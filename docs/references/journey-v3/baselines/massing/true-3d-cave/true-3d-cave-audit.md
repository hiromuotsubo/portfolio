# Journey V3 Phase 1C.1 — True 3D Cave Composite Audit

## Method

This audit does not use browser screenshots, alpha overlays, Hero Valley
imagery, or 2D cave mattes. A temporary Blender review Scene named
`V3_TRUE_3D_CAVE_REVIEW` is built in memory from:

- read-only copies of the Phase 1B locked Journey V1 cave/story meshes;
- read-only copies of the Phase 1C.1 Selected v002 meshes;
- the unmodified Phase 1B browser-final camera objects.

The copies retain the source objects' `matrix_world` values. Review materials
are applied only to copied mesh data. The source Blend is opened but never
saved. Its SHA-256 before and after the audit is identical:

`9bc96a17b6aee6c09a59fdc77bc05083197fd9be9d2aab10c8585f4642e13237`

## Visible Journey V1 geometry

- `CAVE_HQ_INTERIOR_SHELL`
- `CAVE_HQ_GROUND`
- `CAVE_HQ_FLOOR_WATER`
- `WEB_CAVE_HQ_DEBRIS_00`
- `WEB_CAVE_HQ_DEBRIS_01`
- `WEB_CAVE_HQ_HANGING_PLANTS_00`
- `WEB_CAVE_HQ_MOSS_00`

## Hidden old environment geometry

- `TER_V13_FICTIONAL_NAGANO_MASSIF`
- `MTN_V13_FAR_CENTRAL_RIDGE`
- `BAR_V13_LEFT_MID`
- `BAR_V13_RIGHT_FOREGROUND`
- `RIV_V13_EMERALD_S_WATER.001`
- `RIV_V13_VISIBLE_PEBBLE_BED.001`
- `FX_V13_WATER_RIPPLES`
- `WEB_RIVERBANK_ROCKS_PLACED_00`
- `WEB_RIVERBANK_ROCKS_PLACED_01`
- `P2_RIDGE_MID`
- `P2_RIDGE_FAR`
- `P2_FOREST_MID_CANOPY`
- `P2_SHORE_WET_LEFT`
- `P2_SHORE_WET_RIGHT`
- `P2_CLOUD_FAR`

All listed old-environment names exist in the source Blend. None is linked to
the True 3D review Scene.

## Visible Selected v002 geometry

- `V3_V002_PRIMARY_MASSIF`
- `V3_V002_OPPOSING_RIDGES`
- `V3_V002_MIDGROUND_RANGE`
- `V3_V002_DISTANT_RANGE`
- `V3_V002_VALLEY_FLOOR`
- `V3_V002_MEADOW_BASE`
- `V3_V002_RIVERBED_PROXY`
- `V3_V002_LEFT_RIVERBANK_PROXY`
- `V3_V002_RIGHT_RIVERBANK_PROXY`

## Cameras and results

No camera position, rotation, FOV, projection, or lens value is manually
adjusted.

| Progress | Source camera | Cave vertices in front / in frame | True 3D result |
| --- | --- | ---: | --- |
| 11.5 | `CAM_V3_SWEEP_P011_50` | 84 / 0 | v002 is visible, but the actual cave opening does not frame the image. |
| 13.5 | `CAM_V3_SWEEP_P013_50` | 0 / 0 | No cave geometry is in front of the camera. |
| 16 | `CAM_V3_SWEEP_P016_00` | 0 / 0 | No cave geometry is in front of the camera. |
| 20 | `CAM_V3_SWEEP_P020_00` | 0 / 0 | No cave geometry is in front of the camera. |
| 23.5 | `CAM_V3_SWEEP_P023_50` | 21 / 0 | Cave fragments are in front but remain outside the frame. |
| 25 | `CAM_V3_SWEEP_P025_00` | 107 / 0 | Cave fragments approach the view but remain outside the frame. |
| 28.25 | `CAM_V3_SWEEP_P028_25` | 460 / 6 | The cave shell enters suddenly from the upper-right and causes a large occlusion. |
| 30 | `CAM_V3_SWEEP_P030_00` | 460 / 6 | The same upper-right cave-shell occlusion remains. |

The mountains themselves do not suddenly appear during 11.5–25; their
parallax is continuous. The failure is that the retained cave geometry does
not provide the expected early opening frame, then re-enters the widened view
at 28.25/30. Runtime cave opacity normally hides this late geometry, but the
raw same-Scene geometry/projection requested by this audit is not spatially
self-explanatory without that runtime visibility treatment.

## Cave-to-new-ground seam

BVH triangle-overlap testing reports:

- cave/v002 intersecting object pairs: `0`
- triangle-pair intersections: `0`

This avoids destructive overlap, but it also confirms that the surfaces are
not sewn together. For the 18 vertices at the forward edge of
`CAVE_HQ_GROUND`, the nearest v002 surface is always
`V3_V002_RIVERBED_PROXY`:

- minimum distance: `1.8419625`
- median distance: `2.0063522`
- 95th percentile distance: `2.2039542`
- maximum distance: `2.2175860`

Therefore a real spatial gap of approximately `1.84–2.22` world units remains
between the cave-floor exit and the nearest new terrain surface. It is not a
geometry intersection, but it is a void/seam risk and does not meet the
requirement for a finished continuous cave-to-valley ground connection.

## Conclusion

The True 3D audit is **not a spatial-continuity pass**. Phase 1D should not
start yet.

Required work before Phase 1D:

1. verify the raw cave-shell-to-browser-final-camera alignment at progress
   11.5 independently of runtime opacity;
2. add a Journey V3-only cave-exit transition/connector surface that joins
   `CAVE_HQ_GROUND` to the v002 meadow/riverbank system without modifying the
   locked cave or fixed cameras;
3. repeat these eight True 3D renders and require the seam distance to close
   without producing cave/terrain intersections;
4. confirm that the cave edge frames the early view and leaves the frame
   monotonically, rather than re-entering at 28.25/30.

No v002 shape, Journey V1 file, Journey V3 runtime file, public GLB, camera,
PBR material, flower, forest, wind, water, fog, commit, or remote state was
changed by this audit.

Machine-readable evidence is stored in
`true-3d-cave-geometry-audit.json` in this directory.

Reproduction commands:

```text
/Applications/Blender.app/Contents/MacOS/Blender --background --python scripts/blender/render_journey_v3_true_3d_cave.py
node scripts/build_journey_v3_true_3d_cave_contact_sheet.mjs
```
