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
OUTPUT_ROOT = PROJECT_ROOT / "work" / "blender" / "journey-v1-cave-macro-v004"
OUTPUT_BLEND = OUTPUT_ROOT / "journey-cave-macro-v004.blend"
OUTPUT_GLB = OUTPUT_ROOT / "journey-cave-macro-v004.glb"
REPORT = OUTPUT_ROOT / "journey-cave-macro-v004-report.json"

SHELL_NAME = "CAVE_MACRO_SHELL_V004"
FLOOR_NAME = "CAVE_MACRO_FLOOR_V004"
TALUS_NAME = "CAVE_MACRO_FLOOR_TALUS_V004"


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
        # Replace authored cave geometry only. Keep review cameras, targets,
        # lights and state helpers in the saved .blend so the V004 working
        # file remains practical for future look-development.
        if obj.type != "MESH":
            continue
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
    obj["journey_v1_cave_candidate"] = "macro-v004-natural-floor"
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


def clamp(value, low=0.0, high=1.0):
    return max(low, min(high, value))


def smoothstep(low, high, value):
    t = clamp((value - low) / (high - low))
    return t * t * (3.0 - 2.0 * t)


def floor_height(x, y):
    """Continuous rock-floor elevation with a protected walking corridor.

    The camera remains on the authored route. Relief is deliberately broad
    and geological: a shallow meandering drainage channel, eroded lateral
    shelves, low-frequency strata, and restrained fractured plates. The
    center never rises enough to intersect the fixed first-person eye line.
    """
    drainage_center = (
        math.sin(y * 0.105 + 0.7) * 0.34
        + math.sin(y * 0.29 - 1.4) * 0.10
    )
    distance_from_drainage = x - drainage_center
    edge_weight = smoothstep(1.25, 5.8, abs(distance_from_drainage))
    wall_bank = smoothstep(3.15, 6.15, abs(distance_from_drainage))

    # Long waves keep the floor from reading as a mathematically flat plane.
    longitudinal = (
        math.sin(y * 0.155 + 0.55) * 0.072
        + math.sin(y * 0.052 - 1.30) * 0.046
        + math.sin(y * 0.37 + 2.10) * 0.022
    )
    lateral_strata = (
        math.sin(distance_from_drainage * 0.58 + y * 0.082) * 0.052
        + math.sin(distance_from_drainage * 1.13 - y * 0.047 + 0.8) * 0.022
    )

    # Water and foot traffic have worn one shallow, irregular runnel through
    # the center. It supplies depth cues without moving or bobbing the camera.
    runnel = -0.088 * math.exp(-((distance_from_drainage / 0.76) ** 2))
    shoulder = 0.038 * math.exp(-(((abs(distance_from_drainage) - 1.35) / 0.72) ** 2))
    eroded_bank = wall_bank * (
        0.105
        + math.sin(y * 0.31 + distance_from_drainage * 0.22) * 0.045
    )

    # A handful of curving fracture depressions break the long direction of
    # the tunnel. They are shallow enough to remain readable as rock seams,
    # rather than appearing as trenches across the walking route.
    fracture_a = math.sin(y * 0.61 + x * 0.18 + 0.3)
    fracture_b = math.sin(y * 0.34 - x * 0.43 - 1.2)
    seam_a = -0.032 * math.exp(-((fracture_a / 0.16) ** 2))
    seam_b = -0.022 * math.exp(-((fracture_b / 0.13) ** 2)) * (0.35 + edge_weight * 0.65)

    height = (
        -0.395
        + longitudinal
        + lateral_strata * (0.30 + edge_weight * 0.70)
        + runnel
        + shoulder
        + eroded_bank
        + seam_a
        + seam_b
    )

    # Settle gently into the portal plane so the same camera crosses from cave
    # to valley without a lip or visible asset seam.
    portal_settle = smoothstep(-2.8, 1.2, y)
    portal_edge = smoothstep(0.42, 2.85, abs(x))
    portal_erosion = (
        math.sin(x * 0.73 + 0.55) * 0.105
        + math.sin(x * 1.67 - 0.90) * 0.046
    ) * portal_edge
    portal_runnel = -0.035 * math.exp(-(((x - drainage_center) / 0.70) ** 2))
    portal_height = -0.382 + portal_erosion + portal_runnel
    return height * (1.0 - portal_settle) + portal_height * portal_settle


def build_floor(material):
    # V003 used only 28 x 13 vertices and intentionally flattened its
    # centerline. V004 keeps the same macro bounds but provides enough real
    # topology for low rock shelves, drainage and fractured silhouette.
    y_stations = [(-32.0 + index * 0.50) for index in range(68)]
    x_columns = [(-6.8 + index * 0.425) for index in range(33)]
    vertices = []
    faces = []
    for row, y in enumerate(y_stations):
        opening = max(0.0, min(1.0, (y + 3.5) / 6.0))
        for column, x in enumerate(x_columns):
            expanded_x = x * (1.0 + opening * 0.18)
            # The visible far edge of the floor must not draw a ruler-straight
            # line below the opening. Only the last two rows meander in depth;
            # X=0 stays almost unchanged so the fixed camera crosses cleanly.
            boundary_influence = smoothstep(len(y_stations) - 2.6, len(y_stations) - 1.0, row)
            boundary_edge = smoothstep(0.45, 2.75, abs(expanded_x))
            boundary_offset = (
                math.sin(expanded_x * 0.61 + 0.35) * 0.34
                + math.sin(expanded_x * 1.43 - 0.75) * 0.13
            ) * boundary_edge * boundary_influence
            effective_y = y + boundary_offset
            edge_weight = smoothstep(1.30, 5.90, abs(expanded_x))
            plate_row = row // 4
            plate_column = column // 4
            broad_plate = (
                deterministic_noise(plate_row, plate_column, 71) - 0.5
            ) * 0.068
            fine_plate = (
                deterministic_noise(row // 2, column // 2, 97) - 0.5
            ) * 0.022
            # The walking center receives restrained relief; broken shelves
            # become progressively stronger where floor meets cave wall.
            plate_relief = (
                broad_plate * (0.28 + edge_weight * 0.72)
                + fine_plate * (0.22 + edge_weight * 0.78)
            )
            vertices.append((
                expanded_x,
                effective_y,
                floor_height(expanded_x, effective_y) + plate_relief,
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
    obj["geometry_role"] = (
        "stable eroded rock floor / shallow runnel / fractured plates / portal continuity"
    )
    return obj


def build_floor_talus(material):
    """Create embedded, faceted collapse stones along both wall bases.

    Talus stays outside the 1.5 m free-space corridor and is sunk below the
    floor. The stones therefore add natural parallax and contact complexity
    without altering the camera path or turning the passage into an obstacle
    course.
    """
    vertices = []
    faces = []
    rock_count = 54
    for rock_index in range(rock_count):
        side = -1.0 if rock_index % 2 == 0 else 1.0
        longitudinal_jitter = deterministic_noise(rock_index, 0, 109)
        y = -31.2 + (rock_index / (rock_count - 1)) * 31.2
        y += (longitudinal_jitter - 0.5) * 0.72

        corridor = 1.65 + math.sin(y * 0.16 + side) * 0.18
        distance = corridor + 0.40 + deterministic_noise(rock_index, 1, 113) * 3.15
        x = side * distance
        opening = smoothstep(-3.5, 2.5, y)
        x *= 1.0 + opening * 0.15

        width = 0.24 + deterministic_noise(rock_index, 2, 127) * 0.58
        length = 0.34 + deterministic_noise(rock_index, 3, 131) * 0.84
        height = 0.20 + deterministic_noise(rock_index, 4, 137) * 0.54
        if rock_index % 13 == 0:
            width *= 1.30
            length *= 1.22
            height *= 1.25

        rotation = (
            (deterministic_noise(rock_index, 5, 139) - 0.5) * 0.92
            + side * 0.12
        )
        cos_r = math.cos(rotation)
        sin_r = math.sin(rotation)
        base_z = floor_height(x, y) - height * 0.23
        start = len(vertices)

        # A skewed lower/shoulder ring and off-center cap make each stone read
        # as a broken cave plate instead of a repeated primitive.
        lower = [
            (-0.58, -0.50),
            (0.54, -0.46),
            (0.62, 0.48),
            (-0.50, 0.56),
        ]
        shoulder = [
            (-0.42, -0.34),
            (0.38, -0.30),
            (0.44, 0.36),
            (-0.34, 0.40),
        ]
        for local_x, local_y in lower:
            scaled_x = local_x * width
            scaled_y = local_y * length
            vertices.append((
                x + scaled_x * cos_r - scaled_y * sin_r,
                y + scaled_x * sin_r + scaled_y * cos_r,
                base_z,
            ))
        for corner, (local_x, local_y) in enumerate(shoulder):
            skew = (deterministic_noise(rock_index, corner, 149) - 0.5) * 0.08
            scaled_x = (local_x + skew) * width
            scaled_y = (local_y - skew) * length
            vertices.append((
                x + scaled_x * cos_r - scaled_y * sin_r,
                y + scaled_x * sin_r + scaled_y * cos_r,
                base_z + height * (0.56 + corner * 0.035),
            ))
        cap_shift_x = (deterministic_noise(rock_index, 7, 151) - 0.5) * width * 0.32
        cap_shift_y = (deterministic_noise(rock_index, 8, 157) - 0.5) * length * 0.30
        vertices.append((x + cap_shift_x, y + cap_shift_y, base_z + height))

        faces.append((start + 3, start + 2, start + 1, start))
        for corner in range(4):
            next_corner = (corner + 1) % 4
            faces.append((
                start + corner,
                start + next_corner,
                start + 4 + next_corner,
                start + 4 + corner,
            ))
            faces.append((start + 4 + corner, start + 4 + next_corner, start + 8))

    obj = link_mesh(TALUS_NAME, vertices, faces, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj["geometry_role"] = "embedded wall-base talus / collapse plates / corridor depth cues"
    return obj


OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
removed_names = remove_previous_cave_objects()

stone = make_material("MAT_JOURNEY_CAVE_MACRO_V004", (0.042, 0.049, 0.046), 0.91)
floor = make_material("MAT_JOURNEY_CAVE_FLOOR_V004", (0.038, 0.043, 0.039), 0.94)
# Moisture is integrated into the stone/floor shader in JourneyScene. A
# separate water mesh was removed after camera QA because even a subtle plane
# read as a placed prop while the viewer approached it.
created = [build_shell(stone), build_floor(floor), build_floor_talus(floor)]

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
