import argparse
import hashlib
import json
import math
import os
import statistics
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PHASE_ROOT = PROJECT_ROOT / "work/blender/journey-v3/phase1b"
DEFAULT_OUTPUT = DEFAULT_PHASE_ROOT / "journey-v3-spatial-reference-v001.blend"
REFERENCE_DIR = DEFAULT_PHASE_ROOT / "reference"
MAIN_GLB = REFERENCE_DIR / "journey-v16-spatial-reference.glb"
PHASE2_GLB = PROJECT_ROOT / "public/journey/models/journey-phase2-environment.glb"
CAMERA_GLB = REFERENCE_DIR / "journey-v3-camera-baselines.glb"
CAMERA_MANIFEST = REFERENCE_DIR / "journey-v3-camera-baselines-manifest.json"
LANDMARK_MANIFEST = REFERENCE_DIR / "journey-v3-landmarks.json"
DEFAULT_VALIDATION = (
    PROJECT_ROOT
    / "docs/references/journey-v3/baselines/blender/camera-projection-validation.json"
)
DEFAULT_RENDER_DIR = (
    PROJECT_ROOT / "docs/references/journey-v3/baselines/blender"
)


def parse_args():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--validation-output", type=Path, default=DEFAULT_VALIDATION)
    parser.add_argument("--render-dir", type=Path, default=DEFAULT_RENDER_DIR)
    parser.add_argument("--skip-renders", action="store_true")
    return parser.parse_args(args)


def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def matrix_from_three(values):
    return Matrix(
        (
            (values[0], values[4], values[8], values[12]),
            (values[1], values[5], values[9], values[13]),
            (values[2], values[6], values[10], values[14]),
            (values[3], values[7], values[11], values[15]),
        )
    )


def matrix_to_column_major(matrix):
    return [matrix[row][column] for column in range(4) for row in range(4)]


def matrix_max_error(left, right):
    return max(abs(left[row][column] - right[row][column]) for row in range(4) for column in range(4))


GLTF_TO_BLENDER = Matrix(
    (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 0.0, -1.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )
)


def import_into_collection(filepath, collection):
    before = set(bpy.data.objects)
    result = bpy.ops.import_scene.gltf(filepath=str(filepath))
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF import failed: {filepath}")
    imported = [obj for obj in bpy.data.objects if obj not in before]
    for obj in imported:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
    return imported


def collection(scene, name):
    value = bpy.data.collections.new(name)
    scene.collection.children.link(value)
    return value


def set_reference_metadata(target_collection, objects, role, source_path):
    source_hash = sha256_file(source_path)
    target_collection["journey_role"] = role
    target_collection["source_path"] = str(source_path)
    target_collection["source_sha256"] = source_hash
    target_collection["export_enabled"] = False
    target_collection["locked_reference"] = True
    target_collection.hide_select = True
    for obj in objects:
        obj["journey_role"] = role
        obj["source_path"] = str(source_path)
        obj["source_sha256"] = source_hash
        obj["export_enabled"] = False
        obj["locked_reference"] = True
        obj.hide_select = True
    return source_hash


def color_reference_objects(objects, phase2=False):
    for obj in objects:
        name = obj.name.upper()
        if "RIV" in name or "WATER" in name:
            obj.color = (0.02, 0.5, 0.64, 1.0)
        elif "CAVE" in name:
            obj.color = (0.06, 0.12, 0.13, 1.0)
        elif "MTN" in name or "MASSIF" in name:
            obj.color = (0.27, 0.4, 0.25, 1.0)
        elif phase2 or "FOREST" in name or "TREE" in name:
            obj.color = (0.08, 0.24, 0.12, 1.0)
        elif "PEBBLE" in name or "ROCK" in name or "BAR" in name:
            obj.color = (0.35, 0.38, 0.34, 1.0)
        else:
            obj.color = (0.18, 0.32, 0.2, 1.0)


def create_line_object(name, points, edges, target_collection, color, render=False):
    mesh = bpy.data.meshes.new(f"{name}_MESH")
    mesh.from_pydata([tuple(point) for point in points], edges, [])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.color = color
    obj.display_type = "WIRE"
    obj.hide_render = not render
    obj["export_enabled"] = False
    obj["journey_role"] = "review-guide"
    target_collection.objects.link(obj)
    return obj


def create_frustums(cameras, target_collection):
    created = []
    sweep_points = []
    for camera in cameras:
        if not camera.name.startswith("CAM_V3_SWEEP_"):
            continue
        sweep_points.append(camera.matrix_world.translation.copy())
        aspect = camera.data.angle_x / camera.data.angle_y if camera.data.angle_y else 1.6
        aspect = camera.data.sensor_width / camera.data.sensor_height if camera.data.sensor_height else aspect
        aspect = camera.get("journey_aspect_ratio", aspect)
        depth = 12.0
        half_height = math.tan(camera.data.angle_y * 0.5) * depth
        half_width = half_height * aspect
        local = [
            Vector((0, 0, 0)),
            Vector((-half_width, -half_height, -depth)),
            Vector((half_width, -half_height, -depth)),
            Vector((half_width, half_height, -depth)),
            Vector((-half_width, half_height, -depth)),
        ]
        world = [camera.matrix_world @ point for point in local]
        edges = [(0, 1), (0, 2), (0, 3), (0, 4), (1, 2), (2, 3), (3, 4), (4, 1)]
        created.append(
            create_line_object(
                f"FRUSTUM_{camera.name}",
                world,
                edges,
                target_collection,
                (0.95, 0.5, 0.04, 1.0),
            )
        )
    if len(sweep_points) > 1:
        created.append(
            create_line_object(
                "PATH_CAVE_EXIT_TO_DAY_CLEAR",
                sweep_points,
                [(index, index + 1) for index in range(len(sweep_points) - 1)],
                target_collection,
                (1.0, 0.08, 0.04, 1.0),
            )
        )
    return created


def bounds_center(objects, tokens):
    points = []
    for obj in objects:
        if not any(token in obj.name.upper() for token in tokens):
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    if not points:
        return Vector((0, 0, 0))
    return sum(points, Vector()) / len(points)


def create_review_guides(main_objects, target_collection, cameras):
    guide_specs = [
        ("GUIDE_CAVE_OPENING", ("CAVE",)),
        ("GUIDE_RIVER_LEADING_LINE", ("RIV", "WATER")),
        ("GUIDE_MOUNTAIN_OCCUPANCY", ("MTN", "MASSIF")),
    ]
    guides = []
    for name, tokens in guide_specs:
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "SPHERE"
        empty.empty_display_size = 1.2
        empty.location = bounds_center(main_objects, tokens)
        empty.hide_render = True
        empty["journey_role"] = "review-guide"
        empty["export_enabled"] = False
        empty["purpose"] = name.removeprefix("GUIDE_").lower().replace("_", " ")
        target_collection.objects.link(empty)
        guides.append(empty)
    for camera in cameras:
        camera.data.show_safe_areas = True
        camera.data.show_composition_center = True
        camera.data.show_composition_thirds = True
        camera.data.passepartout_alpha = 0.75
    return guides


def build_kdtrees(main_objects):
    trees = {}
    for obj in main_objects:
        if obj.type != "MESH" or not obj.data.vertices:
            continue
        tree = KDTree(len(obj.data.vertices))
        for vertex in obj.data.vertices:
            tree.insert(obj.matrix_world @ vertex.co, vertex.index)
        tree.balance()
        trees[obj.name] = (obj, tree)
    return trees


def find_tree(trees, node_name):
    if node_name in trees:
        return trees[node_name]
    matches = [value for name, value in trees.items() if name.startswith(node_name)]
    if len(matches) == 1:
        return matches[0]
    raise RuntimeError(f"Cannot uniquely resolve imported mesh node: {node_name}")


def validate_projection(scene, camera_objects, main_objects, landmark_manifest):
    trees = build_kdtrees(main_objects)
    camera_map = {camera.name: camera for camera in camera_objects}
    validation_cameras = []
    all_pixel_errors = []
    all_spatial_errors = []
    for camera_entry in landmark_manifest["cameras"]:
        camera = camera_map[camera_entry["name"]]
        landmarks = []
        for landmark in camera_entry["landmarks"]:
            expected_three = Vector((*landmark["threeWorldPosition"], 1.0))
            expected_blender = (GLTF_TO_BLENDER @ expected_three).to_3d()
            obj, tree = find_tree(trees, landmark["nodeName"])
            nearest, vertex_index, spatial_error = tree.find(expected_blender)
            coordinate = world_to_camera_view(scene, camera, nearest)
            blender_pixel = [
                coordinate.x * scene.render.resolution_x,
                (1.0 - coordinate.y) * scene.render.resolution_y,
            ]
            browser_pixel = landmark["projection"]["pixel"]
            pixel_error = math.hypot(
                blender_pixel[0] - browser_pixel[0],
                blender_pixel[1] - browser_pixel[1],
            )
            all_pixel_errors.append(pixel_error)
            all_spatial_errors.append(spatial_error)
            landmarks.append(
                {
                    "id": landmark["id"],
                    "label": landmark["label"],
                    "sourceNodeName": landmark["nodeName"],
                    "sourceMeshName": landmark["meshName"],
                    "sourcePrimitiveIndex": landmark["primitiveIndex"],
                    "sourceVertexIndex": landmark["vertexIndex"],
                    "resolvedBlenderObject": obj.name,
                    "resolvedBlenderVertexIndex": vertex_index,
                    "threeWorldPosition": list(landmark["threeWorldPosition"]),
                    "threeNdc": list(landmark["projection"]["ndc"]),
                    "threePixelCoordinate": list(browser_pixel),
                    "expectedBlenderWorldPosition": list(expected_blender),
                    "blenderWorldPosition": list(nearest),
                    "blenderPixelCoordinate": blender_pixel,
                    "worldPositionError": spatial_error,
                    "pixelError": pixel_error,
                }
            )
        validation_cameras.append(
            {
                "key": camera_entry["key"],
                "cameraName": camera.name,
                "landmarks": landmarks,
            }
        )
    return {
        "schemaVersion": 1,
        "viewport": landmark_manifest["viewport"],
        "coordinateConversion": "BlenderWorld = C * glTFWorld, C maps (x,y,z) to (x,-z,y).",
        "landmarkSelection": landmark_manifest["selection"],
        "cameras": validation_cameras,
        "summary": {
            "landmarkCount": len(all_pixel_errors),
            "medianPixelError": statistics.median(all_pixel_errors),
            "maximumPixelError": max(all_pixel_errors),
            "medianWorldPositionError": statistics.median(all_spatial_errors),
            "maximumWorldPositionError": max(all_spatial_errors),
            "targetMedianPixelError": 0.75,
            "targetMaximumPixelError": 2.0,
            "passed": statistics.median(all_pixel_errors) <= 0.75
            and max(all_pixel_errors) <= 2.0,
        },
    }


def render_diagnostics(scene, camera_objects, main_objects, phase2_objects, render_dir):
    render_dir.mkdir(parents=True, exist_ok=True)
    camera_map = {camera.name: camera for camera in camera_objects}
    renders = [
        ("cave-exit", "CAM_V3_CAVE_EXIT_1440x900", 11.5),
        ("day-clear-start", "CAM_V3_DAY_CLEAR_START_1440x900", 30.0),
        ("day-clear-late", "CAM_V3_DAY_CLEAR_LATE_1440x900", 37.9),
    ]
    try:
        scene.render.engine = "BLENDER_WORKBENCH_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.18, 0.43, 0.52)
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    output = []
    for key, camera_name, progress in renders:
        scene.camera = camera_map[camera_name]
        for obj in main_objects:
            obj.hide_render = progress >= 20 and "CAVE" in obj.name.upper()
        for obj in phase2_objects:
            obj.hide_render = False
        filepath = render_dir / f"{key}-blender.png"
        scene.render.filepath = str(filepath)
        bpy.ops.render.render(write_still=True)
        output.append(str(filepath))
    for obj in main_objects:
        obj.hide_render = False
    return output


def main():
    args = parse_args()
    args.output = args.output.resolve()
    args.validation_output = args.validation_output.resolve()
    args.render_dir = args.render_dir.resolve()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.validation_output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "JOURNEY_V3_SPATIAL_REFERENCE"
    scene.render.resolution_x = 1440
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = 1.0
    scene.render.pixel_aspect_y = 1.0
    scene.render.use_border = False
    scene.render.use_crop_to_border = False
    scene.unit_settings.scale_length = 1.0
    scene["journey_phase"] = "1B"
    scene["authoritative_camera_source"] = str(
        PROJECT_ROOT / "docs/references/journey-v3/baselines/camera"
    )
    scene["environment_work_status"] = "empty; reserved for Phase 1C"

    main_collection = collection(scene, "V1_MAIN_SPATIAL_REFERENCE_LOCKED")
    phase2_collection = collection(scene, "V1_PHASE2_ENV_REFERENCE_LOCKED")
    camera_collection = collection(scene, "V3_CAMERA_BASELINES")
    frustum_collection = collection(scene, "V3_CAMERA_FRUSTUMS")
    guide_collection = collection(scene, "V3_REVIEW_GUIDES")
    environment_collection = collection(scene, "V3_ENVIRONMENT_WORK")
    environment_collection["journey_role"] = "phase-1c-environment-work"
    environment_collection["export_enabled"] = True
    environment_collection["locked_reference"] = False

    main_objects = import_into_collection(MAIN_GLB, main_collection)
    phase2_objects = import_into_collection(PHASE2_GLB, phase2_collection)
    camera_objects = import_into_collection(CAMERA_GLB, camera_collection)
    camera_objects = [obj for obj in camera_objects if obj.type == "CAMERA"]
    color_reference_objects(main_objects)
    color_reference_objects(phase2_objects, phase2=True)
    main_hash = set_reference_metadata(
        main_collection, main_objects, "v1-main-spatial-reference", MAIN_GLB
    )
    phase2_hash = set_reference_metadata(
        phase2_collection, phase2_objects, "v1-phase2-environment-reference", PHASE2_GLB
    )

    camera_manifest = read_json(CAMERA_MANIFEST)
    manifest_by_name = {entry["name"]: entry for entry in camera_manifest["cameras"]}
    matrix_validation = []
    for camera in camera_objects:
        entry = manifest_by_name[camera.name]
        camera["journey_role"] = entry["role"]
        camera["preview"] = entry["preview"]
        camera["progress"] = entry["progress"]
        camera["clip_time"] = entry["clipTime"]
        camera["source_path"] = entry["sourcePath"]
        camera["export_enabled"] = False
        camera["browser_matrix_world"] = entry["matrixWorld"]
        camera["journey_aspect_ratio"] = entry["aspectRatio"]
        camera.data.sensor_fit = "VERTICAL"
        source_matrix = matrix_from_three(entry["matrixWorld"])
        candidates = {
            "C_times_M": GLTF_TO_BLENDER @ source_matrix,
            "C_times_M_times_C_inverse": GLTF_TO_BLENDER
            @ source_matrix
            @ GLTF_TO_BLENDER.inverted(),
            "M_times_C_inverse": source_matrix @ GLTF_TO_BLENDER.inverted(),
        }
        errors = {
            name: matrix_max_error(camera.matrix_world, value)
            for name, value in candidates.items()
        }
        selected_formula = min(errors, key=errors.get)
        imported_forward = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        imported_up = camera.matrix_world.to_quaternion() @ Vector((0, 1, 0))
        candidate_forward = candidates[selected_formula].to_quaternion() @ Vector((0, 0, -1))
        candidate_up = candidates[selected_formula].to_quaternion() @ Vector((0, 1, 0))
        fov_error = abs(camera.data.angle_y - entry["yfovRadians"])
        matrix_validation.append(
            {
                "cameraName": camera.name,
                "progress": entry["progress"],
                "formulaErrors": errors,
                "selectedFormula": selected_formula,
                "selectedMatrixMaxAbsError": errors[selected_formula],
                "importedMatrixWorld": matrix_to_column_major(camera.matrix_world),
                "formulaMatrixWorld": matrix_to_column_major(candidates[selected_formula]),
                "importedPosition": list(camera.matrix_world.translation),
                "importedQuaternion": list(camera.matrix_world.to_quaternion()),
                "importedForward": list(imported_forward),
                "formulaForward": list(candidate_forward),
                "importedUp": list(imported_up),
                "formulaUp": list(candidate_up),
                "yfovRadiansImported": camera.data.angle_y,
                "yfovRadiansSource": entry["yfovRadians"],
                "yfovErrorRadians": fov_error,
                "lensMillimeters": camera.data.lens,
                "sensorFit": camera.data.sensor_fit,
                "sensorWidth": camera.data.sensor_width,
                "sensorHeight": camera.data.sensor_height,
            }
        )
        if errors[selected_formula] > 1e-5 or fov_error > 1e-5:
            raise RuntimeError(
                f"Camera conversion mismatch for {camera.name}: "
                f"matrix={errors[selected_formula]}, fov={fov_error}"
            )

    frustum_objects = create_frustums(camera_objects, frustum_collection)
    guide_objects = create_review_guides(main_objects, guide_collection, camera_objects)
    landmark_manifest = read_json(LANDMARK_MANIFEST)
    projection_validation = validate_projection(
        scene, camera_objects, main_objects, landmark_manifest
    )
    projection_validation["matrixConversionValidation"] = matrix_validation
    projection_validation["sources"] = {
        "mainSpatialReference": str(MAIN_GLB),
        "mainSpatialReferenceSha256": main_hash,
        "phase2Environment": str(PHASE2_GLB),
        "phase2EnvironmentSha256": phase2_hash,
        "cameraGlb": str(CAMERA_GLB),
        "cameraGlbSha256": sha256_file(CAMERA_GLB),
        "cameraManifest": str(CAMERA_MANIFEST),
        "landmarkManifest": str(LANDMARK_MANIFEST),
    }
    if not projection_validation["summary"]["passed"]:
        with open(args.validation_output, "w", encoding="utf-8") as handle:
            json.dump(projection_validation, handle, indent=2)
            handle.write("\n")
        raise RuntimeError(
            "Landmark projection exceeds Phase 1B limits: "
            f"median={projection_validation['summary']['medianPixelError']}, "
            f"max={projection_validation['summary']['maximumPixelError']}"
        )

    rendered = []
    if not args.skip_renders:
        rendered = render_diagnostics(
            scene, camera_objects, main_objects, phase2_objects, args.render_dir
        )
    projection_validation["diagnosticRenders"] = rendered
    projection_validation["structure"] = {
        "collections": [
            {
                "name": value.name,
                "objectCount": len(value.objects),
                "exportEnabled": value.get("export_enabled"),
                "lockedReference": value.get("locked_reference"),
            }
            for value in (
                main_collection,
                phase2_collection,
                camera_collection,
                frustum_collection,
                guide_collection,
                environment_collection,
            )
        ],
        "mainObjectCount": len(main_objects),
        "phase2ObjectCount": len(phase2_objects),
        "cameraCount": len(camera_objects),
        "frustumObjectCount": len(frustum_objects),
        "guideObjectCount": len(guide_objects),
        "environmentWorkObjectCount": len(environment_collection.objects),
    }
    with open(args.validation_output, "w", encoding="utf-8") as handle:
        json.dump(projection_validation, handle, indent=2)
        handle.write("\n")

    scene.camera = next(
        camera for camera in camera_objects if camera.name == "CAM_V3_DAY_CLEAR_START_1440x900"
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(args.output), check_existing=False)
    print(
        json.dumps(
            {
                "blend": str(args.output),
                "validation": str(args.validation_output),
                "projection": projection_validation["summary"],
                "cameraFormula": sorted(
                    set(entry["selectedFormula"] for entry in matrix_validation)
                ),
                "collectionCount": 6,
                "cameraCount": len(camera_objects),
                "environmentWorkObjectCount": len(environment_collection.objects),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
