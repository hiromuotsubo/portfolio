# Journey V3 Phase 1C.2 — Volumetric Terrain v003 Audit

## Disposition

Phase 1C.2 replaces the rejected v002 profile sheets with a reproducible, continuous Blender height-field terrain. It is a macro-structure and camera-safety baseline only. It does not authorize Phase 1D, runtime integration, PBR, vegetation, flowers, wind, water shading, fog, or time-of-day work.

- output Blend: `/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/work/blender/journey-v3/phase1c2/journey-v3-volumetric-terrain-v003.blend`
- output Blend SHA-256: `e4341be717e17791d4988ea919c33443e3fbc1e3dcecee0797224b74a2bfb362`
- Blender: `5.2.0 LTS` (`fbe6228777e7`)
- v002 input SHA-256 before/after: `9bc96a17b6aee6c09a59fdc77bc05083197fd9be9d2aab10c8585f4642e13237`
- v002 input unchanged: yes
- locked-reference signature unchanged: yes
- final deterministic structure signature: `483c571d0f90ef76620ea586e2ed06d4085952b00a0ace738a26200ec60c8ab5`
- two independent clean builds produced the same structure, object records, region footprints, cave connector record, and deterministic signature

## v002 topology conclusion

The detailed source audit is in `phase-1c2-v002-topology-audit.md` and its JSON companion.

- `side_range()` repeated one normalized cross-slope profile through camera depth. The primary and opposing mountains were profile extrusions/ribbon terrain.
- `distant_range()` used only 18 depth rows and the same `sin(pi * depth)` cross-section. The mid/far mountains were shallow camera-facing strips/background curtains.
- meadow, valley, riverbed, and banks were independent rectangular/ribbon patches.
- all nine selected v002 surfaces were open; none supplied a Final Wide terrain guard.
- Solidify would only thicken the rejected sheets and therefore was not used.

## v003 terrain method

v003 uses one authored analytic height field across a `1240 × 1400` world-unit domain (`x=-620..620`, `y=-300..1100`) with a six-unit base grid. It is built from:

1. broad, rotated summit and shoulder fields with finite two-dimensional footprints;
2. independently placed left-dominant, right-midground, and distant-range fields;
3. broad spur curves connecting summits to valley-facing shoulders;
4. authored drainage curves subtracted along plausible downslope directions;
5. a widening valley distance field;
6. one continuous S-curve river centerline with a depressed riverbed;
7. low-frequency near-field meadow relief;
8. an outer skirt and bottom guard extending behind the final camera.

No camera-facing profile sheet, background plate, repeated arch section, Solidify-only fix, high-frequency noise disguise, or image projection is used.

## Terrain objects and semantic regions

Physical meshes:

- `V3_VALLEY_TERRAIN` — continuous mountain/valley/river/meadow height-field surface
- `V3_CAVE_EXIT_TRANSITION_TERRAIN` — near/cave-side portion of the same analytic field
- `V3_TERRAIN_SKIRT_AND_BOTTOM` — Final Wide/open-edge guard
- `V3_CAVE_EXIT_FLOOR_CONNECTOR` — locked cave-floor seam to the broad transition ring
- `V3_CAVE_TO_MEADOW_TRANSITION` — transition ring to analytic meadow/river terrain
- `V3_CAVE_FADE_REPLACEMENT_FLOOR` — V3-only floor shown only after runtime cave fade

Named region attributes on the terrain:

| Region | Width | Camera-depth | Plan bounding area |
| --- | ---: | ---: | ---: |
| `V3_LEFT_DOMINANT_MASSIF` | 648 | 1082 | 701136 |
| `V3_RIGHT_MIDGROUND_RIDGES` | 598 | 1082 | 647036 |
| `V3_DISTANT_MOUNTAIN_RANGE` | 1240 | 540 | 669600 |
| `V3_RIVERBED` | 84 | 1082 | 90888 |
| `V3_MEADOW_TERRAIN` | 1240 | 176 | 218240 |

These are attributes/regions of a continuous terrain, not separate mountain cards. Top, side, elevated, and ±30-degree orbit reviews show plan area and multiple depth sections. The v003 mountain surface does not terminate as the repeated arches seen in v002.

## Day Clear composition

- one near, dominant left massif enters from the frame edge;
- the right side is a more distant sequence of shoulders rather than a mirrored wall;
- the center is kept as a broad river/valley pass;
- nine non-uniform distant summit fields form a laterally connected range;
- the river remains one visible S-curve from foreground to the central pass;
- the near ground is continuous and gently relieved rather than separate meadow planes.

The clay result is deliberately macro-scale. Montfort informs the connected mass, asymmetry, shoulders, slope continuity, and perceived scale. Hero Valley informs the open center, river leading line, foreground meadow allocation, and multi-layer range. Neither reference is used as a background image.

## Cave cause classification and continuity

The seven Journey runtime cave objects and the seven objects used by the previous True 3D review are identical; no runtime-classified cave object was omitted. Their parent chains are empty and their stored transforms match the locked import. The runtime control is:

`cavePresence = 1 - smoothstep(13.5, 20.2, progress)`

The cave is visible while `cavePresence > 0.004`, material opacity is multiplied by `cavePresence`, and depth writing stops once presence is below `0.18`.

Classification:

1. omitted cave geometry: none;
2. runtime opacity/fade: confirmed and reproduced in the runtime-equivalent review;
3. object/parent transform mismatch: not found;
4. real geometry issue: the v002 cave-floor/riverbed gap was real and is replaced by V3-only connector terrain;
5. progress 28.25/30 raw-geometry re-entry: correct fade-dependent re-entry; it is absent in runtime-equivalent renders because the runtime cave is already hidden.

v003 continuity results:

- the nine locked `CAVE_HQ_GROUND` exit vertices are copied without changing the source object;
- connector seam minimum/maximum distance: `0 / 0` world units;
- core cave versus v003 connector/terrain triangle intersections: `0`;
- the former `1.842–2.218` unit void is closed;
- geometry-only and runtime-equivalent visibility are rendered separately;
- after cave fade, a slightly overlapping V3-only replacement floor prevents a sub-pixel hole without moving or modifying locked cave geometry;
- the browser's expected progress-11.5 opening silhouette is still not reproduced by these seven raw cave objects alone. Because inclusion and transforms are verified, this is retained as a runtime-composition/reference limitation rather than “fixed” by moving the locked cave. The browser silhouette may include legacy environment/fog contribution beyond the runtime cave-name set and must be isolated before any cave-authoring decision.

## Full-story camera review

The final browser cameras for `sunset`, `night`, `river-hold`, `milky-way`, `seated-figure`, `final-wide`, and `ending` were captured with neutral pointer/frozen runtime and imported through a camera-only glTF. No camera position, quaternion, FOV, or lens was adjusted in Blender.

The diagnostic sweep shows:

- no exposed mountain back face or camera-facing sheet;
- no visible terrain side/bottom/open edge at Final Wide or Ending;
- no terrain penetration into the fixed camera path;
- the terrain remains a single landscape from all story cameras;
- the seated-figure/story review retains the reference story object only for interference checking.

## Required diagnostic outputs

- `v003-day-clear-clay.png`
- `v003-day-clear-wireframe.png`
- `v003-top-view.png`
- `v003-top-view-wireframe.png`
- `v003-side-view.png`
- `v003-side-view-wireframe.png`
- `v003-orbit-left-30.png`
- `v003-orbit-right-30.png`
- `v003-elevated-three-quarter.png`
- `v003-cave-true-3d-contact-sheet.png`
- `v003-cave-to-day-camera-sweep.png`
- `v003-full-story-camera-sweep.png`
- `v003-final-wide.png`
- `v002-vs-v003-top-side-comparison.png`
- `montfort-hero-v002-v003-comparison.png`

Individual geometry-only, runtime-equivalent, cave-to-day, and story frames are stored under `volumetric/diagnostic/`.

## Regeneration

```sh
node scripts/capture_journey_v3_full_story_camera.mjs
node scripts/build_journey_v3_phase1c2_camera_gltf.mjs
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/build_journey_v3_volumetric_terrain_v003.py
node scripts/build_journey_v3_phase1c2_comparisons.mjs
```

For a structure-only deterministic rebuild, add `-- --skip-renders --output <blend> --validation-output <json>` to the Blender command.

## Remaining uncertainty / hold before Phase 1D

- The progress-11.5 browser cave-opening silhouette is not explained by the seven raw runtime cave objects alone. Do not move the locked cave; first isolate the browser contribution of legacy terrain, fog, and material-side rendering.
- This is macro massing. Peak faceting, rock planes, erosion hierarchy, vegetation zones, final meadow micro-relief, river cross-section refinement, and all look development remain later work.
- Phase 1D is not started and public/runtime integration remains prohibited pending human visual review.
