# Journey V3 Phase 1B Spatial Reference Audit

## Scope and authority

This Phase 1B file is a reproducible production-space reference only. It does not contain a new mountain, valley, riverbank, flower field, wind system, or production material. Journey V1 remains the sole camera, timing, behavior, experience, and continuous-3D-space baseline. Journey V2 is not used. The browser-final Journey V3 camera matrices captured after all Journey V1 runtime corrections are the camera authority; the camera stored in the runtime GLB is not used alone as the comparison camera.

Reference priority for Phase 1C is:

1. Journey V1 camera, behavior, and continuous 3D space.
2. Montfort for mountain macro massing, ridge silhouette, slope continuity, valley carving, erosion structure, rock/vegetation integration, perceived scale, lighting, and atmospheric depth.
3. Hero Valley for valley, river, flower field, blue/green contrast, and overall composition. It must not be used as a background plate.
4. Kamikochi field photography for vegetation, saturation, water, Japanese naturalism, and atmospheric perspective.

Montfort is to be reinterpreted for the fixed Journey V1 cameras, not copied. The Journey V1 camera must not be changed to fit the mountain.

## Git and tool baseline

- Repository: `/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio`
- Branch: `main`
- Starting HEAD: `8aeabde7fd90d6c868039aa01f056ef97e853568`
- Phase 1A tag: `baseline/journey-v3-phase-1a-camera-audit` → `8aeabde7fd90d6c868039aa01f056ef97e853568`
- Blender: `5.2.0 LTS`, build hash `fbe6228777e7`
- Node: `v24.18.0`
- glTF-Transform CLI: `4.4.2`

## Generated untracked production references

### Blender file

- Absolute path: `/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1b/journey-v3-spatial-reference-v001.blend`
- File name: `journey-v3-spatial-reference-v001.blend`
- Size: `11,887,071` bytes
- SHA-256: `bde155848309f8141b4535b7590788db6ce86068bd9b1a73384d6971ca19f58e`
- Resolution: `1440 × 900`, 100%, square pixels
- Unit scale: `1.0`
- Render region/crop: disabled
- Active review camera on save: `CAM_V3_DAY_CLEAR_START_1440x900`

The Blend binary hash may vary between rebuilds because of Blender serialization details. Two clean rebuilds produced byte-identical structural validation JSON (`161b9f0bba5c4d708ea5855cbce3880e3fa89bedc4c6c25fa3bb23077ce89335`) while their Blend hashes differed, as expected. The scripts and structural validation are authoritative.

### Runtime and derived GLBs

| File | Size | SHA-256 | Role |
| --- | ---: | --- | --- |
| `public/journey/models/journey-v16-pbr-ktx2.glb` | 17,570,988 | `4d30066f0a854f276007c60b4f99a28c99ccbc3d6ec7f0e69dd5b719c995b97f` | Untouched runtime source |
| `work/blender/journey-v3/phase1b/reference/journey-v16-spatial-reference.glb` | 1,947,292 | `8a78a9589e12fc84dbe24e3d34e24f8e1e3ff14ef28bbba1745817dab720d007` | Geometry-only Blender import reference |
| `public/journey/models/journey-phase2-environment.glb` | 1,271,796 | `27626ac20d358fc9f0ee3a588f1e84a5e1b8ac668d48dc9f6f8da8444978e713` | Untouched authoritative auxiliary environment |
| `work/blender/journey-v3/phase1b/reference/journey-v3-camera-baselines.glb` | 14,944 | `c409233351215d6683c91298efc794f4be47d17fe6d4927e662a64a0f62934ce` | Browser-final camera-only GLB |

## Camera source hashes

| Baseline | SHA-256 |
| --- | --- |
| `cave-exit-1440x900.json` | `20059dd8bd31f6b73660a1188ecf5ef36d0c66d040b754631c9a19b3767fb1c1` |
| `day-clear-start-1440x900.json` | `ccc4a0aa150807c72b4950820965d2b7877fd64a04eac1ef770363f66e156b05` |
| `day-clear-late-1440x900.json` | `31b9b8e1009e60263dd44250be94038f099c857f9e149cbc29645b0ad366643c` |
| `cave-to-day-camera-sweep-1440x900.json` | `c0f5ad9a252a20c375992bbc1f6f7b76b92e52c022907c3fae6c09a12035688f` |

## Geometry-only v16 method and equivalence

`scripts/prepare_journey_v16_spatial_reference.mjs` reads v16 with glTF-Transform and meshopt decoding, disposes only embedded textures and the now-unused `KHR_texture_basisu` extension, retains material names/slots, and writes a Blender-importable GLB. It does not alter the runtime source.

The source and derived files match on:

- 1 scene
- 17 nodes and all node names
- 16 meshes
- 16 primitives
- 53 accessors
- 13 materials and all material names
- 1 camera
- 1 animation and its duration/channels
- 0 skins
- every node TRS, matrix, hierarchy, mesh assignment, and camera assignment
- every POSITION accessor type/count/normalization/value SHA-256
- every index accessor type/count/value SHA-256
- aggregate scene bounds: min `[-225.25, -0.9484916042935098, -396.0085757011627]`, max `[225.125, 187.00028110408337, 30]`

The aggregate geometry hash is `e1712f3b0e278e32403030af1f7135d453f622eac92c5eb495d6ea91f43b3a14`. The complete source and output comparison digest is identical: `6bc88653d19bfff81782224a5e9a1d68f05b15f0d3029457bfc0e7821b9ef96a`. The only count difference is textures: source `9`, geometry-only output `0`.

## Camera Sweep

The browser was sampled every `0.25` story-progress units from `11.5` through `30` after all runtime camera corrections. Ten representative cameras were selected using actual cumulative motion:

`position distance + quaternion angle radians × 5 + absolute FOV delta degrees × 0.08`

Required transition anchors were added at Cave Exit, fog HOLD entry/completion, the open-vista transition, and Day Clear. Final representative progress values are:

`11.5, 12, 13.5, 16, 20, 22, 23.5, 25, 28.25, 30`

The contact sheet is `docs/references/journey-v3/baselines/screenshots/cave-to-day-camera-sweep-contact-sheet.png`.

## Collection structure

| Collection | Objects | Locked | Export enabled | Purpose |
| --- | ---: | --- | --- | --- |
| `V1_MAIN_SPATIAL_REFERENCE_LOCKED` | 17 | yes | no | geometry-only v16, camera, animation, hierarchy |
| `V1_PHASE2_ENV_REFERENCE_LOCKED` | 6 | yes | no | authoritative auxiliary environment |
| `V3_CAMERA_BASELINES` | 13 | no | no per camera | three comparisons plus ten sweep cameras |
| `V3_CAMERA_FRUSTUMS` | 11 | no | no per object | ten frustums plus one camera path |
| `V3_REVIEW_GUIDES` | 3 | no | no per object | cave opening, river leading line, mountain occupancy |
| `V3_ENVIRONMENT_WORK` | 0 | no | yes | deliberately empty for Phase 1C |

The two V1 reference Collections and all contained objects carry `journey_role`, `source_path`, `source_sha256`, `export_enabled=false`, and `locked_reference=true`. Reference objects and Collections are selection-locked. No mesh was applied, joined, decimated, or edited.

## Cameras

Comparison cameras:

- `CAM_V3_CAVE_EXIT_1440x900` — progress `11.5`, vertical FOV `39.7607066°`, Blender lens `33.1851845 mm`
- `CAM_V3_DAY_CLEAR_START_1440x900` — progress `30`, vertical FOV `57.8607066°`, Blender lens `21.7107716 mm`
- `CAM_V3_DAY_CLEAR_LATE_1440x900` — progress `37.9`, vertical FOV `57.8607066°`, Blender lens `21.7107716 mm`

Sweep cameras:

- `CAM_V3_SWEEP_P011_50`
- `CAM_V3_SWEEP_P012_00`
- `CAM_V3_SWEEP_P013_50`
- `CAM_V3_SWEEP_P016_00`
- `CAM_V3_SWEEP_P020_00`
- `CAM_V3_SWEEP_P022_00`
- `CAM_V3_SWEEP_P023_50`
- `CAM_V3_SWEEP_P025_00`
- `CAM_V3_SWEEP_P028_25`
- `CAM_V3_SWEEP_P030_00`

The camera-only GLB assigns each browser-final Three.js `matrixWorld` directly to a glTF camera node. glTF and Three.js share Y-up, right-handed, local camera forward `-Z`, so Blender's glTF importer performs the primary conversion.

The independent matrix verification tested `C × M`, `C × M × C⁻¹`, and `M × C⁻¹`, where `C` maps Three/glTF world coordinates `(x, y, z)` to Blender world coordinates `(x, -z, y)`. Every imported camera matched `C × M`. Maximum matrix element error was `3.8743e-7`; maximum vertical-FOV error was `7.4234e-8` radians. Position, quaternion, forward vector, up vector, projection, and lens were not hand-adjusted.

## Landmark projection validation

`scripts/validate_journey_v3_camera_projection.mjs` selects twelve actual mesh vertices per comparison camera from 48,452 sampled source vertices, distributed across a 4 × 3 NDC target grid. Blender resolves each expected converted point against the imported mesh vertex set and projects it using the imported camera.

- Landmarks: `36` total (`12` per camera)
- Median pixel error: `0.0002459501 px`
- Maximum pixel error: `0.0003539195 px`
- Median world-position resolution error: `4.0233e-7` units
- Maximum world-position resolution error: `1.5259e-5` units
- Target: median `≤ 0.75 px`, maximum `≤ 2 px`
- Result: pass

The full per-landmark report is `docs/references/journey-v3/baselines/blender/camera-projection-validation.json`.

## Browser/Blender image comparison

For Cave Exit, Day Clear Start, and Day Clear Late, the tracked output contains the browser Canvas baseline, Blender Workbench diagnostic render, 50% overlay, and edge comparison. Edge colors are red for browser, cyan for Blender, and near-white where they overlap.

Mountain ridge position, valley center, river perspective, frame occupancy, and major occlusion boundaries align with the numerical projection validation. Browser runtime shaders, fog, atmospheric layers, water shading, cave fade, phase-2 material treatment, and lighting are intentionally absent from the Workbench diagnostic render. Therefore whole-frame RGB differences (`45.86–46.38` mean 8-bit RGB levels) are expected and are not treated as camera error. Cave Exit has the largest appearance difference because the browser's cave/fog runtime treatment is not reproduced in Workbench; no camera adjustment was made to compensate.

## Frustums and review findings

The ten orange camera frustums and red path expose the full Cave Exit → Day Clear travel corridor. They show:

- a narrow, near-constant orientation and FOV through the cave/fog segment (`11.5–16`)
- the forward low corridor that future mountain massing must not enter
- the rapid opening of position, pitch, and FOV from `20–28.25`
- the stable final Day Clear camera from `28.25–30`
- the required guard band around the cave opening, central valley/river sightline, and frame-edge mountain occupancy

These guides constrain Phase 1C massing; they do not authorize changing the camera.

## Rebuild scripts and commands

Authoritative scripts:

- `scripts/capture_journey_v3_camera_sweep.mjs`
- `scripts/prepare_journey_v16_spatial_reference.mjs`
- `scripts/build_journey_v3_camera_gltf.mjs`
- `scripts/validate_journey_v3_camera_projection.mjs`
- `scripts/blender/build_journey_v3_spatial_reference.py`
- `scripts/build_journey_v3_blender_comparisons.mjs`
- `scripts/build_journey_v3_phase1b.mjs`

Rebuild:

```text
node scripts/capture_journey_v3_camera_sweep.mjs
node scripts/build_journey_v3_phase1b.mjs
```

The first command refreshes the browser-final sweep and contact sheet. The second regenerates the geometry-only reference, camera-only GLB, mesh-derived landmarks, Blender file, projection report, diagnostic renders, overlays, and edges.

Two clean Blender-only reproducibility checks were also run with separate `repro-check-a` and `repro-check-b` destinations. Their validation JSON files are byte-identical. Collection names/counts, object counts, camera names/matrices/lenses, reference hashes/bounds, projection results, custom export flags, and the empty environment-work Collection are deterministic.

## Known constraints and local backup

- The Blend and temporary reference GLBs live under ignored `work/`; tracked scripts and this audit are the durable source of truth.
- Workbench diagnostics verify spatial projection, not WebGL material/lighting parity.
- Phase 2 environment and v16 references are locked context only and must not be exported with the Phase 1C environment.
- `V3_ENVIRONMENT_WORK` is intentionally empty.
- No new terrain, mountain, riverbank, flower, wind, or production material exists in this file.
- A local-only safety copy may be made later beside the Blend, for example as `work/blender/journey-v3/phase1b/backups/journey-v3-spatial-reference-v001-<date>.blend`; no copy or upload was performed in Phase 1B.
