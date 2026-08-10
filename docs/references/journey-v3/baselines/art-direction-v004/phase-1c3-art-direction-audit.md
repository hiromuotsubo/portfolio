# Journey V3 Phase 1C.3 — art-direction candidates M and H

## Status

Phase 1C.3 produced two human-review candidates. Neither is selected. No Hybrid was created, Phase 1D was not started, Journey V1 and the Journey V3 runtime were not changed, and no public GLB was generated.

## Source and preserved foundation

- Source Blend: `/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1c2/journey-v3-volumetric-terrain-v003.blend`
- Source SHA-256 before/after both builds: `e4341be717e17791d4988ea919c33443e3fbc1e3dcecee0797224b74a2bfb362`
- Preserved: continuous height field, cave-exit connector, cave-to-meadow transition, terrain skirt/bottom, world origin/scale, locked V1 spatial reference, fixed browser-final camera baselines, Camera Sweep, full-story cameras, and reproducible build pipeline.
- Locked reference signature was identical before and after each build.
- Cave connector maximum seam distance: `0.0` world units for M and H.
- Core-cave triangle intersections: none for M and H.

## Cause of v003 roundness

v003 used `oriented_gaussian()` and `connected_field()` as its dominant mountain construction. Broad Gaussian point fields were max/add blended with equal smoothing. That solved the v002 curtain topology, but point-centric isotropic-looking summit influence produced dome/blob silhouettes and weakened authored ridge continuity.

Phase 1C.3 retains a height field but changes the landform hierarchy:

1. finite anisotropic 2D mountain footprints with piecewise planar/slope-break profiles;
2. authored main and secondary ridge polylines;
3. explicit shoulders and lowered saddle control points;
4. directional spurs connecting crest to valley;
5. connected drainage subtraction aligned toward the valley;
6. a separately cleared valley corridor and continuous riverbed.

The ridge field articulates broad mountain footprints; it is not the sole mountain surface. No silhouette sheet, Solidify repair, background plate, or high-frequency noise is used.

## Candidate M — Montfort dominant

Blend:

`/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1c3/journey-v3-art-direction-candidate-m.blend`

SHA-256: `5ea9ea2635dd44687bd515d8b013e70eb1a2d310692b6d2926f9bb92ed1e45ce`

Design:

- A near, dominant left massif with a long diagonal main ridge.
- Three overlapping left footprints give the massif depth and prevent a single-ribbon profile.
- Two shoulders, a lowered saddle, upper/lower spurs, drainage cuts, and broad/steep slope transitions.
- The opposite side uses two lower, receding ridge/mass layers.
- Seven overlapping distant footprint fields maintain a range without closing the central valley.
- Day Clear projected mountain height: `570.95 px`; Final Wide: `486.01 px` (14.9% reduction).
- Day Clear diagnostic sky fraction: `35.11%`; Final Wide: `42.11%`.

This is the stronger perceived-scale and asymmetric mass option. Its main review risk is that the left face remains extremely dominant and may need a later art-directed slope break after a human choice.

## Candidate H — Hero Valley dominant

Blend:

`/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1c3/journey-v3-art-direction-candidate-h.blend`

SHA-256: `c27c6d001ea9900de896a0fd9f0aaab1768d6a101838b247e74cf3c3d45dfd58`

Design:

- A broader central valley with left/right masses receding toward the background.
- Eight uneven distant footprint fields and two connected range guides create a multi-peak skyline.
- Peak spacing and height are deliberately irregular; the valley is open without becoming a blank center.
- The foreground river has a larger, opposite-handed S curve than M.
- Day Clear projected mountain height: `396.44 px`; Final Wide: `343.08 px` (13.5% reduction).
- Day Clear diagnostic sky fraction: `41.98%`; Final Wide: `48.18%`.

This is the stronger valley/river/readable-range option. Its main review risk is that mountain scale is materially lower than M and below the requested 25–32% sky target in the clean diagnostic mask.

## River and meadow

- Each candidate uses one continuous riverbed in the same height field.
- M centerline bends right and then left; H uses a wider left-then-right S. Both have gradual changes and no 90-degree turn.
- The riverbed is subtracted from the valley floor and narrows from foreground to background.
- `candidate-*-river-projection.png` records the actual Day Clear projection of the centerline.
- The meadow is the continuous near portion of the same terrain. It uses only low-frequency relief and a small bank-directed slope; it is not a separate rectangular plane.
- No flowers, vegetation, water surface, PBR look development, or wind were added.

## Review cameras and story behavior

- Top cameras are orthographic and frame the full terrain bounds with 10–15% margin. They display terrain bounds, axes, cave bounds, camera path, river, and ridge guides.
- Side cameras frame full depth and height and distinguish the skirt/bottom.
- Orbit cameras target the terrain-bounds center at ±30 degrees, not the Day Clear camera position.
- Elevated cameras show terrain footprint, valley, river, cave location, and ridge system together.
- Full-story sheets include Cave Exit, Day Clear, Sunset, Night, River HOLD, Milky Way, Seated Figure, Final Wide, and Ending using the validated browser-final cameras.
- Day Clear→Final Wide changes are present in both candidates: mountain projected height falls by 84.94 px for M and 53.36 px for H, while the diagnostic sky fraction increases by 7.00 and 6.20 percentage points respectively.

Journey V1 browser images are also measured. Because the PBR browser frame has no semantic mountain mask, its RGB-derived values in `screen-space-measurements.json` are explicitly marked approximate and are not treated as ground truth geometry masks.

## Cave-frame provenance

At progress 11.5, toggling all locked cave geometry caused zero changed pixels; toggling the old Journey V1 terrain/environment changed 85.592% of pixels. Scene FogExp2 and DOM `cave-grade` strongly affect tone but do not create the 3D edge. See `cave-frame-provenance-audit.md` and the toggle contact sheet.

Conclusion: do not move the cave. The expected frame depends on old environment geometry that a later V3 integration intends to replace, so the opening composition requires a dedicated V3 transition solution after candidate selection.

## Geometry budget

Both candidates intentionally retain the v003 authoring grid:

- grid: 210 × 236, step 6 world units;
- mesh objects: 6;
- vertices: 53,043 total;
- triangles: 103,496 total;
- boundary edges: 2,576 across open terrain/connectors/skirt components;
- estimated uncompressed geometry payload: 4,015,728 bytes (3.830 MiB), excluding GLB container/material overhead and compression;
- largest object: 38,220 vertices, so 16-bit indices are sufficient per current mesh primitive;
- Blender maximum RSS observed: M 469,598,208 bytes; H 464,060,416 bytes.

Near, mid, far, river, and meadow currently share the same 6-unit authoring density. This deliberately defers optimization until a human selects M or H.

Two clean non-rendering regenerations produced identical stable structural signatures:

- M: `988b6297ba6f60d5cf2582a8c5396922346fbaa24a0ce13b6ccb7450ab7ad815`
- H: `0d24025ae4d472c21726f848680137c451276be06c5990f1db83e1c25aaef04b`

## Proposed LOD strategy after selection

- Keep a high-resolution authoring terrain for sculpt/bake source only.
- Split runtime terrain into near (meadow/river/cave transition), mid (dominant masses and banks), and far (distant range) tiles with stable world-space seams.
- Desktop: retain near silhouettes/river density, reduce mid density approximately 2×, far density approximately 4×; preserve ridge and skyline control vertices.
- Mobile: reduce near density approximately 2×, mid approximately 4×, and far approximately 6–8×, subject to fixed-camera silhouette error checks.
- Use shared border samples or skirts plus locked border vertices to prevent LOD cracks.
- Bake only high-frequency erosion and normal information after the macro candidate is approved; do not bake away silhouette, drainage, bank, or meadow relief.
- Measure pixel-space silhouette error at all fixed cameras before accepting an LOD.

## Reproduction

```text
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/build_journey_v3_art_direction_candidate.py -- --candidate M
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/build_journey_v3_art_direction_candidate.py -- --candidate H
node scripts/capture_journey_v3_phase1c3_browser_audit.mjs
node scripts/build_journey_v3_phase1c3_comparisons.mjs
```

## Required comparison outputs

- `candidate-m-day-clear-clay.png`, `candidate-m-day-clear-silhouette.png`, `candidate-m-cave-exit.png`, `candidate-m-final-wide.png`, `candidate-m-top-view.png`, `candidate-m-side-view.png`, `candidate-m-orbit-left.png`, `candidate-m-orbit-right.png`, `candidate-m-elevated.png`, `candidate-m-river-projection.png`, `candidate-m-full-story-sweep.png`
- the corresponding eleven Candidate H files
- `candidate-m-vs-h-day-clear.png`
- `candidate-m-vs-h-silhouette.png`
- `candidate-m-vs-h-final-wide.png`
- `candidate-m-vs-h-top-side.png`
- `montfort-hero-v003-m-h.png`
- `geometry-budget.json`
- `screen-space-measurements.json`

## Remaining uncertainties

- M/H require human visual selection; no automatic choice is made.
- M may be too dominant/steep on the left, while H may still feel too open and low relative to Hero Valley.
- Macro forms remain clay-stage geometry; no conclusion about final rock/vegetation integration is possible yet.
- The progress-11.5 opening frame depends on old environment geometry, so replacement-transition design must be resolved before hiding the old terrain in runtime.
- Runtime LOD, final masks, erosion, materials, vegetation, river water, atmosphere, and wind remain future work.
- Local browser capture also reproduced the pre-existing React warning/error about `JourneyLoadBridge` being updated while `JourneyScene` renders. Phase 1C.3 did not modify runtime code; the issue is recorded for a later runtime-focused phase.
