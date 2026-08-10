import hashlib
import json
import math
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[2]
SOURCE_BLEND = ROOT / "work/blender/journey-v3/phase1c/journey-v3-macro-massing-v002.blend"
OUTPUT_DIR = ROOT / "docs/references/journey-v3/baselines/massing/true-3d-cave"
AUDIT_PATH = OUTPUT_DIR / "true-3d-cave-geometry-audit.json"

PROGRESS_CAMERAS = [
    (11.5, "CAM_V3_SWEEP_P011_50", "11-5"),
    (13.5, "CAM_V3_SWEEP_P013_50", "13-5"),
    (16.0, "CAM_V3_SWEEP_P016_00", "16"),
    (20.0, "CAM_V3_SWEEP_P020_00", "20"),
    (23.5, "CAM_V3_SWEEP_P023_50", "23-5"),
    (25.0, "CAM_V3_SWEEP_P025_00", "25"),
    (28.25, "CAM_V3_SWEEP_P028_25", "28-25"),
    (30.0, "CAM_V3_SWEEP_P030_00", "30"),
]

CAVE_NAMES = [
    "CAVE_HQ_INTERIOR_SHELL",
    "CAVE_HQ_GROUND",
    "CAVE_HQ_FLOOR_WATER",
    "WEB_CAVE_HQ_DEBRIS_00",
    "WEB_CAVE_HQ_DEBRIS_01",
    "WEB_CAVE_HQ_HANGING_PLANTS_00",
    "WEB_CAVE_HQ_MOSS_00",
]

HIDDEN_OLD_ENVIRONMENT = [
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
]


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def material(name, color, roughness=0.9):
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.use_nodes = True
    principled = next(node for node in value.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    return value


def clone_mesh_object(source, collection, review_material, role):
    clone = source.copy()
    clone.data = source.data.copy()
    clone.name = f"TRUE3D_{source.name}"
    clone.data.name = f"TRUE3D_{source.data.name}"
    clone.data.materials.clear()
    clone.data.materials.append(review_material)
    for polygon in clone.data.polygons:
        polygon.material_index = 0
    clone.matrix_world = source.matrix_world.copy()
    clone.hide_render = False
    clone.hide_viewport = False
    clone["journey_role"] = role
    clone["source_object"] = source.name
    clone["source_locked_reference"] = role == "v1-cave-story-reference"
    clone["review_only"] = True
    clone["export_enabled"] = False
    collection.objects.link(clone)
    return clone


def clone_camera(source, collection):
    clone = source.copy()
    clone.data = source.data.copy()
    clone.name = f"TRUE3D_{source.name}"
    clone.data.name = f"TRUE3D_{source.data.name}"
    clone.matrix_world = source.matrix_world.copy()
    clone["source_camera"] = source.name
    clone["manual_adjustment"] = False
    clone["review_only"] = True
    collection.objects.link(clone)
    return clone


def top_camera(collection):
    data = bpy.data.cameras.new("TRUE3D_TOP_CAMERA_DATA")
    data.type = "ORTHO"
    data.ortho_scale = 690.0
    data.clip_start = 0.1
    data.clip_end = 1200.0
    camera = bpy.data.objects.new("TRUE3D_TOP_CAMERA", data)
    camera.location = (0.0, 210.0, 680.0)
    camera.rotation_euler = (0.0, 0.0, 0.0)
    camera["review_only"] = True
    collection.objects.link(camera)
    return camera


def camera_arrow(camera, collection, review_material):
    location = camera.matrix_world.translation
    forward = camera.matrix_world.to_3x3() @ Vector((0.0, 0.0, -1.0))
    planar = Vector((forward.x, forward.y, 0.0))
    if planar.length < 1e-8:
        planar = Vector((0.0, 1.0, 0.0))
    planar.normalize()
    right = Vector((planar.y, -planar.x, 0.0))
    center = Vector((location.x, location.y, 260.0))
    tip = center + planar * 22.0
    back = center - planar * 6.0
    vertices = [tip, back + right * 7.0, back - right * 7.0]
    mesh = bpy.data.meshes.new(f"TRUE3D_ARROW_{camera.name}_MESH")
    mesh.from_pydata(vertices, [], [(0, 1, 2)])
    mesh.materials.append(review_material)
    arrow = bpy.data.objects.new(f"TRUE3D_ARROW_{camera.name}", mesh)
    arrow["source_camera"] = camera.get("source_camera")
    arrow["xy_position_only"] = True
    arrow["review_only"] = True
    collection.objects.link(arrow)
    return arrow


def collection(scene, name):
    value = bpy.data.collections.new(name)
    scene.collection.children.link(value)
    return value


def build_bvh(obj):
    vertices = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    polygons = [tuple(polygon.vertices) for polygon in obj.data.polygons]
    return BVHTree.FromPolygons(vertices, polygons, all_triangles=False)


def overlap_report(cave_objects, environment_objects):
    cave_bvhs = {obj.name: build_bvh(obj) for obj in cave_objects if obj.type == "MESH" and obj.data.polygons}
    environment_bvhs = {obj.name: build_bvh(obj) for obj in environment_objects if obj.type == "MESH" and obj.data.polygons}
    results = []
    for cave_name, cave_bvh in cave_bvhs.items():
        for environment_name, environment_bvh in environment_bvhs.items():
            overlaps = cave_bvh.overlap(environment_bvh)
            if overlaps:
                results.append({
                    "caveObject": cave_name,
                    "environmentObject": environment_name,
                    "trianglePairCount": len(overlaps),
                })
    return results, environment_bvhs


def percentile(values, amount):
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * amount
    lower = math.floor(position)
    upper = math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def exit_seam_report(cave_ground, environment_bvhs):
    world_vertices = [cave_ground.matrix_world @ vertex.co for vertex in cave_ground.data.vertices]
    max_y = max(vertex.y for vertex in world_vertices)
    exit_vertices = [vertex for vertex in world_vertices if vertex.y >= max_y - 0.65]
    distances = []
    nearest_targets = {}
    for vertex in exit_vertices:
        best_distance = float("inf")
        best_name = None
        for name, tree in environment_bvhs.items():
            nearest = tree.find_nearest(vertex)
            if nearest is not None and nearest[3] < best_distance:
                best_distance = nearest[3]
                best_name = name
        if best_name is not None:
            distances.append(best_distance)
            nearest_targets[best_name] = nearest_targets.get(best_name, 0) + 1
    return {
        "exitVertexCount": len(exit_vertices),
        "exitWorldYRange": [min((v.y for v in exit_vertices), default=None), max_y],
        "nearestSurfaceDistance": {
            "minimum": min(distances, default=None),
            "median": percentile(distances, 0.5),
            "p95": percentile(distances, 0.95),
            "maximum": max(distances, default=None),
        },
        "nearestTargetCounts": nearest_targets,
    }


def camera_projection_report(scene, camera, cave_objects, environment_objects, progress):
    def projected_counts(objects):
        in_frame = 0
        in_front = 0
        total = 0
        for obj in objects:
            stride = max(1, len(obj.data.vertices) // 1800)
            for index in range(0, len(obj.data.vertices), stride):
                total += 1
                point = world_to_camera_view(scene, camera, obj.matrix_world @ obj.data.vertices[index].co)
                if point.z > 0:
                    in_front += 1
                    if 0 <= point.x <= 1 and 0 <= point.y <= 1:
                        in_frame += 1
        return {"sampleCount": total, "inFrontCount": in_front, "inFrameVertexCount": in_frame}

    return {
        "progress": progress,
        "camera": camera.name,
        "sourceCamera": camera.get("source_camera"),
        "matrixWorld": [value for row in camera.matrix_world for value in row],
        "fovDegrees": math.degrees(camera.data.angle_y),
        "caveProjection": projected_counts(cave_objects),
        "v002Projection": projected_counts(environment_objects),
    }


def set_scene(scene):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.world = bpy.data.worlds.new("TRUE3D_CAVE_WORLD")
    scene.world.use_nodes = True
    background = next(node for node in scene.world.node_tree.nodes if node.type == "BACKGROUND")
    background.inputs["Color"].default_value = (0.16, 0.31, 0.38, 1.0)
    background.inputs["Strength"].default_value = 0.42


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source_hash_before = sha256(SOURCE_BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))

    source_cave = [bpy.data.objects[name] for name in CAVE_NAMES]
    source_selected_collection = bpy.data.collections["V3_MACRO_V002_SELECTED"]
    source_environment = [obj for obj in source_selected_collection.objects if obj.type == "MESH"]
    missing_hidden = [name for name in HIDDEN_OLD_ENVIRONMENT if bpy.data.objects.get(name) is None]

    scene = bpy.data.scenes.new("V3_TRUE_3D_CAVE_REVIEW")
    set_scene(scene)
    cave_collection = collection(scene, "TRUE3D_V1_CAVE_STORY")
    environment_collection = collection(scene, "TRUE3D_V002_SELECTED")
    camera_collection = collection(scene, "TRUE3D_VALIDATED_CAMERAS")
    light_collection = collection(scene, "TRUE3D_REVIEW_LIGHTS")

    cave_material = material("TRUE3D_MAT_CAVE", (0.055, 0.085, 0.09, 1.0), 0.96)
    cave_ground_material = material("TRUE3D_MAT_CAVE_GROUND", (0.11, 0.13, 0.125, 1.0), 0.94)
    environment_material = material("TRUE3D_MAT_V002", (0.46, 0.49, 0.45, 1.0), 0.90)
    meadow_material = material("TRUE3D_MAT_MEADOW", (0.37, 0.43, 0.35, 1.0), 0.94)
    river_material = material("TRUE3D_MAT_RIVERBED", (0.10, 0.29, 0.36, 1.0), 0.82)
    bank_material = material("TRUE3D_MAT_BANK", (0.31, 0.30, 0.27, 1.0), 0.94)
    silhouette_material = material("TRUE3D_MAT_SILHOUETTE", (0.004, 0.006, 0.008, 1.0), 1.0)
    arrow_material = material("TRUE3D_MAT_CAMERA_ARROW", (1.0, 0.20, 0.035, 1.0), 0.55)

    cave_clones = []
    for source in source_cave:
        chosen = cave_ground_material if source.name in {"CAVE_HQ_GROUND", "CAVE_HQ_FLOOR_WATER"} else cave_material
        cave_clones.append(clone_mesh_object(source, cave_collection, chosen, "v1-cave-story-reference"))

    environment_clones = []
    for source in source_environment:
        role = source.get("journey_role", "")
        chosen = environment_material
        if role in {"continuous-meadow-terrain", "continuous-valley-floor"}:
            chosen = meadow_material
        elif role == "single-riverbed":
            chosen = river_material
        elif role == "irregular-riverbank":
            chosen = bank_material
        environment_clones.append(clone_mesh_object(source, environment_collection, chosen, "v002-selected-macro"))

    cameras = {}
    for progress, camera_name, _ in PROGRESS_CAMERAS:
        source = bpy.data.objects[camera_name]
        cameras[progress] = clone_camera(source, camera_collection)
    top = top_camera(camera_collection)
    arrows = {progress: camera_arrow(camera, camera_collection, arrow_material) for progress, camera in cameras.items()}
    for arrow in arrows.values():
        arrow.hide_render = True

    sun_data = bpy.data.lights.new("TRUE3D_CAVE_SUN_DATA", "SUN")
    sun_data.energy = 1.65
    sun_data.angle = math.radians(4.0)
    sun = bpy.data.objects.new("TRUE3D_CAVE_SUN", sun_data)
    sun.rotation_euler = (math.radians(48), math.radians(-18), math.radians(-38))
    light_collection.objects.link(sun)

    area_data = bpy.data.lights.new("TRUE3D_CAVE_FILL_DATA", "AREA")
    area_data.energy = 520.0
    area_data.shape = "DISK"
    area_data.size = 12.0
    area = bpy.data.objects.new("TRUE3D_CAVE_FILL", area_data)
    area.location = (0.0, -4.0, 8.0)
    area.rotation_euler = (math.radians(8), 0.0, 0.0)
    light_collection.objects.link(area)

    rendered = []
    camera_reports = []
    original_materials = {obj: list(obj.data.materials) for obj in cave_clones + environment_clones}
    for progress, _, slug in PROGRESS_CAMERAS:
        camera = cameras[progress]
        scene.camera = camera
        camera_reports.append(camera_projection_report(scene, camera, cave_clones, environment_clones, progress))
        clay_path = OUTPUT_DIR / f"true-3d-cave-progress-{slug}.png"
        scene.render.filepath = str(clay_path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        rendered.append(str(clay_path))

        for obj in cave_clones + environment_clones:
            obj.data.materials.clear()
            obj.data.materials.append(silhouette_material)
        silhouette_path = OUTPUT_DIR / f"true-3d-cave-progress-{slug}-silhouette.png"
        scene.render.filepath = str(silhouette_path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        rendered.append(str(silhouette_path))
        for obj, materials in original_materials.items():
            obj.data.materials.clear()
            for value in materials:
                obj.data.materials.append(value)

        for arrow_progress, arrow in arrows.items():
            arrow.hide_render = arrow_progress != progress
        scene.camera = top
        top_path = OUTPUT_DIR / f"true-3d-cave-progress-{slug}-top-down.png"
        scene.render.filepath = str(top_path)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        rendered.append(str(top_path))
        arrows[progress].hide_render = True

    overlaps, environment_bvhs = overlap_report(source_cave, source_environment)
    seam = exit_seam_report(bpy.data.objects["CAVE_HQ_GROUND"], environment_bvhs)

    source_hash_after = sha256(SOURCE_BLEND)
    if source_hash_before != source_hash_after:
        raise RuntimeError("Source v002 Blend changed during read-only review")

    output = {
        "schemaVersion": 1,
        "phase": "Journey V3 Phase 1C.1 True 3D Cave Audit",
        "sourceBlend": str(SOURCE_BLEND),
        "sourceBlendSha256Before": source_hash_before,
        "sourceBlendSha256After": source_hash_after,
        "sourceBlendUnchanged": source_hash_before == source_hash_after,
        "reviewScene": scene.name,
        "worldCoordinatesUnchanged": True,
        "cameraManualAdjustment": False,
        "shownJourneyV1Geometry": CAVE_NAMES,
        "hiddenOldEnvironmentGeometry": HIDDEN_OLD_ENVIRONMENT,
        "hiddenNamesMissingFromBlend": missing_hidden,
        "shownV002Geometry": [obj.name for obj in source_environment],
        "cameraReports": camera_reports,
        "geometryIntersections": overlaps,
        "intersectionPairCount": len(overlaps),
        "caveExitSeam": seam,
        "renderedFiles": rendered,
    }
    AUDIT_PATH.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({
        "sourceBlendUnchanged": output["sourceBlendUnchanged"],
        "intersectionPairCount": output["intersectionPairCount"],
        "seam": seam,
        "renders": len(rendered),
        "audit": str(AUDIT_PATH),
    }, indent=2))


main()
