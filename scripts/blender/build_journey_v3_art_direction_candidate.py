"""Build Journey V3 Phase 1C.3 Candidate M or H from the v003 foundation."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import resource
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import build_journey_v3_volumetric_terrain_v003 as phase1c2
import build_journey_v3_macro_massing as phase1c
import journey_v3_art_direction_v004_config as art_config


ROOT = Path(__file__).resolve().parents[2]
SOURCE_BLEND = ROOT / "work/blender/journey-v3/phase1c2/journey-v3-volumetric-terrain-v003.blend"
OUTPUT_ROOT = ROOT / "work/blender/journey-v3/phase1c3"
RENDER_ROOT = ROOT / "docs/references/journey-v3/baselines/art-direction-v004"
EXPECTED_SOURCE_SHA256 = "e4341be717e17791d4988ea919c33443e3fbc1e3dcecee0797224b74a2bfb362"
VIEWPORT = (1440, 900)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True, choices=("M", "H"))
    parser.add_argument("--output", type=Path)
    parser.add_argument("--render-dir", type=Path, default=RENDER_ROOT)
    parser.add_argument("--validation-output", type=Path)
    parser.add_argument("--skip-renders", action="store_true")
    parser.add_argument("--quick-renders", action="store_true")
    arguments = parser.parse_args(
        sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    )
    slug = arguments.candidate.lower()
    arguments.output = arguments.output or OUTPUT_ROOT / f"journey-v3-art-direction-candidate-{slug}.blend"
    arguments.validation_output = arguments.validation_output or RENDER_ROOT / f"candidate-{slug}-structure.json"
    return arguments


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smoothstep(edge0, edge1, value):
    amount = clamp((value - edge0) / max(edge1 - edge0, 1e-9))
    return amount * amount * (3.0 - 2.0 * amount)


def lerp(left, right, amount):
    return left + (right - left) * amount


def segment_projection(x, y, start, end):
    sx, sy = start[:2]
    ex, ey = end[:2]
    vx = ex - sx
    vy = ey - sy
    length_squared = vx * vx + vy * vy
    if length_squared <= 1e-9:
        return 0.0, math.hypot(x - sx, y - sy), 0.0
    amount = clamp(((x - sx) * vx + (y - sy) * vy) / length_squared)
    closest_x = sx + vx * amount
    closest_y = sy + vy * amount
    length = math.sqrt(length_squared)
    signed_distance = (vx * (y - closest_y) - vy * (x - closest_x)) / length
    return amount, abs(signed_distance), signed_distance


def segment_distance(x, y, start, end):
    amount, _distance, _signed = segment_projection(x, y, start, end)
    sx, sy = start
    ex, ey = end
    closest_x = lerp(sx, ex, amount)
    closest_y = lerp(sy, ey, amount)
    return math.hypot(x - closest_x, y - closest_y)


def ridge_profile(normalized_distance):
    """Piecewise macro profile: crest, planar face, slope break, then foot."""
    value = abs(normalized_distance)
    if value >= 1.0:
        return 0.0
    if value <= 0.16:
        return 1.0 - 0.08 * (value / 0.16)
    if value <= 0.52:
        return lerp(0.92, 0.52, (value - 0.16) / 0.36)
    if value <= 0.76:
        return lerp(0.52, 0.26, (value - 0.52) / 0.24)
    return 0.26 * (1.0 - smoothstep(0.76, 1.0, value))


def ridge_value(x, y, ridge):
    best = 0.0
    points = ridge["points"]
    for start, end in zip(points, points[1:]):
        amount, _distance, signed_distance = segment_projection(x, y, start, end)
        height = lerp(start[2], end[2], amount)
        left_width = lerp(start[3], end[3], amount)
        right_width = lerp(start[4], end[4], amount)
        width = left_width if signed_distance >= 0.0 else right_width
        profile = ridge_profile(signed_distance / max(width, 1e-6))
        best = max(best, height * profile * ridge.get("weight", 1.0))
    return best


def ridge_network_value(x, y, ridges):
    values = sorted((ridge_value(x, y, ridge) for ridge in ridges), reverse=True)
    if not values:
        return 0.0
    result = values[0]
    if len(values) > 1:
        result += values[1] * 0.18
    if len(values) > 2:
        result += values[2] * 0.06
    return result


def compact_mass_value(x, y, field):
    """An anisotropic, finite-footprint mass with deliberate slope breaks."""
    _group, center_x, center_y, height, radius_x, radius_y, angle_degrees = field
    angle = math.radians(angle_degrees)
    cosine = math.cos(angle)
    sine = math.sin(angle)
    local_x = (x - center_x) * cosine + (y - center_y) * sine
    local_y = -(x - center_x) * sine + (y - center_y) * cosine
    q = math.sqrt((local_x / radius_x) ** 2 + (local_y / radius_y) ** 2)
    if q >= 1.0:
        return 0.0
    if q <= 0.18:
        profile = lerp(1.0, 0.93, q / 0.18)
    elif q <= 0.52:
        profile = lerp(0.93, 0.58, (q - 0.18) / 0.34)
    elif q <= 0.78:
        profile = lerp(0.58, 0.25, (q - 0.52) / 0.26)
    else:
        profile = 0.25 * (1.0 - smoothstep(0.78, 1.0, q))
    return height * profile


def compact_mass_network(x, y, fields, group=None):
    values = sorted(
        (
            compact_mass_value(x, y, field)
            for field in fields
            if group is None or field[0] == group
        ),
        reverse=True,
    )
    if not values:
        return 0.0
    return values[0] + sum(values[1:3]) * 0.16


def river_sample(candidate, y):
    stations = candidate["river"]
    if y <= stations[0][0]:
        return stations[0][1], stations[0][2]
    if y >= stations[-1][0]:
        return stations[-1][1], stations[-1][2]
    for left, right in zip(stations, stations[1:]):
        if left[0] <= y <= right[0]:
            amount = (y - left[0]) / (right[0] - left[0])
            return lerp(left[1], right[1], amount), lerp(left[2], right[2], amount)
    raise RuntimeError("River interpolation failed")


def make_terrain_function(candidate):
    def terrain_components(x, y):
        center, river_width = river_sample(candidate, y)
        base = 0.10 + (y + 300.0) * 0.0068
        meadow_fade = 1.0 - smoothstep(170.0, 270.0, y)
        phase = candidate["meadow_phase"]
        meadow_relief = meadow_fade * (
            1.62 * math.sin(x * 0.012 + y * 0.008 + phase)
            + 0.66 * math.sin(x * 0.029 - y * 0.011 + phase * 1.7)
            + 0.30 * math.sin(x * 0.053 + y * 0.022 - phase)
        )
        meadow_slope = meadow_fade * (abs(x - center) / 620.0) * 1.25

        left_mass = compact_mass_network(x, y, candidate["mass_fields"], "left")
        right_mass = compact_mass_network(x, y, candidate["mass_fields"], "right")
        distant_mass = compact_mass_network(
            x,
            y,
            [
                ("distant", field[0], field[1] - 130.0, *field[2:])
                for field in candidate["distant_fields"]
            ],
            "distant",
        )
        left = left_mass + ridge_network_value(x, y, candidate["left_ridges"]) * candidate["ridge_strength"]
        right = right_mass + ridge_network_value(x, y, candidate["right_ridges"]) * candidate["ridge_strength"]
        distant = distant_mass + ridge_network_value(x, y, candidate["distant_ridges"]) * candidate["distant_ridge_strength"]
        near_width, far_width = candidate["valley_width"]
        valley_width = lerp(near_width, far_width, smoothstep(80.0, 1060.0, y))
        valley_mask = math.exp(-((abs(x - center) / max(valley_width, 1.0)) ** 3.6))
        left *= 1.0 - valley_mask * 0.94
        right *= 1.0 - valley_mask * 0.92
        distant *= 1.0 - valley_mask * candidate["distant_valley_cut"]

        values = sorted((left, right, distant), reverse=True)
        mountain = (values[0] + values[1] * 0.12) * candidate["height_scale"]
        drainage = 0.0
        for start, end, amplitude, width in candidate["drainage"]:
            distance = segment_distance(x, y, start, end)
            drainage += amplitude * math.exp(-0.5 * (distance / width) ** 2)
        drainage *= smoothstep(28.0, 150.0, mountain)
        mountain = max(0.0, mountain - drainage)

        distance_to_river = abs(x - center)
        river_factor = math.exp(-((distance_to_river / max(river_width, 1e-6)) ** 4.0))
        river_depth = lerp(2.1, 0.82, smoothstep(-300.0, 1100.0, y))
        bank_distance = abs(distance_to_river - river_width * 1.12)
        bank = 0.56 * math.exp(-0.5 * (bank_distance / max(river_width * 0.38, 1.0)) ** 2)
        z = base + meadow_relief + meadow_slope + mountain + bank - river_factor * river_depth
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
            "nearFade": meadow_fade,
        }

    return terrain_components


def configure_phase1c2(candidate, terrain_components):
    domain = art_config.DOMAIN
    phase1c2.config.X_MIN = domain["x_min"]
    phase1c2.config.X_MAX = domain["x_max"]
    phase1c2.config.Y_MIN = domain["y_min"]
    phase1c2.config.Y_MAX = domain["y_max"]
    phase1c2.config.GRID_STEP = domain["grid_step"]
    phase1c2.config.BOTTOM_Z = domain["bottom_z"]
    phase1c2.config.RIVER_STATIONS = candidate["river"]
    phase1c2.terrain_components = terrain_components
    phase1c2.terrain_height = lambda x, y: terrain_components(x, y)["z"]


def guide_material(name, color):
    value = bpy.data.materials.new(name)
    value.use_nodes = True
    nodes = value.node_tree.nodes
    links = value.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = 1.7
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    value["diagnostic_only"] = True
    value["export_enabled"] = False
    return value


def guide_curve(name, points, collection, material_value, bevel=1.6, cyclic=False):
    curve = bpy.data.curves.new(f"{name}_CURVE", "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = bevel
    curve.bevel_resolution = 2
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for destination, point in zip(spline.points, points):
        destination.co = (*point, 1.0)
    spline.use_cyclic_u = cyclic
    curve.materials.append(material_value)
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.hide_render = True
    obj["export_enabled"] = False
    obj["journey_role"] = "phase-1c3-review-guide"
    return obj


def build_guides(candidate_key, candidate, collection, camera_lookup, terrain_components):
    materials = {
        "river": guide_material(f"MAT_{candidate_key}_RIVER_GUIDE", (0.01, 0.50, 1.0, 1.0)),
        "ridge": guide_material(f"MAT_{candidate_key}_RIDGE_GUIDE", (1.0, 0.24, 0.04, 1.0)),
        "camera": guide_material(f"MAT_{candidate_key}_CAMERA_PATH", (1.0, 0.82, 0.06, 1.0)),
        "bounds": guide_material(f"MAT_{candidate_key}_BOUNDS", (0.2, 1.0, 0.35, 1.0)),
        "cave": guide_material(f"MAT_{candidate_key}_CAVE", (0.96, 0.12, 0.78, 1.0)),
        "axis_x": guide_material(f"MAT_{candidate_key}_AXIS_X", (1.0, 0.05, 0.05, 1.0)),
        "axis_y": guide_material(f"MAT_{candidate_key}_AXIS_Y", (0.05, 1.0, 0.1, 1.0)),
    }
    river_points = [
        (center, y, terrain_components(center, y)["z"] + 5.0)
        for y, center, _width in candidate["river"]
        if y >= 150.0
    ]
    guides = [guide_curve(f"GUIDE_{candidate_key}_RIVER_CENTERLINE", river_points, collection, materials["river"], 1.15)]
    for group in ("left_ridges", "right_ridges", "distant_ridges"):
        for ridge in candidate[group]:
            points = [
                (point[0], point[1], terrain_components(point[0], point[1])["z"] + 3.0)
                for point in ridge["points"]
            ]
            guides.append(guide_curve(f"GUIDE_{ridge['name']}", points, collection, materials["ridge"], 1.2))

    ordered_sweep = sorted(
        (
            camera
            for camera in camera_lookup.values()
            if camera.type == "CAMERA" and ("SWEEP" in camera.name or "CAVE_EXIT" in camera.name or "DAY_CLEAR_START" in camera.name)
        ),
        key=lambda item: float(item.get("progress", 30.0)),
    )
    camera_points = [tuple(camera.matrix_world.translation) for camera in ordered_sweep]
    if len(camera_points) >= 2:
        guides.append(guide_curve(f"GUIDE_{candidate_key}_CAMERA_SWEEP", camera_points, collection, materials["camera"], 1.5))

    domain = art_config.DOMAIN
    bounds_z = domain["bottom_z"] + 2.0
    bounds = [
        (domain["x_min"], domain["y_min"], bounds_z),
        (domain["x_max"], domain["y_min"], bounds_z),
        (domain["x_max"], domain["y_max"], bounds_z),
        (domain["x_min"], domain["y_max"], bounds_z),
    ]
    guides.append(guide_curve(f"GUIDE_{candidate_key}_TERRAIN_BOUNDS", bounds, collection, materials["bounds"], 2.0, True))
    guides.append(guide_curve(f"GUIDE_{candidate_key}_AXIS_X", [(-110.0, 0.0, 8.0), (110.0, 0.0, 8.0)], collection, materials["axis_x"], 1.4))
    guides.append(guide_curve(f"GUIDE_{candidate_key}_AXIS_Y", [(0.0, -110.0, 8.0), (0.0, 110.0, 8.0)], collection, materials["axis_y"], 1.4))

    cave = bpy.data.objects["CAVE_HQ_INTERIOR_SHELL"]
    corners = [cave.matrix_world @ Vector(corner) for corner in cave.bound_box]
    cave_min_x = min(point.x for point in corners)
    cave_max_x = max(point.x for point in corners)
    cave_min_y = min(point.y for point in corners)
    cave_max_y = max(point.y for point in corners)
    cave_z = max(point.z for point in corners) + 2.0
    cave_outline = [
        (cave_min_x, cave_min_y, cave_z),
        (cave_max_x, cave_min_y, cave_z),
        (cave_max_x, cave_max_y, cave_z),
        (cave_min_x, cave_max_y, cave_z),
    ]
    guides.append(guide_curve(f"GUIDE_{candidate_key}_CAVE_BOUNDS", cave_outline, collection, materials["cave"], 1.8, True))
    return guides


def create_review_cameras(collection, terrain):
    points = [terrain.matrix_world @ vertex.co for vertex in terrain.data.vertices]
    minimum = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    maximum = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    center = (minimum + maximum) * 0.5
    width = maximum.x - minimum.x
    depth = maximum.y - minimum.y
    height = maximum.z - minimum.z
    aspect = VIEWPORT[0] / VIEWPORT[1]
    result = {}

    def camera(name, camera_type, location, target, value):
        data = bpy.data.cameras.new(f"{name}_DATA")
        data.type = camera_type
        if camera_type == "ORTHO":
            data.ortho_scale = value
        else:
            data.lens = value
        data.clip_start = 0.1
        data.clip_end = 5000.0
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        phase1c2.look_at(obj, target)
        obj["export_enabled"] = False
        obj["journey_role"] = "full-terrain-review-camera"
        collection.objects.link(obj)
        result[name] = obj

    top_scale = max(depth * 1.26, (width / aspect) * 1.26)
    side_scale = max(height * 1.34, (depth / aspect) * 1.26)
    camera("CAM_V004_TOP", "ORTHO", (center.x, center.y, maximum.z + 1500.0), center, top_scale)
    camera("CAM_V004_SIDE", "ORTHO", (minimum.x - 1500.0, center.y, center.z), center, side_scale)
    review_target = (center.x, center.y, minimum.z + height * 0.38)
    camera("CAM_V004_ORBIT_LEFT", "PERSP", (-1180.0, -960.0, maximum.z + 520.0), review_target, 48.0)
    camera("CAM_V004_ORBIT_RIGHT", "PERSP", (1180.0, -960.0, maximum.z + 520.0), review_target, 48.0)
    camera("CAM_V004_ELEVATED", "PERSP", (1040.0, -1120.0, maximum.z + 820.0), review_target, 52.0)
    return result, {"min": list(minimum), "max": list(maximum), "center": list(center)}


def silhouette_material(name):
    value = guide_material(name, (1.0, 1.0, 1.0, 1.0))
    return value


def render_candidate(candidate_key, render_dir, v004_objects, refs, materials, camera_lookup, review_cameras, guides, quick=False):
    render_dir.mkdir(parents=True, exist_ok=True)
    diagnostic_dir = render_dir / "diagnostic"
    diagnostic_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    slug = candidate_key.lower()
    rendered = []
    silhouette = silhouette_material(f"MAT_{candidate_key}_SILHOUETTE")
    original_world = scene.world.color[:]
    guide_visibility = {guide: guide.hide_render for guide in guides}

    def configure(camera, mode="clay", cave=False, show_guides=False, river_only=False, show_story=False):
        for obj in v004_objects:
            obj.hide_render = False
            if obj.name in {"V3_CAVE_EXIT_FLOOR_CONNECTOR", "V3_CAVE_TO_MEADOW_TRANSITION"}:
                obj.hide_render = not cave
            if obj.name == "V3_CAVE_FADE_REPLACEMENT_FLOOR":
                obj.hide_render = cave
            if obj.type != "MESH":
                continue
            if mode == "silhouette":
                phase1c2.single_material(obj, silhouette)
            elif obj.name == "V3_TERRAIN_SKIRT_AND_BOTTOM":
                phase1c2.single_material(obj, materials["skirt"])
            elif "CAVE" in obj.name:
                phase1c2.single_material(obj, materials["connector"])
            else:
                phase1c2.single_material(obj, materials["clay"])

        for obj in refs:
            retain_cave = cave and obj.name in phase1c2.CAVE_NAMES
            retain_story = show_story and "SEATED" in obj.name.upper()
            obj.hide_render = not (retain_cave or retain_story)
            if not obj.hide_render and obj.type == "MESH":
                phase1c2.single_material(obj, materials["cave"] if retain_cave else materials["story"])

        for guide in guides:
            guide.hide_render = not show_guides
            if river_only:
                guide.hide_render = "RIVER_CENTERLINE" not in guide.name

        scene.world.color = (0.0, 0.0, 0.0) if mode == "silhouette" else original_world
        scene.camera = camera
        bpy.context.view_layer.update()

    def render(filename, camera, **kwargs):
        configure(camera, **kwargs)
        path = render_dir / filename
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        rendered.append(str(path))

    day = camera_lookup["CAM_V3_DAY_CLEAR_START_1440x900"]
    final_wide = camera_lookup["CAM_V3_STORY_FINAL_WIDE_1440x900"]
    cave = camera_lookup["CAM_V3_CAVE_EXIT_1440x900"]
    render(f"candidate-{slug}-day-clear-clay.png", day)
    render(f"candidate-{slug}-day-clear-silhouette.png", day, mode="silhouette")
    render(f"candidate-{slug}-cave-exit.png", cave, cave=True)
    render(f"candidate-{slug}-final-wide.png", final_wide)
    render(f"diagnostic/candidate-{slug}-final-wide-silhouette.png", final_wide, mode="silhouette")
    render(f"candidate-{slug}-top-view.png", review_cameras["CAM_V004_TOP"], show_guides=True)
    render(f"candidate-{slug}-side-view.png", review_cameras["CAM_V004_SIDE"], show_guides=True)
    render(f"candidate-{slug}-orbit-left.png", review_cameras["CAM_V004_ORBIT_LEFT"], show_guides=True)
    render(f"candidate-{slug}-orbit-right.png", review_cameras["CAM_V004_ORBIT_RIGHT"], show_guides=True)
    render(f"candidate-{slug}-elevated.png", review_cameras["CAM_V004_ELEVATED"], show_guides=True)
    render(f"candidate-{slug}-river-projection.png", day, show_guides=True, river_only=True)

    if not quick:
        for preview in phase1c2.config.FULL_STORY_PREVIEWS:
            camera_name = f"CAM_V3_STORY_{preview.upper().replace('-', '_')}_1440x900"
            render(
                f"diagnostic/candidate-{slug}-story-{preview}.png",
                camera_lookup[camera_name],
            )

    for guide, hidden in guide_visibility.items():
        guide.hide_render = hidden
    scene.world.color = original_world
    return rendered


def projected_metrics(camera, terrain):
    width, height = VIEWPORT
    mountain_indices = set()
    for name in ("V3_LEFT_DOMINANT_MASSIF", "V3_RIGHT_MIDGROUND_RIDGES", "V3_DISTANT_MOUNTAIN_RANGE"):
        attribute = terrain.data.attributes[name]
        mountain_indices.update(index for index, value in enumerate(attribute.data) if value.value > 0.25)
    projected = []
    for index in mountain_indices:
        point = terrain.matrix_world @ terrain.data.vertices[index].co
        coordinate = world_to_camera_view(bpy.context.scene, camera, point)
        if coordinate.z > 0 and 0 <= coordinate.x <= 1 and 0 <= coordinate.y <= 1:
            projected.append((coordinate.x, coordinate.y))
    river_attribute = terrain.data.attributes["V3_RIVERBED"]
    river_points = []
    for index, value in enumerate(river_attribute.data):
        if value.value <= 0.55:
            continue
        point = terrain.matrix_world @ terrain.data.vertices[index].co
        coordinate = world_to_camera_view(bpy.context.scene, camera, point)
        if coordinate.z > 0 and 0 <= coordinate.x <= 1 and 0 <= coordinate.y <= 1:
            river_points.append((coordinate.x, coordinate.y))
    return {
        "mountainSilhouette": {
            "widthPixels": (max(point[0] for point in projected) - min(point[0] for point in projected)) * width if projected else 0,
            "heightPixels": (max(point[1] for point in projected) - min(point[1] for point in projected)) * height if projected else 0,
            "boundsNdc": {
                "min": [min((point[0] for point in projected), default=None), min((point[1] for point in projected), default=None)],
                "max": [max((point[0] for point in projected), default=None), max((point[1] for point in projected), default=None)],
            },
        },
        "riverVisibleWidthPixels": (max(point[0] for point in river_points) - min(point[0] for point in river_points)) * width if river_points else 0,
        "mountainSampleCount": len(projected),
        "riverSampleCount": len(river_points),
    }


def geometry_budget(objects, grid):
    records = []
    total_vertices = 0
    total_triangles = 0
    total_boundary = 0
    estimated_bytes = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        topology = phase1c2.topology_record(obj)
        triangles = sum(max(len(polygon.vertices) - 2, 0) for polygon in obj.data.polygons)
        vertices = len(obj.data.vertices)
        requires_32 = vertices > 65535
        index_bytes = 4 if requires_32 else 2
        # position + normal + UV + eight scalar zone attributes + index data
        object_bytes = vertices * (12 + 12 + 8 + 8 * 4) + triangles * 3 * index_bytes
        total_vertices += vertices
        total_triangles += triangles
        total_boundary += topology["boundaryEdgeCount"]
        estimated_bytes += object_bytes
        records.append({
            "name": obj.name,
            "vertices": vertices,
            "triangles": triangles,
            "boundaryEdges": topology["boundaryEdgeCount"],
            "requires32BitIndices": requires_32,
            "estimatedGeometryBytes": object_bytes,
        })
    xs = grid["xs"]
    ys = grid["ys"]
    near_rows = sum(1 for value in ys if value < 220.0)
    mid_rows = sum(1 for value in ys if 220.0 <= value < 650.0)
    far_rows = sum(1 for value in ys if value >= 650.0)
    density = 1.0 / (phase1c2.config.GRID_STEP**2)
    max_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {
        "gridResolution": {"x": len(xs), "y": len(ys), "step": phase1c2.config.GRID_STEP},
        "objects": records,
        "totals": {
            "meshObjectCount": len(records),
            "vertices": total_vertices,
            "triangles": total_triangles,
            "boundaryEdges": total_boundary,
            "estimatedGeometryBytes": estimated_bytes,
            "estimatedGeometryMiB": estimated_bytes / (1024 * 1024),
            "blenderMaxRssRaw": max_rss,
        },
        "density": {
            "verticesPerSquareWorldUnit": density,
            "nearRows": near_rows,
            "midRows": mid_rows,
            "farRows": far_rows,
            "riverAndMeadow": "same 6-unit grid density as mountain and far terrain",
            "farWaste": "far field retains authoring density and should be reduced for runtime LOD",
        },
    }


def deterministic_signature(candidate_key, objects, budget, cameras):
    stable_budget = json.loads(json.dumps(budget))
    stable_budget["totals"].pop("blenderMaxRssRaw", None)
    payload = {
        "candidate": candidate_key,
        "objects": [phase1c2.topology_record(obj) for obj in objects if obj.type == "MESH"],
        "budget": stable_budget,
        "cameras": [
            {
                "name": camera.name,
                "matrix": [round(value, 8) for row in camera.matrix_world for value in row],
                "lens": camera.data.lens,
                "orthoScale": camera.data.ortho_scale,
            }
            for camera in sorted(cameras, key=lambda item: item.name)
        ],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def main():
    args = parse_args()
    candidate_key = args.candidate
    candidate = art_config.CANDIDATES[candidate_key]
    output = args.output.resolve()
    render_dir = args.render_dir.resolve()
    validation_output = args.validation_output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    render_dir.mkdir(parents=True, exist_ok=True)
    validation_output.parent.mkdir(parents=True, exist_ok=True)

    source_hash_before = sha256_file(SOURCE_BLEND)
    if source_hash_before != EXPECTED_SOURCE_SHA256:
        raise RuntimeError(f"Unexpected v003 source hash: {source_hash_before}")
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
    locked_before = phase1c.reference_signature()
    environment = bpy.data.collections["V3_ENVIRONMENT_WORK"]
    phase1c2.clear_collection(environment)
    environment["journey_phase"] = "1C.3"
    environment["visual_version"] = "v004-candidate"
    environment["candidate"] = candidate_key
    environment["selected_candidate"] = "NONE_HUMAN_REVIEW_REQUIRED"

    terrain_collection = phase1c2.new_collection(f"V3_ART_DIRECTION_CANDIDATE_{candidate_key}", environment)
    connector_collection = phase1c2.new_collection("V3_CAVE_EXIT_CONNECTORS", environment)
    guide_collection = phase1c2.new_collection(f"V3_{candidate_key}_REVIEW_GUIDES", environment)
    camera_collection = phase1c2.new_collection("V3_CAMERA_FULL_STORY", environment)
    review_camera_collection = phase1c2.new_collection(f"V3_{candidate_key}_REVIEW_CAMERAS", environment)
    for collection, enabled in (
        (terrain_collection, True),
        (connector_collection, True),
        (guide_collection, False),
        (camera_collection, False),
        (review_camera_collection, False),
    ):
        collection["export_enabled"] = enabled

    terrain_components = make_terrain_function(candidate)
    configure_phase1c2(candidate, terrain_components)
    materials = phase1c2.build_materials()
    terrain_objects, grid = phase1c2.create_terrain(terrain_collection, materials)
    connector_objects, exit_points = phase1c2.create_connectors(connector_collection, materials)
    connector_objects.append(phase1c2.create_cave_fade_replacement(connector_collection, materials))
    phase1c2.create_lighting(guide_collection)
    full_story_cameras = phase1c2.import_full_story_cameras(camera_collection)
    phase1c2.setup_scene()

    baseline_cameras = [obj for obj in bpy.data.collections["V3_CAMERA_BASELINES"].objects if obj.type == "CAMERA"]
    all_cameras = baseline_cameras + full_story_cameras
    camera_lookup = {camera.name: camera for camera in all_cameras}
    required = {
        "CAM_V3_CAVE_EXIT_1440x900",
        "CAM_V3_DAY_CLEAR_START_1440x900",
        *{f"CAM_V3_STORY_{preview.upper().replace('-', '_')}_1440x900" for preview in phase1c2.config.FULL_STORY_PREVIEWS},
    }
    missing = sorted(required - set(camera_lookup))
    if missing:
        raise RuntimeError(f"Missing fixed browser cameras: {missing}")

    terrain = bpy.data.objects["V3_VALLEY_TERRAIN"]
    review_cameras, terrain_bounds = create_review_cameras(review_camera_collection, terrain)
    guides = build_guides(candidate_key, candidate, guide_collection, camera_lookup, terrain_components)
    v004_objects = terrain_objects + connector_objects
    refs = phase1c2.reference_objects()
    rendered = []
    if not args.skip_renders:
        rendered = render_candidate(
            candidate_key,
            render_dir,
            v004_objects,
            refs,
            materials,
            camera_lookup,
            review_cameras,
            guides,
            quick=args.quick_renders,
        )

    core_cave = [bpy.data.objects[name] for name in sorted(phase1c2.CORE_CAVE_NAMES)]
    intersections = phase1c2.geometry_intersections(
        core_cave,
        [obj for obj in v004_objects if obj.name != "V3_CAVE_FADE_REPLACEMENT_FLOOR"],
    )
    connector = bpy.data.objects["V3_CAVE_EXIT_FLOOR_CONNECTOR"]
    connector_points = [connector.matrix_world @ vertex.co for vertex in connector.data.vertices]
    seam_distances = [min((point - candidate_point).length for candidate_point in connector_points) for point in exit_points]
    budget = geometry_budget(v004_objects, grid)
    screen_metrics = {
        "dayClear": projected_metrics(camera_lookup["CAM_V3_DAY_CLEAR_START_1440x900"], terrain),
        "finalWide": projected_metrics(camera_lookup["CAM_V3_STORY_FINAL_WIDE_1440x900"], terrain),
    }
    locked_after = phase1c.reference_signature()
    source_hash_after = sha256_file(SOURCE_BLEND)
    if locked_before["sha256"] != locked_after["sha256"]:
        raise RuntimeError("Locked spatial reference changed")
    if source_hash_before != source_hash_after:
        raise RuntimeError("v003 source Blend changed")

    signature = deterministic_signature(candidate_key, v004_objects, budget, all_cameras + list(review_cameras.values()))
    validation = {
        "schemaVersion": 1,
        "phase": "Journey V3 Phase 1C.3",
        "candidate": candidate_key,
        "candidateLabel": candidate["label"],
        "selected": False,
        "sourceV003Blend": str(SOURCE_BLEND),
        "sourceV003Sha256Before": source_hash_before,
        "sourceV003Sha256After": source_hash_after,
        "sourceV003Unchanged": source_hash_before == source_hash_after,
        "outputBlend": str(output),
        "lockedReferenceSignatureBefore": locked_before["sha256"],
        "lockedReferenceSignatureAfter": locked_after["sha256"],
        "lockedReferenceUnchanged": locked_before["sha256"] == locked_after["sha256"],
        "terrainBounds": terrain_bounds,
        "geometryBudget": budget,
        "screenMetrics": screen_metrics,
        "caveConnector": {
            "seamDistanceMin": min(seam_distances),
            "seamDistanceMax": max(seam_distances),
            "coreCaveIntersections": intersections,
        },
        "ridgeGuides": [ridge["name"] for group in ("left_ridges", "right_ridges", "distant_ridges") for ridge in candidate[group]],
        "riverStations": candidate["river"],
        "reviewCameras": sorted(review_cameras),
        "fullStoryCameras": sorted(camera.name for camera in full_story_cameras),
        "renderedFiles": rendered,
        "deterministicSignature": signature,
    }
    with open(validation_output, "w", encoding="utf-8") as handle:
        json.dump(validation, handle, indent=2)
        handle.write("\n")

    for obj in refs:
        obj.hide_render = True
    for obj in v004_objects:
        obj.hide_render = False
    for guide in guides:
        guide.hide_render = True
    bpy.context.scene.camera = camera_lookup["CAM_V3_DAY_CLEAR_START_1440x900"]
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    print(json.dumps({
        "candidate": candidate_key,
        "output": str(output),
        "validation": str(validation_output),
        "sourceV003Unchanged": source_hash_before == source_hash_after,
        "lockedReferenceUnchanged": locked_before["sha256"] == locked_after["sha256"],
        "caveSeamMaxDistance": max(seam_distances),
        "coreCaveIntersections": intersections,
        "geometryBudget": budget["totals"],
        "deterministicSignature": signature,
        "renderCount": len(rendered),
    }, indent=2))


if __name__ == "__main__":
    main()
