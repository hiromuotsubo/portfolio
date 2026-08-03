from pathlib import Path

import bpy


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE = PROJECT_ROOT / "work/blender/source/journey-v13-illustrated.glb"
OUTPUT = PROJECT_ROOT / "work/pbr/painter/journey-mountains-painter.fbx"
MOUNTAIN_TOKENS = {"ALPINE", "MASSIF", "RIDGE"}


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))

mountains = []
for obj in list(bpy.context.scene.objects):
    if obj.type != "MESH":
        continue
    material_names = " ".join(material.name for material in obj.data.materials if material)
    identity = f"{obj.name} {obj.data.name} {material_names}".upper()
    if any(token in identity for token in MOUNTAIN_TOKENS):
        mountains.append(obj)
    else:
        bpy.data.objects.remove(obj, do_unlink=True)

for obj in mountains:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15192, island_margin=0.018)
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)

for obj in mountains:
    obj.select_set(True)
bpy.context.view_layer.objects.active = mountains[0]

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.export_scene.fbx(
    filepath=str(OUTPUT),
    use_selection=True,
    apply_unit_scale=True,
    bake_space_transform=False,
    add_leaf_bones=False,
    mesh_smooth_type="FACE",
    use_mesh_modifiers=True,
    bake_anim=False,
    path_mode="AUTO",
)

print(f"PAINTER_MESH={OUTPUT}")
