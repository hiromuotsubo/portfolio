import json
from pathlib import Path

import bpy


SOURCE = Path(
    "/Users/tsubo/Documents/Codex/2026-07-24/https-www-blender-org-lab-mcp/outputs/"
    "journey-master-model-v13.blend"
)


def material_summary(material):
    if not material:
        return None
    images = []
    if material.use_nodes and material.node_tree:
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE" and node.image:
                images.append(
                    {
                        "name": node.image.name,
                        "size": list(node.image.size),
                        "filepath": bpy.path.abspath(node.image.filepath),
                    }
                )
    return {
        "name": material.name,
        "blend_method": getattr(material, "surface_render_method", None),
        "images": images,
    }


bpy.ops.wm.open_mainfile(filepath=str(SOURCE))

objects = []
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    mesh = obj.data
    objects.append(
        {
            "name": obj.name,
            "mesh": mesh.name,
            "vertices": len(mesh.vertices),
            "edges": len(mesh.edges),
            "polygons": len(mesh.polygons),
            "uv_layers": [layer.name for layer in mesh.uv_layers],
            "color_attributes": [attribute.name for attribute in mesh.color_attributes],
            "materials": [material.name for material in mesh.materials if material],
            "modifiers": [
                {"name": modifier.name, "type": modifier.type}
                for modifier in obj.modifiers
            ],
            "dimensions": [round(value, 4) for value in obj.dimensions],
        }
    )

summary = {
    "source": str(SOURCE),
    "blender_version": bpy.app.version_string,
    "scene": bpy.context.scene.name,
    "frame_range": [bpy.context.scene.frame_start, bpy.context.scene.frame_end],
    "mesh_count": len(objects),
    "vertices": sum(item["vertices"] for item in objects),
    "polygons": sum(item["polygons"] for item in objects),
    "objects": sorted(objects, key=lambda item: item["polygons"], reverse=True),
    "materials": [
        material_summary(material)
        for material in bpy.data.materials
        if material
    ],
    "worlds": [world.name for world in bpy.data.worlds],
    "cameras": [camera.name for camera in bpy.data.cameras],
    "lights": [light.name for light in bpy.data.lights],
}

print("JOURNEY_BLEND_AUDIT=" + json.dumps(summary, ensure_ascii=False))
