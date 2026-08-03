import json
from pathlib import Path

import bpy


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "work/blender/source/journey-v13-illustrated.glb"
OUTPUT = PROJECT_ROOT / "work/blender/export/journey-v15-source.glb"
MOUNTAIN_MATERIAL = "MAT_V13_TEXTURED_ALPINE_PBR"
WEB_UNUSED_IMAGES = {
    "aerial_rocks_02_disp_4k",
    "aerial_rocks_02_rough_4k",
}
WEB_HIDDEN_TOKENS = {
    "FOLIAGE",
    "TRANSITION_FOG",
    "MEADOW",
    "SEATED",
}


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    material_names = " ".join(
        material.name for material in obj.data.materials if material
    )
    identity = f"{obj.name} {obj.data.name} {material_names}".upper()
    if any(token in identity for token in WEB_HIDDEN_TOKENS):
        bpy.data.objects.remove(obj, do_unlink=True)

material = bpy.data.materials.get(MOUNTAIN_MATERIAL)
if material and material.node_tree:
    for node in list(material.node_tree.nodes):
        if (
            node.type == "TEX_IMAGE"
            and node.image
            and node.image.name in WEB_UNUSED_IMAGES
        ):
            material.node_tree.nodes.remove(node)

for image_name in WEB_UNUSED_IMAGES:
    image = bpy.data.images.get(image_name)
    if image and image.users == 0:
        bpy.data.images.remove(image)

bpy.ops.outliner.orphans_purge(do_recursive=True)

OUTPUT.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT),
    export_format="GLB",
    export_cameras=True,
    export_lights=True,
    export_animations=True,
    export_optimize_animation_size=True,
    export_unused_images=False,
    export_unused_textures=False,
    export_meshopt_compression_enable=True,
    export_meshopt_extension="EXT_meshopt_compression",
)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
summary = {
    "source": str(SOURCE),
    "output": str(OUTPUT),
    "meshes": len(meshes),
    "vertices": sum(len(obj.data.vertices) for obj in meshes),
    "polygons": sum(len(obj.data.polygons) for obj in meshes),
    "images": [image.name for image in bpy.data.images if image.size[0] > 0],
    "output_bytes": OUTPUT.stat().st_size,
}
print("JOURNEY_OPTIMIZED=" + json.dumps(summary))
