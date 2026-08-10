# Journey V3 Phase 1A camera and Blender audit

## Authority and scope

This baseline preserves Journey V1 as the only camera, behavior, timing, and
continuous-space authority. It does not use Journey V2, change Journey V1,
author mountain geometry, save a Blend file, or export a GLB.

Reference priority remains:

1. Journey V1 camera, behavior, timing, and continuous 3D space
2. Montfort mountain form and look development
3. Hero Valley valley, river, meadow, and color composition
4. Kamikochi naturalism, vegetation, restrained color, and atmosphere

## Deterministic browser capture

Capture Mode is enabled only when a valid preview is combined with both
`captureCamera=1` and `freezeRuntime=1`. It fixes pointer and mobile look at
zero, removes walking bob, freezes camera-affecting damping and shader time,
keeps story/HOLD/time-of-day values at the preview values, fixes renderer DPR
to 1, and publishes one post-correction snapshot at
`window.__JOURNEY_V3_CAPTURE__`.

The snapshot is produced after animation sampling, story-to-clip mapping,
open-valley framing, ending framing, viewport framing, pointer/bob capture
overrides, projection update, and `camera.updateMatrixWorld(true)`.

Regenerate all JSON and UI/Canvas PNG files at 1440 x 900 CSS pixels with:

```sh
node scripts/capture_journey_v3_camera.mjs
```

The command starts and stops its own local Vite and headless Chrome processes.
It uses a 1440 x 900 viewport, device scale factor 1, waits for the public
capture API and normal UI settlement, and writes the baseline files beneath
this directory.

## Progress selection

| Capture | Preview | Story progress | Selection basis |
| --- | --- | ---: | --- |
| Cave Exit | `cave-exit` | 11.5 | Existing Journey V1 parity checkpoint and cave-walk chapter boundary. |
| Day Clear Start | `day-clear` | 30 | Existing Journey V1 parity Hero Frame checkpoint. `VISUAL_TIMING.sunsetStart` is exactly 30, so its sunset smoothstep is still exactly 0 at this boundary. |
| Day Clear Late | `day-clear-late` | 37.9 | Last sampled point within the `EXPERIENCE_PACE` clear-valley chapter (20-38). The gradual sunset smoothstep has already reached 0.2537212094907407 because the actual visual blend begins at 30. |

The code therefore contains no distinct state that is simultaneously later
than progress 30 and still mathematically pre-sunset. The V1 camera track also
holds the same final browser position and orientation at progress 30 and 37.9;
only clip time and visual lighting advance. Creating an artificial different
day camera would violate the V1 camera authority, so the baseline records this
constraint explicitly instead of changing the camera.

## Camera summary

All matrices use Three.js `Matrix4.elements` column-major storage order.

| Capture | Position | Quaternion | Vertical FOV | Clip time / duration |
| --- | --- | --- | ---: | ---: |
| Cave Exit | `[0, 3.830900192260742, -0.391295850276947]` | `[0.1057454830722683, 0.01688443487874638, -0.0017957816084297569, 0.9942482506079923]` | 39.76070657389487° | 4.087165320327186 / 11 s |
| Day Clear Start | `[0.19253011894546054, 3.8884935451816816, 1.4677618305562001]` | `[0.13446184369941855, 0.016825422636074772, -0.0022834460530664147, 0.9907732856795207]` | 57.86070657389487° | 5.517600000000001 / 11 s |
| Day Clear Late | `[0.19253011894546054, 3.8884935451816816, 1.4677618305562001]` | `[0.13446184369941855, 0.016825422636074772, -0.0022834460530664147, 0.9907732856795207]` | 57.86070657389487° | 5.992074000000001 / 11 s |

The camera is `CAM_V13_MASTER_ANIMATED`, aspect is 1.6, near is
0.05000000074505806, and runtime far is 2400. Journey scene root, main GLB
root, phase-2 GLB root, and camera parent are identity at capture time. The
named Journey V3 upper group is `JOURNEY_V3_SKY_RIG`; its final transform is
stored in each JSON. Camera-relative matrices are stored for all three roots.

## Main Blend candidate audit

Candidate:

`/Users/tsubo/Documents/Codex/2026-07-24/https-www-blender-org-lab-mcp/outputs/journey-master-model-v13.blend`

Formal rating: **Likely source but not fully reproducible**.

Evidence of lineage and spatial compatibility:

- It contains `CAM_V13_MASTER_ANIMATED` and Action
  `CAM_V13_MASTER_ANIMATEDアクション.014`.
- The native Action spans frames 1-330 at 30 fps, exactly 11 seconds. The web
  GLB has the same Action name and an 11-second, two-channel, 530-keyframe
  animation (0-264 at the importer's 24 fps).
- The candidate contains matching core object/mesh pairs for
  `CAVE_HQ_INTERIOR_SHELL`, `CAVE_HQ_GROUND`, `CAVE_HQ_FLOOR_WATER`,
  `TER_V13_FICTIONAL_NAGANO_MASSIF`, `MTN_V13_FAR_CENTRAL_RIDGE`,
  `RIV_V13_EMERALD_S_WATER.001`, and
  `RIV_V13_VISIBLE_PEBBLE_BED.001`.
- Those exported core objects use identity world transforms and their
  dimensions agree with the pre-KTX2 web GLB to normal export/quantization
  precision.
- `scripts/audit_journey_blend.py` explicitly points to this candidate.

Why it is not rated authoritative:

- The candidate contains 5,328 mesh objects, 89 materials, 13 cameras, and
  160 Actions, whereas the runtime web asset is an intentionally reduced
  16-mesh, 13-material, one-camera, one-animation asset.
- `scripts/optimize_journey_glb.py` consumes
  `work/blender/source/journey-v13-illustrated.glb`, not the Blend directly.
  That intermediate file and the exact candidate-Blend-to-v13-export step are
  not present, so the complete transformation cannot be replayed from this
  Blend alone.

The documented v13-to-v16 processing chain is:

```text
journey-v13-illustrated.glb (missing working intermediate)
  -> scripts/optimize_journey_glb.py
  -> work/blender/export/journey-v15-source.glb
  -> glTF extraction + scripts/generate_journey_pbr.mjs
  -> journey-v16-pbr-ktx2-uncompressed.glb
  -> gltf-transform uastc
  -> gltf-transform meshopt
  -> public/journey/models/journey-v16-pbr-ktx2.glb
```

The tracked `journey-v15-web.glb` and runtime v16 GLB have the same 16 meshes,
1,075,578 render vertices, 191,248 upload vertices, and 11-second camera
animation. Their scene bounds differ by less than 0.009 scene units after
mesh quantization. KTX2 changes texture encoding, not topology; meshopt adds
the small measured coordinate quantization without changing object hierarchy
or camera animation.

Blender 5.2 could not import the final KTX2 GLB because that importer build
does not expose `KHR_texture_basisu`. The geometry comparison therefore used
glTF-Transform's direct v16 inspection plus a read-only Blender import of the
tracked pre-KTX2 v15 GLB. No temporary or permanent GLB was exported.

## Phase-2 environment source audit

Source:

`work/blender/phase2/journey-phase2-environment.blend`

Formal rating: **Authoritative source**.

- `scripts/phase2_build_environment.py` creates the six selected objects,
  saves this Blend, and immediately exports the runtime GLB in the same run.
- Commit `b65edd3ca21072bd20cfabb026d2b24697aa9dfc` introduced the generator
  and runtime GLB together.
- Blend and GLB contain the same six object/mesh names, identity transforms,
  no camera, and no animation.
- Both have aggregate bounds `[-280, 13, -0.106733]` to
  `[280, 548, 255.160004]` in Blender's imported Z-up coordinates.
- The Blend retains 18 material datablocks from its imported source reference;
  the selected export correctly contains only the five materials used by the
  six output objects.
- Export uses selection-only, applied transforms, no animation, and Y-up glTF.
  Shore object bounds become smaller after export because unused, unreferenced
  source vertices are omitted; referenced faces and world alignment remain
  consistent.

## Recommended fallback spatial source

Use the current runtime main GLB as a locked spatial reference in the next
Blender phase:

1. Import it into a collection named `V1_SPATIAL_REFERENCE_LOCKED`.
2. Make the collection non-editable and exclude it from Journey V3 exports.
3. Author the new mountain, valley, ground, and riverbank in separate Journey
   V3 collections or a separate Blend.
4. Keep the Journey V1 story/camera GLB and new Journey V3 environment GLB at
   the same identity world transform in WebGL.

This preserves the proven continuous world even though the main source Blend
cannot be rated fully reproducible.

## Three.js to Blender matrix design

Three.js/glTF is right-handed Y-up. Blender is right-handed Z-up. The world
basis conversion is a +90° rotation about X:

```text
C = [ 1  0  0  0 ]
    [ 0  0 -1  0 ]
    [ 0  1  0  0 ]
    [ 0  0  0  1 ]

(x, y, z)Three -> (x, -z, y)Blender
```

Read JSON arrays as Three.js column-major matrices; when constructing a
Blender `mathutils.Matrix`, transpose the four array slices into row-major
form. Do not convert Euler components or hand-edit signs.

Three.js/glTF and Blender cameras both use local -Z forward and local +Y up.
For a camera transform expressed in the imported glTF scene coordinates, use:

```text
M_camera_blender = M_reference_parent_blender * C * M_camera_relative_three
```

`M_camera_relative_three` should be the saved 4x4 relative matrix, not a
position/Euler reconstruction. Derive Blender location and quaternion from the
resulting matrix decomposition.

For generic object node transforms whose local geometry basis is also being
converted, the full basis change is `C * M * inverse(C)`. This is why importing
the reference GLB first is safer: Blender's glTF importer handles mesh/node
basis conversion, while the captured camera can be placed against the imported
reference with the explicit camera-world formula above.

Three.js `PerspectiveCamera.fov` is vertical. Set the Blender camera to
`sensor_fit = 'VERTICAL'` and compute:

```text
focalLength = sensorHeight / (2 * tan(verticalFov / 2))
```

With a 24 mm sensor height, the captured focal lengths are approximately
33.1851835 mm at Cave Exit and 21.7107702 mm for both Day captures. Set render
resolution to 1440 x 900, percentage 100, square pixels, copy near/far from the
JSON, and verify the Blender render against the Canvas-only PNG without
non-uniform resizing.

The recommended workflow is the imported locked GLB reference, not an empty
scene. An empty scene can use the same matrix math, but it lacks an independent
geometry/root check and is therefore more vulnerable to a silent axis, root,
or scale mismatch.
