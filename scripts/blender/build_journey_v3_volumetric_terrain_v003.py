"""Build Journey V3 Phase 1C.2 v003 as one carved volumetric terrain system."""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from mathutils.bvhtree import BVHTree


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))

import build_journey_v3_macro_massing as phase1c  # noqa: E402
import journey_v3_volumetric_v003_config as config  # noqa: E402


SOURCE_BLEND = PROJECT_ROOT / "work/blender/journey-v3/phase1c/journey-v3-macro-massing-v002.blend"
CAMERA_GLB = PROJECT_ROOT / "work/blender/journey-v3/phase1c2/reference/journey-v3-full-story-cameras.glb"
DEFAULT_OUTPUT = PROJECT_ROOT / "work/blender/journey-v3/phase1c2/journey-v3-volumetric-terrain-v003.blend"
DEFAULT_RENDER_DIR = PROJECT_ROOT / "docs/references/journey-v3/baselines/volumetric"
DEFAULT_VALIDATION = DEFAULT_RENDER_DIR / "phase-1c2-v003-structure-validation.json"

OLD_ENVIRONMENT = {
    "TER_V13_FICTIONAL_NAGANO_MASSIF",
    "MTN_V13_FAR_CENTRAL_RIDGE",
    "BAR_V13_LEFT_MID",
    "BAR_V13_RIGHT_FOREGROUND",
    "RIV_V13_EMERALD_S_WATER.001",
    "RIV_V13_VISIBLE_PEBBLE_BED.001",
    "FX_V13_WATER_RIPPLES",
    "WEB_RIVERBANK_ROCKS_PLACED_00",
    "WEB_RIVERBANK_ROCKS_PLACED_01",
    "P2_RIDGE_MID",
    "P2_RIDGE_FAR",
    "P2_FOREST_MID_CANOPY",
    "P2_SHORE_WET_LEFT",
    "P2_SHORE_WET_RIGHT",
    "P2_CLOUD_FAR",
}
CAVE_NAMES = {
    "CAVE_HQ_INTERIOR_SHELL",
    "CAVE_HQ_GROUND",
    "CAVE_HQ_FLOOR_WATER",
    "WEB_CAVE_HQ_DEBRIS_00",
    "WEB_CAVE_HQ_DEBRIS_01",
    "WEB_CAVE_HQ_HANGING_PLANTS_00",
    "WEB_CAVE_HQ_MOSS_00",
}
CORE_CAVE_NAMES = {"CAVE_HQ_INTERIOR_SHELL", "CAVE_HQ_GROUND", "CAVE_HQ_FLOOR_WATER"}


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR)
    parser.add_argument("--validation-output", type=Path, default=DEFAULT_VALIDATION)
    parser.add_argument("--skip-renders", action="store_true")
    parser.add_argument("--quick-renders", action="store_true")
    return parser.parse_args(values)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smoothstep(edge0, edge1, value):
    amount = clamp((value - edge0) / max(edge1 - edge0, 1e-9))
    return amount * amount * (3.0 - 2.0 * amount)


def lerp(left, right, amount):
    return left + (right - left) * amount


def oriented_gaussian(x, y, field):
    center_x, center_y, amplitude, sigma_x, sigma_y, angle = field
    cosine = math.cos(angle)
    sine = math.sin(angle)
    dx = x - center_x
    dy = y - center_y
    local_x = dx * cosine + dy * sine
    local_y = -dx * sine + dy * cosine
    # Truncated broad Gaussian RBFs keep a finite footprint while avoiding the
    # conical peaks produced by compact linear tents. Overlapping fields build
    # shoulders, saddles and receding depth sections.
    radius_squared = (local_x / sigma_x) ** 2 + (local_y / sigma_y) ** 2
    cutoff_squared = 2.75**2
    if radius_squared >= cutoff_squared:
        return 0.0
    floor = math.exp(-0.5 * cutoff_squared)
    normalized = (math.exp(-0.5 * radius_squared) - floor) / (1.0 - floor)
    return amplitude * normalized**0.88


def connected_field(x, y, fields):
    values = sorted((oriented_gaussian(x, y, field) for field in fields), reverse=True)
    return values[0] + values[1] * 0.30 + values[2] * 0.12 if len(values) >= 3 else sum(values)


def segment_distance(x, y, start, end):
    sx, sy = start
    ex, ey = end
    vx = ex - sx
    vy = ey - sy
    denominator = vx * vx + vy * vy
    if denominator <= 1e-9:
        return math.hypot(x - sx, y - sy)
    amount = clamp(((x - sx) * vx + (y - sy) * vy) / denominator)
    return math.hypot(x - (sx + vx * amount), y - (sy + vy * amount))


def river_sample(y):
    stations = config.RIVER_STATIONS
    if y <= stations[0][0]:
        return stations[0][1], stations[0][2]
    if y >= stations[-1][0]:
        return stations[-1][1], stations[-1][2]
    for left, right in zip(stations, stations[1:]):
        if left[0] <= y <= right[0]:
            amount = (y - left[0]) / (right[0] - left[0])
            return lerp(left[1], right[1], amount), lerp(left[2], right[2], amount)
    raise RuntimeError("River interpolation failed")


def terrain_components(x, y):
    base = 0.12 + y * 0.0105
    near_fade = 1.0 - smoothstep(150.0, 260.0, y)
    rolling = near_fade * (
        0.58 * math.sin(x * 0.024 + y * 0.016)
        + 0.26 * math.sin(x * 0.051 - y * 0.013)
        + 0.14 * math.sin(x * 0.083 + y * 0.037)
    )

    left = connected_field(x, y, config.LEFT_MASSIF_FIELDS)
    right = connected_field(x, y, config.RIGHT_RIDGE_FIELDS)
    distant = connected_field(x, y, config.DISTANT_FIELDS)
    center, river_width = river_sample(y)
    valley_width = lerp(226.0, 116.0, smoothstep(80.0, 1020.0, y))
    valley_mask = math.exp(-((abs(x - center) / valley_width) ** 3.2))
    left *= 1.0 - valley_mask * 0.90
    right *= 1.0 - valley_mask * 0.88
    distant *= 1.0 - valley_mask * 0.28

    mountain = max(left, right, distant)
    secondary = sorted((left, right, distant), reverse=True)[1]
    mountain += secondary * 0.14
    spur = 0.0
    for start, end, amplitude, width in config.SPUR_LINES:
        distance = segment_distance(x, y, start, end)
        spur += amplitude * math.exp(-0.5 * (distance / width) ** 2)
    mountain += spur * smoothstep(8.0, 72.0, mountain)
    drainage = 0.0
    for start, end, amplitude, width in config.DRAINAGE_LINES:
        distance = segment_distance(x, y, start, end)
        drainage += amplitude * math.exp(-0.5 * (distance / width) ** 2)
    drainage *= smoothstep(70.0, 240.0, mountain)
    mountain = max(0.0, mountain - drainage)

    distance_to_river = abs(x - center)
    river_factor = math.exp(-((distance_to_river / max(river_width, 1e-6)) ** 4.0))
    river_depth = lerp(1.65, 0.72, smoothstep(0.0, 900.0, y))
    bank_distance = abs(distance_to_river - river_width * 1.18)
    bank = 0.42 * math.exp(-0.5 * (bank_distance / max(river_width * 0.34, 1.0)) ** 2)
    z = base + rolling + mountain + bank - river_factor * river_depth
    return {
        "z": z,
        "base": base,
        "mountain": mountain,
        "left": left,
        "right": right,
        "distant": distant,
        "drainage": drainage,
        "riverFactor": river_factor,
        "riverWidth": river_width,
        "riverCenter": center,
        "distanceToRiver": distance_to_river,
        "nearFade": near_fade,
    }


def terrain_height(x, y):
    return terrain_components(x, y)["z"]


def zone_weights(x, y, components):
    z = components["z"]
    mountain = components["mountain"]
    river = components["riverFactor"]
    drainage = clamp(components["drainage"] / 24.0)
    elevation = clamp((z - 12.0) / 165.0)
    rock = clamp(elevation * 0.92 + clamp(mountain / 190.0) * 0.35 + drainage * 0.22)
    snow = clamp((elevation - 0.72) * 3.3 + drainage * 0.12)
    forest = clamp((1.0 - abs(elevation - 0.34) * 2.55) * (1.0 - rock * 0.72))
    grass = clamp((1.0 - rock) * (1.0 - snow) * (0.92 - forest * 0.44))
    wet = clamp(river * 0.82 + drainage * 0.38)
    flower_shape = 0.56 + 0.24 * math.sin(x * 0.031 + y * 0.039) + 0.16 * math.sin(x * 0.073 - y * 0.022)
    flower = clamp(
        flower_shape
        * (1.0 - smoothstep(150.0, 215.0, y))
        * (1.0 - river)
        * (1.0 - smoothstep(8.0, 26.0, mountain))
    )
    wind = clamp((grass * 0.88 + forest * 0.62 + flower * 0.35) * (1.0 - rock) * (1.0 - river))
    return {
        "ROCK": rock,
        "GRASS": grass,
        "FOREST": forest,
        "SNOW": snow,
        "WET": wet,
        "FLOWER_POTENTIAL": flower,
        "RIVER_EXCLUSION": river,
        "WIND_REACTIVE_VEGETATION": wind,
    }


def region_weights(x, y, components):
    scale = max(components["left"], components["right"], components["distant"], 1e-6)
    return {
        "V3_LEFT_DOMINANT_MASSIF": clamp(components["left"] / scale) if x < 30 else 0.0,
        "V3_RIGHT_MIDGROUND_RIDGES": clamp(components["right"] / scale) if x > -30 else 0.0,
        "V3_DISTANT_MOUNTAIN_RANGE": clamp(components["distant"] / scale) * smoothstep(500.0, 680.0, y),
        "V3_RIVERBED": components["riverFactor"],
        "V3_MEADOW_TERRAIN": (1.0 - smoothstep(150.0, 220.0, y)) * (1.0 - components["riverFactor"]),
    }


def blended_zone_color(weights):
    names = ["ROCK", "GRASS", "FOREST", "SNOW", "WET", "FLOWER_POTENTIAL", "RIVER_EXCLUSION"]
    total = sum(max(weights[name], 0.0) for name in names)
    if total < 1e-8:
        return (0.35, 0.37, 0.34, 1.0)
    return tuple(
        sum(config.ZONE_COLORS[name][channel] * max(weights[name], 0.0) for name in names) / total
        for channel in range(4)
    )


def material(name, color, roughness=0.9, alpha=1.0):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color[:3], alpha)
    value.use_nodes = True
    bsdf = next(node for node in value.node_tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (*color[:3], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Alpha"].default_value = alpha
    if alpha < 1.0:
        value.surface_render_method = "DITHERED"
    value["diagnostic_only"] = True
    value["export_enabled"] = False
    return value


def wire_material():
    value = bpy.data.materials.new("MAT_V003_WIREFRAME")
    value.use_nodes = True
    nodes = value.node_tree.nodes
    links = value.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    wire = nodes.new("ShaderNodeWireframe")
    wire.inputs["Size"].default_value = 0.65
    mix = nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"
    mix.inputs[1].default_value = (0.72, 0.75, 0.71, 1.0)
    mix.inputs[2].default_value = (0.015, 0.02, 0.024, 1.0)
    links.new(wire.outputs["Fac"], mix.inputs[0])
    links.new(mix.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.96
    value["diagnostic_only"] = True
    value["export_enabled"] = False
    return value


def build_materials():
    zone = bpy.data.materials.new("MAT_V003_ZONE_REVIEW")
    zone.use_nodes = True
    nodes = zone.node_tree.nodes
    links = zone.node_tree.links
    bsdf = next(node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
    vertex_color = nodes.new("ShaderNodeVertexColor")
    vertex_color.layer_name = "ZONE_REVIEW_COLOR"
    links.new(vertex_color.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.94
    clay = material("MAT_V003_CLAY", (0.44, 0.47, 0.43, 1.0), 0.92)
    clay_nodes = clay.node_tree.nodes
    clay_links = clay.node_tree.links
    clay_bsdf = next(node for node in clay_nodes if node.bl_idname == "ShaderNodeBsdfPrincipled")
    river_attribute = clay_nodes.new("ShaderNodeAttribute")
    river_attribute.attribute_name = "RIVER_EXCLUSION"
    river_mix = clay_nodes.new("ShaderNodeMixRGB")
    river_mix.blend_type = "MIX"
    river_mix.inputs[1].default_value = (0.44, 0.47, 0.43, 1.0)
    river_mix.inputs[2].default_value = (0.08, 0.25, 0.31, 1.0)
    clay_links.new(river_attribute.outputs["Fac"], river_mix.inputs[0])
    clay_links.new(river_mix.outputs["Color"], clay_bsdf.inputs["Base Color"])
    return {
        "clay": clay,
        "connector": material("MAT_V003_CONNECTOR_CLAY", (0.38, 0.42, 0.37, 1.0), 0.94),
        "skirt": material("MAT_V003_SKIRT", (0.20, 0.23, 0.22, 1.0), 0.98),
        "cave": material("MAT_V003_CAVE_CLAY", (0.035, 0.05, 0.055, 1.0), 0.98),
        "story": material("MAT_V003_STORY_CLAY", (0.12, 0.13, 0.13, 1.0), 0.96),
        "wire": wire_material(),
        "zone": zone,
    }


def new_collection(name, parent):
    collection = bpy.data.collections.new(name)
    parent.children.link(collection)
    return collection


def clear_collection(collection):
    for child in list(collection.children):
        clear_collection(child)
        bpy.data.collections.remove(child)
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def make_mesh(name, vertices, faces, zone_data, region_data, collection, material_value, role):
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    mesh.materials.append(material_value)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    for zone_name in config.ZONE_COLORS:
        attribute = mesh.attributes.new(zone_name, type="FLOAT", domain="POINT")
        for index, values in enumerate(zone_data):
            attribute.data[index].value = values.get(zone_name, 0.0)
    for region_name in region_data[0] if region_data else []:
        attribute = mesh.attributes.new(region_name, type="FLOAT", domain="POINT")
        for index, values in enumerate(region_data):
            attribute.data[index].value = values.get(region_name, 0.0)
    color = mesh.color_attributes.new(name="ZONE_REVIEW_COLOR", type="FLOAT_COLOR", domain="POINT")
    for index, values in enumerate(zone_data):
        color.data[index].color = blended_zone_color(values)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj["journey_phase"] = "1C.2"
    obj["visual_version"] = "v003"
    obj["journey_role"] = role
    obj["export_enabled"] = True
    obj["wind_deforms_geometry"] = False
    obj["bedrock_deformable"] = False
    obj["zone_attributes"] = json.dumps(sorted(config.ZONE_COLORS))
    for region_name in region_data[0] if region_data else []:
        group = obj.vertex_groups.new(name=region_name)
        indices = [index for index, values in enumerate(region_data) if values.get(region_name, 0.0) > 0.01]
        if indices:
            group.add(indices, 1.0, "REPLACE")
    return obj


def extract_faces(global_vertices, global_zones, global_regions, faces):
    remap = {}
    vertices = []
    zones = []
    regions = []
    output_faces = []
    for face in faces:
        output = []
        for index in face:
            if index not in remap:
                remap[index] = len(vertices)
                vertices.append(global_vertices[index])
                zones.append(global_zones[index])
                regions.append(global_regions[index])
            output.append(remap[index])
        output_faces.append(tuple(output))
    return vertices, output_faces, zones, regions


def grid_values(minimum, maximum, step, required=()):
    count = int(math.floor((maximum - minimum) / step))
    values = [minimum + index * step for index in range(count + 1)]
    if values[-1] < maximum - 1e-6:
        values.append(maximum)
    values.extend(required)
    return sorted(set(round(value, 6) for value in values if minimum <= value <= maximum))


def cave_hole_bounds(y):
    if y <= 6.0:
        return -20.0, 18.0
    amount = smoothstep(6.0, config.CAVE_HOLE_Y_MAX, y)
    return (
        lerp(-14.0, config.CAVE_HOLE_X[0], amount),
        lerp(12.0, config.CAVE_HOLE_X[1], amount),
    )


def create_terrain(collection, materials):
    xs = grid_values(config.X_MIN, config.X_MAX, config.GRID_STEP, config.CAVE_HOLE_X)
    ys = grid_values(config.Y_MIN, config.Y_MAX, config.GRID_STEP, (1.0, 6.0, config.CAVE_HOLE_Y_MAX))
    vertices = []
    zones = []
    regions = []
    for y in ys:
        for x in xs:
            components = terrain_components(x, y)
            vertices.append((x, y, components["z"]))
            zones.append(zone_weights(x, y, components))
            regions.append(region_weights(x, y, components))
    nx = len(xs)
    main_faces = []
    transition_faces = []
    for y_index in range(len(ys) - 1):
        y_center = (ys[y_index] + ys[y_index + 1]) * 0.5
        for x_index in range(nx - 1):
            x_center = (xs[x_index] + xs[x_index + 1]) * 0.5
            face = (
                y_index * nx + x_index,
                y_index * nx + x_index + 1,
                (y_index + 1) * nx + x_index + 1,
                (y_index + 1) * nx + x_index,
            )
            if y_center < config.CAVE_HOLE_Y_MAX:
                hole_left, hole_right = cave_hole_bounds(y_center)
                if hole_left < x_center < hole_right:
                    continue
                transition_faces.append(face)
            else:
                main_faces.append(face)

    main_values = extract_faces(vertices, zones, regions, main_faces)
    transition_values = extract_faces(vertices, zones, regions, transition_faces)
    main = make_mesh(
        "V3_VALLEY_TERRAIN",
        *main_values,
        collection,
        materials["clay"],
        "continuous-volumetric-height-field",
    )
    transition = make_mesh(
        "V3_CAVE_EXIT_TRANSITION_TERRAIN",
        *transition_values,
        collection,
        materials["connector"],
        "cave-exit-side-transition",
    )

    outer = []
    for x in xs:
        outer.append((x, ys[0], terrain_height(x, ys[0])))
    for y in ys[1:]:
        outer.append((xs[-1], y, terrain_height(xs[-1], y)))
    for x in reversed(xs[:-1]):
        outer.append((x, ys[-1], terrain_height(x, ys[-1])))
    for y in reversed(ys[1:-1]):
        outer.append((xs[0], y, terrain_height(xs[0], y)))
    skirt_vertices = outer + [(x, y, config.BOTTOM_Z) for x, y, _z in outer]
    count = len(outer)
    skirt_faces = []
    for index in range(count):
        following = (index + 1) % count
        skirt_faces.append((index, following, count + following, count + index))
    skirt_faces.append(tuple(range(count, count * 2)))
    empty_zone = [{name: 0.0 for name in config.ZONE_COLORS} for _ in skirt_vertices]
    empty_regions = [{name: 0.0 for name in regions[0]} for _ in skirt_vertices]
    skirt = make_mesh(
        "V3_TERRAIN_SKIRT_AND_BOTTOM",
        skirt_vertices,
        skirt_faces,
        empty_zone,
        empty_regions,
        collection,
        materials["skirt"],
        "terrain-guard-skirt",
    )
    skirt["export_enabled"] = True
    return [main, transition, skirt], {"xs": xs, "ys": ys}


def cave_exit_vertices(cave_ground):
    points = [cave_ground.matrix_world @ vertex.co for vertex in cave_ground.data.vertices]
    maximum_y = max(point.y for point in points)
    result = sorted((point for point in points if point.y >= maximum_y - 1e-4), key=lambda point: point.x)
    if len(result) < 4:
        raise RuntimeError("Unable to identify the CAVE_HQ_GROUND forward exit edge")
    return result


def connector_ring(source_points, y, left, right, terrain_mix):
    result = []
    count = len(source_points)
    for index, source in enumerate(source_points):
        amount = index / (count - 1)
        x = lerp(left, right, amount)
        target_z = terrain_height(x, y)
        z = lerp(source.z, target_z, terrain_mix)
        result.append(Vector((x, y, z)))
    return result


def create_connector_mesh(name, rings, collection, materials, role):
    vertices = [tuple(point) for ring in rings for point in ring]
    count = len(rings[0])
    faces = []
    for ring_index in range(len(rings) - 1):
        for index in range(count - 1):
            start = ring_index * count + index
            faces.append((start, start + 1, start + count + 1, start + count))
    zones = []
    regions = []
    for point in vertices:
        components = terrain_components(point[0], point[1])
        values = zone_weights(point[0], point[1], components)
        values["RIVER_EXCLUSION"] = 0.0
        values["FLOWER_POTENTIAL"] *= smoothstep(6.0, 18.0, point[1])
        zones.append(values)
        regions.append(region_weights(point[0], point[1], components))
    return make_mesh(name, vertices, faces, zones, regions, collection, materials["connector"], role)


def create_connectors(collection, materials):
    cave = bpy.data.objects["CAVE_HQ_GROUND"]
    exit_points = cave_exit_vertices(cave)
    first = [point.copy() for point in exit_points]
    ring_6 = connector_ring(exit_points, 6.0, -14.0, 12.0, 0.45)
    ring_18 = connector_ring(exit_points, config.CAVE_HOLE_Y_MAX, config.CAVE_HOLE_X[0], config.CAVE_HOLE_X[1], 1.0)
    floor = create_connector_mesh(
        "V3_CAVE_EXIT_FLOOR_CONNECTOR",
        [first, ring_6],
        collection,
        materials,
        "cave-floor-connector",
    )
    meadow = create_connector_mesh(
        "V3_CAVE_TO_MEADOW_TRANSITION",
        [ring_6, ring_18],
        collection,
        materials,
        "cave-to-meadow-transition",
    )
    return [floor, meadow], exit_points


def create_cave_fade_replacement(collection, materials):
    ys = grid_values(config.Y_MIN, config.CAVE_HOLE_Y_MAX, 3.0, (1.0, 6.0, config.CAVE_HOLE_Y_MAX))
    columns = 17
    vertices = []
    for y in ys:
        left, right = cave_hole_bounds(y)
        # Runtime-only patch intentionally overlaps the hole rim by two units
        # and sits 0.04 above the analytic terrain. This avoids sub-pixel gaps
        # after the cave/connector set has faded without modifying locked data.
        left -= 2.0
        right += 2.0
        for index in range(columns):
            amount = index / (columns - 1)
            x = lerp(left, right, amount)
            vertices.append((x, y, terrain_height(x, y) + 0.04))
    faces = []
    for row in range(len(ys) - 1):
        for column in range(columns - 1):
            start = row * columns + column
            faces.append((start, start + 1, start + columns + 1, start + columns))
    zones = []
    regions = []
    for x, y, _z in vertices:
        components = terrain_components(x, y)
        values = zone_weights(x, y, components)
        values["RIVER_EXCLUSION"] = 0.0
        zones.append(values)
        regions.append(region_weights(x, y, components))
    obj = make_mesh(
        "V3_CAVE_FADE_REPLACEMENT_FLOOR",
        vertices,
        faces,
        zones,
        regions,
        collection,
        materials["connector"],
        "runtime-exclusive-cave-floor-replacement",
    )
    obj["visibility_rule"] = "visible only after runtime cave geometry has faded"
    return obj


def create_curve(name, points, collection, color):
    curve = bpy.data.curves.new(f"{name}_CURVE", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = 0.45
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for target, point in zip(spline.points, points):
        target.co = (*point, 1.0)
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    guide_material = material(f"MAT_{name}", color, 0.8)
    curve.materials.append(guide_material)
    obj.hide_render = True
    obj["export_enabled"] = False
    obj["journey_role"] = "review-guide"
    return obj


def build_guides(collection):
    guides = []
    river = []
    for y, center, _width in config.RIVER_STATIONS:
        river.append((center, y, terrain_height(center, y) + 0.8))
    guides.append(create_curve("GUIDE_V003_RIVER_CENTERLINE", river, collection, (0.02, 0.55, 1.0, 1.0)))
    left_ridge = [(field[0], field[1], terrain_height(field[0], field[1]) + 1.0) for field in config.LEFT_MASSIF_FIELDS]
    right_ridge = [(field[0], field[1], terrain_height(field[0], field[1]) + 1.0) for field in config.RIGHT_RIDGE_FIELDS]
    guides.append(create_curve("GUIDE_V003_LEFT_MAIN_RIDGE", left_ridge, collection, (1.0, 0.38, 0.06, 1.0)))
    guides.append(create_curve("GUIDE_V003_RIGHT_RECEDING_RIDGE", right_ridge, collection, (1.0, 0.72, 0.08, 1.0)))
    for region_name in (
        "V3_LEFT_DOMINANT_MASSIF",
        "V3_RIGHT_MIDGROUND_RIDGES",
        "V3_DISTANT_MOUNTAIN_RANGE",
        "V3_RIVERBED",
        "V3_MEADOW_TERRAIN",
    ):
        empty = bpy.data.objects.new(region_name, None)
        empty.empty_display_type = "CUBE"
        empty.empty_display_size = 3.0
        empty.hide_render = True
        empty["terrain_source_object"] = "V3_VALLEY_TERRAIN"
        empty["terrain_vertex_group"] = region_name
        empty["export_enabled"] = False
        collection.objects.link(empty)
    return guides


def import_full_story_cameras(collection):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CAMERA_GLB))
    imported = set(bpy.data.objects) - before
    for obj in imported:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
        obj["export_enabled"] = False
        obj["journey_role"] = "browser-final-camera-reference"
    cameras = sorted((obj for obj in imported if obj.type == "CAMERA"), key=lambda item: item.name)
    if len(cameras) != len(config.FULL_STORY_PREVIEWS):
        raise RuntimeError(f"Expected {len(config.FULL_STORY_PREVIEWS)} full-story cameras, found {len(cameras)}")
    return cameras


def look_at(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def create_review_cameras(collection):
    result = {}
    definitions = {
        "CAM_V003_TOP": ("ORTHO", (0.0, 430.0, 1180.0), (0.0, 430.0, 0.0), 1050.0),
        "CAM_V003_SIDE": ("ORTHO", (820.0, 430.0, 180.0), (0.0, 430.0, 80.0), 980.0),
        "CAM_V003_ORBIT_LEFT_30": ("PERSP", (-520.0, -220.0, 270.0), (0.0, 430.0, 75.0), 52.0),
        "CAM_V003_ORBIT_RIGHT_30": ("PERSP", (520.0, -220.0, 270.0), (0.0, 430.0, 75.0), 52.0),
        "CAM_V003_ELEVATED_THREE_QUARTER": ("PERSP", (520.0, -180.0, 430.0), (0.0, 440.0, 55.0), 55.0),
    }
    for name, (camera_type, location, target, value) in definitions.items():
        data = bpy.data.cameras.new(f"{name}_DATA")
        data.type = camera_type
        if camera_type == "ORTHO":
            data.ortho_scale = value
        else:
            data.lens = value
        data.clip_start = 0.1
        data.clip_end = 3000.0
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        look_at(obj, target)
        obj["export_enabled"] = False
        collection.objects.link(obj)
        result[name] = obj
    return result


def reference_objects():
    result = []
    for collection_name in ("V1_MAIN_SPATIAL_REFERENCE_LOCKED", "V1_PHASE2_ENV_REFERENCE_LOCKED"):
        result.extend(phase1c.collection_recursive_objects(bpy.data.collections[collection_name]))
    return result


def single_material(obj, material_value):
    if obj.type != "MESH" or obj.data is None:
        return
    obj.data.materials.clear()
    obj.data.materials.append(material_value)
    for polygon in obj.data.polygons:
        polygon.material_index = 0


def cave_presence(progress):
    return 1.0 - smoothstep(13.5, 20.2, progress)


def render_scene(render_dir, v003_objects, refs, materials, camera_lookup, review_cameras, quick=False):
    render_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    rendered = []
    v003_materials = {obj: list(obj.data.materials) for obj in v003_objects if obj.type == "MESH"}
    ref_materials = {
        obj: list(obj.data.materials)
        for obj in refs
        if obj.type == "MESH" and obj.data is not None
    }
    ref_visibility = {obj: obj.hide_render for obj in refs}

    def configure(camera, mode="clay", cave_mode="none", progress=30.0, show_story=False):
        presence = cave_presence(progress)
        connector_names = {
            "V3_CAVE_EXIT_FLOOR_CONNECTOR",
            "V3_CAVE_TO_MEADOW_TRANSITION",
        }
        for obj in v003_objects:
            obj.hide_render = (
                obj.name == "V3_CAVE_FADE_REPLACEMENT_FLOOR"
                and cave_mode == "geometry"
            )
            if obj.name == "V3_CAVE_FADE_REPLACEMENT_FLOOR" and cave_mode == "runtime":
                obj.hide_render = presence > 0.004
            if obj.name in connector_names:
                obj.hide_render = (
                    cave_mode == "none"
                    or (cave_mode == "runtime" and presence <= 0.004)
                )
            if obj.type != "MESH":
                continue
            if mode == "wire":
                single_material(obj, materials["wire"])
            elif mode == "zones":
                single_material(obj, materials["zone"])
            elif obj.name == "V3_TERRAIN_SKIRT_AND_BOTTOM":
                single_material(obj, materials["skirt"])
            elif "CAVE" in obj.name:
                single_material(obj, materials["connector"])
            else:
                single_material(obj, materials["clay"])
        runtime_cave_material = None
        if cave_mode == "runtime" and presence > 0.004:
            runtime_cave_material = material(
                f"MAT_V003_CAVE_RUNTIME_{str(progress).replace('.', '_')}",
                (0.035, 0.05, 0.055, 1.0),
                0.98,
                presence,
            )
        for obj in refs:
            retain_cave = obj.name in CAVE_NAMES
            retain_story = show_story and "SEATED" in obj.name.upper()
            obj.hide_render = not (
                (cave_mode == "geometry" and retain_cave)
                or (cave_mode == "runtime" and retain_cave and presence > 0.004)
                or retain_story
            )
            if not obj.hide_render and obj.type == "MESH":
                single_material(
                    obj,
                    runtime_cave_material if retain_cave and runtime_cave_material else materials["cave"] if retain_cave else materials["story"],
                )
        scene.camera = camera
        bpy.context.view_layer.update()

    def render(filename, camera, **kwargs):
        configure(camera, **kwargs)
        path = render_dir / filename
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        rendered.append(str(path))

    day = camera_lookup["CAM_V3_DAY_CLEAR_START_1440x900"]
    render("v003-day-clear-clay.png", day)
    render("v003-day-clear-wireframe.png", day, mode="wire")
    render("v003-top-view.png", review_cameras["CAM_V003_TOP"])
    render("v003-top-view-wireframe.png", review_cameras["CAM_V003_TOP"], mode="wire")
    render("v003-side-view.png", review_cameras["CAM_V003_SIDE"])
    render("v003-side-view-wireframe.png", review_cameras["CAM_V003_SIDE"], mode="wire")
    render("v003-orbit-left-30.png", review_cameras["CAM_V003_ORBIT_LEFT_30"])
    render("v003-orbit-right-30.png", review_cameras["CAM_V003_ORBIT_RIGHT_30"])
    render("v003-elevated-three-quarter.png", review_cameras["CAM_V003_ELEVATED_THREE_QUARTER"])

    if quick:
        render(
            "v003-final-wide.png",
            camera_lookup["CAM_V3_STORY_FINAL_WIDE_1440x900"],
            cave_mode="runtime",
            progress=96.0,
            show_story=True,
        )
        return rendered

    for progress in config.CAVE_PROGRESS:
        camera_name = "CAM_V3_DAY_CLEAR_START_1440x900" if progress == 30.0 else f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_")
        camera = camera_lookup[camera_name]
        slug = str(progress).replace(".", "-")
        render(f"diagnostic/v003-cave-geometry-p{slug}.png", camera, cave_mode="geometry", progress=progress)
        render(f"diagnostic/v003-cave-runtime-p{slug}.png", camera, cave_mode="runtime", progress=progress)
    for progress in config.CAVE_TO_DAY_PROGRESS:
        camera_name = "CAM_V3_DAY_CLEAR_START_1440x900" if progress == 30.0 else f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_")
        render(
            f"diagnostic/v003-sweep-p{str(progress).replace('.', '-')}.png",
            camera_lookup[camera_name],
            cave_mode="runtime",
            progress=progress,
        )
    for preview in config.FULL_STORY_PREVIEWS:
        name = f"CAM_V3_STORY_{preview.upper().replace('-', '_')}_1440x900"
        progress = camera_lookup[name].get("progress")
        if progress is None:
            progress = next(
                value for key, value in {
                    "sunset": 46.0,
                    "night": 68.0,
                    "river-hold": 70.0,
                    "milky-way": 80.0,
                    "seated-figure": 84.0,
                    "final-wide": 96.0,
                    "ending": 100.0,
                }.items() if key == preview
            )
        render(
            f"diagnostic/v003-story-{preview}.png",
            camera_lookup[name],
            cave_mode="runtime",
            progress=float(progress),
            show_story=float(progress) >= 84.0,
        )
    render(
        "v003-final-wide.png",
        camera_lookup["CAM_V3_STORY_FINAL_WIDE_1440x900"],
        cave_mode="runtime",
        progress=96.0,
        show_story=True,
    )

    for obj, original in v003_materials.items():
        obj.data.materials.clear()
        for value in original:
            obj.data.materials.append(value)
    for obj, original in ref_materials.items():
        obj.data.materials.clear()
        for value in original:
            obj.data.materials.append(value)
    for obj, hidden in ref_visibility.items():
        obj.hide_render = hidden
    return rendered


def world_bvh(obj):
    vertices = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    polygons = [tuple(polygon.vertices) for polygon in obj.data.polygons]
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)


def geometry_intersections(cave_objects, v003_objects):
    results = []
    cave_bvhs = {obj: world_bvh(obj) for obj in cave_objects if obj.type == "MESH"}
    terrain_bvhs = {obj: world_bvh(obj) for obj in v003_objects if obj.type == "MESH"}
    for cave, cave_bvh in cave_bvhs.items():
        for terrain, terrain_bvh in terrain_bvhs.items():
            overlap = cave_bvh.overlap(terrain_bvh)
            if overlap:
                results.append({"cave": cave.name, "terrain": terrain.name, "trianglePairCount": len(overlap)})
    return results


def topology_record(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    boundary = sum(1 for edge in bm.edges if len(edge.link_faces) == 1)
    non_manifold = sum(1 for edge in bm.edges if len(edge.link_faces) != 2)
    closed = boundary == 0 and non_manifold == 0
    volume = abs(bm.calc_volume(signed=False)) if closed else None
    bm.free()
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return {
        "name": obj.name,
        "role": obj.get("journey_role"),
        "vertexCount": len(obj.data.vertices),
        "faceCount": len(obj.data.polygons),
        "boundaryEdgeCount": boundary,
        "nonManifoldEdgeCount": non_manifold,
        "closed": closed,
        "volume": volume,
        "bounds": {"min": minimum, "max": maximum, "size": [maximum[i] - minimum[i] for i in range(3)]},
    }


def region_footprints(terrain):
    result = {}
    for region_name in (
        "V3_LEFT_DOMINANT_MASSIF",
        "V3_RIGHT_MIDGROUND_RIDGES",
        "V3_DISTANT_MOUNTAIN_RANGE",
        "V3_RIVERBED",
        "V3_MEADOW_TERRAIN",
    ):
        attribute = terrain.data.attributes[region_name]
        points = [
            terrain.matrix_world @ terrain.data.vertices[index].co
            for index, value in enumerate(attribute.data)
            if value.value > 0.25
        ]
        minimum = [min(point[axis] for point in points) for axis in range(3)]
        maximum = [max(point[axis] for point in points) for axis in range(3)]
        result[region_name] = {
            "sampleVertexCount": len(points),
            "bounds": {"min": minimum, "max": maximum, "size": [maximum[i] - minimum[i] for i in range(3)]},
            "planFootprintBoundingArea": (maximum[0] - minimum[0]) * (maximum[1] - minimum[1]),
            "depth": maximum[1] - minimum[1],
            "width": maximum[0] - minimum[0],
        }
    return result


def camera_review(cameras, terrain, skirt):
    results = []
    terrain_points = [terrain.matrix_world @ vertex.co for vertex in terrain.data.vertices]
    mountain_attribute_names = (
        "V3_LEFT_DOMINANT_MASSIF",
        "V3_RIGHT_MIDGROUND_RIDGES",
        "V3_DISTANT_MOUNTAIN_RANGE",
    )
    mountain_indices = set()
    for name in mountain_attribute_names:
        attribute = terrain.data.attributes[name]
        mountain_indices.update(index for index, value in enumerate(attribute.data) if value.value > 0.25)
    skirt_points = [skirt.matrix_world @ vertex.co for vertex in skirt.data.vertices]
    for camera in cameras:
        projected_mountains = []
        for index in mountain_indices:
            coordinate = world_to_camera_view(bpy.context.scene, camera, terrain_points[index])
            if 0 <= coordinate.x <= 1 and 0 <= coordinate.y <= 1 and coordinate.z > 0:
                projected_mountains.append((coordinate.x, coordinate.y))
        skirt_in_frame = 0
        for point in skirt_points:
            coordinate = world_to_camera_view(bpy.context.scene, camera, point)
            if 0 <= coordinate.x <= 1 and 0 <= coordinate.y <= 1 and coordinate.z > 0:
                skirt_in_frame += 1
        results.append({
            "camera": camera.name,
            "progress": camera.get("progress"),
            "mountainVisibleSampleCount": len(projected_mountains),
            "mountainNdcBounds": {
                "min": [min((point[0] for point in projected_mountains), default=None), min((point[1] for point in projected_mountains), default=None)],
                "max": [max((point[0] for point in projected_mountains), default=None), max((point[1] for point in projected_mountains), default=None)],
            },
            "outerSkirtVertexCountInFrame": skirt_in_frame,
        })
    return results


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.use_border = False
    scene.world = bpy.data.worlds.new("V003_DIAGNOSTIC_WORLD")
    scene.world.use_nodes = True
    background = next(node for node in scene.world.node_tree.nodes if node.bl_idname == "ShaderNodeBackground")
    background.inputs["Color"].default_value = (0.12, 0.27, 0.34, 1.0)
    background.inputs["Strength"].default_value = 0.42


def create_lighting(collection):
    sun_data = bpy.data.lights.new("V003_DIAGNOSTIC_SUN_DATA", "SUN")
    sun_data.energy = 1.55
    sun_data.angle = math.radians(4.5)
    sun = bpy.data.objects.new("V003_DIAGNOSTIC_SUN", sun_data)
    sun.rotation_euler = (math.radians(42), math.radians(-20), math.radians(-36))
    sun["export_enabled"] = False
    collection.objects.link(sun)


def deterministic_signature(records, footprints, cameras):
    payload = {
        "records": records,
        "footprints": footprints,
        "cameras": [
            {
                "name": camera.name,
                "matrixWorld": [round(value, 9) for row in camera.matrix_world for value in row],
                "lens": camera.data.lens,
                "type": camera.data.type,
            }
            for camera in sorted(cameras, key=lambda item: item.name)
        ],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main():
    args = parse_args()
    output = args.output.resolve()
    render_dir = args.render_dir.resolve()
    validation_output = args.validation_output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    render_dir.mkdir(parents=True, exist_ok=True)
    (render_dir / "diagnostic").mkdir(parents=True, exist_ok=True)
    validation_output.parent.mkdir(parents=True, exist_ok=True)

    source_hash_before = sha256_file(SOURCE_BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
    locked_before = phase1c.reference_signature()
    environment = bpy.data.collections["V3_ENVIRONMENT_WORK"]
    clear_collection(environment)
    environment["journey_phase"] = "1C.2"
    environment["visual_version"] = "v003"
    environment["selected_candidate"] = "VOLUMETRIC_TERRAIN_V003"

    terrain_collection = new_collection("V3_VOLUMETRIC_TERRAIN_V003", environment)
    connector_collection = new_collection("V3_CAVE_EXIT_CONNECTORS", environment)
    guide_collection = new_collection("V3_V003_GUIDES", environment)
    camera_collection = new_collection("V3_CAMERA_FULL_STORY", environment)
    review_camera_collection = new_collection("V3_V003_REVIEW_CAMERAS", environment)
    terrain_collection["export_enabled"] = True
    connector_collection["export_enabled"] = True
    guide_collection["export_enabled"] = False
    camera_collection["export_enabled"] = False
    review_camera_collection["export_enabled"] = False

    materials = build_materials()
    terrain_objects, grid = create_terrain(terrain_collection, materials)
    connector_objects, exit_points = create_connectors(connector_collection, materials)
    connector_objects.append(create_cave_fade_replacement(connector_collection, materials))
    guides = build_guides(guide_collection)
    create_lighting(guide_collection)
    full_story_cameras = import_full_story_cameras(camera_collection)
    review_cameras = create_review_cameras(review_camera_collection)
    setup_scene()

    baseline_cameras = [obj for obj in bpy.data.collections["V3_CAMERA_BASELINES"].objects if obj.type == "CAMERA"]
    all_cameras = baseline_cameras + full_story_cameras
    camera_lookup = {obj.name: obj for obj in all_cameras}
    required = {
        "CAM_V3_DAY_CLEAR_START_1440x900",
        *{f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_") for progress in config.CAVE_TO_DAY_PROGRESS},
        *{f"CAM_V3_STORY_{preview.upper().replace('-', '_')}_1440x900" for preview in config.FULL_STORY_PREVIEWS},
    }
    missing = sorted(required - set(camera_lookup))
    if missing:
        raise RuntimeError(f"Missing required browser-final cameras: {missing}")

    v003_objects = terrain_objects + connector_objects
    refs = reference_objects()
    rendered = []
    if not args.skip_renders:
        rendered = render_scene(
            render_dir,
            v003_objects,
            refs,
            materials,
            camera_lookup,
            review_cameras,
            quick=args.quick_renders,
        )

    terrain = bpy.data.objects["V3_VALLEY_TERRAIN"]
    skirt = bpy.data.objects["V3_TERRAIN_SKIRT_AND_BOTTOM"]
    records = [topology_record(obj) for obj in v003_objects]
    footprints = region_footprints(terrain)
    core_cave = [bpy.data.objects[name] for name in sorted(CORE_CAVE_NAMES)]
    intersections = geometry_intersections(
        core_cave,
        [obj for obj in v003_objects if obj.name != "V3_CAVE_FADE_REPLACEMENT_FLOOR"],
    )
    connector = bpy.data.objects["V3_CAVE_EXIT_FLOOR_CONNECTOR"]
    connector_points = [connector.matrix_world @ vertex.co for vertex in connector.data.vertices]
    seam_distances = [min((point - candidate).length for candidate in connector_points) for point in exit_points]
    camera_results = camera_review(all_cameras, terrain, skirt)
    locked_after = phase1c.reference_signature()
    source_hash_after = sha256_file(SOURCE_BLEND)
    if locked_before["sha256"] != locked_after["sha256"]:
        raise RuntimeError("Locked Phase 1B reference changed while building v003")
    if source_hash_before != source_hash_after:
        raise RuntimeError("Source v002 Blend changed while building v003")

    signature = deterministic_signature(records, footprints, all_cameras)
    validation = {
        "schemaVersion": 1,
        "phase": "Journey V3 Phase 1C.2",
        "visualVersion": "v003",
        "sourceV002Blend": str(SOURCE_BLEND),
        "sourceV002Sha256Before": source_hash_before,
        "sourceV002Sha256After": source_hash_after,
        "sourceV002Unchanged": source_hash_before == source_hash_after,
        "outputBlend": str(output),
        "cameraGltf": str(CAMERA_GLB),
        "cameraGltfSha256": sha256_file(CAMERA_GLB),
        "lockedReferenceSignatureBefore": locked_before["sha256"],
        "lockedReferenceSignatureAfter": locked_after["sha256"],
        "lockedReferenceUnchanged": locked_before["sha256"] == locked_after["sha256"],
        "grid": {
            "xCount": len(grid["xs"]),
            "yCount": len(grid["ys"]),
            "xRange": [grid["xs"][0], grid["xs"][-1]],
            "yRange": [grid["ys"][0], grid["ys"][-1]],
            "bottomZ": config.BOTTOM_Z,
        },
        "objects": records,
        "regionFootprints": footprints,
        "caveConnector": {
            "exitVertexCount": len(exit_points),
            "seamDistance": {
                "minimum": min(seam_distances),
                "maximum": max(seam_distances),
            },
            "coreCaveIntersections": intersections,
        },
        "caveCauseClassification": {
            "omittedRuntimeCaveGeometry": [],
            "runtimeOpacityFade": "cavePresence = 1 - smoothstep(13.5, 20.2, progress)",
            "transformMismatch": False,
            "actualGeometryIssues": [
                "v002 cave-floor to riverbed gap measured 1.842-2.218 units",
                "raw geometry at progress 11.5 does not produce the expected cave-opening frame",
            ],
            "correctFadeDependentReentry": "At progress 28.25 and 30 the retained shell may project into frame, but runtime cave visibility is already false because cavePresence <= 0.004.",
        },
        "cameraReview": camera_results,
        "fullStoryCameras": sorted(obj.name for obj in full_story_cameras),
        "reviewCameras": sorted(review_cameras),
        "guides": sorted(obj.name for obj in guides),
        "renderedFiles": rendered,
        "deterministicSignature": signature,
    }
    with open(validation_output, "w", encoding="utf-8") as handle:
        json.dump(validation, handle, indent=2)
        handle.write("\n")

    for obj in refs:
        obj.hide_render = True
    for obj in v003_objects:
        obj.hide_render = False
    for guide in guides:
        guide.hide_render = True
    bpy.context.scene.camera = camera_lookup["CAM_V3_DAY_CLEAR_START_1440x900"]
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    print(json.dumps({
        "output": str(output),
        "validation": str(validation_output),
        "sourceV002Unchanged": source_hash_before == source_hash_after,
        "lockedReferenceUnchanged": locked_before["sha256"] == locked_after["sha256"],
        "deterministicSignature": signature,
        "coreCaveIntersections": intersections,
        "caveSeamMaxDistance": max(seam_distances),
        "renderCount": len(rendered),
    }, indent=2))


if __name__ == "__main__":
    main()
