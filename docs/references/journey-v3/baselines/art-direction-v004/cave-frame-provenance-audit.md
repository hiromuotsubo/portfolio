# Journey V3 Phase 1C.3 — progress 11.5 cave-frame provenance

## Scope

This audit identifies the elements that form the apparent cave/opening frame at story progress 11.5. It does not move, rotate, scale, or edit the locked Journey V1 cave. The capture uses `/journey-v3?preview=cave-exit&neutralPointer=1&captureCamera=1&freezeRuntime=1` at 1440 × 900 and the browser-final `CAM_V13_MASTER_ANIMATED` state.

The reproducible capture is implemented by `scripts/capture_journey_v3_phase1c3_browser_audit.mjs`. It obtains the live React Three Fiber root from the running page, restores the same baseline before every variant, toggles one object/effect category, explicitly renders the same fixed camera, and records PNG and pixel-difference data.

## Result

The expected progress-11.5 opening frame is **not formed by the locked cave geometry in this camera state**. It is principally formed by the existing Journey V1 mountain/terrain geometry, with scene fog and the DOM `cave-grade` contributing tonal and atmospheric treatment.

| Variant | Changed pixels | Changed fraction | Interpretation |
| --- | ---: | ---: | --- |
| no cave shell | 0 | 0.000% | `CAVE_HQ_INTERIOR_SHELL` is outside the visible projection at this frame. |
| no cave ground/water | 0 | 0.000% | `CAVE_HQ_GROUND` and `CAVE_HQ_FLOOR_WATER` do not form the visible edge. |
| no cave debris | 0 | 0.000% | Debris does not form the visible edge. |
| no all cave | 0 | 0.000% | Confirms that the complete cave group is not the visible frame source. |
| no old terrain/environment | 1,109,272 | 85.592% | Existing massif/ridge terrain is the primary geometry source. |
| cave FrontSide instead of DoubleSide | 0 | 0.000% | Backface/DoubleSide is not the missing-frame cause at progress 11.5. |
| no FogExp2 | 1,108,773 | 85.553% | Fog strongly affects the full image, but it is an atmosphere contribution rather than the edge geometry. |
| no screen-mist scene objects | 0 | 0.000% | Screen-mist classified scene objects do not contribute in this state. |
| no CSS cave-grade | 967,285 | 74.636% | The grade changes tone over most of the frame; it does not provide the geometry silhouette. |
| no DOM atmosphere group | 800,816 | 61.791% | DOM atmosphere contributes to grading/visibility, not the 3D edge itself. |

## Cause classification carried forward from Phase 1C.1

1. **Geometry omitted from the earlier Blender review:** no omitted locked cave object explains the expected visible frame. The browser inventory included shell, ground, water, debris, moss, and hanging plants, yet hiding all cave objects caused zero pixel change.
2. **Journey V1 opacity/fade/visibility:** runtime cave presence is fully active at progress 11.5 (`1 - smoothstep(13.5, 20.2, 11.5) = 1`). Fade does not explain the absent Blender cave edge at this progress. Fade remains relevant after 13.5 and reaches practical invisibility around 20.2.
3. **Object or parent transform mismatch:** not supported by the browser toggle evidence. The validated browser camera and locked reference transforms are unchanged.
4. **Actual geometry placement:** the cave shell is genuinely outside the visible progress-11.5 projection; moving it would incorrectly alter authoritative Journey V1 geometry.
5. **Correct later re-entry hidden by fade:** progress 28.25/30 cave-shell re-entry in geometry-only Blender review is compatible with Journey V1's intended fade/visibility behavior. It must be evaluated separately from physical terrain continuity.

## Decision

- Do not move the locked cave.
- Keep geometry-only cave continuity and runtime-visibility-equivalent review as separate tests.
- Preserve the v003 connector system, whose seam distance is 0 and whose core-cave triangle-intersection list is empty in both candidates.
- During later Journey V3 integration, explicitly hide the replaced old mountain/terrain geometry only after a Journey V3-specific transition/opening solution is reviewed. The browser frame cannot be expected to survive removal of the old environment without such a replacement.

Artifacts:

- `browser/cave-provenance/cave-frame-provenance.json`
- `browser/cave-provenance/cave-frame-provenance-contact-sheet.png`
- individual baseline and toggle PNGs in `browser/cave-provenance/`

