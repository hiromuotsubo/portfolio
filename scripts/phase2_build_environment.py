import math
import random
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "public/journey/models/journey-v15-web.glb"
WORK_DIR = PROJECT_ROOT / "work/blender/phase2"
BLEND_OUTPUT = WORK_DIR / "journey-phase2-environment.blend"
GLB_OUTPUT = PROJECT_ROOT / "public/journey/models/journey-phase2-environment.glb"
SEED = 240809


def material(name, color, roughness=0.9, metallic=0.0):
    result = bpy.data.materials.new(name)
    result.diffuse_color = (*color, 1.0)
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    return result


def mesh_object(name, vertices, faces, assigned_material):
    mesh = bpy.data.meshes.new(name + "_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(assigned_material)
    return obj


def ray_height(bvh, x, y, fallback=0.0):
    hit = bvh.ray_cast(Vector((x, y, 245.0)), Vector((0.0, 0.0, -1.0)), 310.0)
    if hit[0] is None:
        return fallback, Vector((0.0, 0.0, 1.0))
    return hit[0].z, hit[1]


def add_canopy_crown(vertices, faces, x, y, z, radius, height, rotation=0.0):
    start = len(vertices)
    sides = 6
    ring_data = ((0.12, 0.66), (0.46, 1.0), (0.78, 0.62))
    for height_factor, radius_factor in ring_data:
        for index in range(sides):
            angle = rotation + math.tau * index / sides
            lobe = 0.88 + 0.14 * math.sin(index * 2.17 + rotation * 3.0)
            vertices.append(
                (
                    x + math.cos(angle) * radius * radius_factor * lobe,
                    y + math.sin(angle) * radius * radius_factor * lobe,
                    z + height * height_factor,
                )
            )
    vertices.append((x + radius * 0.08, y - radius * 0.06, z + height * 0.94))
    vertices.append((x, y, z + height * 0.03))
    top = start + sides * 3
    base = top + 1
    for ring in range(2):
        ring_start = start + ring * sides
        next_ring = ring_start + sides
        for index in range(sides):
            nxt = (index + 1) % sides
            faces.extend(
                (
                    (ring_start + index, ring_start + nxt, next_ring + nxt),
                    (ring_start + index, next_ring + nxt, next_ring + index),
                )
            )
    upper = start + sides * 2
    for index in range(sides):
        nxt = (index + 1) % sides
        faces.append((upper + index, upper + nxt, top))
        faces.append((base, start + nxt, start + index))


def build_forest_shell(massif):
    source_mesh = massif.data
    selected_faces = []
    used_indices = set()
    for polygon in source_mesh.polygons:
        coordinates = [source_mesh.vertices[index].co for index in polygon.vertices]
        center_y = sum(value.y for value in coordinates) / len(coordinates)
        center_z = sum(value.z for value in coordinates) / len(coordinates)
        if center_y < 28.0 or center_y > 252.0 or center_z < 0.4 or center_z > 61.0:
            continue
        if polygon.normal.z < 0.2:
            continue
        selected_faces.append(tuple(polygon.vertices))
        used_indices.update(polygon.vertices)

    index_map = {source_index: new_index for new_index, source_index in enumerate(sorted(used_indices))}
    vertices = []
    for source_index in sorted(used_indices):
        source_vertex = source_mesh.vertices[source_index]
        coordinate = source_vertex.co.copy()
        broad = math.sin(coordinate.x * 0.091 + coordinate.y * 0.063)
        cluster = math.sin(coordinate.x * 0.37 - coordinate.y * 0.29)
        crown = abs(math.sin(coordinate.x * 0.91 + coordinate.y * 0.77))
        displacement = 0.10 + broad * 0.07 + cluster * 0.05 + crown * 0.08
        displaced = coordinate + source_vertex.normal * displacement
        vertices.append(tuple(displaced))
    faces = [tuple(index_map[index] for index in face) for face in selected_faces]
    obj = mesh_object("P2_FOREST_MID_CANOPY", vertices, faces, FOREST_MATERIAL)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new(name="P2_FOREST_DECIMATE", type="DECIMATE")
    modifier.ratio = 0.68
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    obj.select_set(False)
    return obj


def build_forest_edge(name, side, massif_bvh, depth_offset=0.0):
    rng = random.Random(SEED + 90 + int(side * 13) + round(depth_offset * 10))
    vertices = []
    faces = []
    samples = 74
    for index in range(samples):
        y = 38.0 + index * 2.65 + depth_offset
        center = math.sin(y * 0.052) * 7.0
        width = max(7.5, 21.0 - y * 0.068)
        x = center + side * (width + 2.4 + math.sin(y * 0.17) * 1.15)
        z, normal = ray_height(massif_bvh, x, y, 0.0)
        height = rng.uniform(0.72, 1.35) * max(0.52, 1.15 - y / 360.0)
        base = len(vertices)
        outward = side * (0.42 + 0.18 * math.sin(y * 0.31))
        vertices.extend(
            (
                (x - outward, y, z + 0.05),
                (x + outward, y, z + height * 0.58),
                (x, y, z + height),
            )
        )
        if index:
            previous = base - 3
            faces.extend(
                (
                    (previous, base, previous + 1),
                    (previous + 1, base, base + 1),
                    (previous + 1, base + 1, previous + 2),
                    (previous + 2, base + 1, base + 2),
                )
            )
    obj = mesh_object(name, vertices, faces, FOREST_DARK_MATERIAL)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def ridge_height(x, y, layer):
    phase = x * (0.014 + layer * 0.0017) + layer * 1.3
    broad = 27.0 + 24.0 * (0.5 + 0.5 * math.sin(phase))
    peaks = 22.0 * abs(math.sin(x * 0.031 + layer * 0.9)) ** 1.65
    erosion = 7.0 * math.sin(x * 0.087 + y * 0.031) + 4.0 * math.sin(x * 0.151 - y * 0.023)
    valley_opening = 30.0 * math.exp(-((x + 5.0 - layer * 12.0) / 55.0) ** 2)
    return 74.0 + layer * 15.0 + broad + peaks + erosion - valley_opening


def build_ridge(name, layer, y_front, y_back, width, assigned_material):
    columns = 76
    rows = 8
    vertices = []
    faces = []
    for row in range(rows):
        v = row / (rows - 1)
        y = y_front + (y_back - y_front) * v
        for column in range(columns):
            u = column / (columns - 1)
            x = -width * 0.5 + width * u
            crest = ridge_height(x, y, layer)
            z = crest - (1.0 - v) * (46.0 + 8.0 * math.sin(x * 0.025 + layer))
            z += math.sin(u * math.pi) * math.sin(v * math.pi) * 8.0
            vertices.append((x, y, max(21.0, z)))
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            b = a + 1
            c = a + columns
            d = c + 1
            faces.extend(((a, b, d), (a, d, c)))
    return mesh_object(name, vertices, faces, assigned_material)


def river_width(y):
    return max(3.8, 30.0 - y * 0.12)


def river_center(y):
    return math.sin(y * 0.052) * 7.0 + math.sin(y * 0.017) * 2.4


def build_shore(name, side, water_bvh, assigned_material, width_scale, z_offset):
    rng = random.Random(SEED + (1 if side < 0 else 2) + round(width_scale * 100))
    rows = 64
    vertices = []
    faces = []
    for index in range(rows):
        t = index / (rows - 1)
        y = 13.0 + t * 188.0
        center = river_center(y)
        edge = center + side * river_width(y)
        wobble = math.sin(y * 0.19 + side) * 0.85 + math.sin(y * 0.071) * 0.72
        inner_x = edge - side * (0.45 + 0.35 * math.sin(y * 0.13))
        outer_width = width_scale * (1.8 + 1.35 * rng.random()) * max(0.48, 1.12 - y / 350.0)
        outer_x = edge + side * outer_width + wobble
        inner_z, _ = ray_height(water_bvh, inner_x, y, 0.1)
        outer_z, _ = ray_height(water_bvh, edge, y, inner_z)
        vertices.extend(((inner_x, y, inner_z + z_offset), (outer_x, y, outer_z + z_offset + 0.04)))
    for index in range(rows - 1):
        y = 13.0 + index / (rows - 1) * 188.0
        patch_signal = math.sin(y * 0.18 + side * 0.8) + math.sin(y * 0.057 - side)
        if patch_signal < -0.16:
            continue
        a = index * 2
        faces.extend(((a, a + 1, a + 3), (a, a + 3, a + 2)))
    return mesh_object(name, vertices, faces, assigned_material)


def add_stone(vertices, faces, x, y, z, radius, seed):
    start = len(vertices)
    rng = random.Random(seed)
    vertices.extend(
        [
            (x - radius, y, z),
            (x + radius, y, z),
            (x, y - radius * 0.72, z),
            (x, y + radius * 0.72, z),
            (x, y, z + radius * rng.uniform(0.52, 0.9)),
        ]
    )
    faces.extend(
        [
            (start, start + 2, start + 4),
            (start + 2, start + 1, start + 4),
            (start + 1, start + 3, start + 4),
            (start + 3, start, start + 4),
            (start, start + 3, start + 2),
            (start + 2, start + 3, start + 1),
        ]
    )


def build_stone_clusters(water_bvh):
    rng = random.Random(SEED + 320)
    vertices = []
    faces = []
    for index in range(540):
        y = rng.uniform(18.0, 172.0)
        side = -1.0 if rng.random() < 0.5 else 1.0
        x = river_center(y) + side * (river_width(y) + rng.uniform(-1.2, 5.4))
        z, _ = ray_height(water_bvh, x - side * 0.6, y, 0.15)
        radius = rng.uniform(0.08, 0.34) * max(0.58, 1.08 - y / 330.0)
        add_stone(vertices, faces, x, y, z + 0.08, radius, SEED + index)
    obj = mesh_object("P2_SHORE_STONE_CLUSTERS", vertices, faces, STONE_MATERIAL)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def build_cloud_cluster(name, x, y, z, width, height):
    vertices = []
    faces = []
    # Three shallow, parallel cards form a soft world-space slab. Angled cards
    # revealed their edges in the browser; depth offsets preserve parallax
    # without reading as crossed geometry.
    planes = [(-9.0, 0.82, -0.06), (0.0, 1.0, 0.0), (11.0, 0.76, 0.08)]
    for plane_index, (depth, scale, horizontal_shift) in enumerate(planes):
        start = len(vertices)
        half_width = width * scale * 0.5
        half_height = height * (0.82 + plane_index * 0.08) * 0.5
        z_shift = (plane_index - 1) * height * 0.08
        center_x = x + width * horizontal_shift
        vertices.extend(
            [
                (center_x - half_width, y + depth, z - half_height + z_shift),
                (center_x + half_width, y + depth, z - half_height + z_shift),
                (center_x + half_width, y + depth, z + half_height + z_shift),
                (center_x - half_width, y + depth, z + half_height + z_shift),
            ]
        )
        faces.extend(((start, start + 1, start + 2), (start, start + 2, start + 3)))
    obj = mesh_object(name, vertices, faces, CLOUD_MATERIAL)
    uv_layer = obj.data.uv_layers.new(name="UVMap")
    card_uv = ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0))
    for polygon in obj.data.polygons:
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = card_uv[obj.data.loops[loop_index].vertex_index % 4]
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE), import_pack_images=False)
massif = bpy.data.objects.get("TER_V13_FICTIONAL_NAGANO_MASSIF")
water = bpy.data.objects.get("RIV_V13_EMERALD_S_WATER.001")
depsgraph = bpy.context.evaluated_depsgraph_get()
massif_bvh = BVHTree.FromObject(massif, depsgraph)
water_bvh = BVHTree.FromObject(water, depsgraph)

FOREST_MATERIAL = material("P2_MAT_FOREST_CANOPY", (0.075, 0.245, 0.085), 0.98)
FOREST_DARK_MATERIAL = material("P2_MAT_FOREST_EDGE", (0.04, 0.15, 0.065), 1.0)
RIDGE_MID_MATERIAL = material("P2_MAT_RIDGE_MID", (0.28, 0.43, 0.4), 0.98)
RIDGE_FAR_MATERIAL = material("P2_MAT_RIDGE_FAR", (0.42, 0.52, 0.52), 0.98)
SHORE_WET_MATERIAL = material("P2_MAT_SHORE_WET", (0.18, 0.22, 0.2), 0.96)
SHORE_DRY_MATERIAL = material("P2_MAT_SHORE_DRY", (0.38, 0.38, 0.33), 1.0)
STONE_MATERIAL = material("P2_MAT_SHORE_STONE", (0.32, 0.34, 0.31), 0.97)
CLOUD_MATERIAL = material("P2_MAT_CLOUD_VOLUME_CARD", (0.86, 0.88, 0.84), 0.9)

created = [
    build_forest_shell(massif),
    build_ridge("P2_RIDGE_MID", 1, 392.0, 448.0, 470.0, RIDGE_MID_MATERIAL),
    build_ridge("P2_RIDGE_FAR", 2, 468.0, 548.0, 560.0, RIDGE_FAR_MATERIAL),
    build_shore("P2_SHORE_WET_LEFT", -1.0, water_bvh, SHORE_WET_MATERIAL, 0.32, 0.045),
    build_shore("P2_SHORE_WET_RIGHT", 1.0, water_bvh, SHORE_WET_MATERIAL, 0.32, 0.045),
    build_cloud_cluster("P2_CLOUD_FAR", -18.0, 438.0, 205.0, 258.0, 88.0),
]

for obj in list(bpy.context.scene.objects):
    if obj not in created:
        bpy.data.objects.remove(obj, do_unlink=True)

for obj in created:
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

WORK_DIR.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUTPUT))
bpy.ops.export_scene.gltf(
    filepath=str(GLB_OUTPUT),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_materials="EXPORT",
    export_yup=True,
)

triangles = sum(len(obj.data.polygons) for obj in created if obj.type == "MESH")
vertices = sum(len(obj.data.vertices) for obj in created if obj.type == "MESH")
print(f"PHASE2_ENVIRONMENT={GLB_OUTPUT}")
print(f"PHASE2_BLEND={BLEND_OUTPUT}")
print(f"PHASE2_OBJECTS={len(created)}")
print(f"PHASE2_VERTICES={vertices}")
print(f"PHASE2_TRIANGLES={triangles}")
