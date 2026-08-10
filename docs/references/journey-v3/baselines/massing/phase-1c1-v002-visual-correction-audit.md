# Journey V3 Phase 1C.1 — Macro Massing Visual Correction Audit

## Status and scope

Archive disposition: **composition improved, but volumetric terrain structure
and cave continuity rejected**. This is a local pre-rebuild archive, not an
approved visual or structural baseline for Phase 1D.

Phase 1C v001 is preserved as a **Technical pass / Visual rejected** checkpoint.
Its Blend and tracked renders were not overwritten or deleted.

Visual-rejection reasons recorded for v001:

- canyon-wall composition
- inflated smooth mountain forms
- isolated needle peak
- insufficient distant mountain range
- weak river leading line
- flat foreground planes
- artificial zone boundaries

Phase 1C.1 creates v002 only. It does not change Journey V1, the Journey V3
runtime, public GLBs, cameras, story progression, HOLD behavior, UI, sound, PBR
materials, vegetation, flowers, wind, water shaders, fog, sunset, or night.

## Files and provenance

- Protected v001 Blend:
  `/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1c/journey-v3-macro-massing-v001.blend`
- Protected v001 SHA-256:
  `6af3e6a666293a924e915ee3d374a241467c8eb2647753346af3347d612aa920`
- New v002 Blend:
  `/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1c/journey-v3-macro-massing-v002.blend`
- v002 SHA-256:
  `9bc96a17b6aee6c09a59fdc77bc05083197fd9be9d2aab10c8585f4642e13237`
- v002 size: `13,748,448 bytes`
- Phase 1B input Blend SHA-256:
  `bde155848309f8141b4535b7590788db6ce86068bd9b1a73384d6971ca19f58e`
- Blender: `5.2.0 LTS` (`fbe6228777e7`)
- Structure validation:
  `docs/references/journey-v3/baselines/massing/phase-1c1-v002-structure-validation.json`
- Deterministic structure signature:
  `05e5e5bc087af9b6b7831f8bfb7bf5265c1d6c0652839f1a854d2f40cb76329e`

The Phase 1B locked-reference signature is identical before and after the
build. Two clean `--skip-renders` rebuilds produced the same structure
signature. The minimum sampled mountain-to-camera distance across the fixed
browser-final camera set is `120.1027885` world units.

## Reference priority

1. Journey V1 fixed browser-final camera, camera path, Cave Exit, continuous
   3D space, story, UI, and sound.
2. Montfort: macro mass, asymmetry, connected ridge/shoulder/slope structure,
   perceived scale, and room for later rock/vegetation integration.
3. Hero Valley: open valley, distant range, S-shaped river leading line,
   meadow allocation, and broad composition. The image is not used as a
   background plane or texture.
4. Kamikochi: believable valley/river relationship, restrained natural scale,
   vegetation logic, moisture, and atmospheric depth for later phases.

## Candidate A2 — Montfort-dominant asymmetric valley

A2 deliberately places a close, high left dominant massif against receded
right-hand ridges. It uses a diagonal valley, broad shoulders, slope breaks,
three connected drainage channels, and a large future rock-face zone. Its
silhouette is intentionally much heavier than B2.

Review result: A2 proves the Montfort massing direction but remains too
dominant at the left edge for the selected Journey composition. It was not
selected unchanged.

## Candidate B2 — Hero Valley open range

B2 moves both side ranges deeper, widens the valley and meadow, expands the
single river corridor, and emphasizes the central/distant ranges. Its
silhouette is lower, wider, and visibly distinct from A2.

Review result: B2 provides the required openness and river readability, but
its side mountains alone understate the Montfort sense of weight. It was not
selected unchanged.

## Selected Hybrid v002

Selected v002 uses B2's open valley as the base and reintroduces a receded,
Montfort-derived left dominant shoulder. The right range begins farther back,
so both sides no longer form equal canyon walls. Two separately modeled,
depth-bearing central ranges span the horizon, leaving a broad central saddle
rather than an empty gap or narrow slit.

The linear tent peaks that produced the v001 needle were replaced by broad
zero-slope crest profiles. The macro forms contain authored shoulders, main
and secondary ridges, saddles, low-frequency slope breaks, planar face zones,
steep faces, receding ridges, and connected drainage cuts. No fine rock noise
was added.

Selected objects:

- `V3_V002_PRIMARY_MASSIF`
- `V3_V002_OPPOSING_RIDGES`
- `V3_V002_MIDGROUND_RANGE`
- `V3_V002_DISTANT_RANGE`
- `V3_V002_VALLEY_FLOOR`
- `V3_V002_MEADOW_BASE`
- `V3_V002_RIVERBED_PROXY`
- `V3_V002_LEFT_RIVERBANK_PROXY`
- `V3_V002_RIGHT_RIVERBANK_PROXY`

The nine selected objects contain separate near shoulder, midground ridge,
distant range, valley, meadow, riverbed, and bank responsibilities. A2 and B2
remain hidden and export-disabled in the alternatives collection.

## River, meadow, and zones

The river is one continuous depressed riverbed, not parallel strips. Ten
authored stations produce a shallow S curve; width tapers from foreground to
distance, elevation rises upstream, and each bank has independent irregular
offset and height. `GUIDE_V002_RIVER_CENTERLINE`, `GUIDE_V002_LEFT_BANK`, and
`GUIDE_V002_RIGHT_BANK` are rendered with a legend.

The meadow is a single connected grid with low rolling relief, small authored
depressions/rises, a slight river-facing grade, irregular banks, and river
exclusion. It occupies the lower review frame without hiding the river. No
flower object was created.

Zone review blends ROCK, GRASS, FOREST, SNOW, WET, FLOWER_POTENTIAL, and
RIVER_EXCLUSION from elevation, slope proxy, curvature/slope breaks,
drainage, valley/river distance, moisture/aspect, and art-direction fields.
It no longer uses v001's repeated sawtooth boundary. The diagnostic legend
also identifies WIND_REACTIVE_VEGETATION; that mask includes only future
grass, flower, shrub, canopy, and mountain vegetation, never bedrock, ridge,
terrain, cave, riverbed, banks, camera, or ground deformation.

## Cave composite and Camera Sweep

Review cameras are the unchanged Phase 1B browser-final cameras. Clean macro
renders exist for the ten sweep progress values:

`11.5, 12, 13.5, 16, 20, 22, 23.5, 25, 28.25, 30`.

They show continuous parallax, no sudden mountain pop, no camera-corridor
entry, and a gradual change from a restricted threshold view to the open
valley. The river remains visible at every sampled camera. No camera value was
altered.

The imported spatial-reference cave meshes have no vertices inside the
browser-final Cave Exit frame at progress 11.5 after glTF-to-Blender
conversion; therefore a Blender-only Clay render cannot faithfully reproduce
the runtime cave fade/framing. For the required real-scene check, the existing
Journey V3 parity runtime was captured deterministically at progress
`11.5, 13.5, 16, 20, 30`, with neutral pointer and frozen runtime. Those
Journey V1 cave/story frames are composited at 32% over the matching clean
v002 macro renders. This diagnostic shows the existing cave threshold and its
release while keeping the clean macro renders as the visual acceptance basis.
It is not a Hero Valley background and is not used as runtime content.

Result: at 11.5 and 13.5 the cave edge frames the external world without a
mountain blocking the opening; at 16 the restricted-to-open contrast remains;
at 20 the cave release exposes the valley; at 30 the clean Day Clear
composition is unobstructed.

### True 3D audit supplement

The browser-layer composite above is valid only as a composition diagnostic;
it is not evidence that the locked cave and v002 surfaces join in one Blender
space. The follow-up True 3D audit in
`true-3d-cave/true-3d-cave-audit.md` renders the actual meshes together and
supersedes any spatial-continuity implication of the image composite. It finds
no cave/v002 triangle intersections, but it finds a `1.84–2.22` world-unit
cave-floor seam and a cave-shell occlusion entering at progress 28.25/30.
Phase 1D must remain blocked until those findings are resolved without moving
the fixed cameras or editing the locked cave reference.

## Required comparison renders

Candidate A2:

- `candidate-a2-day-clear-clay.png`
- `candidate-a2-cave-composite.png`
- `candidate-a2-silhouette.png`
- `candidate-a2-top-view.png`

Candidate B2:

- `candidate-b2-day-clear-clay.png`
- `candidate-b2-cave-composite.png`
- `candidate-b2-silhouette.png`
- `candidate-b2-top-view.png`

Selected v002:

- `selected-v002-day-clear-clay.png`
- `selected-v002-day-clear-zones.png`
- `selected-v002-day-clear-river-guides.png`
- `selected-v002-cave-composite.png`
- `selected-v002-camera-sweep-contact-sheet.png`
- `selected-v002-silhouette.png`
- `selected-v002-top-view.png`
- `selected-v002-side-view.png`

Comparisons:

- `phase1c-v001-vs-v002-contact-sheet.png`
- `montfort-hero-v001-v002-comparison.png`

All paths above are under
`docs/references/journey-v3/baselines/massing/`. The clean Clay render, not
the Cave Composite or runtime overlay, is the primary macro-form evidence.

## Reproduction

Full local rebuild:

```text
node scripts/build_journey_v3_phase1c1.mjs
```

Blender geometry/render build only:

```text
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/build_journey_v3_macro_massing_v002.py -- --selected V002
```

Runtime cave/story captures and comparison sheets:

```text
node scripts/capture_journey_v3_phase1c1_cave.mjs
node scripts/build_journey_v3_phase1c1_comparisons.mjs
```

## Remaining uncertainty

- v002 is a macro visual correction, not a final terrain model. Its large
  planar faces and drainage need Phase 1D-level sculpt/detail only after human
  visual approval.
- The central range is intentionally broad and continuous; exact peak rhythm
  may need one later art-direction pass, without changing the camera.
- The Cave Composite depends on captured runtime cave/story appearance because
  Blender Clay does not reproduce the runtime cave fade/material treatment.
- River hydraulics, bank geology, final meadow micro-relief, and final zone
  masks remain intentionally unresolved.

Phase 1D has not started. No commit or push is part of Phase 1C.1.
