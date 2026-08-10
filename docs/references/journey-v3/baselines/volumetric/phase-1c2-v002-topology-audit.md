# Journey V3 Phase 1C.2 — v002 Topology and Cave Input Audit

## Disposition

v002 remains archived and unmodified. This audit confirms that its render composition improved over v001, but its mountain construction is not an acceptable volumetric terrain base.

- source SHA-256 before: `9bc96a17b6aee6c09a59fdc77bc05083197fd9be9d2aab10c8585f4642e13237`
- source SHA-256 after: `9bc96a17b6aee6c09a59fdc77bc05083197fd9be9d2aab10c8585f4642e13237`
- source unchanged: `True`

## Object topology

| Object | Generator | Verts / Faces | Boundary / non-manifold | Closed | Width | Camera depth | Footprint area | Classification |
| --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| `V3_V002_DISTANT_RANGE` | `distant_range()` | 1872 / 1751 | 240 / 240 | False | 699.741 | 145.562 | 84912.000 | shallow ridge strip, background curtain, camera-facing sheet |
| `V3_V002_LEFT_RIVERBANK_PROXY` | `river_objects()` | 250 / 196 | 106 / 106 | False | 62.472 | 401.447 | 13078.457 | narrow ribbon terrain |
| `V3_V002_MEADOW_BASE` | `continuous_ground()` | 1786 / 1702 | 166 / 166 | False | 341.818 | 234.055 | 72859.092 | rectangular terrain patch |
| `V3_V002_MIDGROUND_RANGE` | `distant_range()` | 1872 / 1751 | 240 / 240 | False | 623.310 | 128.989 | 66960.000 | shallow ridge strip, background curtain, camera-facing sheet |
| `V3_V002_OPPOSING_RIDGES` | `side_range()` | 4256 / 4125 | 260 / 260 | False | 243.097 | 286.099 | 61663.496 | profile extrusion, ribbon terrain, open height-field patch |
| `V3_V002_PRIMARY_MASSIF` | `side_range()` | 4256 / 4125 | 260 / 260 | False | 246.875 | 294.788 | 64589.548 | profile extrusion, ribbon terrain, open height-field patch |
| `V3_V002_RIGHT_RIVERBANK_PROXY` | `river_objects()` | 250 / 196 | 106 / 106 | False | 48.331 | 402.458 | 12879.581 | narrow ribbon terrain |
| `V3_V002_RIVERBED_PROXY` | `river_objects()` | 650 / 588 | 122 / 122 | False | 78.920 | 402.683 | 21423.059 | open terrain surface |
| `V3_V002_VALLEY_FLOOR` | `continuous_ground()` | 1504 / 1426 | 154 / 154 | False | 378.743 | 250.296 | 88128.839 | rectangular terrain patch |

## Why v002 reads as strips and curtains

- `side_range()` repeats one normalized cross-slope profile through Y and only modulates that profile with `peak_chain()`. The result has plan area, but its macro silhouette is governed by a repeated profile extrusion rather than independently authored depth cross-sections.
- `distant_range()` uses only 18 depth rows across a very wide X span and a shared `sin(pi * depth)` profile. This produces shallow camera-facing ridge strips and repeating arch-like side silhouettes.
- `continuous_ground()` creates separate rectangular meadow and valley patches. River and banks are additional ribbons, so their plan-view separation reads as layered patches instead of one carved terrain surface.
- Every selected v002 surface is open and has boundary/non-manifold edges. None provides a closed terrain skirt for Final Wide or oblique inspection.
- Adding Solidify would only thicken these existing profiles; it would not create new mountain footprints, drainage topology, or independent depth sections.

## Cave visibility and transform classification

Runtime-classified cave objects: `7`.
Objects omitted from the previous True 3D review: `[]`.
Previously shown objects not classified by the runtime cave rule: `[]`.

Journey V1/Journey V3 parity runtime applies `cavePresence = 1 - smoothstep(13.5, 20.2, progress)`, sets cave visibility from `cavePresence > 0.004`, multiplies material opacity by cavePresence, and disables depth writing after cavePresence falls below 0.18.

The machine-readable JSON records every cave object's `matrixWorld`, `matrixLocal`, parent chain, and bounds. No source transform is changed by this audit.

## Required v003 response

v003 must replace repeated profile strips with one carved height-field terrain volume spanning the camera-frustum union, including skirts/bottom closure, an actual river channel, an irregular meadow, and V3-only cave-exit connector geometry. Geometry-only continuity and runtime-equivalent cave visibility must be reviewed separately.
