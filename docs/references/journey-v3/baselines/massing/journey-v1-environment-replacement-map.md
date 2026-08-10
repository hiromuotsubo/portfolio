# Journey V1 Environment Replacement Map for Journey V3

This map is planning-only for Phase 1C. It does not change WebGL visibility. Journey V1 remains untouched, and future visibility changes must be scoped to `/journey-v3`.

## Main runtime GLB

| Object | Current role | Phase 1C classification | Journey V3 disposition | Reason |
| --- | --- | --- | --- | --- |
| `TER_V13_FICTIONAL_NAGANO_MASSIF` | Existing main mountain, valley slopes, and terrain mass | Hide candidate | Replace with `V3_HERO_MASSIF`, left/right ridges, valley floor, and zone-authored terrain | The monolithic V1 mass cannot provide the Montfort-directed ridge, drainage, and material-zone separation required by the delta contract. |
| `MTN_V13_FAR_CENTRAL_RIDGE` | Existing far ridge | Hide candidate | Replace with `V3_FAR_RIDGES` | The new macro composition needs controlled depth layers and a continuous but non-repeating skyline. |
| `BAR_V13_LEFT_MID` | Left gravel bar / riverbank / ground transition | Hide candidate | Replace with `V3_LEFT_RIVERBANK_PROXY` and later production bank | The current bank participates in visible water/ground boundary failures. |
| `BAR_V13_RIGHT_FOREGROUND` | Right foreground gravel bar / riverbank | Hide candidate | Replace with `V3_RIGHT_RIVERBANK_PROXY` and `V3_MEADOW_BASE` transition | The V3 meadow and river exclusion zone require a deliberately separated boundary. |
| `RIV_V13_EMERALD_S_WATER.001` | Main river surface | Hide candidate after integration | Replace with a later V3 water surface following the Phase 1C river route | The existing route is a useful leading-line reference, but Phase 1C establishes a cleaner grade, width change, and bank separation. Story/river-light bindings must be migrated before hiding it. |
| `RIV_V13_VISIBLE_PEBBLE_BED.001` | Existing riverbed | Hide candidate | Replace with `V3_RIVERBED_PROXY`, later production riverbed | The new bed must remain lower than both banks and support shallow/deep zones without green terrain penetration. |
| `FX_V13_WATER_RIPPLES` | Existing water response geometry | Decision pending | Replace only when V3 water reaction is implemented | It is tied to the existing river behavior; removing it before the water integration phase could break the preserved experience. |
| `WEB_RIVERBANK_ROCKS_PLACED_00` | Existing bank rock group | Hide candidate | Replace later with V3 shoreline assets | Individual rocks are outside Phase 1C and must follow the new bank geometry. |
| `WEB_RIVERBANK_ROCKS_PLACED_01` | Existing bank rock group | Hide candidate | Replace later with V3 shoreline assets | Same as above. |
| `CAVE_HQ_INTERIOR_SHELL` | Cave enclosure and threshold silhouette | Keep | Retain as locked Journey V1 story geometry | It establishes the preserved cave-to-valley transition and must not be changed for the mountain. |
| `CAVE_HQ_GROUND` | Cave floor and exit ground | Keep | Retain as locked Journey V1 story geometry | It is part of the continuous walk and camera threshold. Phase 1C terrain must meet it without editing it. |
| `CAVE_HQ_FLOOR_WATER` | Cave water / reflective floor | Keep | Retain | It belongs to the cave sequence, not the natural-environment replacement. |
| `WEB_CAVE_HQ_DEBRIS_00` | Cave debris | Keep | Retain | Story-scale cave dressing. |
| `WEB_CAVE_HQ_DEBRIS_01` | Cave debris | Keep | Retain | Story-scale cave dressing. |
| `WEB_CAVE_HQ_HANGING_PLANTS_00` | Cave hanging vegetation | Keep | Retain for parity; reconsider only in a later cave-specific pass | It is not part of Phase 1C macro terrain. |
| `WEB_CAVE_HQ_MOSS_00` | Cave moss | Keep | Retain for parity; reconsider only in a later cave-specific pass | It is not part of Phase 1C macro terrain. |
| `CAM_V13_MASTER_ANIMATED` | Authored Journey V1 GLB camera | Keep | Retain, but do not use alone as the Blender comparison camera | Camera animation remains part of the Journey V1 experience. Browser-final Phase 1A cameras are the authoritative comparison values. |

## Phase 2 auxiliary environment GLB

| Object | Current role | Phase 1C classification | Journey V3 disposition | Reason |
| --- | --- | --- | --- | --- |
| `P2_RIDGE_MID` | Existing midground ridge | Hide candidate | Replace with `V3_MIDGROUND_RIDGES` | New ridges must follow the selected massif and valley carving. |
| `P2_RIDGE_FAR` | Existing far ridge | Hide candidate | Replace with `V3_FAR_RIDGES` | The selected skyline and atmospheric depth require a coordinated far layer. |
| `P2_FOREST_MID_CANOPY` | Existing midground canopy representation | Hide candidate after vegetation integration | Replace with later vegetation generated from `FOREST` and `WIND_REACTIVE_VEGETATION` zones | Phase 1C creates only the masks; actual forest remains later work. |
| `P2_SHORE_WET_LEFT` | Existing wet left shoreline | Hide candidate | Replace using the new left bank, `WET`, and `RIVER_EXCLUSION` geometry/masks | The wet zone must follow the actual new bank. |
| `P2_SHORE_WET_RIGHT` | Existing wet right shoreline | Hide candidate | Replace using the new right bank, `WET`, and `RIVER_EXCLUSION` geometry/masks | Same as above. |
| `P2_CLOUD_FAR` | Distant cloud card | Decision pending | Retain only if it remains a supporting distant detail and does not conflict with later V3 atmosphere | It is not terrain, but final WebGL atmosphere may make it redundant. |

## Integration rule

The new Phase 1C geometry is reviewed without the replace-candidate objects, but those locked references remain unedited in the Phase 1C Blend. A later Journey V3-only integration phase must hide old objects explicitly by exact object name after replacement GLB, water behavior, material boundaries, and story bindings are validated. No old mountain is to be concealed by stacking the new mountain directly over it.
