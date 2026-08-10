import argparse
import hashlib
import json
import math
import os
import statistics
import struct
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
sys.path.insert(0, str(SCRIPT_DIR))
import journey_v3_macro_config as config  # noqa: E402


PHASE1B_BLEND = (
    PROJECT_ROOT
    / "work/blender/journey-v3/phase1b/journey-v3-spatial-reference-v001.blend"
)
DEFAULT_OUTPUT = (
    PROJECT_ROOT
    / "work/blender/journey-v3/phase1c/journey-v3-macro-massing-v001.blend"
)
DEFAULT_RENDER_DIR = (
    PROJECT_ROOT / "docs/references/journey-v3/baselines/massing"
)
DEFAULT_VALIDATION = DEFAULT_RENDER_DIR / "phase-1c-structure-validation.json"


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR)
    parser.add_argument("--validation-output", type=Path, default=DEFAULT_VALIDATION)
    parser.add_argument("--skip-renders", action="store_true")
    return parser.parse_args(values)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smoothstep(edge0, edge1, value):
    if edge1 == edge0:
        return 1.0 if value >= edge1 else 0.0
    x = clamp((value - edge0) / (edge1 - edge0))
    return x * x * (3.0 - 2.0 * x)


def gaussian(value, center, width):
    return math.exp(-((value - center) / max(width, 1e-6)) ** 2)


def lerp(left, right, amount):
    return left + (right - left) * amount


def collection_recursive_objects(target):
    objects = list(target.objects)
    for child in target.children:
        objects.extend(collection_recursive_objects(child))
    return objects


def new_collection(name, parent):
    value = bpy.data.collections.new(name)
    parent.children.link(value)
    return value


def set_collection_role(target, role, export_enabled, selected=False):
    target["journey_role"] = role
    target["export_enabled"] = export_enabled
    target["selected_candidate"] = selected


def material(name, color, roughness=0.82, metallic=0.0):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    bsdf = next(
        (
            node
            for node in value.node_tree.nodes
            if node.bl_idname == "ShaderNodeBsdfPrincipled"
        ),
        None,
    )
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    value["diagnostic_only"] = True
    value["export_enabled"] = False
    return value


def build_materials():
    zone_materials = {
        zone: material(f"MAT_V3_ZONE_{zone}", color)
        for zone, color in config.ZONE_COLORS.items()
    }
    zone_review = material("MAT_V3_ZONE_REVIEW", (0.5, 0.5, 0.5, 1.0), 0.88)
    nodes = zone_review.node_tree.nodes
    links = zone_review.node_tree.links
    bsdf = next(
        (node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"),
        None,
    )
    attribute = nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "ZONE_REVIEW_COLOR"
    if bsdf:
        links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])
    return {
        "clay": material("MAT_V3_CLAY_REVIEW", (0.43, 0.45, 0.42, 1.0), 0.9),
        "zone_review": zone_review,
        "zones": zone_materials,
    }


def dominant_zone(weights):
    base_order = [
        "RIVER_EXCLUSION",
        "FLOWER_POTENTIAL",
        "SNOW",
        "ROCK",
        "WET",
        "FOREST",
        "GRASS",
        "WIND_REACTIVE_VEGETATION",
    ]
    return max(base_order, key=lambda name: weights.get(name, 0.0))


def create_mesh_object(
    name,
    vertices,
    faces,
    weights,
    target_collection,
    materials,
    candidate,
    role,
    export_enabled,
):
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    for zone_name in config.ZONE_COLORS:
        attribute = mesh.attributes.new(zone_name, type="FLOAT", domain="POINT")
        zone_values = [entry.get(zone_name, 0.0) for entry in weights]
        for index, value in enumerate(zone_values):
            attribute.data[index].value = value
    review_color = mesh.color_attributes.new(
        name="ZONE_REVIEW_COLOR", type="FLOAT_COLOR", domain="POINT"
    )
    for index, entry in enumerate(weights):
        review_color.data[index].color = config.ZONE_COLORS[dominant_zone(entry)]
    zone_names = list(config.ZONE_COLORS)
    for zone_name in zone_names:
        mesh.materials.append(materials["zones"][zone_name])
    zone_index = {name: index for index, name in enumerate(zone_names)}
    vertex_dominant = [dominant_zone(entry) for entry in weights]
    for polygon, face in zip(mesh.polygons, faces):
        counts = {}
        for vertex_index in face:
            zone_name = vertex_dominant[vertex_index]
            counts[zone_name] = counts.get(zone_name, 0) + 1
        face_zone = max(counts, key=counts.get)
        polygon.material_index = zone_index[face_zone]
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    target_collection.objects.link(obj)
    obj["journey_role"] = role
    obj["candidate"] = candidate
    obj["cycle"] = config.CANDIDATES[candidate]["cycle"]
    obj["export_enabled"] = export_enabled
    obj["zone_attributes"] = json.dumps(zone_names)
    obj["bedrock_deformable"] = False
    obj["wind_deforms_geometry"] = False
    return obj


def empty_weights(**overrides):
    result = {name: 0.0 for name in config.ZONE_COLORS}
    result.update(overrides)
    return result


def mountain_zone_weights(z, t, erosion, side, y):
    elevation = clamp((z - 16.0) / 118.0)
    steep = clamp(abs(math.cos(math.pi * t)) * 0.72 + elevation * 0.35)
    shaded_aspect = clamp(0.5 + side * 0.16 + math.sin(y * 0.018) * 0.18)
    rock = clamp((elevation - 0.38) * 1.45 + steep * 0.55 + erosion * 0.34)
    snow = clamp((elevation - 0.72) * 3.0 + erosion * 0.28 + shaded_aspect * 0.12)
    forest_band = clamp(1.0 - abs(elevation - 0.32) * 2.5)
    forest = clamp(forest_band * (1.0 - rock * 0.72) * (0.7 + shaded_aspect * 0.3))
    grass = clamp((1.0 - rock) * (1.0 - snow) * (0.72 - forest * 0.34))
    wet = clamp(erosion * (1.0 - elevation) * 0.82)
    wind = clamp((grass * 0.92 + forest * 0.66) * (1.0 - rock) * (1.0 - snow))
    return empty_weights(
        ROCK=rock,
        GRASS=grass,
        FOREST=forest,
        SNOW=snow,
        WET=wet,
        WIND_REACTIVE_VEGETATION=wind,
    )


def valley_half_width(y, settings):
    near_to_far = clamp(y / 360.0)
    return lerp(49.0, 18.0, near_to_far) * settings["valley_width_scale"]


def peak_chain(y, peaks):
    """Art-directed, drainage-scale ridge rhythm; deliberately not texture noise."""
    return sum(amplitude * gaussian(y, center, width) for center, amplitude, width in peaks)


def create_side_mountain(candidate, side, name, target_collection, materials):
    settings = config.CANDIDATES[candidate]
    nx, ny = 54, 62
    outer_x = 224.0
    y_start = settings["mountain_start_y"] + settings["mountain_depth_shift"]
    y_end = 352.0 + settings["mountain_depth_shift"]
    vertices = []
    weights = []
    for y_index in range(ny):
        v = y_index / (ny - 1)
        y = lerp(y_start, y_end, v)
        valley_edge = valley_half_width(y, settings)
        for x_index in range(nx):
            t = x_index / (nx - 1)
            x = side * (valley_edge + t * (outer_x - valley_edge))
            profile = max(0.0, math.sin(math.pi * t)) ** 0.72
            ramp = smoothstep(y_start, y_start + 52.0, y)
            if candidate == "HYBRID":
                # Cycle 2: a chain of large shoulders and peaks gives the mountain
                # a readable macro silhouette while retaining continuous slopes.
                if side < 0:
                    broad_height = 30.0 + peak_chain(
                        y,
                        (
                            (112.0, 50.0, 34.0),
                            (169.0, 104.0, 38.0),
                            (226.0, 72.0, 42.0),
                            (296.0, 45.0, 54.0),
                        ),
                    )
                    ridge_center = 0.34 + 0.055 * math.sin(y * 0.019)
                else:
                    broad_height = 27.0 + peak_chain(
                        y,
                        (
                            (126.0, 36.0, 34.0),
                            (207.0, 82.0, 41.0),
                            (261.0, 64.0, 37.0),
                            (319.0, 38.0, 46.0),
                        ),
                    )
                    ridge_center = 0.40 + 0.06 * math.sin(y * 0.017 + 1.1)
                ridge_core = gaussian(t, ridge_center, 0.23)
                broad_shoulder = 0.58 * gaussian(t, 0.72, 0.34)
                valley_spur = 0.32 * gaussian(
                    t,
                    0.11 + 0.035 * math.sin(y * 0.026 + side),
                    0.10,
                )
                edge_fade = max(0.0, math.sin(math.pi * t)) ** 0.42
                profile = clamp(ridge_core + broad_shoulder + valley_spur) * edge_fade
                continuity = 0.91 + 0.055 * math.sin(y * 0.071 + side * 0.8)
                continuity += 0.035 * math.sin(y * 0.123 + t * 2.6)
            else:
                if side < 0:
                    primary = settings["left_primary_height"] * gaussian(
                        y, settings["left_peak_y"], 78.0
                    )
                    shoulder = settings["left_shoulder_height"] * gaussian(y, 305.0, 92.0)
                    base = 34.0
                else:
                    primary = settings["right_primary_height"] * gaussian(
                        y, settings["right_peak_y"], 82.0
                    )
                    shoulder = settings["right_shoulder_height"] * gaussian(y, 318.0, 96.0)
                    base = 30.0
                broad_height = base + primary + shoulder
                continuity = 0.92 + 0.08 * math.sin(y * 0.021 + t * 3.2 + side * 0.7)
            z = 0.022 * y + ramp * profile * broad_height * continuity
            erosion = 0.0
            for channel_index, base_t in enumerate((0.28, 0.50, 0.72)):
                channel_t = base_t + 0.08 * math.sin(
                    y * (0.012 + channel_index * 0.002) + side * channel_index
                )
                channel = gaussian(t, channel_t, 0.055 + channel_index * 0.008)
                erosion += channel
                z -= (
                    settings["erosion_strength"]
                    * ramp
                    * channel
                    * (8.0 + channel_index * 2.5)
                    * smoothstep(y_start + 16.0, y_end - 18.0, y)
                )
            collapse = gaussian(t, 0.47 if side < 0 else 0.58, 0.13) * gaussian(
                y, settings["left_peak_y"] if side < 0 else settings["right_peak_y"], 62.0
            )
            z -= collapse * settings["erosion_strength"] * (10.0 if side < 0 else 7.0)
            vertices.append((x, y, z))
            weights.append(mountain_zone_weights(z, t, clamp(erosion), side, y))
    faces = []
    for y_index in range(ny - 1):
        for x_index in range(nx - 1):
            start = y_index * nx + x_index
            faces.append((start, start + 1, start + nx + 1, start + nx))
    return create_mesh_object(
        name,
        vertices,
        faces,
        weights,
        target_collection,
        materials,
        candidate,
        "macro-mountain-ridge",
        candidate == "HYBRID",
    )


def create_hero_massif(candidate, name, target_collection, materials):
    settings = config.CANDIDATES[candidate]
    nx, ny = 68, 38
    y_start = 244.0 + settings["mountain_depth_shift"]
    y_end = 438.0 + settings["mountain_depth_shift"]
    vertices = []
    weights = []
    for y_index in range(ny):
        depth = y_index / (ny - 1)
        y = lerp(y_start, y_end, depth)
        depth_profile = max(0.0, math.sin(math.pi * depth)) ** 0.68
        for x_index in range(nx):
            u = x_index / (nx - 1)
            x = lerp(-182.0, 182.0, u)
            bias = settings["rear_peak_bias"]
            if candidate == "HYBRID":
                peak_field = (
                    0.18
                    + 0.78 * gaussian(x, bias - 102.0, 34.0)
                    + 0.94 * gaussian(x, bias - 48.0, 29.0)
                    + 0.56 * gaussian(x, bias + 24.0, 37.0)
                    + 0.72 * gaussian(x, bias + 82.0, 31.0)
                    + 0.38 * gaussian(x, bias + 137.0, 35.0)
                )
                peak_field *= 0.94 + 0.05 * math.sin(x * 0.105 + depth * 2.4)
                saddle = 0.34 * gaussian(x, 4.0, 34.0)
            else:
                peak_field = (
                    0.34
                    + 0.62 * gaussian(x, bias - 58.0, 56.0)
                    + 0.48 * gaussian(x, bias + 64.0, 48.0)
                    + 0.22 * gaussian(x, bias + 126.0, 42.0)
                )
                saddle = 0.22 * gaussian(x, 2.0, 30.0)
            macro = settings["rear_height"] * depth_profile * (peak_field - saddle)
            if candidate == "HYBRID":
                # Sculpt an actual continuous valley into the rear mass rather
                # than cutting faces or placing a flat masking plane.
                valley_width = lerp(68.0, 20.0, smoothstep(0.0, 0.82, depth))
                macro *= 1.0 - 0.93 * gaussian(x, 2.0, valley_width)
            z = 2.0 + 0.018 * y + macro
            erosion = 0.0
            for channel_x, width in ((bias - 82.0, 17.0), (bias - 5.0, 15.0), (bias + 74.0, 18.0)):
                shifted = channel_x + (depth - 0.5) * 28.0
                channel = gaussian(x, shifted, width)
                erosion += channel
                z -= channel * settings["erosion_strength"] * depth_profile * 13.0
            vertices.append((x, y, z))
            weights.append(
                mountain_zone_weights(z, u, clamp(erosion), -1 if x < 0 else 1, y)
            )
    faces = []
    for y_index in range(ny - 1):
        for x_index in range(nx - 1):
            start = y_index * nx + x_index
            faces.append((start, start + 1, start + nx + 1, start + nx))
    return create_mesh_object(
        name,
        vertices,
        faces,
        weights,
        target_collection,
        materials,
        candidate,
        "macro-hero-massif",
        candidate == "HYBRID",
    )


def create_ridge_band(candidate, name, target_collection, materials, far=False):
    settings = config.CANDIDATES[candidate]
    nx, ny = (72, 14) if far else (56, 12)
    x_extent = 260.0 if far else 190.0
    y_start = (418.0 if far else 282.0) + settings["mountain_depth_shift"]
    y_end = (505.0 if far else 366.0) + settings["mountain_depth_shift"]
    base_height = 78.0 if far else 50.0
    amplitude = 42.0 if far else 34.0
    vertices = []
    weights = []
    for y_index in range(ny):
        depth = y_index / (ny - 1)
        profile = max(0.0, math.sin(math.pi * depth)) ** 0.75
        y = lerp(y_start, y_end, depth)
        for x_index in range(nx):
            u = x_index / (nx - 1)
            x = lerp(-x_extent, x_extent, u)
            skyline = (
                0.65
                + 0.18 * math.sin(x * 0.032 + 0.4)
                + 0.12 * math.sin(x * 0.071 - 1.1)
                + 0.20 * gaussian(x, -92.0, 48.0)
                + 0.16 * gaussian(x, 108.0, 52.0)
            )
            if candidate == "HYBRID":
                skyline += 0.14 * math.sin(x * 0.119 + 0.6)
                skyline += 0.12 * gaussian(x, -146.0, 30.0)
                skyline += 0.15 * gaussian(x, 72.0, 26.0)
                if not far:
                    valley_width = lerp(46.0, 17.0, depth)
                    skyline *= 1.0 - 0.88 * gaussian(x, 1.0, valley_width)
            # The band is terrain, not a floating backdrop: its near/far edges
            # descend into the valley-scale base while the ridge rises in depth.
            z = 2.0 + 0.018 * y + profile * (base_height + amplitude * skyline)
            vertices.append((x, y, z))
            weights.append(mountain_zone_weights(z, u, 0.18, -1 if x < 0 else 1, y))
    faces = []
    for y_index in range(ny - 1):
        for x_index in range(nx - 1):
            start = y_index * nx + x_index
            faces.append((start, start + 1, start + nx + 1, start + nx))
    return create_mesh_object(
        name,
        vertices,
        faces,
        weights,
        target_collection,
        materials,
        candidate,
        "macro-far-ridges" if far else "macro-midground-ridges",
        candidate == "HYBRID",
    )


def interpolate_river(y, settings):
    stations = config.RIVER_STATIONS
    if y <= stations[0][0]:
        current = stations[0]
        return current[1], current[2] * settings["river_width_scale"], current[3]
    if y >= stations[-1][0]:
        current = stations[-1]
        return current[1], current[2] * settings["river_width_scale"], current[3]
    for left, right in zip(stations, stations[1:]):
        if left[0] <= y <= right[0]:
            amount = (y - left[0]) / (right[0] - left[0])
            return (
                lerp(left[1], right[1], amount),
                lerp(left[2], right[2], amount) * settings["river_width_scale"],
                lerp(left[3], right[3], amount),
            )
    raise RuntimeError("River interpolation failed")


def create_ribbon_object(
    candidate,
    name,
    target_collection,
    materials,
    role,
    station_values,
    cross_count,
    coordinate_function,
    weight_function,
):
    vertices = []
    weights = []
    for station_index, station in enumerate(station_values):
        for cross_index in range(cross_count):
            amount = cross_index / (cross_count - 1)
            vertices.append(coordinate_function(station, amount))
            weights.append(weight_function(station, amount))
    faces = []
    for station_index in range(len(station_values) - 1):
        for cross_index in range(cross_count - 1):
            start = station_index * cross_count + cross_index
            faces.append(
                (start, start + 1, start + cross_count + 1, start + cross_count)
            )
    return create_mesh_object(
        name,
        vertices,
        faces,
        weights,
        target_collection,
        materials,
        candidate,
        role,
        candidate == "HYBRID",
    )


def create_valley_objects(candidate, names, target_collection, materials):
    settings = config.CANDIDATES[candidate]
    y_values = [2.0 + index * (346.0 / 34.0) for index in range(35)]
    riverbed = create_ribbon_object(
        candidate,
        names["riverbed"],
        target_collection,
        materials,
        "riverbed-proxy",
        y_values,
        7,
        lambda y, amount: (
            interpolate_river(y, settings)[0]
            + lerp(-interpolate_river(y, settings)[1], interpolate_river(y, settings)[1], amount),
            y,
            interpolate_river(y, settings)[2]
            - 0.48 * (1.0 - abs(amount * 2.0 - 1.0)),
        ),
        lambda _y, amount: empty_weights(
            WET=0.55 + 0.2 * (1.0 - abs(amount * 2.0 - 1.0)),
            RIVER_EXCLUSION=1.0,
        ),
    )

    banks = []
    for side, key in ((-1, "left_bank"), (1, "right_bank")):
        banks.append(
            create_ribbon_object(
                candidate,
                names[key],
                target_collection,
                materials,
                "riverbank-proxy",
                y_values,
                5,
                lambda y, amount, side=side: (
                    interpolate_river(y, settings)[0]
                    + side
                    * (
                        interpolate_river(y, settings)[1]
                        + lerp(0.4, 12.0, amount)
                    ),
                    y,
                    interpolate_river(y, settings)[2]
                    + lerp(0.72, 1.85, amount)
                    + math.sin(y * 0.035 + side) * 0.12,
                ),
                lambda _y, amount: empty_weights(
                    ROCK=0.2 + amount * 0.25,
                    GRASS=amount * 0.55,
                    WET=1.0 - amount * 0.7,
                    RIVER_EXCLUSION=1.0 - amount * 0.25,
                    WIND_REACTIVE_VEGETATION=amount * 0.42,
                ),
            )
        )

    valley_y = [96.0 + index * (254.0 / 24.0) for index in range(25)]
    valley_vertices = []
    valley_weights = []
    valley_faces = []
    cross_count = 6
    for side in (-1, 1):
        vertex_offset = len(valley_vertices)
        for y in valley_y:
            center, half_width, bed_z = interpolate_river(y, settings)
            inner = center + side * (half_width + 12.0)
            outer = side * 155.0
            for cross_index in range(cross_count):
                amount = cross_index / (cross_count - 1)
                x = lerp(inner, outer, amount)
                z = bed_z + 1.86 + amount * 0.035 * abs(x - inner)
                z += 0.38 * math.sin(y * 0.028 + x * 0.017)
                valley_vertices.append((x, y, z))
                wet = (1.0 - amount) * 0.7
                forest = clamp(amount * 0.62 + smoothstep(160.0, 300.0, y) * 0.22)
                grass = clamp(0.9 - forest * 0.55 - wet * 0.4)
                valley_weights.append(
                    empty_weights(
                        GRASS=grass,
                        FOREST=forest,
                        WET=wet,
                        RIVER_EXCLUSION=1.0 - amount,
                        WIND_REACTIVE_VEGETATION=clamp(grass * 0.9 + forest * 0.64),
                    )
                )
        for y_index in range(len(valley_y) - 1):
            for cross_index in range(cross_count - 1):
                start = vertex_offset + y_index * cross_count + cross_index
                valley_faces.append(
                    (start, start + 1, start + cross_count + 1, start + cross_count)
                )
    valley = create_mesh_object(
        names["valley"],
        valley_vertices,
        valley_faces,
        valley_weights,
        target_collection,
        materials,
        candidate,
        "macro-valley-floor",
        candidate == "HYBRID",
    )

    meadow_y = [2.0 + index * (150.0 / 22.0) for index in range(23)]
    meadow_vertices = []
    meadow_weights = []
    meadow_faces = []
    meadow_cross_count = 8
    for side in (-1, 1):
        vertex_offset = len(meadow_vertices)
        for y in meadow_y:
            center, half_width, bed_z = interpolate_river(y, settings)
            inner = center + side * (half_width + 12.0)
            extent = (112.0 if side < 0 else 82.0) * settings["meadow_width_scale"]
            outer = side * extent
            for cross_index in range(meadow_cross_count):
                amount = cross_index / (meadow_cross_count - 1)
                x = lerp(inner, outer, amount)
                z = bed_z + 1.9 + 0.24 * math.sin(x * 0.042 + y * 0.026)
                z += 0.12 * math.sin(x * 0.085 - y * 0.018)
                meadow_vertices.append((x, y, z))
                cluster = 0.58 + 0.32 * math.sin(x * 0.038 + y * 0.046 + side)
                flower = clamp(cluster * smoothstep(8.0, 30.0, y) * (1.0 - smoothstep(126.0, 150.0, y)))
                wet = (1.0 - amount) * 0.42
                meadow_weights.append(
                    empty_weights(
                        GRASS=0.84,
                        WET=wet,
                        FLOWER_POTENTIAL=flower,
                        RIVER_EXCLUSION=1.0 - amount,
                        WIND_REACTIVE_VEGETATION=clamp(0.72 + flower * 0.28),
                    )
                )
        for y_index in range(len(meadow_y) - 1):
            for cross_index in range(meadow_cross_count - 1):
                start = vertex_offset + y_index * meadow_cross_count + cross_index
                meadow_faces.append(
                    (
                        start,
                        start + 1,
                        start + meadow_cross_count + 1,
                        start + meadow_cross_count,
                    )
                )
    meadow = create_mesh_object(
        names["meadow"],
        meadow_vertices,
        meadow_faces,
        meadow_weights,
        target_collection,
        materials,
        candidate,
        "flower-meadow-base",
        candidate == "HYBRID",
    )
    return [riverbed, *banks, valley, meadow]


def create_candidate(candidate, target_collection, materials, selected=False):
    role_names = config.SELECTED_OBJECT_NAMES
    names = {
        role: role if selected else f"CANDIDATE_{candidate}_{role}"
        for role in role_names
    }
    objects = [
        create_hero_massif(candidate, names["V3_HERO_MASSIF"], target_collection, materials),
        create_side_mountain(candidate, -1, names["V3_LEFT_RIDGE"], target_collection, materials),
        create_side_mountain(candidate, 1, names["V3_RIGHT_RIDGE"], target_collection, materials),
        create_ridge_band(
            candidate,
            names["V3_MIDGROUND_RIDGES"],
            target_collection,
            materials,
            far=False,
        ),
        create_ridge_band(
            candidate,
            names["V3_FAR_RIDGES"],
            target_collection,
            materials,
            far=True,
        ),
    ]
    objects.extend(
        create_valley_objects(
            candidate,
            {
                "valley": names["V3_VALLEY_FLOOR"],
                "riverbed": names["V3_RIVERBED_PROXY"],
                "left_bank": names["V3_LEFT_RIVERBANK_PROXY"],
                "right_bank": names["V3_RIGHT_RIVERBANK_PROXY"],
                "meadow": names["V3_MEADOW_BASE"],
            },
            target_collection,
            materials,
        )
    )
    return objects


def create_curve(name, points, target_collection, color, cyclic=False):
    curve = bpy.data.curves.new(name, type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = 0.22
    curve.bevel_resolution = 1
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coordinate in zip(spline.points, points):
        point.co = (*coordinate, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    obj.color = color
    obj.hide_render = True
    obj["journey_role"] = "macro-guide"
    obj["export_enabled"] = False
    target_collection.objects.link(obj)
    return obj


def create_guides(settings, guide_collection, zone_collection):
    river_points = []
    left_bank = []
    right_bank = []
    for y, center, half_width, bed_z in config.RIVER_STATIONS:
        width = half_width * settings["river_width_scale"]
        river_points.append((center, y, bed_z + 0.25))
        left_bank.append((center - width - 0.4, y, bed_z + 0.78))
        right_bank.append((center + width + 0.4, y, bed_z + 0.78))
    guides = [
        create_curve("GUIDE_RIVER_CENTERLINE", river_points, guide_collection, (0.05, 0.5, 1.0, 1.0)),
        create_curve("GUIDE_LEFT_BANK_BOUNDARY", left_bank, guide_collection, (0.2, 0.8, 0.95, 1.0)),
        create_curve("GUIDE_RIGHT_BANK_BOUNDARY", right_bank, guide_collection, (0.2, 0.8, 0.95, 1.0)),
        create_curve(
            "GUIDE_VALLEY_LEFT",
            [(-valley_half_width(y, settings), y, 0.022 * y + 2.0) for y in range(50, 351, 30)],
            guide_collection,
            (0.45, 0.95, 0.25, 1.0),
        ),
        create_curve(
            "GUIDE_VALLEY_RIGHT",
            [(valley_half_width(y, settings), y, 0.022 * y + 2.0) for y in range(50, 351, 30)],
            guide_collection,
            (0.45, 0.95, 0.25, 1.0),
        ),
        create_curve(
            "GUIDE_MEADOW_BOUNDARY",
            [(-118, 4, 1), (-105, 145, 5), (75, 145, 5), (92, 4, 1)],
            guide_collection,
            (0.9, 0.25, 0.65, 1.0),
            cyclic=True,
        ),
    ]
    for side in (-1, 1):
        for index, fraction in enumerate((0.30, 0.52, 0.72), start=1):
            points = []
            for y in range(72, 334, 28):
                valley_edge = valley_half_width(y, settings)
                t = fraction + 0.08 * math.sin(y * (0.012 + index * 0.002) + side * index)
                x = side * (valley_edge + t * (224.0 - valley_edge))
                points.append((x, y, 0.022 * y + 30.0 + t * 55.0))
            guides.append(
                create_curve(
                    f"GUIDE_EROSION_{'LEFT' if side < 0 else 'RIGHT'}_{index:02d}",
                    points,
                    guide_collection,
                    (0.72, 0.34, 0.12, 1.0),
                )
            )
    for zone_name in config.ZONE_COLORS:
        empty = bpy.data.objects.new(f"ZONE_GUIDE_{zone_name}", None)
        empty.empty_display_type = "CIRCLE"
        empty.empty_display_size = 1.0
        empty.hide_render = True
        empty["journey_role"] = "zone-guide"
        empty["zone_name"] = zone_name
        empty["export_enabled"] = False
        empty["wind_deforms_geometry"] = False
        zone_collection.objects.link(empty)
    return guides


def reference_signature():
    result = []
    for collection_name in (
        "V1_MAIN_SPATIAL_REFERENCE_LOCKED",
        "V1_PHASE2_ENV_REFERENCE_LOCKED",
        "V3_CAMERA_BASELINES",
        "V3_CAMERA_FRUSTUMS",
        "V3_REVIEW_GUIDES",
    ):
        target = bpy.data.collections[collection_name]
        for obj in sorted(collection_recursive_objects(target), key=lambda item: item.name):
            result.append(
                {
                    "collection": collection_name,
                    "name": obj.name,
                    "type": obj.type,
                    "matrixWorld": [round(value, 9) for row in obj.matrix_world for value in row],
                    "vertices": len(obj.data.vertices) if obj.type == "MESH" else None,
                    "polygons": len(obj.data.polygons) if obj.type == "MESH" else None,
                    "sourceSha256": obj.get("source_sha256"),
                    "lockedReference": obj.get("locked_reference"),
                }
            )
    encoded = json.dumps(result, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return {"sha256": hashlib.sha256(encoded).hexdigest(), "objects": result}


def mesh_geometry_hash(obj):
    digest = hashlib.sha256()
    for vertex in obj.data.vertices:
        digest.update(struct.pack("<3d", *vertex.co))
    for polygon in obj.data.polygons:
        digest.update(struct.pack("<I", len(polygon.vertices)))
        for index in polygon.vertices:
            digest.update(struct.pack("<I", index))
    return digest.hexdigest()


def object_record(obj):
    bounds = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "name": obj.name,
        "type": obj.type,
        "candidate": obj.get("candidate"),
        "role": obj.get("journey_role"),
        "cycle": obj.get("cycle"),
        "exportEnabled": obj.get("export_enabled"),
        "transform": [round(value, 9) for row in obj.matrix_world for value in row],
        "vertexCount": len(obj.data.vertices) if obj.type == "MESH" else None,
        "polygonCount": len(obj.data.polygons) if obj.type == "MESH" else None,
        "geometrySha256": mesh_geometry_hash(obj) if obj.type == "MESH" else None,
        "bounds": {
            "min": [min(point[axis] for point in bounds) for axis in range(3)],
            "max": [max(point[axis] for point in bounds) for axis in range(3)],
        },
        "attributes": sorted(attribute.name for attribute in obj.data.attributes)
        if obj.type == "MESH"
        else [],
    }


def camera_review(cameras, selected_objects):
    mountains = [
        obj
        for obj in selected_objects
        if obj.get("journey_role")
        in {"macro-hero-massif", "macro-mountain-ridge", "macro-midground-ridges", "macro-far-ridges"}
    ]
    meadow = next(obj for obj in selected_objects if obj.name == "V3_MEADOW_BASE")
    river = next(obj for obj in selected_objects if obj.name == "V3_RIVERBED_PROXY")
    results = []
    for camera in cameras:
        camera_position = camera.matrix_world.translation
        projected = []
        minimum_mountain_distance = float("inf")
        for obj in mountains:
            stride = max(1, len(obj.data.vertices) // 1600)
            for vertex_index in range(0, len(obj.data.vertices), stride):
                vertex = obj.data.vertices[vertex_index]
                world = obj.matrix_world @ vertex.co
                minimum_mountain_distance = min(
                    minimum_mountain_distance, (world - camera_position).length
                )
                coordinate = world_to_camera_view(bpy.context.scene, camera, world)
                if 0.0 <= coordinate.x <= 1.0 and 0.0 <= coordinate.y <= 1.0 and coordinate.z > 0:
                    projected.append((coordinate.x, coordinate.y))
        meadow_projection = []
        for vertex in meadow.data.vertices:
            coordinate = world_to_camera_view(
                bpy.context.scene, camera, meadow.matrix_world @ vertex.co
            )
            if coordinate.z > 0:
                meadow_projection.append((coordinate.x, coordinate.y))
        river_projection = []
        for vertex in river.data.vertices:
            coordinate = world_to_camera_view(
                bpy.context.scene, camera, river.matrix_world @ vertex.co
            )
            if coordinate.z > 0:
                river_projection.append((coordinate.x, coordinate.y))
        results.append(
            {
                "camera": camera.name,
                "progress": camera.get("progress"),
                "minimumMountainVertexDistance": minimum_mountain_distance,
                "mountainVisibleSampleCount": len(projected),
                "approximateSkyFractionAboveHighestMountain": 1.0 - max(
                    (point[1] for point in projected), default=0.0
                ),
                "meadowProjectedYRange": [
                    min((point[1] for point in meadow_projection), default=None),
                    max((point[1] for point in meadow_projection), default=None),
                ],
                "riverProjectedSampleCount": sum(
                    1
                    for point in river_projection
                    if 0.0 <= point[0] <= 1.0 and 0.0 <= point[1] <= 1.0
                ),
            }
        )
    return results


def setup_diagnostic_scene(materials, guide_collection):
    scene = bpy.context.scene
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.image_settings.color_mode = "RGBA"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("V3_DIAGNOSTIC_WORLD")
    scene.world.color = (0.08, 0.12, 0.14)
    scene.world.use_nodes = True
    world_background = next(
        (
            node
            for node in scene.world.node_tree.nodes
            if node.bl_idname == "ShaderNodeBackground"
        ),
        None,
    )
    if world_background is None:
        world_background = scene.world.node_tree.nodes.new("ShaderNodeBackground")
    world_background.inputs["Color"].default_value = (0.16, 0.31, 0.38, 1.0)
    world_background.inputs["Strength"].default_value = 0.42
    sun_data = bpy.data.lights.new("V3_DIAGNOSTIC_SUN_DATA", type="SUN")
    sun_data.energy = 1.35
    sun_data.angle = math.radians(7.0)
    sun = bpy.data.objects.new("V3_DIAGNOSTIC_SUN", sun_data)
    sun.rotation_euler = (math.radians(38.0), math.radians(-18.0), math.radians(-38.0))
    sun["journey_role"] = "diagnostic-lighting"
    sun["export_enabled"] = False
    guide_collection.objects.link(sun)
    return sun


def render_reviews(
    render_dir,
    materials,
    candidate_objects,
    reference_original_visibility,
    camera_map,
):
    render_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    all_candidate_objects = [obj for values in candidate_objects.values() for obj in values]
    references = list(reference_original_visibility)
    material_states = {
        obj: (list(obj.data.materials), [polygon.material_index for polygon in obj.data.polygons])
        for obj in all_candidate_objects
    }

    def assign_review_material(obj, review_material):
        obj.data.materials.clear()
        obj.data.materials.append(review_material)
        for polygon in obj.data.polygons:
            polygon.material_index = 0

    def restore_materials(obj):
        original_materials, original_indices = material_states[obj]
        obj.data.materials.clear()
        for original in original_materials:
            obj.data.materials.append(original)
        for polygon, original_index in zip(obj.data.polygons, original_indices):
            polygon.material_index = original_index

    def configure(candidate, camera_name, clay, cave):
        for obj in all_candidate_objects:
            obj.hide_render = obj not in candidate_objects[candidate]
            if obj in candidate_objects[candidate]:
                if clay:
                    assign_review_material(obj, materials["clay"])
                else:
                    restore_materials(obj)
        for obj in references:
            obj.hide_render = not (
                cave and any(token in obj.name for token in config.RETAINED_CAVE_TOKENS)
            )
        scene.camera = camera_map[camera_name]
        view_layer.material_override = None
        bpy.context.view_layer.update()

    renders = []

    def render(candidate, camera_name, clay, cave, filename):
        configure(candidate, camera_name, clay, cave)
        path = render_dir / filename
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        renders.append(str(path))

    for candidate in ("A", "B"):
        prefix = f"candidate-{candidate.lower()}"
        render(candidate, "CAM_V3_CAVE_EXIT_1440x900", True, True, f"{prefix}-cave-exit-clay.png")
        render(candidate, "CAM_V3_DAY_CLEAR_START_1440x900", True, False, f"{prefix}-day-clear-clay.png")
        render(candidate, "CAM_V3_DAY_CLEAR_START_1440x900", False, False, f"{prefix}-day-clear-zones.png")

    render("HYBRID", "CAM_V3_CAVE_EXIT_1440x900", True, True, "selected-cave-exit-clay.png")
    render("HYBRID", "CAM_V3_DAY_CLEAR_START_1440x900", True, False, "selected-day-clear-start-clay.png")
    render("HYBRID", "CAM_V3_DAY_CLEAR_LATE_1440x900", True, False, "selected-day-clear-late-clay.png")
    render("HYBRID", "CAM_V3_DAY_CLEAR_START_1440x900", False, False, "selected-day-clear-zones.png")
    for progress in config.CAMERA_SWEEP_PROGRESS:
        camera_name = f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_")
        render(
            "HYBRID",
            camera_name,
            True,
            progress <= 16.0,
            f"selected-sweep-p{progress:05.2f}.png".replace(".", "_", 1),
        )

    view_layer.material_override = None
    for obj in all_candidate_objects:
        restore_materials(obj)
    for obj, hidden in reference_original_visibility.items():
        obj.hide_render = hidden
    for obj in candidate_objects["A"] + candidate_objects["B"]:
        obj.hide_render = True
        obj.hide_viewport = True
    for obj in candidate_objects["HYBRID"]:
        obj.hide_render = False
        obj.hide_viewport = False
    return renders


def main():
    args = parse_args()
    args.output = args.output.resolve()
    args.render_dir = args.render_dir.resolve()
    args.validation_output = args.validation_output.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.validation_output.parent.mkdir(parents=True, exist_ok=True)
    source_hash_before = sha256_file(PHASE1B_BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(PHASE1B_BLEND))
    scene = bpy.context.scene
    locked_before = reference_signature()
    environment_root = bpy.data.collections["V3_ENVIRONMENT_WORK"]
    if environment_root.children:
        raise RuntimeError("Phase 1B V3_ENVIRONMENT_WORK is not empty")
    environment_root["journey_phase"] = "1C"
    environment_root["selected_candidate"] = "HYBRID"

    selected_collection = new_collection("V3_MACRO_SELECTED", environment_root)
    guide_collection = new_collection("V3_MACRO_GUIDES", environment_root)
    zone_collection = new_collection("V3_ZONE_GUIDES", environment_root)
    alternatives_collection = new_collection("V3_MACRO_ALTERNATIVES", environment_root)
    candidate_a_collection = new_collection("V3_MACRO_CANDIDATE_A", alternatives_collection)
    candidate_b_collection = new_collection("V3_MACRO_CANDIDATE_B", alternatives_collection)
    set_collection_role(selected_collection, "selected-macro-environment", True, True)
    set_collection_role(guide_collection, "macro-guides", False)
    set_collection_role(zone_collection, "zone-guides", False)
    set_collection_role(alternatives_collection, "macro-alternatives", False)
    set_collection_role(candidate_a_collection, "candidate-a-montfort", False)
    set_collection_role(candidate_b_collection, "candidate-b-hero-valley", False)

    materials = build_materials()
    candidate_objects = {
        "A": create_candidate("A", candidate_a_collection, materials),
        "B": create_candidate("B", candidate_b_collection, materials),
        "HYBRID": create_candidate("HYBRID", selected_collection, materials, selected=True),
    }
    guides = create_guides(config.CANDIDATES["HYBRID"], guide_collection, zone_collection)
    setup_diagnostic_scene(materials, guide_collection)

    camera_objects = sorted(
        [obj for obj in bpy.data.collections["V3_CAMERA_BASELINES"].objects if obj.type == "CAMERA"],
        key=lambda obj: obj.name,
    )
    camera_map = {obj.name: obj for obj in camera_objects}
    required_cameras = {
        "CAM_V3_CAVE_EXIT_1440x900",
        "CAM_V3_DAY_CLEAR_START_1440x900",
        "CAM_V3_DAY_CLEAR_LATE_1440x900",
        *{
            f"CAM_V3_SWEEP_P{progress:06.2f}".replace(".", "_")
            for progress in config.CAMERA_SWEEP_PROGRESS
        },
    }
    missing = sorted(required_cameras - set(camera_map))
    if missing:
        raise RuntimeError(f"Missing Phase 1B cameras: {missing}")

    reference_objects = []
    for collection_name in (
        "V1_MAIN_SPATIAL_REFERENCE_LOCKED",
        "V1_PHASE2_ENV_REFERENCE_LOCKED",
    ):
        reference_objects.extend(collection_recursive_objects(bpy.data.collections[collection_name]))
    reference_original_visibility = {obj: obj.hide_render for obj in reference_objects}
    rendered = []
    if not args.skip_renders:
        rendered = render_reviews(
            args.render_dir,
            materials,
            candidate_objects,
            reference_original_visibility,
            camera_map,
        )
    else:
        for obj in candidate_objects["A"] + candidate_objects["B"]:
            obj.hide_render = True
            obj.hide_viewport = True
        for obj in candidate_objects["HYBRID"]:
            obj.hide_render = False
            obj.hide_viewport = False

    for obj, hidden in reference_original_visibility.items():
        obj.hide_render = hidden
    scene.camera = camera_map["CAM_V3_DAY_CLEAR_START_1440x900"]
    locked_after = reference_signature()
    if locked_before["sha256"] != locked_after["sha256"]:
        raise RuntimeError("Locked Phase 1B reference changed during Phase 1C build")
    if sha256_file(PHASE1B_BLEND) != source_hash_before:
        raise RuntimeError("Phase 1B source Blend was modified")

    selected_records = [object_record(obj) for obj in candidate_objects["HYBRID"]]
    candidate_records = {
        key: [object_record(obj) for obj in values]
        for key, values in candidate_objects.items()
    }
    camera_results = camera_review(camera_objects, candidate_objects["HYBRID"])
    minimum_distance = min(entry["minimumMountainVertexDistance"] for entry in camera_results)
    if minimum_distance < 30.0:
        raise RuntimeError(
            f"Selected mountain enters camera guard band: {minimum_distance:.3f}"
        )
    structure = {
        "schemaVersion": 1,
        "phase": "Journey V3 Phase 1C",
        "sourceBlend": str(PHASE1B_BLEND),
        "sourceBlendSha256": source_hash_before,
        "outputBlend": str(args.output),
        "renderResolution": [1440, 900, 100],
        "selectedCandidate": "HYBRID",
        "selectedCycle": 2,
        "candidateIntent": {
            key: value["label"] for key, value in config.CANDIDATES.items()
        },
        "lockedReferenceSignatureBefore": locked_before["sha256"],
        "lockedReferenceSignatureAfter": locked_after["sha256"],
        "lockedReferenceUnchanged": locked_before["sha256"] == locked_after["sha256"],
        "collections": {
            "V3_ENVIRONMENT_WORK": [child.name for child in environment_root.children],
            "V3_MACRO_ALTERNATIVES": [child.name for child in alternatives_collection.children],
        },
        "objectCounts": {key: len(values) for key, values in candidate_objects.items()},
        "candidates": candidate_records,
        "selectedObjects": selected_records,
        "guideObjects": sorted(obj.name for obj in guides),
        "zoneGuides": sorted(obj.name for obj in zone_collection.objects),
        "cameras": [
            {
                "name": camera.name,
                "progress": camera.get("progress"),
                "matrixWorld": [round(value, 9) for row in camera.matrix_world for value in row],
                "lens": camera.data.lens,
            }
            for camera in camera_objects
        ],
        "cameraReview": camera_results,
        "minimumMountainCameraDistance": minimum_distance,
        "renderedFiles": rendered,
        "deterministicSignature": None,
    }
    deterministic_payload = {
        key: value
        for key, value in structure.items()
        if key not in {"outputBlend", "renderedFiles", "deterministicSignature"}
    }
    structure["deterministicSignature"] = hashlib.sha256(
        json.dumps(deterministic_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    with open(args.validation_output, "w", encoding="utf-8") as handle:
        json.dump(structure, handle, indent=2)
        handle.write("\n")
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output), check_existing=False)
    print(
        json.dumps(
            {
                "output": str(args.output),
                "validation": str(args.validation_output),
                "selectedCandidate": structure["selectedCandidate"],
                "objectCounts": structure["objectCounts"],
                "lockedReferenceUnchanged": structure["lockedReferenceUnchanged"],
                "minimumMountainCameraDistance": minimum_distance,
                "deterministicSignature": structure["deterministicSignature"],
                "renders": len(rendered),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
