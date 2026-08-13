import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_BLEND = Path(os.environ.get(
    "JOURNEY_CAVE_SOURCE_BLEND",
    "/Users/tsubo/Documents/Codex/2026-07-24/https-www-blender-org-lab-mcp/outputs/journey-master-model-v13.blend",
))
OUTPUT_ROOT = PROJECT_ROOT / "work" / "blender" / "journey-v1-cave-macro-v003"
OUTPUT_BLEND = OUTPUT_ROOT / "journey-cave-macro-v003.blend"
OUTPUT_GLB = OUTPUT_ROOT / "journey-cave-macro-v003.glb"
REPORT = OUTPUT_ROOT / "journey-cave-macro-v003-report.json"

SHELL_NAME = "CAVE_MACRO_SHELL_V003"
FLOOR_NAME = "CAVE_MACRO_FLOOR_V003"
PUDDLE_NAME = "CAVE_MACRO_PUDDLE_V003"


def make_material(name, base_color, roughness, metallic=0.0):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = (*base_color, 1.0)
    material.use_nodes = True
    bsdf = next(
        (node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"),
        None,
    )
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*base_color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return material


def remove_previous_cave_objects():
    removed = []
    for obj in list(bpy.data.objects):
        identity = f"{obj.name} {getattr(obj.data, 'name', '')}".upper()
        if "CAVE" not in identity:
            continue
        removed.append(obj.name)
        bpy.data.objects.remove(obj, do_unlink=True)
    return removed


def link_mesh(name, vertices, faces, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.validate(verbose=False)
    mesh.update(calc_edges=True)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material)
    obj["journey_v1_cave_candidate"] = "macro-v003"
    return obj


def build_shell(material):
    # Blender's +Y points toward the portal. The WebGL export maps this to -Z,
    # matching Journey's fixed intro camera. The rings define one continuous
    # rock space rather than a tunnel assembled from separate boulders.
    stations = [
        (-32.0, -0.18, 4.82, 4.58, 6.75),
        (-30.0, -0.24, 4.96, 4.72, 6.62),
        (-27.5, -0.30, 5.08, 4.82, 6.48),
        (-25.0, -0.34, 5.18, 4.90, 6.88),
        (-22.5, -0.29, 5.26, 4.98, 7.18),
        (-20.0, -0.20, 5.18, 4.92, 6.74),
        (-17.5, -0.08, 5.06, 4.78, 6.46),
        (-15.0, 0.03, 4.94, 4.66, 6.82),
        (-12.5, 0.10, 4.82, 4.54, 7.42),
        (-10.0, 0.12, 4.70, 4.42, 7.16),
        (-7.5, 0.08, 4.46, 4.18, 7.28),
        (-5.0, 0.02, 4.12, 3.86, 6.82),
        (-3.0, -0.04, 3.72, 3.50, 6.18),
        (-1.2, -0.05, 3.38, 3.18, 5.58),
        (0.4, -0.02, 3.14, 2.98, 5.22),
        (0.8, 0.00, 3.06, 2.92, 5.12),
        (1.2, 0.02, 3.00, 2.88, 5.02),
    ]
    # Densify only the camera-visible corridor. Roughly 1.25k quads are enough
    # for meso-scale fractured planes without turning polygon count into the
    # source of realism.
    dense_stations = []
    for station_index in range(len(stations) - 1):
        current = stations[station_index]
        following = stations[station_index + 1]
        dense_stations.append(current)
        dense_stations.append(tuple(
            current[value_index] + (following[value_index] - current[value_index]) * 0.5
            for value_index in range(len(current))
        ))
    dense_stations.append(stations[-1])
    stations = dense_stations
    arch_segments = 48
    vertices = []
    faces = []

    for station_index, (y, center_x, left_width, right_width, height) in enumerate(stations):
        station_t = station_index / (len(stations) - 1)
        floor_z = -0.34 + math.sin(y * 0.17) * 0.035
        for segment in range(arch_segments + 1):
            u = segment / arch_segments
            theta = math.pi * (1.0 - u)
            side_width = left_width if math.cos(theta) < 0 else right_width
            wall_profile = abs(math.cos(theta)) ** 0.82
            ceiling_profile = max(0.0, math.sin(theta)) ** 0.72

            # Macro asymmetry: a massive left wall, a recessed right chamber,
            # and a low shelf that lifts into the exit overhang.
            left_mass = -0.52 * math.exp(-((y + 19.0) / 5.6) ** 2) * max(0.0, -math.cos(theta))
            right_recess = 0.48 * math.exp(-((y + 10.5) / 4.7) ** 2) * max(0.0, math.cos(theta))
            overhang = 0.46 * math.exp(-((y + 2.4) / 3.2) ** 2) * math.exp(-((u - 0.37) / 0.22) ** 2)
            high_void = 0.55 * math.exp(-((y + 13.0) / 5.0) ** 2) * math.exp(-((u - 0.63) / 0.28) ** 2)

            # Meso geological shelves are broad enough to read as erosion,
            # never as high-frequency displacement pasted onto a smooth tube.
            strata = (
                math.sin(y * 0.46 + u * 5.1) * 0.30
                + math.sin(y * 0.19 - u * 9.4 + 1.7) * 0.17
            )
            broad_erosion = (
                math.sin(y * 0.13 + u * 7.2 + 0.4) * 0.24
                + math.sin(y * 0.31 - u * 3.8) * 0.14
            )
            wall_breakup = (strata + broad_erosion) * (0.24 + wall_profile * 0.76)
            x = center_x + math.cos(theta) * (side_width + wall_breakup)
            x += left_mass + right_recess
            # Near-vertical lower walls rise into an eroded asymmetric vault.
            # This avoids the perfect half-cylinder silhouette of a generated
            # tunnel while preserving a clean walkable centerline.
            wall_lift = min(1.0, ceiling_profile * 4.2)
            vertical_base = 1.05 + math.sin(y * 0.24 + u * 4.2) * 0.18
            z = floor_z + vertical_base * wall_lift
            z += ceiling_profile * (height + high_void - vertical_base)
            z += math.sin(u * math.pi * 3.0 + y * 0.23) * 0.22 * ceiling_profile
            z += broad_erosion * 0.38 * ceiling_profile
            z -= overhang

            continuous_fracture = (
                math.sin(u * 7.4 + y * 0.12 + 0.8) * 0.62
                + math.sin(u * 14.1 - y * 0.075 - 0.3) * 0.26
            ) * ceiling_profile
            upper_scar = math.exp(-((u - (0.34 + math.sin(y * 0.08) * 0.08)) / 0.10) ** 2)
            z += continuous_fracture - upper_scar * ceiling_profile * 0.48
            x += math.sin(u * 9.2 + y * 0.17) * wall_profile * 0.34

            # The last metres form an eroded rock portal, not a perfect arch.
            # Large, low-frequency cuts preserve the opening while giving its
            # silhouette the asymmetry and accumulated fracture of real stone.
            portal_influence = max(0.0, min(1.0, (y + 13.0) / 14.2))
            portal_brow = (
                math.sin(u * 5.8 + 0.7) * 0.68
                + math.sin(u * 12.7 - 1.1) * 0.34
            ) * ceiling_profile
            left_notch = math.exp(-((u - 0.28) / 0.12) ** 2) * 0.86
            right_notch = math.exp(-((u - 0.73) / 0.15) ** 2) * 0.62
            z += portal_influence * (portal_brow - left_notch - right_notch)
            x += portal_influence * math.sin(u * 8.6 + 0.4) * 0.38 * wall_profile

            # Preserve an uncluttered, human-height walkable corridor around
            # X=0 while letting the wall bases remain eroded and irregular.
            if segment in (0, arch_segments):
                z = floor_z - 0.06
            vertices.append((x, y, z))

    stride = arch_segments + 1
    for station_index in range(len(stations) - 1):
        for segment in range(arch_segments):
            a = station_index * stride + segment
            b = a + stride
            faces.append((a, b, b + 1, a + 1))

    # Close only the rear ring behind the viewer. The front remains a physical
    # portal so the camera can cross it without any geometry or visibility pop.
    rear_center = len(vertices)
    rear_y = stations[0][0] - 0.12
    vertices.append((stations[0][1], rear_y, 3.15))
    for segment in range(arch_segments):
        faces.append((rear_center, segment + 1, segment))

    obj = link_mesh(SHELL_NAME, vertices, faces, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    bevel = obj.modifiers.new("CAVE_MACRO_EDGE_SOFTEN", "BEVEL")
    bevel.width = 0.055
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(52)
    obj["geometry_role"] = "continuous macro wall / ceiling / portal"
    return obj


def floor_height(x, y):
    broad = math.sin(y * 0.21 + 0.8) * 0.045 + math.sin(y * 0.071 - 1.2) * 0.035
    cross = math.cos(x * 0.72 + y * 0.11) * 0.022
    # Keep the centerline quiet; most relief lives nearer the walls.
    edge_weight = min(1.0, abs(x) / 5.8)
    return -0.39 + broad * 0.55 + cross * edge_weight


def build_floor(material):
    y_stations = [(-32.0 + index * 1.75) for index in range(21)]
    x_columns = [-6.7, -5.35, -3.8, -2.25, 0.0, 2.1, 3.8, 5.25, 6.75]
    vertices = []
    faces = []
    for y in y_stations:
        opening = max(0.0, min(1.0, (y + 3.5) / 6.0))
        for x in x_columns:
            expanded_x = x * (1.0 + opening * 0.18)
            vertices.append((expanded_x, y, floor_height(expanded_x, y)))
    stride = len(x_columns)
    for row in range(len(y_stations) - 1):
        for column in range(stride - 1):
            a = row * stride + column
            b = a + stride
            faces.append((a, a + 1, b + 1, b))
    obj = link_mesh(FLOOR_NAME, vertices, faces, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj["geometry_role"] = "stable eroded walking floor"
    return obj


def build_puddle(material):
    center_x = 1.34
    center_y = -13.2
    points = 28
    vertices = [(center_x, center_y, floor_height(center_x, center_y) + 0.018)]
    faces = []
    for index in range(points):
        angle = math.tau * index / points
        radius = 1.0 + math.sin(index * 1.91) * 0.18 + math.sin(index * 3.13 + 0.7) * 0.08
        x = center_x + math.cos(angle) * 0.92 * radius
        y = center_y + math.sin(angle) * 1.48 * radius
        z = floor_height(x, y) + 0.024
        vertices.append((x, y, z))
    for index in range(points):
        faces.append((0, index + 1, ((index + 1) % points) + 1))
    obj = link_mesh(PUDDLE_NAME, vertices, faces, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj["geometry_role"] = "single shallow irregular puddle"
    return obj


OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
removed_names = remove_previous_cave_objects()

stone = make_material("MAT_JOURNEY_CAVE_MACRO_V003", (0.075, 0.085, 0.082), 0.91)
floor = make_material("MAT_JOURNEY_CAVE_FLOOR_V003", (0.064, 0.069, 0.064), 0.94)
water = make_material("MAT_JOURNEY_CAVE_PUDDLE_V003", (0.022, 0.048, 0.046), 0.26)
if water.node_tree:
    bsdf = next((node for node in water.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Coat Weight"].default_value = 0.32
        bsdf.inputs["Coat Roughness"].default_value = 0.22
        bsdf.inputs["IOR"].default_value = 1.333

created = [build_shell(stone), build_floor(floor), build_puddle(water)]

for obj in bpy.context.scene.objects:
    obj.select_set(False)
for obj in created:
    obj.hide_render = False
    obj.select_set(True)
bpy.context.view_layer.objects.active = created[0]

bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND), copy=True)
bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT_GLB),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
    export_materials="NONE",
    export_yup=True,
)

report = {
    "sourceBlend": str(SOURCE_BLEND),
    "outputBlend": str(OUTPUT_BLEND),
    "outputGlb": str(OUTPUT_GLB),
    "blenderVersion": bpy.app.version_string,
    "removedCaveObjects": removed_names,
    "objects": [
        {
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "polygons": len(obj.data.polygons),
            "dimensions": [round(value, 4) for value in obj.dimensions],
            "bounds": [
                [round(min((obj.matrix_world @ Vector(corner))[axis] for corner in obj.bound_box), 4)
                 for axis in range(3)],
                [round(max((obj.matrix_world @ Vector(corner))[axis] for corner in obj.bound_box), 4)
                 for axis in range(3)],
            ],
            "modifiers": [modifier.name for modifier in obj.modifiers],
        }
        for obj in created
    ],
    "outputBytes": OUTPUT_GLB.stat().st_size,
}
REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
print("JOURNEY_CAVE_MACRO=" + json.dumps(report))
