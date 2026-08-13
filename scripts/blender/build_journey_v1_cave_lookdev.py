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
OUTPUT_ROOT = PROJECT_ROOT / "work" / "blender" / "journey-v1-cave-lookdev"
OUTPUT_BLEND = OUTPUT_ROOT / "journey-cave-lookdev-v002.blend"
OUTPUT_GLB = OUTPUT_ROOT / "journey-cave-lookdev-v002.glb"
REPORT = OUTPUT_ROOT / "journey-cave-lookdev-v002-report.json"

CAVE_EXPORT_NAMES = {
    "CAVE_HQ_INTERIOR_SHELL",
    "CAVE_HQ_GROUND",
    "CAVE_HQ_FLOOR_WATER",
    "CAVE_DEBRIS_001",
    "CAVE_DEBRIS_002",
    "CAVE_HANGING_LEAF_01_01",
    "CAVE_MOSS_PATCH_01",
}


def is_cave_object(obj):
    identity = f"{obj.name} {getattr(obj.data, 'name', '')}".upper()
    return any(token in identity for token in CAVE_EXPORT_NAMES)


def add_multiscale_surface(obj):
    if obj.type != "MESH" or "INTERIOR_SHELL" not in obj.name.upper():
        return
    # Preserve the portal/corridor footprint while giving medium/fine erosion
    # enough vertices to break broad low-poly planes. One SIMPLE subdivision
    # pass improves the silhouette without rounding or shrinking the authored
    # opening; the modifiers remain nondestructive in the derived source.
    subdiv = obj.modifiers.new("JOURNEY_CAVE_MEDIUM_SUBDIV", "SUBSURF")
    subdiv.subdivision_type = "SIMPLE"
    subdiv.levels = 1
    subdiv.render_levels = 1

    medium_tex = bpy.data.textures.new("JOURNEY_CAVE_EROSION_MEDIUM", "VORONOI")
    medium_tex.noise_scale = 2.8
    medium_tex.noise_intensity = 0.72
    medium = obj.modifiers.new("JOURNEY_CAVE_EROSION_MEDIUM", "DISPLACE")
    medium.texture = medium_tex
    medium.texture_coords = "GLOBAL"
    medium.strength = 0.22
    medium.mid_level = 0.52

    fine_tex = bpy.data.textures.new("JOURNEY_CAVE_EROSION_FINE", "CLOUDS")
    fine_tex.noise_scale = 0.72
    fine_tex.noise_depth = 2
    fine = obj.modifiers.new("JOURNEY_CAVE_EROSION_FINE", "DISPLACE")
    fine.texture = fine_tex
    fine.texture_coords = "GLOBAL"
    fine.strength = 0.065
    fine.mid_level = 0.5


def soften_debris(obj):
    if obj.type != "MESH" or "DEBRIS" not in obj.name.upper():
        return
    bevel = obj.modifiers.new("JOURNEY_CAVE_DEBRIS_SOFTEN", "BEVEL")
    bevel.width = 0.055
    bevel.segments = 2
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(36)
    # Sink the isolated props slightly into the cave floor so their contact
    # reads as accumulated geology rather than placed game assets.
    obj.location.z -= min(0.08, max(obj.dimensions.z * 0.012, 0.025))


def configure_materials(obj):
    for material in obj.data.materials:
        if not material:
            continue
        material.roughness = max(material.roughness, 0.82)
        material.metallic = 0.0
        material.diffuse_color[0] *= 0.88
        material.diffuse_color[1] *= 0.94
        material.diffuse_color[2] *= 0.91
        if material.use_nodes and material.node_tree:
            bsdf = next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)
            if bsdf:
                bsdf.inputs["Roughness"].default_value = max(
                    bsdf.inputs["Roughness"].default_value,
                    0.82,
                )
                if "Specular IOR Level" in bsdf.inputs:
                    bsdf.inputs["Specular IOR Level"].default_value = 0.23


OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))

selected = []
for obj in bpy.context.scene.objects:
    obj.select_set(False)
    if not is_cave_object(obj):
        obj.hide_render = True
        continue
    obj.hide_render = False
    add_multiscale_surface(obj)
    soften_debris(obj)
    if obj.type == "MESH":
        configure_materials(obj)
    obj.select_set(True)
    selected.append(obj)

if not selected:
    raise RuntimeError("No V1 cave objects matched in the source Blend")

bpy.context.view_layer.objects.active = next(
    obj for obj in selected if obj.type == "MESH"
)
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND), copy=True)

# Runtime reuses the production cave materials and replaces only the authored
# shell geometry. Exporting the full source scene here would duplicate the
# existing texture payload and could accidentally change unrelated floor or
# debris assets. The complete look-development work remains in the versioned
# .blend above; the web candidate is deliberately geometry-only.
for obj in selected:
    obj.select_set(obj.type == "MESH" and "INTERIOR_SHELL" in obj.name.upper())
bpy.context.view_layer.objects.active = next(
    obj for obj in selected if obj.type == "MESH" and "INTERIOR_SHELL" in obj.name.upper()
)

bpy.ops.export_scene.gltf(
    filepath=str(OUTPUT_GLB),
    export_format="GLB",
    use_selection=True,
    # Apply the one-level breakup stack to the candidate GLB. The derived
    # .blend retains the nondestructive modifiers for future look development.
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
    "objects": [
        {
            "name": obj.name,
            "type": obj.type,
            "vertices": len(obj.data.vertices) if obj.type == "MESH" else 0,
            "polygons": len(obj.data.polygons) if obj.type == "MESH" else 0,
            "dimensions": [round(value, 4) for value in obj.dimensions],
            "modifiers": [modifier.name for modifier in obj.modifiers],
        }
        for obj in selected
    ],
    "outputBytes": OUTPUT_GLB.stat().st_size,
}
REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
print("JOURNEY_CAVE_LOOKDEV=" + json.dumps(report))
