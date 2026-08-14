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


def deterministic_noise(row, column, salt=0):
    value = math.sin(
        (row + 1) * 12.9898 +
        (column + 1) * 78.233 +
        (salt + 1) * 37.719
    ) * 43758.5453
    return value - math.floor(value)


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
    # Three longitudinal samples per authored station retain the continuous
    # macro shell while giving the broad rock plates enough edges to change
    # direction. The density is still tiny compared with the valley world;
    # topology is used only where the fixed camera can read it.
    dense_stations = []
    for station_index in range(len(stations) - 1):
        current = stations[station_index]
        following = stations[station_index + 1]
        for station_fraction in (0.0, 1.0 / 3.0, 2.0 / 3.0):
            dense_stations.append(tuple(
                current[value_index] +
                (following[value_index] - current[value_index]) * station_fraction
                for value_index in range(len(current))
            ))
    dense_stations.append(stations[-1])
    stations = dense_stations
    arch_segments = 60
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

            # Adjacent geological plates share the shell but not one smooth
            # tangent. A low-frequency block value creates real ridges and
            # recesses instead of a normal-map illusion on a round tunnel.
            plate_row = station_index // 3
            plate_column = segment // 5
            plate_shift = (deterministic_noise(plate_row, plate_column, 3) - 0.5) * 0.58
            plate_tilt = (deterministic_noise(plate_row, plate_column, 17) - 0.5) * 0.34

            # Long erosion shelves interrupt both walls at different heights.
            left_shelf = math.exp(-((u - 0.17) / 0.055) ** 2) * (
                0.18 + 0.20 * max(0.0, math.sin(y * 0.42 + 0.8))
            )
            right_shelf = math.exp(-((u - 0.82) / 0.06) ** 2) * (
                0.16 + 0.24 * max(0.0, math.sin(y * 0.37 - 1.1))
            )
            upper_ledge = math.exp(-((u - 0.42) / 0.075) ** 2) * (
                0.12 + 0.18 * max(0.0, math.sin(y * 0.29 + 2.2))
            )
            wall_breakup += left_shelf + right_shelf + upper_ledge
            x = center_x + math.cos(theta) * (side_width + wall_breakup)
            x += math.cos(theta) * plate_shift * (0.36 + wall_profile * 0.64)
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
            z += plate_shift * ceiling_profile * 0.38 + plate_tilt * wall_profile * 0.16

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
            # Alternating diagonals keep broad surfaces faceted without a
            # repeating procedural direction running through the cave.
            if (station_index + segment) % 2:
                faces.append((a, b, a + 1))
                faces.append((a + 1, b, b + 1))
            else:
                faces.append((a, b, b + 1))
                faces.append((a, b + 1, a + 1))

    def append_wall_ledge(side, y_start, y_end, wall_x, base_z, depth, height, salt):
        """Append one fractured ledge to the same shell mesh.

        These are long erosion shelves attached outside the free-space
        corridor, not separate boulder props. They produce the readable hard
        edges and shadow pockets missing from the sinusoidal macro surface.
        """
        ledge_start = len(vertices)
        samples = 7
        for sample in range(samples):
            sample_t = sample / (samples - 1)
            y = y_start + (y_end - y_start) * sample_t
            irregularity = deterministic_noise(sample, salt, 29) - 0.5
            local_wall = wall_x + irregularity * 0.22
            local_depth = depth * (0.78 + deterministic_noise(sample, salt, 41) * 0.4)
            local_floor = base_z + math.sin(sample_t * math.pi * 2.2 + salt) * 0.09
            local_height = height * (0.82 + deterministic_noise(sample, salt, 53) * 0.35)
            outer_x = side * local_wall
            inner_x = side * (local_wall - local_depth)
            vertices.extend([
                (outer_x, y, local_floor - 0.05),
                (inner_x, y, local_floor),
                (inner_x, y, local_floor + local_height),
                (outer_x, y, local_floor + local_height + irregularity * 0.08),
            ])
        for sample in range(samples - 1):
            current = ledge_start + sample * 4
            following = current + 4
            for edge in range(4):
                next_edge = (edge + 1) % 4
                faces.append((current + edge, following + edge, following + next_edge))
                faces.append((current + edge, following + next_edge, current + next_edge))
        faces.append(tuple(ledge_start + edge for edge in (3, 2, 1, 0)))
        end = ledge_start + (samples - 1) * 4
        faces.append(tuple(end + edge for edge in (0, 1, 2, 3)))

    ledges = [
        (-1, -29.0, -19.0, 4.82, 0.72, 0.64, 0.44, 2),
        (-1, -24.5, -13.0, 4.96, 3.35, 0.48, 0.38, 5),
        (-1, -17.5, -6.0, 4.48, 1.48, 0.72, 0.52, 7),
        (-1, -11.5, -1.0, 4.02, 4.45, 0.42, 0.42, 11),
        (1, -28.0, -17.0, 4.62, 2.52, 0.50, 0.46, 13),
        (1, -20.0, -9.0, 4.48, 0.82, 0.62, 0.48, 17),
        (1, -14.5, -3.0, 4.02, 3.72, 0.50, 0.38, 19),
        (1, -7.5, 0.7, 3.50, 1.72, 0.48, 0.42, 23),
    ]
    for ledge in ledges:
        append_wall_ledge(*ledge)

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
    # No blanket bevel: it was rounding every geological direction change and
    # was the main reason the exported cave read as clay. Lighting may soften
    # the rock, but the authored planes remain physically distinct.
    obj["geometry_role"] = "continuous macro wall / fractured meso ledges / ceiling / portal"
    return obj


def floor_height(x, y):
    broad = math.sin(y * 0.21 + 0.8) * 0.045 + math.sin(y * 0.071 - 1.2) * 0.035
    cross = math.cos(x * 0.72 + y * 0.11) * 0.022
    # Keep the centerline quiet; most relief lives nearer the walls.
    edge_weight = min(1.0, abs(x) / 5.8)
    return -0.39 + broad * 0.55 + cross * edge_weight


def build_floor(material):
    y_stations = [(-32.0 + index * 1.25) for index in range(28)]
    x_columns = [-6.7, -5.75, -4.8, -3.85, -2.9, -1.85, 0.0, 1.75, 2.75, 3.75, 4.75, 5.75, 6.75]
    vertices = []
    faces = []
    for y in y_stations:
        opening = max(0.0, min(1.0, (y + 3.5) / 6.0))
        for column, x in enumerate(x_columns):
            expanded_x = x * (1.0 + opening * 0.18)
            edge_weight = min(1.0, max(0.0, (abs(expanded_x) - 1.45) / 4.8))
            plate = (deterministic_noise(round((y + 32) / 2.5), column // 2, 71) - 0.5) * 0.12
            vertices.append((
                expanded_x,
                y,
                floor_height(expanded_x, y) + plate * edge_weight,
            ))
    stride = len(x_columns)
    for row in range(len(y_stations) - 1):
        for column in range(stride - 1):
            a = row * stride + column
            b = a + stride
            if (row + column) % 2:
                faces.append((a, a + 1, b))
                faces.append((a + 1, b + 1, b))
            else:
                faces.append((a, a + 1, b + 1))
                faces.append((a, b + 1, b))
    obj = link_mesh(FLOOR_NAME, vertices, faces, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj["geometry_role"] = "stable faceted walking floor with edge erosion"
    return obj


OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
removed_names = remove_previous_cave_objects()

stone = make_material("MAT_JOURNEY_CAVE_MACRO_V003", (0.042, 0.049, 0.046), 0.91)
floor = make_material("MAT_JOURNEY_CAVE_FLOOR_V003", (0.038, 0.043, 0.039), 0.94)
# Moisture is integrated into the stone/floor shader in JourneyScene. A
# separate water mesh was removed after camera QA because even a subtle plane
# read as a placed prop while the viewer approached it.
created = [build_shell(stone), build_floor(floor)]

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
