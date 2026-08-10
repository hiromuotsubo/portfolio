# Journey V3 Phase 1C Macro Massing Audit

## Authority and scope

Journey V1 remains the sole camera, camera-path, timing, interaction, story, and continuous-3D-space authority. Journey V2 is not used. The browser-final cameras, locked spatial references, Camera Sweep, frustums, and review guides from Phase 1B were used without changing their matrices or geometry.

Reference priority is:

1. Journey V1 camera, behavior, and continuous 3D space.
2. Montfort for mountain macro massing, asymmetric silhouette, ridge/slope continuity, valley carving, large erosion, perceived scale, and future rock/vegetation integration.
3. Hero Valley for an open valley, river leading line, future flower meadow, blue/green contrast, and overall composition. It is not used as a background plate.
4. Kamikochi photography for plausible Japanese vegetation bands, river/bank relationship, restrained saturation, natural scale, and atmospheric depth.

This phase creates only diagnostic macro geometry and masks. It does not create final PBR rock, individual rocks, forest objects, grass, flowers, wind, water, fog, time-of-day lighting, or a public/runtime GLB.

## Files and hashes

- Phase 1C Blend: `/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1c/journey-v3-macro-massing-v001.blend`
- Blend size: `13,124,445` bytes
- Blend SHA-256: `6af3e6a666293a924e915ee3d374a241467c8eb2647753346af3347d612aa920`
- Blender: `5.2.0 LTS`, build hash `fbe6228777e7`
- Input Phase 1B Blend SHA-256: `bde155848309f8141b4535b7590788db6ce86068bd9b1a73384d6971ca19f58e`
- Structural validation: `phase-1c-structure-validation.json`
- Structural validation SHA-256: `7597365940137eb5bfd066cf64f3f46806a8da832870020aec73024b494b7035`
- Deterministic structural signature: `c24b11880919d65770e2d7c9c5b4259949db5117d6aec16d2011dfda5c559946`
- Build script SHA-256: `c3d6d71531f5993b08f1d3f23ba969983710c7ba2ac19f376c7c53486f19fecd`
- Config SHA-256: `c85e8638ff094acf2e3e2267bb1c46bcee3addecaf0c0624f0b98fe3ad70cf5d`

The Blend binary is ignored under `work/`. The tracked Python/configuration scripts and structural validation are the durable source of truth.

## Phase 1B baseline used

- `V1_MAIN_SPATIAL_REFERENCE_LOCKED`
- `V1_PHASE2_ENV_REFERENCE_LOCKED`
- `V3_CAMERA_BASELINES`
- `V3_CAMERA_FRUSTUMS`
- `V3_REVIEW_GUIDES`
- Browser-final Cave Exit, Day Clear Start, and Day Clear Late cameras
- Camera Sweep progress: `11.5, 12, 13.5, 16, 20, 22, 23.5, 25, 28.25, 30`

The locked-reference structural signature before and after generation is identical. The source Phase 1B Blend is opened read-only as the build input and is never saved.

## Candidate designs

### Candidate A — Montfort-dominant

- Strong left/right asymmetry and a close, dominant primary massif.
- Narrower valley (`0.90` width scale), deeper drainage, stronger erosion (`1.15`).
- Large rock-wall potential and linked slopes take priority over meadow width.
- Rejected as the sole solution because the valley and future meadow felt too compressed in the fixed Day Clear camera.

### Candidate B — Hero Valley-dominant

- Wider valley (`1.27` width scale), wider river (`1.20`), and larger meadow (`1.26`).
- More distant mountain start and more open sky/river sightline.
- Rejected as the sole solution because the mountain presence and asymmetrical Montfort-like mass were too weak.

### Selected Hybrid — Cycle 2

- Uses Candidate A's asymmetric mass and connected slopes with Candidate B's open central valley, river legibility, and meadow allowance.
- Adds an art-directed chain of major peaks, shoulders, spurs, drainage-scale erosion channels, and a carved rear valley.
- Uses broad control fields and guide curves, not high-frequency procedural noise.
- Selected because it preserves the fixed Journey V1 camera/path while reading as a multi-slope 3D landscape rather than a cone or background plate.

Candidate A and B remain under `V3_MACRO_ALTERNATIVES`, hidden and `export_enabled=false`. The Hybrid occupies `V3_MACRO_SELECTED`.

## Collection structure

```text
V3_ENVIRONMENT_WORK
├── V3_MACRO_SELECTED
├── V3_MACRO_GUIDES
├── V3_ZONE_GUIDES
└── V3_MACRO_ALTERNATIVES
    ├── V3_MACRO_CANDIDATE_A
    └── V3_MACRO_CANDIDATE_B
```

The five Phase 1B reference/camera/guide Collections remain separate and unchanged.

## Selected macro objects

| Object | Role | Vertices | Polygons |
| --- | --- | ---: | ---: |
| `V3_HERO_MASSIF` | rear hero massif | 2,584 | 2,479 |
| `V3_LEFT_RIDGE` | left ridge and connected slope | 3,348 | 3,233 |
| `V3_RIGHT_RIDGE` | right ridge and connected slope | 3,348 | 3,233 |
| `V3_MIDGROUND_RIDGES` | layered midground ridges | 672 | 605 |
| `V3_FAR_RIDGES` | far-range guard-band ridges | 1,008 | 923 |
| `V3_VALLEY_FLOOR` | continuous valley floor | 300 | 240 |
| `V3_RIVERBED_PROXY` | graded riverbed proxy | 245 | 204 |
| `V3_LEFT_RIVERBANK_PROXY` | left bank proxy | 175 | 136 |
| `V3_RIGHT_RIVERBANK_PROXY` | right bank proxy | 175 | 136 |
| `V3_MEADOW_BASE` | future flower-meadow terrain | 368 | 308 |

All mountain/terrain objects carry `bedrock_deformable=false` and `wind_deforms_geometry=false`. Wind is represented only as a future vegetation mask.

## Valley, river, meadow, and erosion guides

- `GUIDE_RIVER_CENTERLINE`
- `GUIDE_LEFT_BANK_BOUNDARY`
- `GUIDE_RIGHT_BANK_BOUNDARY`
- `GUIDE_VALLEY_LEFT`
- `GUIDE_VALLEY_RIGHT`
- `GUIDE_MEADOW_BOUNDARY`
- `GUIDE_EROSION_LEFT_01` through `03`
- `GUIDE_EROSION_RIGHT_01` through `03`

The riverbed descends toward the foreground and stays below both banks. Width changes across ten stations and the centerline bends through the valley without climbing the mountain. The meadow extends across the lower frame with gentle macro undulation and retains a separate river-exclusion mask.

## Zone attributes

Every selected mesh contains named point attributes:

- `ROCK`
- `GRASS`
- `FOREST`
- `SNOW`
- `WET`
- `FLOWER_POTENTIAL`
- `RIVER_EXCLUSION`
- `WIND_REACTIVE_VEGETATION`

The masks combine elevation, cross-slope position, drainage/erosion proximity, aspect, valley/river proximity, and art-directed terms. They are not height-only horizontal bands. The diagnostic Zone Review uses dominant-face colors; the underlying floating-point attributes remain available for later WebGL integration.

`WIND_REACTIVE_VEGETATION` marks only future grass, flower, shrub, canopy, and mountain-vegetation regions. It does not authorize deformation of rock, terrain, ridge, riverbed, bank, cave, camera, or ground geometry.

## Diagnostic materials and lighting

- `MAT_V3_CLAY_REVIEW`: neutral clay, no texture/fog/bloom.
- Zone materials: diagnostic colors for the eight zone attributes; not final Journey colors.
- One directional diagnostic Sun plus a low-strength World light reveals broad plane changes and valley depth without final look development.
- Render setting: Eevee, `1440 × 900`, 100%, square pixels.

## Camera Sweep and guard-band findings

All 13 comparison cameras were reviewed: Cave Exit, Day Clear Start, Day Clear Late, and the ten Phase 1B sweep cameras.

- Minimum mountain-vertex distance across all cameras: `69.9331050375` Blender units, at progress `20`.
- Day Clear Start/Late minimum mountain distance: `73.7915530413` units.
- Visible riverbed samples remain present at every review camera (`213–228`).
- The meadow reaches the lower roughly `20–25%` of the Day Clear projection.
- The broad terrain does not intersect the camera path or frustums.
- The cave-to-day contact sheet shows continuous parallax without a sudden mountain pop, a one-plane read, or frame-edge termination.
- The central valley/river sightline stays open through Day Clear.

The automatic sky-fraction sample is conservative because it measures the highest visible mountain vertex, not the continuous silhouette; visual review is the authority for the requested approximate composition.

## Improvement cycles

### Cycle 1 findings

1. A/B ridge silhouettes were too smooth and read as rounded hills.
2. Rear ridge bases formed high floating bands across the valley.
3. The diagnostic light/material setup obscured zone distinctions.

### Cycle 2 corrections

1. Added multiple large peaks, shoulders, spurs, and drainage-aligned erosion channels to the Hybrid, without high-frequency detail.
2. Carved a continuous central valley into the rear mass; lowered mid/far ridge bases into the terrain; faded side-mountain edges into the valley floor.
3. Reduced diagnostic Sun energy and made zone rendering independent of localized Blender node names.

The second cycle changes silhouette, valley connectivity, and slope thickness; it is not a noise-only revision.

## Reference interpretation

- Montfort: asymmetric primary mass, broad connected faces, large drainage lines, rear-ridge layering, and perceived scale.
- Hero Valley: open central valley, readable river leading line, foreground meadow allowance, and sky/terrain balance.
- Kamikochi: graded riverbed and banks, restrained natural slope transitions, plausible wet/forest relationship, and a path toward Japanese vegetation character.
- Not adopted: Montfort terrain duplication, Hero Valley image plane, a central cone/pyramid, a single noisy height field, floating background ridges, or camera adjustment.

## Comparison renders

Required outputs are in this directory:

- Candidate A: Cave Exit Clay, Day Clear Clay, Day Clear Zones.
- Candidate B: Cave Exit Clay, Day Clear Clay, Day Clear Zones.
- Selected: Cave Exit Clay, Day Clear Start/Late Clay, Day Clear Zones.
- Ten raw selected Camera Sweep frames.
- `selected-camera-sweep-contact-sheet.png`.
- `selected-silhouette-overlay.png` (50% V1 browser/selected macro overlay).
- `phase-1c-candidate-comparison-contact-sheet.png`.
- `phase-1c-reference-comparison-contact-sheet.png`.

## Reproducibility

Authoritative scripts:

- `scripts/blender/journey_v3_macro_config.py`
- `scripts/blender/build_journey_v3_macro_massing.py`
- `scripts/build_journey_v3_massing_comparisons.mjs`
- `scripts/build_journey_v3_phase1c.mjs`

Rebuild command:

```text
node scripts/build_journey_v3_phase1c.mjs
```

Two additional clean builds were written to `work/blender/journey-v3/phase1c/repro-a` and `repro-b`. After excluding destination-specific `outputBlend`/`renderedFiles`, their validation JSON is byte-identical to the final validation. All three deterministic signatures are `c24b11880919d65770e2d7c9c5b4259949db5117d6aec16d2011dfda5c559946`.

## Remaining Phase 1D work and constraints

- Human art-direction approval is still required before runtime integration.
- The macro geometry intentionally lacks final rock fracture, talus, vegetation geometry, snow detail, river water, and production shading.
- Zone boundaries are deliberately coarse and must be refined during look development.
- The old Journey V1 environment remains visible at runtime; the replacement map is planning-only until the V3 integration phase.
- No public GLB was generated and no `/journey-v3` runtime code was changed.
- Phase 1D may proceed only after approval of the macro silhouette, valley width, river course, and meadow allocation.
