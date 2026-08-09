import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "public/journey/models/journey-v15-web.glb"


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE), import_pack_images=False)

objects = []
for obj in bpy.context.scene.objects:
    if obj.type not in {"MESH", "CAMERA"}:
        continue
    entry = {
        "name": obj.name,
        "type": obj.type,
        "location": [round(value, 4) for value in obj.location],
        "dimensions": [round(value, 4) for value in obj.dimensions],
        "parent": obj.parent.name if obj.parent else None,
    }
    if obj.type == "MESH":
        world_bounds = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        entry.update(
            {
                "vertices": len(obj.data.vertices),
                "polygons": len(obj.data.polygons),
                "materials": [material.name for material in obj.data.materials if material],
                "bounds": {
                    "min": [round(min(point[index] for point in world_bounds), 4) for index in range(3)],
                    "max": [round(max(point[index] for point in world_bounds), 4) for index in range(3)],
                },
            }
        )
    objects.append(entry)

summary = {
    "source": str(SOURCE),
    "blender_version": bpy.app.version_string,
    "animations": [animation.name for animation in bpy.data.actions],
    "objects": sorted(objects, key=lambda item: item.get("polygons", 0), reverse=True),
}

camera = bpy.data.objects.get("CAM_V13_MASTER_ANIMATED")
if camera and bpy.data.actions:
    action = bpy.data.actions[0]
    frame_start, frame_end = action.frame_range
    samples = []
    for ratio in (0.0, 0.395, 0.447, 0.58, 0.72, 0.8):
        frame = frame_start + (frame_end - frame_start) * ratio
        bpy.context.scene.frame_set(round(frame))
        samples.append(
            {
                "ratio": ratio,
                "frame": round(frame),
                "location": [round(value, 4) for value in camera.location],
            }
        )
    summary["camera_samples"] = samples

print("PHASE2_GLB_AUDIT=" + json.dumps(summary, ensure_ascii=False))
