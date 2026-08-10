# Journey V2 — experience and visual direction

## Source review

### Reference recording 14:50:03

The strongest quality is continuity between a finished illustration, a spatial mountain, fog, and typography. The camera does not announce a page change: it approaches a visual field, lets mist and exposure reorganise it, and leaves the viewer unsure where image, depth and interface separate. Journey V2 should borrow that continuity, not its corporate typography or saturated green palette.

### Reference recording 14:43:37

The artwork remains the same object while the camera moves from gallery, to frame, to image interior, and back. The frame is a spatial threshold. Journey V2 translates this principle into cave wall → cave aperture → fogged valley → open landscape. The landscape seen through the cave must be the same landscape revealed outside it.

### Scene transition sheet

The eight emotional beats and their order are retained: Loading, Cave, Fog Valley, Clear Kamikochi, Sunset, Night, Sky, Awe. They are organised as three continuous acts rather than eight pages.

## Experience structure

### Act 1 — Threshold

1. **Loading** — a pale water stain slowly completes around a small aperture; almost no interface.
2. **Cave** — a dark irregular frame surrounds a distant, desaturated valley. Forward movement is directed and slow.
3. **Fog Valley** — the aperture expands beyond the viewport while fog remains, so the viewer crosses the threshold before the view is granted.

### Act 2 — One valley, passing time

4. **Clear Kamikochi** — fog thins, pigment settles and the already-present landscape gains contrast, colour and water reflection.
5. **Sunset** — the same layers receive warmer light, cooler shadow and quieter sky; no scene or image replacement.
6. **Night** — the same mountain, river and bank remain registered while pigment darkens and sparse stars appear.
7. **Sky** — composition, light on the river and a gentle camera target shift make the sky dominant without instructional copy.

### Act 3 — Awe

8. **Awe** — an anonymous seated silhouette is first readable, then becomes small only through camera retreat. The final image is held long enough to look at rather than consumed by an ending animation.

## Representation matrix

| Element | Primary representation | Secondary treatment | Reason |
| --- | --- | --- | --- |
| Cave threshold | SVG/DOM vector frame | subtle CSS lighting and grain | Close, graphic and controllable; full 3D is unnecessary for the PoC. |
| Sky | photo-derived 2.5D layer | time colour field, cloud/fog masks | Needs continuity and slow parallax, not geometry. |
| Distant mountain | photo-derived layer | depth fade, restrained pigment edge | Establishes real Kamikochi topology. |
| Main mountain / forest | photo-derived layer | local contrast and transparent pigment response | Retains real forest scale and avoids invented AI detail. |
| River / bank | photo-derived layer | directional highlight and small flow distortion | Preserves real river geometry while allowing life. |
| Foreground | photo-derived masked layer | smallest depth blur and strongest parallax | Gives spatial scale without a forest of objects. |
| Fog | layered CSS/SVG noise fields | opacity, blur and stain breakup | Must reveal the existing view, not crossfade to a new image. |
| Paper / pigment | local layer response | blend, granulation, uneven edges | Must not be one global watercolor filter. |
| Light | CSS gradients and per-layer grading | optional later WebGL light scattering | Simple controls produce the required emotional result first. |
| Water | DOM layer in PoC | later lightweight fragment shader if needed | Prove the art direction before adding GPU complexity. |
| Sound | existing cave/wind/river field recordings | gain/filter automation | Silence and environmental transition are more important than music. |

## Camera timeline

The camera is directed. Scroll progress controls a damped timeline; pointer input contributes only a few pixels of depth-dependent offset and is suppressed during major forward movement.

- **0–10% Loading:** no camera movement.
- **10–32% Cave:** slow push toward the cave aperture; FOV feels narrower through framing, not a visible zoom effect.
- **32–55% Fog:** the cave frame moves beyond the viewport; valley layers separate slightly while fog remains dominant.
- **55–100% Clear:** movement settles, contrast and pigment return, river highlight begins, and pointer parallax eases in.

The final eight-scene timeline will reuse this directed-camera model for time, sky and pull-back. Large moves set pointer weight to zero; the weight eases back only after the move settles.

## Asset strategy

### Available and used in the PoC

- `nagano-kappabashi-selected.png` — the actual Kamikochi photograph and shared topology source.
- `cave-ambience.m4a`, `wind-field.m4a`, `river-field.m4a` — existing spatial/emotional sound sources.
- Existing Journey cave imagery — composition reference only; no old model or Journey scene code is imported.

### Photo-derived work

- Sky, distant mountain, main forest, river/bank and foreground are separated as masks from the same photograph.
- Watercolour is a material interpretation of those real pixels; no invented AI landscape is used.
- For production, create hand-refined masks and local pigment maps at 4K or above from the original RAW/JPEG.

### Blender / 3D

- Not required for the Phase 5 PoC.
- Consider later only for cave-adjacent rock silhouettes, close shadow catchers or a foreground element that crosses camera space.
- Do not rebuild the mountain or forest as full 3D.

### Shader / procedural

- Fog breakup, river shimmer, pigment bloom, edge softness and paper granulation.
- These remain local to materials/layers; no uniform full-screen “watercolor filter.”

### Sound still desirable

- 60–120 second clean recordings at cave mouth, river bank, open valley, evening and night.
- Record at 48 kHz/24-bit when possible, with limited wind protection noise and no speech.

### Additional photography still desirable

- 4K+ landscape orientation from one fixed viewpoint, with full sky, ridge, river and both banks visible.
- Bracketed or RAW captures at clear day, golden hour and blue hour from the same tripod position.
- Separate close photographs of rock, river surface, wet gravel and paper/watercolour textures for local material maps.

## Phase 5 proof of concept

The PoC lives at `/journey-v2` and does not alter `/journey`.

### Acceptance gates

1. The valley through the cave is the exact valley revealed later.
2. Cave → Fog → Clear feels like forward movement and changing visibility, not three screens.
3. The photograph is split into depth layers with restrained differential parallax.
4. Fog has wet, irregular edges and multiple speeds without resembling a repeated transition preset.
5. Watercolour qualities differ by element: soft sky wash, detailed forest pigment, transparent river colour and dry cave edge.
6. Pointer motion is subtle and disabled during large timeline movement.
7. The result does not resemble an AI-generated landscape or an animated background image.
8. Mobile input and reduced-motion mode preserve the composition.

Only a representation that passes these gates should be extended to Sunset, Night, Sky and Awe.
