# Journey V2 — Phase 5 Proof of Concept Log

## Scope

This pass intentionally implements only Loading → Cave → Fog Valley → Clear
Kamikochi at `/journey-v2`. The current `/journey` remains unchanged. Sunset,
Night, Sky, and Awe must not be built until this visual method is accepted.

## Visual source rule

The landscape topology comes from Hiromu's Kamikochi photograph
`nagano-kappabashi-selected.png`. It is not an AI-invented landscape. The same
photograph is separated into sky, distant mountain, forest, river, and
foreground treatments so geography cannot drift between states.

## Cycle 1 — Cave threshold

- **Problem:** the first aperture was too large and exposed the landscape too
  early.
- **Hypothesis:** a smaller irregular opening would restore tension and make
  the reveal feel earned.
- **Implementation:** reduced the SVG cave aperture and retained a displaced,
  uneven rim rather than a symmetric vignette.
- **Browser result:** the far landscape reads as a destination while darkness
  still dominates.
- **Decision:** ACCEPT.

## Cycle 2 — Fog density

- **Problem:** the initial fog filled the frame with white and read as a scene
  transition card.
- **Hypothesis:** mist should remove detail while preserving the valley's large
  shapes and river direction.
- **Implementation:** changed fog to a rise-and-clear curve, reduced wash
  opacity, and retained three independently drifting pigment layers.
- **Browser result:** the mountain silhouette and river remain barely legible;
  Clear now feels like detail returning to a place that was always present.
- **Decision:** first version REJECTED; second version ACCEPTED.

## Cycle 3 — Clear image and depth

- **Problem:** a single treated photograph would still feel like a flat hero
  image.
- **Hypothesis:** local material treatment plus depth-specific movement can
  preserve photographic truth while creating quiet spatial presence.
- **Implementation:** repeated the same source through independently masked
  sky, distant, forest, river, and foreground layers. Each layer has its own
  saturation, contrast, brightness, softness, and very small parallax range.
- **Browser result:** forest and river regain local density after the mist; left
  and right pointer checks show different movement rates without a theatrical
  parallax effect.
- **Decision:** ACCEPT for the PoC.

## Motion review

- Loading fades into darkness instead of exposing a progress-only UI.
- Cave exit enlarges continuously; there is no landscape image swap.
- Fog peaks after the threshold and then clears from the same landscape.
- Pointer look is effectively locked during the major camera move and eased in
  only after the reveal.
- Mountain remains still enough to feel monumental; fog and river light carry
  the living motion.

## Gate for the remaining scenes

Continue only if this PoC direction is accepted. The next pass should derive
Sunset and Night from these exact spatial layers, changing light, pigment,
reflection, fog color, exposure, and sky—not replacing the geography. New
source photography is preferable to generated scenery whenever additional
coverage is needed.

## Refinement pass — spatial watercolor

### Cave depth

- **Rejected:** a single displaced SVG aperture still read as a dark mask over
  a photograph.
- **Accepted:** three independently shaped rock layers now form foreground,
  middle, and back cave walls. Each receives a different low-level reflected
  color, motion rate, and irregular edge. A restrained bounce light and exit
  haze connect the exterior light to the cave interior.
- **Browser evaluation:** the opening remains intentionally small, while the
  visible tonal steps around it establish distance before the camera crosses
  the threshold.

### Depth-specific watercolor treatment

- **Rejected:** hard polygon clips exposed the construction during the reveal.
- **Accepted:** broad feathered density masks replaced visible layer edges.
  The base photograph is gently softened; distant mountains receive displaced
  translucent pigment, the forest receives local canopy-like brush breakup,
  the river receives directional brush distortion, and foreground information
  remains comparatively photographic.
- **Result:** no whole-frame watercolor filter is used. The treatment becomes
  stronger with distance and remains anchored to the original Kamikochi
  photograph.

### Fog and emotional reveal

- **Rejected:** stacked white washes overexposed the valley and behaved like an
  overlay transition.
- **Accepted:** far, middle, and near fog now have separate density curves and
  drift directions. The foreground remains legible while distance is removed.
  Clearing is sequenced as peak → ridge → valley → river/reflection.
- **Browser evaluation:** continuous scrolling shows the same geography before,
  during, and after the mist; no image or scene cut is visible.

### Spatial and UI review

- Clear was checked at center, left, and right pointer positions. Sky, mountain,
  forest, river, and foreground use restrained, different movement rates.
- The delta is deliberately below an obvious parallax effect but sufficient to
  separate near and far forms in motion.
- Default visual mode removes the study title, chapter number, and V1 link.
  `?debug` restores review UI; `?progress=0…100` exposes fixed review frames.
- A complete Loading → Cave → Fog → Clear interaction run completed without
  runtime errors.
