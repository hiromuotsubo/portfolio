import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import build_journey_v3_macro_massing as phase1c  # noqa: E402
import journey_v3_macro_v002_config as config  # noqa: E402

phase1c.config = config

PHASE1B_BLEND = PROJECT_ROOT / "work/blender/journey-v3/phase1b/journey-v3-spatial-reference-v001.blend"
DEFAULT_OUTPUT = PROJECT_ROOT / "work/blender/journey-v3/phase1c/journey-v3-macro-massing-v002.blend"
DEFAULT_REVIEW_OUTPUT = PROJECT_ROOT / "work/blender/journey-v3/phase1c/candidate-a2-b2-review.blend"
DEFAULT_RENDER_DIR = PROJECT_ROOT / "docs/references/journey-v3/baselines/massing"
DEFAULT_VALIDATION = DEFAULT_RENDER_DIR / "phase-1c1-v002-structure-validation.json"


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR)
    parser.add_argument("--validation-output", type=Path, default=DEFAULT_VALIDATION)
    parser.add_argument("--review-only", action="store_true")
    parser.add_argument("--selected", choices=sorted(config.CANDIDATES), default=None)
    parser.add_argument("--skip-renders", action="store_true")
    return parser.parse_args(values)


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def lerp(left, right, amount):
    return left + (right - left) * amount


def smoothstep(edge0, edge1, value):
    return phase1c.smoothstep(edge0, edge1, value)


def gaussian(value, center, width):
    return phase1c.gaussian(value, center, width)


def tent(value, center, width):
    return max(0.0, 1.0 - abs(value - center) / max(width, 1e-6))


def peak_chain(value, peaks):
    # Broad, zero-slope crests avoid the isolated needle profile produced by
    # linear tents while retaining authored shoulders and saddles.
    return sum(
        amplitude * max(0.0, 1.0 - (abs(value - center) / max(width, 1e-6)) ** 1.65)
        for center, amplitude, width in peaks
    )


def empty_weights(**overrides):
    result = {name: 0.0 for name in config.ZONE_COLORS}
    result.update(overrides)
    return result


def natural_zone_weights(z, t, drainage, side, y, slope_break, valley_factor=0.0):
    elevation = clamp((z - 8.0) / 125.0)
    slope = clamp(0.22 + abs(t - 0.5) * 0.72 + slope_break * 0.45 + elevation * 0.25)
    aspect = clamp(0.52 + side * 0.12 + 0.16 * math.sin(y * 0.013 + side))
    curvature = clamp(0.25 + slope_break * 0.55 + drainage * 0.34)
    rock = clamp((elevation - 0.30) * 1.45 + slope * 0.52 + curvature * 0.22)
    snow = clamp((elevation - 0.73) * 3.2 + drainage * 0.18 + (1.0 - aspect) * 0.12)
    forest_center = 0.34 + 0.08 * aspect - 0.05 * drainage
    forest = clamp((1.0 - abs(elevation - forest_center) * 2.8) * (1.0 - rock * 0.68))
    forest *= clamp(0.72 + valley_factor * 0.25 + (1.0 - slope) * 0.22)
    grass = clamp((1.0 - rock) * (1.0 - snow) * (0.78 - forest * 0.40))
    wet = clamp(drainage * (1.0 - elevation) * 0.72 + valley_factor * 0.24)
    wind = clamp((grass * 0.88 + forest * 0.62) * (1.0 - rock) * (1.0 - snow))
    return empty_weights(
        ROCK=rock,
        GRASS=grass,
        FOREST=forest,
        SNOW=snow,
        WET=wet,
        WIND_REACTIVE_VEGETATION=wind,
    )


def blended_zone_color(weights):
    names = ["ROCK", "GRASS", "FOREST", "SNOW", "WET", "FLOWER_POTENTIAL", "RIVER_EXCLUSION"]
    total = sum(max(weights.get(name, 0.0), 0.0) for name in names)
    if total < 1e-8:
        return (0.3, 0.3, 0.3, 1.0)
    return tuple(
        sum(config.ZONE_COLORS[name][channel] * max(weights.get(name, 0.0), 0.0) for name in names) / total
        for channel in range(4)
    )


def create_mesh(name, vertices, faces, weights, collection, materials, candidate, role, selected=False):
    obj = phase1c.create_mesh_object(
        name,
        vertices,
        faces,
        weights,
        collection,
        materials,
        candidate,
        role,
        selected,
    )
    color_attribute = obj.data.color_attributes.get("ZONE_REVIEW_COLOR")
    for index, entry in enumerate(weights):
        color_attribute.data[index].color = blended_zone_color(entry)
    obj["journey_phase"] = "1C.1"
    obj["visual_version"] = "v002"
    return obj


def valley_half_width(y, settings):
    amount = clamp(y / 370.0)
    return lerp(settings["valley_near"], settings["valley_far"], amount)


def valley_center(y, settings):
    diagonal = settings["valley_bias"] * smoothstep(40.0, 320.0, y)
    return diagonal + 7.0 * math.sin(y * 0.010 + settings["valley_bias"] * 0.02)


def river_sample(y, settings):
    stations = list(zip(config.RIVER_Y, settings["river_centers"], config.RIVER_HALF_WIDTH, config.RIVER_BED_Z))
    if y <= stations[0][0]:
        _, center, width, z = stations[0]
        return center, width * settings["river_width_scale"], z
    if y >= stations[-1][0]:
        _, center, width, z = stations[-1]
        return center, width * settings["river_width_scale"], z
    for left, right in zip(stations, stations[1:]):
        if left[0] <= y <= right[0]:
            amount = (y - left[0]) / (right[0] - left[0])
            return (
                lerp(left[1], right[1], amount),
                lerp(left[2], right[2], amount) * settings["river_width_scale"],
                lerp(left[3], right[3], amount),
            )
    raise RuntimeError("River interpolation failed")


def side_range(candidate, side, name, collection, materials, selected=False):
    settings = config.CANDIDATES[candidate]
    side_settings = settings["left" if side < 0 else "right"]
    nx, ny = 56, 76
    vertices = []
    weights = []
    y_start = side_settings["start_y"]
    y_end = side_settings["end_y"]
    for y_index in range(ny):
        v = y_index / (ny - 1)
        y = lerp(y_start, y_end, v)
        inner = valley_center(y, settings) + side * valley_half_width(y, settings)
        outer = side * side_settings["outer"]
        height_chain = side_settings["base"] + peak_chain(y, side_settings["peaks"])
        entry_ramp = smoothstep(y_start, y_start + 46.0, y)
        for x_index in range(nx):
            t = x_index / (nx - 1)
            x = lerp(inner, outer, t)
            ridge_center = side_settings["ridge_center"] + 0.045 * math.sin(y * 0.012 + side)
            main_face = tent(t, ridge_center, side_settings["ridge_width"]) ** 1.12
            outer_shoulder = 0.42 * tent(t, ridge_center + 0.27, 0.27) ** 1.05
            valley_spur = 0.24 * tent(t, 0.19 + 0.025 * math.sin(y * 0.018), 0.15)
            profile = (main_face + outer_shoulder + valley_spur) * max(math.sin(math.pi * t), 0.0) ** 0.34
            # A low-frequency slope break creates planar macro faces without noisy inflation.
            break_line = ridge_center - 0.12 + 0.035 * math.sin(y * 0.015 + side * 0.6)
            slope_break = smoothstep(break_line - 0.035, break_line + 0.035, t)
            planar_factor = 0.90 + 0.16 * slope_break - 0.08 * smoothstep(0.70, 0.82, t)
            z = 1.6 + 0.018 * y + entry_ramp * height_chain * profile * planar_factor
            drainage = 0.0
            for channel_index, base_t in enumerate((0.27, 0.49, 0.69)):
                channel_center = base_t + 0.045 * math.sin(y * (0.010 + channel_index * 0.002) + side)
                channel = tent(t, channel_center, 0.050 + channel_index * 0.008) ** 1.4
                drainage += channel
                z -= channel * side_settings["erosion"] * (6.5 + channel_index * 1.8) * entry_ramp
            z -= tent(t, ridge_center + 0.08, 0.15) * tent(y, side_settings["peaks"][1][0], 70.0) * 5.0
            vertices.append((x, y, z))
            weights.append(natural_zone_weights(z, t, clamp(drainage), side, y, slope_break))
    faces = []
    for y_index in range(ny - 1):
        for x_index in range(nx - 1):
            start = y_index * nx + x_index
            faces.append((start, start + 1, start + nx + 1, start + nx))
    return create_mesh(name, vertices, faces, weights, collection, materials, candidate, "dominant-massif" if side == settings["dominant_side"] else "receding-side-ridges", selected)


def distant_range(candidate, layer, name, collection, materials, selected=False):
    settings = config.CANDIDATES[candidate]
    nx, ny = 104, 18
    y_start = (300.0 if layer == 1 else 414.0) + (10.0 if candidate == "B2" else 0.0)
    y_end = y_start + (108.0 if layer == 1 else 122.0)
    x_extent = 310.0 if layer == 1 else 348.0
    layer_scale = settings["far_scale"] * (1.0 if layer == 1 else 0.86)
    peak_centers = [-252, -186, -116, -44, 28, 102, 178, 248]
    peak_heights = [32, 49, 58, 43, 52, 64, 48, 36] if layer == 1 else [28, 42, 50, 57, 47, 54, 44, 31]
    vertices = []
    weights = []
    for y_index in range(ny):
        depth = y_index / (ny - 1)
        y = lerp(y_start, y_end, depth)
        depth_profile = max(math.sin(math.pi * depth), 0.0) ** 0.52
        for x_index in range(nx):
            u = x_index / (nx - 1)
            x = lerp(-x_extent, x_extent, u)
            shifted_x = x - settings["far_bias"]
            skyline = 14.0
            for center, height in zip(peak_centers, peak_heights):
                distance = abs(shifted_x - center) / (94.0 if layer == 1 else 106.0)
                skyline += height * max(0.0, 1.0 - distance ** 1.72) * 0.62
            # The central saddle remains mountainous; it is never cut to an empty slit.
            skyline -= 10.0 * tent(shifted_x, settings["valley_bias"], 54.0)
            planar_break = smoothstep(-0.1, 0.1, math.sin(shifted_x * 0.021 + layer))
            z = 2.2 + 0.017 * y + depth_profile * skyline * layer_scale * (0.94 + planar_break * 0.08)
            drainage = clamp(sum(tent(shifted_x, center + 28.0, 14.0) for center in peak_centers[1:-1]) * 0.30)
            z -= drainage * depth_profile * (5.5 if layer == 1 else 4.0)
            vertices.append((x, y, z))
            weights.append(natural_zone_weights(z, u, drainage, -1 if x < 0 else 1, y, planar_break))
    faces = []
    for y_index in range(ny - 1):
        for x_index in range(nx - 1):
            start = y_index * nx + x_index
            faces.append((start, start + 1, start + nx + 1, start + nx))
    return create_mesh(name, vertices, faces, weights, collection, materials, candidate, "midground-range" if layer == 1 else "distant-range", selected)


def continuous_ground(candidate, name, collection, materials, meadow, selected=False):
    settings = config.CANDIDATES[candidate]
    nx = 47
    ny = 38 if meadow else 32
    y_start, y_end = (-42.0, 182.0) if meadow else (150.0, 388.0)
    vertices = []
    weights = []
    for y_index in range(ny):
        v = y_index / (ny - 1)
        y = lerp(y_start, y_end, v)
        center, river_width, bed_z = river_sample(y, settings)
        base_extent = settings["meadow_extent"] if meadow else 190.0
        left_extent = base_extent + 9.0 * math.sin(y * 0.023 + 0.8) + (12.0 if candidate == "B2" else 0.0)
        right_extent = base_extent * 0.90 + 11.0 * math.sin(y * 0.019 - 0.5)
        for x_index in range(nx):
            u = x_index / (nx - 1)
            x = lerp(-left_extent, right_extent, u)
            distance = abs(x - center)
            rolling = 1.02 * math.sin(x * 0.021 + y * 0.018) + 0.46 * math.sin(x * 0.047 - y * 0.012)
            rolling += 0.42 * gaussian(x, -72.0 + 0.10 * y, 34.0) - 0.34 * gaussian(x, 58.0 - 0.06 * y, 28.0)
            side_rise = 0.010 * max(distance - river_width, 0.0)
            channel = gaussian(distance, 0.0, river_width * 1.18)
            z = bed_z + 2.05 + side_rise + rolling - channel * 2.88
            if not meadow:
                z += 0.0045 * (y - y_start)
            river_exclusion = clamp(1.0 - (distance - river_width * 0.72) / max(river_width * 0.90, 1.0))
            wet = clamp(1.0 - (distance - river_width) / 18.0)
            valley_factor = clamp(1.0 - distance / max(valley_half_width(y, settings), 1.0))
            flower_cluster = 0.0
            if meadow:
                cluster_field = 0.55 + 0.24 * math.sin(x * 0.032 + y * 0.041) + 0.16 * math.sin(x * 0.018 - y * 0.027)
                flower_cluster = clamp(cluster_field * (1.0 - river_exclusion) * smoothstep(12.0, 42.0, y) * (1.0 - smoothstep(150.0, 182.0, y)))
            grass = clamp(0.82 - wet * 0.34)
            forest = clamp((0.10 if meadow else 0.32) + abs(u - 0.5) * (0.16 if meadow else 0.38))
            wind = clamp(grass * 0.92 + forest * 0.58 + flower_cluster * 0.22)
            weights.append(empty_weights(
                ROCK=clamp((distance - river_width - 42.0) / 95.0) * (0.18 if meadow else 0.32),
                GRASS=grass,
                FOREST=forest,
                WET=wet,
                FLOWER_POTENTIAL=flower_cluster,
                RIVER_EXCLUSION=river_exclusion,
                WIND_REACTIVE_VEGETATION=wind * (1.0 - river_exclusion),
            ))
            vertices.append((x, y, z))
    faces = []
    for y_index in range(ny - 1):
        for x_index in range(nx - 1):
            start = y_index * nx + x_index
            faces.append((start, start + 1, start + nx + 1, start + nx))
    role = "continuous-meadow-terrain" if meadow else "continuous-valley-floor"
    return create_mesh(name, vertices, faces, weights, collection, materials, candidate, role, selected)


def river_objects(candidate, names, collection, materials, selected=False):
    settings = config.CANDIDATES[candidate]
    y_values = [-42.0 + index * (402.0 / 49.0) for index in range(50)]
    bed_vertices = []
    bed_weights = []
    cross_count = 13
    for y in y_values:
        center, width, bed_z = river_sample(y, settings)
        width *= 0.96 + 0.055 * math.sin(y * 0.029 + 0.4)
        for index in range(cross_count):
            amount = index / (cross_count - 1)
            lateral = lerp(-width, width, amount)
            z = bed_z - 0.30 * (1.0 - abs(amount * 2.0 - 1.0))
            bed_vertices.append((center + lateral, y, z))
            bed_weights.append(empty_weights(WET=0.88, RIVER_EXCLUSION=1.0))
    bed_faces = []
    for y_index in range(len(y_values) - 1):
        for x_index in range(cross_count - 1):
            start = y_index * cross_count + x_index
            bed_faces.append((start, start + 1, start + cross_count + 1, start + cross_count))
    bed = create_mesh(names["bed"], bed_vertices, bed_faces, bed_weights, collection, materials, candidate, "single-riverbed", selected)

    banks = []
    for side, key in ((-1, "left_bank"), (1, "right_bank")):
        vertices = []
        weights = []
        bank_cross = 5
        for y in y_values:
            center, width, bed_z = river_sample(y, settings)
            irregular = 1.0 + 0.10 * math.sin(y * 0.041 + side * 1.2) + 0.055 * math.sin(y * 0.017 - side)
            boundary = center + side * width * irregular
            bank_width = 4.2 + 1.6 * math.sin(y * 0.024 + side)
            for index in range(bank_cross):
                amount = index / (bank_cross - 1)
                x = boundary + side * amount * bank_width
                z = bed_z + lerp(0.30, 1.80, smoothstep(0.0, 1.0, amount))
                z += 0.12 * math.sin(y * 0.037 + amount * 2.2 + side)
                vertices.append((x, y, z))
                weights.append(empty_weights(
                    ROCK=0.20 + amount * 0.18,
                    GRASS=amount * 0.46,
                    WET=1.0 - amount * 0.72,
                    RIVER_EXCLUSION=1.0 - amount * 0.70,
                    WIND_REACTIVE_VEGETATION=amount * 0.38,
                ))
        faces = []
        for y_index in range(len(y_values) - 1):
            for x_index in range(bank_cross - 1):
                start = y_index * bank_cross + x_index
                faces.append((start, start + 1, start + bank_cross + 1, start + bank_cross))
        banks.append(create_mesh(names[key], vertices, faces, weights, collection, materials, candidate, "irregular-riverbank", selected))
    return [bed, *banks]


def make_curve_material(name, color):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = 1.8
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    material.diffuse_color = color
    material["diagnostic_only"] = True
    material["export_enabled"] = False
    return material


def create_curve(name, points, collection, material, width=0.35, render=False):
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = width
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*coordinate, 1.0)
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.data.materials.append(material)
    obj.hide_render = not render
    obj["journey_role"] = "macro-guide"
    obj["export_enabled"] = False
    return obj


def build_guides(candidate, collection):
    settings = config.CANDIDATES[candidate]
    center_material = make_curve_material("MAT_V002_GUIDE_RIVER_CENTER", (0.02, 0.55, 1.0, 1.0))
    bank_material = make_curve_material("MAT_V002_GUIDE_BANK", (1.0, 0.38, 0.05, 1.0))
    center_points = []
    left_points = []
    right_points = []
    for y in config.RIVER_Y:
        center, width, bed_z = river_sample(y, settings)
        center_points.append((center, y, bed_z + 0.55))
        left_points.append((center - width, y, bed_z + 1.10))
        right_points.append((center + width, y, bed_z + 1.10))
    return [
        create_curve("GUIDE_V002_RIVER_CENTERLINE", center_points, collection, center_material, 0.55),
        create_curve("GUIDE_V002_LEFT_BANK", left_points, collection, bank_material, 0.38),
        create_curve("GUIDE_V002_RIGHT_BANK", right_points, collection, bank_material, 0.38),
    ]


def build_materials():
    materials = phase1c.build_materials()
    materials["clay_ground"] = phase1c.material("MAT_V002_CLAY_GROUND", (0.38, 0.40, 0.35, 1.0), 0.94)
    materials["clay_river"] = phase1c.material("MAT_V002_CLAY_RIVER", (0.11, 0.29, 0.36, 1.0), 0.78)
    materials["clay_bank"] = phase1c.material("MAT_V002_CLAY_BANK", (0.31, 0.30, 0.27, 1.0), 0.92)
    materials["clay_cave"] = phase1c.material("MAT_V002_CLAY_CAVE", (0.035, 0.050, 0.055, 1.0), 0.98)
    materials["silhouette"] = phase1c.material("MAT_V002_SILHOUETTE", (0.015, 0.018, 0.02, 1.0), 1.0)
    return materials


def create_candidate(candidate, collection, materials, selected=False):
    prefix = "V3_V002" if selected else f"CANDIDATE_{candidate}"
    names = {
        "primary": f"{prefix}_PRIMARY_MASSIF",
        "opposing": f"{prefix}_OPPOSING_RIDGES",
        "mid": f"{prefix}_MIDGROUND_RANGE",
        "far": f"{prefix}_DISTANT_RANGE",
        "valley": f"{prefix}_VALLEY_FLOOR",
        "meadow": f"{prefix}_MEADOW_BASE",
        "bed": f"{prefix}_RIVERBED_PROXY",
        "left_bank": f"{prefix}_LEFT_RIVERBANK_PROXY",
        "right_bank": f"{prefix}_RIGHT_RIVERBANK_PROXY",
    }
    dominant_side = config.CANDIDATES[candidate]["dominant_side"]
    objects = [
        side_range(candidate, dominant_side, names["primary"], collection, materials, selected),
        side_range(candidate, -dominant_side, names["opposing"], collection, materials, selected),
        distant_range(candidate, 1, names["mid"], collection, materials, selected),
        distant_range(candidate, 2, names["far"], collection, materials, selected),
        continuous_ground(candidate, names["valley"], collection, materials, False, selected),
        continuous_ground(candidate, names["meadow"], collection, materials, True, selected),
    ]
    objects.extend(river_objects(candidate, names, collection, materials, selected))
    return objects


def setup_scene(materials, guide_collection):
    scene = bpy.context.scene
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.render.engine = "BLENDER_EEVEE"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("V002_DIAGNOSTIC_WORLD")
    scene.world.color = (0.07, 0.11, 0.13)
    scene.world.use_nodes = True
    background = next((node for node in scene.world.node_tree.nodes if node.bl_idname == "ShaderNodeBackground"), None)
    background.inputs["Color"].default_value = (0.14, 0.29, 0.36, 1.0)
    background.inputs["Strength"].default_value = 0.38
    sun_data = bpy.data.lights.new("V002_DIAGNOSTIC_SUN_DATA", "SUN")
    sun_data.energy = 1.45
    sun_data.angle = math.radians(5.5)
    sun = bpy.data.objects.new("V002_DIAGNOSTIC_SUN", sun_data)
    sun.rotation_euler = (math.radians(42), math.radians(-22), math.radians(-36))
    sun["export_enabled"] = False
    guide_collection.objects.link(sun)

    top_data = bpy.data.cameras.new("CAM_V002_TOP_DATA")
    top_data.type = "ORTHO"
    top_data.ortho_scale = 660.0
    top = bpy.data.objects.new("CAM_V002_TOP", top_data)
    top.location = (0.0, 250.0, 520.0)
    top.rotation_euler = (0.0, 0.0, 0.0)
    guide_collection.objects.link(top)

    side_data = bpy.data.cameras.new("CAM_V002_SIDE_DATA")
    side_data.type = "ORTHO"
    side_data.ortho_scale = 540.0
    side = bpy.data.objects.new("CAM_V002_SIDE", side_data)
    side.location = (540.0, 250.0, 120.0)
    direction = Vector((0.0, 255.0, 45.0)) - side.location
    side.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    guide_collection.objects.link(side)
    return top, side


def reference_objects():
    result = []
    for collection_name in ("V1_MAIN_SPATIAL_REFERENCE_LOCKED", "V1_PHASE2_ENV_REFERENCE_LOCKED"):
        result.extend(phase1c.collection_recursive_objects(bpy.data.collections[collection_name]))
    return result


def render_all(render_dir, candidates, selected_key, materials, cameras, top_camera, side_camera, references, guides):
    render_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    all_objects = [obj for values in candidates.values() for obj in values]
    material_states = {obj: (list(obj.data.materials), [p.material_index for p in obj.data.polygons]) for obj in all_objects}
    reference_visibility = {obj: obj.hide_render for obj in references}
    reference_material_states = {
        obj: (list(obj.data.materials), [p.material_index for p in obj.data.polygons])
        for obj in references
        if obj.type == "MESH" and obj.data is not None
    }
    rendered = []

    def restore(obj):
        original_materials, original_indices = material_states[obj]
        obj.data.materials.clear()
        for material in original_materials:
            obj.data.materials.append(material)
        for polygon, index in zip(obj.data.polygons, original_indices):
            polygon.material_index = index

    def single_material(obj, material):
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.material_index = 0

    def configure(key, camera, mode, cave=False, show_guides=False):
        for obj in all_objects:
            obj.hide_render = obj not in candidates[key]
            if obj in candidates[key]:
                if mode == "zones":
                    single_material(obj, materials["zone_review"])
                elif mode == "silhouette":
                    single_material(obj, materials["silhouette"])
                else:
                    role = obj.get("journey_role")
                    if role == "single-riverbed":
                        single_material(obj, materials["clay_river"])
                    elif role == "irregular-riverbank":
                        single_material(obj, materials["clay_bank"])
                    elif role in {"continuous-meadow-terrain", "continuous-valley-floor"}:
                        single_material(obj, materials["clay_ground"])
                    else:
                        single_material(obj, materials["clay"])
        for obj in references:
            retain = any(token in obj.name for token in config.RETAINED_STORY_TOKENS)
            obj.hide_render = not (cave and retain and obj.name not in config.REPLACED_REFERENCE_OBJECTS)
            if cave and retain and obj in reference_material_states:
                single_material(obj, materials["clay_cave"])
        for guide in guides:
            guide.hide_render = not show_guides
        scene.camera = camera
        bpy.context.view_layer.material_override = None
        bpy.context.view_layer.update()

    def render(key, camera, mode, cave, filename, show_guides=False):
        configure(key, camera, mode, cave, show_guides)
        path = render_dir / filename
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        rendered.append(str(path))

    for key in ("A2", "B2"):
        slug = key.lower()
        render(key, cameras["CAM_V3_DAY_CLEAR_START_1440x900"], "clay", False, f"candidate-{slug}-day-clear-clay.png")
        render(key, cameras["CAM_V3_SWEEP_P013_50"], "clay", True, f"candidate-{slug}-cave-composite.png")
        render(key, cameras["CAM_V3_DAY_CLEAR_START_1440x900"], "silhouette", False, f"candidate-{slug}-silhouette.png")
        render(key, top_camera, "clay", False, f"candidate-{slug}-top-view.png")

    if selected_key:
        render(selected_key, cameras["CAM_V3_DAY_CLEAR_START_1440x900"], "clay", False, "selected-v002-day-clear-clay.png")
        render(selected_key, cameras["CAM_V3_DAY_CLEAR_START_1440x900"], "zones", False, "selected-v002-day-clear-zones.png")
        render(selected_key, cameras["CAM_V3_DAY_CLEAR_START_1440x900"], "clay", False, "selected-v002-day-clear-river-guides.png", True)
        render(selected_key, cameras["CAM_V3_DAY_CLEAR_START_1440x900"], "silhouette", False, "selected-v002-silhouette.png")
        render(selected_key, top_camera, "clay", False, "selected-v002-top-view.png")
        render(selected_key, side_camera, "clay", False, "selected-v002-side-view.png")
        for progress in config.CAMERA_SWEEP_PROGRESS:
            camera_name = f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_")
            filename = f"selected-v002-sweep-p{progress:05.2f}.png".replace(".", "_", 1)
            render(selected_key, cameras[camera_name], "clay", progress <= 20.0, filename)
        for progress in config.CAVE_REVIEW_PROGRESS:
            camera_name = "CAM_V3_DAY_CLEAR_START_1440x900" if progress == 30.0 else f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_")
            filename = f"selected-v002-cave-p{progress:05.2f}.png".replace(".", "_", 1)
            render(selected_key, cameras[camera_name], "clay", True, filename)

    for obj in all_objects:
        restore(obj)
    for obj, hidden in reference_visibility.items():
        obj.hide_render = hidden
    for obj, (original_materials, original_indices) in reference_material_states.items():
        obj.data.materials.clear()
        for material in original_materials:
            obj.data.materials.append(material)
        for polygon, index in zip(obj.data.polygons, original_indices):
            polygon.material_index = index
    for guide in guides:
        guide.hide_render = True
    return rendered


def mesh_record(obj):
    return phase1c.object_record(obj)


def camera_review_v002(cameras, selected_objects):
    mountain_roles = {"dominant-massif", "receding-side-ridges", "midground-range", "distant-range"}
    mountains = [obj for obj in selected_objects if obj.get("journey_role") in mountain_roles]
    meadow = next(obj for obj in selected_objects if obj.get("journey_role") == "continuous-meadow-terrain")
    river = next(obj for obj in selected_objects if obj.get("journey_role") == "single-riverbed")
    results = []
    for camera in cameras:
        minimum_distance = float("inf")
        visible_mountains = 0
        for obj in mountains:
            stride = max(1, len(obj.data.vertices) // 1800)
            for index in range(0, len(obj.data.vertices), stride):
                world = obj.matrix_world @ obj.data.vertices[index].co
                minimum_distance = min(minimum_distance, (world - camera.matrix_world.translation).length)
                projection = world_to_camera_view(bpy.context.scene, camera, world)
                if 0 <= projection.x <= 1 and 0 <= projection.y <= 1 and projection.z > 0:
                    visible_mountains += 1
        river_visible = 0
        for vertex in river.data.vertices:
            projection = world_to_camera_view(bpy.context.scene, camera, river.matrix_world @ vertex.co)
            if 0 <= projection.x <= 1 and 0 <= projection.y <= 1 and projection.z > 0:
                river_visible += 1
        meadow_visible_y = []
        for vertex in meadow.data.vertices:
            projection = world_to_camera_view(bpy.context.scene, camera, meadow.matrix_world @ vertex.co)
            if 0 <= projection.x <= 1 and projection.z > 0:
                meadow_visible_y.append(projection.y)
        results.append({
            "camera": camera.name,
            "progress": camera.get("progress"),
            "minimumMountainVertexDistance": minimum_distance,
            "mountainVisibleSampleCount": visible_mountains,
            "riverVisibleSampleCount": river_visible,
            "meadowVisibleYRange": [min(meadow_visible_y, default=None), max(meadow_visible_y, default=None)],
        })
    return results


def main():
    args = parse_args()
    if args.review_only and args.selected:
        raise RuntimeError("--review-only and --selected are mutually exclusive")
    selected_key = None if args.review_only else args.selected
    if not args.review_only and selected_key is None:
        raise RuntimeError("Final v002 build requires --selected after A2/B2 review")
    output = (args.output or (DEFAULT_REVIEW_OUTPUT if args.review_only else DEFAULT_OUTPUT)).resolve()
    render_dir = args.render_dir.resolve()
    validation_output = args.validation_output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    validation_output.parent.mkdir(parents=True, exist_ok=True)

    source_hash = phase1c.sha256_file(PHASE1B_BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(PHASE1B_BLEND))
    locked_before = phase1c.reference_signature()
    environment_root = bpy.data.collections["V3_ENVIRONMENT_WORK"]
    if environment_root.children or environment_root.objects:
        raise RuntimeError("Phase 1B V3_ENVIRONMENT_WORK is not empty")
    environment_root["journey_phase"] = "1C.1"
    environment_root["visual_version"] = "v002"
    environment_root["selected_candidate"] = selected_key or "PENDING_A2_B2_REVIEW"

    selected_collection = phase1c.new_collection("V3_MACRO_V002_SELECTED", environment_root)
    alternatives = phase1c.new_collection("V3_MACRO_V002_ALTERNATIVES", environment_root)
    a2_collection = phase1c.new_collection("V3_MACRO_V002_CANDIDATE_A2", alternatives)
    b2_collection = phase1c.new_collection("V3_MACRO_V002_CANDIDATE_B2", alternatives)
    guide_collection = phase1c.new_collection("V3_MACRO_V002_GUIDES", environment_root)
    zone_collection = phase1c.new_collection("V3_MACRO_V002_ZONE_GUIDES", environment_root)
    phase1c.set_collection_role(selected_collection, "selected-v002", bool(selected_key), bool(selected_key))
    phase1c.set_collection_role(alternatives, "v002-alternatives", False)
    phase1c.set_collection_role(a2_collection, "candidate-a2", False)
    phase1c.set_collection_role(b2_collection, "candidate-b2", False)
    phase1c.set_collection_role(guide_collection, "v002-guides", False)
    phase1c.set_collection_role(zone_collection, "v002-zone-guides", False)

    materials = build_materials()
    candidates = {
        "A2": create_candidate("A2", a2_collection, materials, False),
        "B2": create_candidate("B2", b2_collection, materials, False),
    }
    if selected_key:
        selected_objects = create_candidate(selected_key, selected_collection, materials, True)
    else:
        selected_objects = []

    guide_source = selected_key or "A2"
    guides = build_guides(guide_source, guide_collection)
    for zone_name in config.ZONE_COLORS:
        empty = bpy.data.objects.new(f"ZONE_V002_{zone_name}", None)
        empty.hide_render = True
        empty["zone_name"] = zone_name
        empty["export_enabled"] = False
        zone_collection.objects.link(empty)
    top_camera, side_camera = setup_scene(materials, guide_collection)

    camera_objects = [obj for obj in bpy.data.collections["V3_CAMERA_BASELINES"].objects if obj.type == "CAMERA"]
    cameras = {obj.name: obj for obj in camera_objects}
    required = {
        "CAM_V3_DAY_CLEAR_START_1440x900",
        *{f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_") for progress in config.CAMERA_SWEEP_PROGRESS},
    }
    missing = sorted(required - set(cameras))
    if missing:
        raise RuntimeError(f"Missing Phase 1B cameras: {missing}")

    refs = reference_objects()
    rendered = []
    if not args.skip_renders:
        if selected_key:
            final_render_candidates = {"A2": candidates["A2"], "B2": candidates["B2"], "SELECTED": selected_objects}
        else:
            final_render_candidates = candidates
        rendered = render_all(render_dir, final_render_candidates, "SELECTED" if selected_key else None, materials, cameras, top_camera, side_camera, refs, guides)

    for obj in candidates["A2"] + candidates["B2"]:
        obj.hide_render = True
        obj.hide_viewport = True
    for obj in selected_objects:
        obj.hide_render = False
        obj.hide_viewport = False
    bpy.context.scene.camera = cameras["CAM_V3_DAY_CLEAR_START_1440x900"]

    locked_after = phase1c.reference_signature()
    if locked_before["sha256"] != locked_after["sha256"]:
        raise RuntimeError("Locked Phase 1B reference changed")
    if phase1c.sha256_file(PHASE1B_BLEND) != source_hash:
        raise RuntimeError("Phase 1B source Blend changed")

    candidate_records = {key: [mesh_record(obj) for obj in candidates[key]] for key in ("A2", "B2")}
    selected_records = [mesh_record(obj) for obj in selected_objects]
    camera_review = camera_review_v002(camera_objects, selected_objects) if selected_objects else []
    minimum_distance = min((entry["minimumMountainVertexDistance"] for entry in camera_review), default=None)
    if minimum_distance is not None and minimum_distance < 30.0:
        raise RuntimeError(f"Selected v002 enters camera guard band: {minimum_distance}")
    structure = {
        "schemaVersion": 2,
        "phase": "Journey V3 Phase 1C.1",
        "visualVersion": "v002",
        "sourceBlend": str(PHASE1B_BLEND),
        "sourceBlendSha256": source_hash,
        "protectedV001Blend": str(PROJECT_ROOT / "work/blender/journey-v3/phase1c/journey-v3-macro-massing-v001.blend"),
        "protectedV001Sha256": phase1c.sha256_file(PROJECT_ROOT / "work/blender/journey-v3/phase1c/journey-v3-macro-massing-v001.blend"),
        "outputBlend": str(output),
        "reviewOnly": args.review_only,
        "selectedCandidate": selected_key,
        "candidateIntent": {key: value["label"] for key, value in config.CANDIDATES.items()},
        "lockedReferenceSignatureBefore": locked_before["sha256"],
        "lockedReferenceSignatureAfter": locked_after["sha256"],
        "lockedReferenceUnchanged": locked_before["sha256"] == locked_after["sha256"],
        "candidateObjects": candidate_records,
        "selectedObjects": selected_records,
        "guides": sorted(obj.name for obj in guides),
        "zones": sorted(config.ZONE_COLORS),
        "cameraReview": camera_review,
        "minimumMountainCameraDistance": minimum_distance,
        "renderedFiles": rendered,
        "deterministicSignature": None,
    }
    deterministic_payload = {key: value for key, value in structure.items() if key not in {"outputBlend", "renderedFiles", "deterministicSignature"}}
    structure["deterministicSignature"] = hashlib.sha256(json.dumps(deterministic_payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    with open(validation_output, "w", encoding="utf-8") as handle:
        json.dump(structure, handle, indent=2)
        handle.write("\n")
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    print(json.dumps({
        "output": str(output),
        "reviewOnly": args.review_only,
        "selectedCandidate": selected_key,
        "v001Sha256": structure["protectedV001Sha256"],
        "lockedReferenceUnchanged": structure["lockedReferenceUnchanged"],
        "minimumMountainCameraDistance": minimum_distance,
        "deterministicSignature": structure["deterministicSignature"],
        "renders": len(rendered),
    }, indent=2))


if __name__ == "__main__":
    main()
