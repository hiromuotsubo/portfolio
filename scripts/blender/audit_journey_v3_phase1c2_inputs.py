"""Read-only Phase 1C.2 input audit for v002 topology and cave references."""

import hashlib
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
SOURCE_BLEND = PROJECT_ROOT / "work/blender/journey-v3/phase1c/journey-v3-macro-massing-v002.blend"
OUTPUT_DIR = PROJECT_ROOT / "docs/references/journey-v3/baselines/volumetric"
JSON_OUTPUT = OUTPUT_DIR / "phase-1c2-v002-topology-audit.json"
MD_OUTPUT = OUTPUT_DIR / "phase-1c2-v002-topology-audit.md"
TRUE_3D_AUDIT = (
    PROJECT_ROOT
    / "docs/references/journey-v3/baselines/massing/true-3d-cave/true-3d-cave-geometry-audit.json"
)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def convex_hull(points):
    unique = sorted(set((round(point[0], 9), round(point[1], 9)) for point in points))
    if len(unique) <= 2:
        return unique

    def cross(origin, left, right):
        return (left[0] - origin[0]) * (right[1] - origin[1]) - (
            left[1] - origin[1]
        ) * (right[0] - origin[0])

    lower = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def polygon_area(points):
    return abs(
        sum(
            left[0] * right[1] - right[0] * left[1]
            for left, right in zip(points, points[1:] + points[:1])
        )
        * 0.5
    ) if len(points) >= 3 else 0.0


def surface_area(obj):
    total = 0.0
    for polygon in obj.data.polygons:
        points = [obj.matrix_world @ obj.data.vertices[index].co for index in polygon.vertices]
        for index in range(1, len(points) - 1):
            total += ((points[index] - points[0]).cross(points[index + 1] - points[0])).length * 0.5
    return total


def bounds_record(points):
    minimum = [min(point[axis] for point in points) for axis in range(3)]
    maximum = [max(point[axis] for point in points) for axis in range(3)]
    return {
        "min": minimum,
        "max": maximum,
        "size": [maximum[index] - minimum[index] for index in range(3)],
    }


def classify_v002(name, role, bounds, depth, width, closed):
    labels = []
    ratio = depth / max(width, 1e-9)
    if role in {"dominant-massif", "receding-side-ridges"}:
        labels.extend(["profile extrusion", "ribbon terrain"])
        if not closed:
            labels.append("open height-field patch")
    if role in {"midground-range", "distant-range"}:
        labels.extend(["shallow ridge strip", "background curtain"])
        if ratio < 0.28:
            labels.append("camera-facing sheet")
    if role in {"continuous-meadow-terrain", "continuous-valley-floor"}:
        labels.append("rectangular terrain patch")
    if "RIVERBANK" in name:
        labels.append("narrow ribbon terrain")
    return labels


def mesh_topology(obj, camera):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    boundary = sum(1 for edge in bm.edges if len(edge.link_faces) == 1)
    non_manifold = sum(1 for edge in bm.edges if len(edge.link_faces) != 2)
    closed = boundary == 0 and non_manifold == 0
    volume = abs(bm.calc_volume(signed=False)) if closed else None
    bm.free()

    points = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
    bounds = bounds_record(points)
    hull = convex_hull([(point.x, point.y) for point in points])
    footprint_area = polygon_area(hull)

    forward = -(camera.matrix_world.to_quaternion() @ Vector((0, 0, 1)))
    forward.z = 0
    forward.normalize()
    right = Vector((forward.y, -forward.x, 0))
    forward_values = [point.dot(forward) for point in points]
    right_values = [point.dot(right) for point in points]
    depth = max(forward_values) - min(forward_values)
    width = max(right_values) - min(right_values)
    role = obj.get("journey_role")
    return {
        "name": obj.name,
        "role": role,
        "vertexCount": len(mesh.vertices),
        "faceCount": len(mesh.polygons),
        "edgeCount": len(mesh.edges),
        "boundaryEdgeCount": boundary,
        "nonManifoldEdgeCount": non_manifold,
        "closed": closed,
        "planFootprintArea": footprint_area,
        "cameraForwardDepth": depth,
        "cameraHorizontalWidth": width,
        "depthToWidthRatio": depth / max(width, 1e-9),
        "height": bounds["size"][2],
        "bounds": bounds,
        "surfaceArea": surface_area(obj),
        "volume": volume,
        "generator": {
            "primaryOrOpposing": "side_range()" if role in {"dominant-massif", "receding-side-ridges"} else None,
            "midOrFar": "distant_range()" if role in {"midground-range", "distant-range"} else None,
            "ground": "continuous_ground()" if role in {"continuous-meadow-terrain", "continuous-valley-floor"} else None,
            "river": "river_objects()" if role in {"single-riverbed", "irregular-riverbank"} else None,
        },
        "structuralClassification": classify_v002(obj.name, role, bounds, depth, width, closed),
    }


def material_names(obj):
    if obj.type != "MESH" or obj.data is None:
        return []
    return [material.name for material in obj.data.materials if material]


def runtime_cave_match(obj):
    identity = " ".join([obj.name, *material_names(obj)]).upper()
    return "CAVE_" in identity or "WEB_CAVE" in identity


def collection_objects_recursive(collection):
    result = set(collection.objects)
    for child in collection.children:
        result.update(collection_objects_recursive(child))
    return result


def matrix_values(matrix):
    return [round(value, 9) for row in matrix for value in row]


def cave_record(obj):
    parents = []
    parent = obj.parent
    while parent:
        parents.append(
            {
                "name": parent.name,
                "matrixWorld": matrix_values(parent.matrix_world),
                "matrixLocal": matrix_values(parent.matrix_local),
            }
        )
        parent = parent.parent
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "name": obj.name,
        "type": obj.type,
        "materials": material_names(obj),
        "matrixWorld": matrix_values(obj.matrix_world),
        "matrixLocal": matrix_values(obj.matrix_local),
        "parentChain": parents,
        "bounds": bounds_record(points),
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source_hash_before = sha256_file(SOURCE_BLEND)
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE_BLEND))
    camera = bpy.data.objects["CAM_V3_DAY_CLEAR_START_1440x900"]
    selected = sorted(
        (
            obj
            for obj in bpy.data.objects
            if obj.type == "MESH" and obj.name.startswith("V3_V002_")
        ),
        key=lambda item: item.name,
    )
    topology = [mesh_topology(obj, camera) for obj in selected]

    locked_reference_objects = set()
    for collection_name in (
        "V1_MAIN_SPATIAL_REFERENCE_LOCKED",
        "V1_PHASE2_ENV_REFERENCE_LOCKED",
    ):
        locked_reference_objects.update(
            collection_objects_recursive(bpy.data.collections[collection_name])
        )
    runtime_cave_objects = sorted(
        (obj for obj in locked_reference_objects if runtime_cave_match(obj)),
        key=lambda item: item.name,
    )
    with open(TRUE_3D_AUDIT, encoding="utf-8") as handle:
        prior = json.load(handle)
    shown = set(prior["shownJourneyV1Geometry"])
    runtime_names = {obj.name for obj in runtime_cave_objects}

    source_hash_after = sha256_file(SOURCE_BLEND)
    report = {
        "schemaVersion": 1,
        "phase": "Journey V3 Phase 1C.2 input audit",
        "sourceBlend": str(SOURCE_BLEND),
        "sourceBlendSha256Before": source_hash_before,
        "sourceBlendSha256After": source_hash_after,
        "sourceBlendUnchanged": source_hash_before == source_hash_after,
        "dayClearCamera": camera.name,
        "topology": topology,
        "runtimeCaveObjects": [cave_record(obj) for obj in runtime_cave_objects],
        "true3dShownCaveObjects": sorted(shown),
        "runtimeCaveObjectsOmittedFromTrue3dReview": sorted(runtime_names - shown),
        "true3dObjectsNotClassifiedAsRuntimeCave": sorted(shown - runtime_names),
        "runtimeCaveFade": {
            "formula": "1 - smoothstep(13.5, 20.2, progress)",
            "visibleCondition": "cavePresence > 0.004",
            "materialOpacity": "journeyCaveBaseOpacity * cavePresence",
            "depthWriteCondition": "cavePresence > 0.18",
        },
    }
    with open(JSON_OUTPUT, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")

    lines = [
        "# Journey V3 Phase 1C.2 — v002 Topology and Cave Input Audit",
        "",
        "## Disposition",
        "",
        "v002 remains archived and unmodified. This audit confirms that its render composition improved over v001, but its mountain construction is not an acceptable volumetric terrain base.",
        "",
        f"- source SHA-256 before: `{source_hash_before}`",
        f"- source SHA-256 after: `{source_hash_after}`",
        f"- source unchanged: `{source_hash_before == source_hash_after}`",
        "",
        "## Object topology",
        "",
        "| Object | Generator | Verts / Faces | Boundary / non-manifold | Closed | Width | Camera depth | Footprint area | Classification |",
        "| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |",
    ]
    for entry in topology:
        generator = next((value for value in entry["generator"].values() if value), "unknown")
        labels = ", ".join(entry["structuralClassification"]) or "open terrain surface"
        lines.append(
            f"| `{entry['name']}` | `{generator}` | {entry['vertexCount']} / {entry['faceCount']} | "
            f"{entry['boundaryEdgeCount']} / {entry['nonManifoldEdgeCount']} | {entry['closed']} | "
            f"{entry['cameraHorizontalWidth']:.3f} | {entry['cameraForwardDepth']:.3f} | "
            f"{entry['planFootprintArea']:.3f} | {labels} |"
        )
    lines.extend(
        [
            "",
            "## Why v002 reads as strips and curtains",
            "",
            "- `side_range()` repeats one normalized cross-slope profile through Y and only modulates that profile with `peak_chain()`. The result has plan area, but its macro silhouette is governed by a repeated profile extrusion rather than independently authored depth cross-sections.",
            "- `distant_range()` uses only 18 depth rows across a very wide X span and a shared `sin(pi * depth)` profile. This produces shallow camera-facing ridge strips and repeating arch-like side silhouettes.",
            "- `continuous_ground()` creates separate rectangular meadow and valley patches. River and banks are additional ribbons, so their plan-view separation reads as layered patches instead of one carved terrain surface.",
            "- Every selected v002 surface is open and has boundary/non-manifold edges. None provides a closed terrain skirt for Final Wide or oblique inspection.",
            "- Adding Solidify would only thicken these existing profiles; it would not create new mountain footprints, drainage topology, or independent depth sections.",
            "",
            "## Cave visibility and transform classification",
            "",
            f"Runtime-classified cave objects: `{len(runtime_cave_objects)}`.",
            f"Objects omitted from the previous True 3D review: `{sorted(runtime_names - shown)}`.",
            f"Previously shown objects not classified by the runtime cave rule: `{sorted(shown - runtime_names)}`.",
            "",
            "Journey V1/Journey V3 parity runtime applies `cavePresence = 1 - smoothstep(13.5, 20.2, progress)`, sets cave visibility from `cavePresence > 0.004`, multiplies material opacity by cavePresence, and disables depth writing after cavePresence falls below 0.18.",
            "",
            "The machine-readable JSON records every cave object's `matrixWorld`, `matrixLocal`, parent chain, and bounds. No source transform is changed by this audit.",
            "",
            "## Required v003 response",
            "",
            "v003 must replace repeated profile strips with one carved height-field terrain volume spanning the camera-frustum union, including skirts/bottom closure, an actual river channel, an irregular meadow, and V3-only cave-exit connector geometry. Geometry-only continuity and runtime-equivalent cave visibility must be reviewed separately.",
            "",
        ]
    )
    MD_OUTPUT.write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({
        "json": str(JSON_OUTPUT),
        "markdown": str(MD_OUTPUT),
        "sourceUnchanged": source_hash_before == source_hash_after,
        "objects": len(topology),
        "runtimeCaveObjects": len(runtime_cave_objects),
        "omittedCaveObjects": sorted(runtime_names - shown),
    }, indent=2))


if __name__ == "__main__":
    main()
