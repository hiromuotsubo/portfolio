# Journey Phase 3 — DAY HERO visual gap

## Review frame

- Target: `/Users/tsubo/Downloads/target_day_hero_sotd.png`
- Current: `/private/tmp/journey-phase2-final-day.png`
- Reality reference: `/Users/tsubo/Desktop/reference_kamikochi_real.jpg`
- Review rule: use the fixed `?preview=day` state, 1280 × 720 viewport, unchanged story camera, and the same cursor position for every browser capture.

## Impact-ranked diagnosis

1. **No believable tree-scale hierarchy.** The current valley has green shading and mottled canopy noise, but almost no trunks, crown silhouettes, forest edge, or familiar-size objects. The target reads as a forest before it reads as green.
2. **The massif is still one continuous surface.** Rock, vegetation, valley and distance mostly follow one connected mesh, so size reads as camera proximity. The target separates foreground trees, forested foothills, rock ridges and distant peaks through occlusion and atmosphere.
3. **River and riverbank lack physical transitions.** The current river is a broad pale reflective ribbon with smooth authored edges. The target and reality reference show a transparent centre, visible bed, interrupted flow, gravel bars, wet stones, shrubs and overlapping bank silhouettes.
4. **The sky has insufficient volume and causal lighting.** The current sky is mostly a gradient plus a thin horizontal cloud trace. The target has volumetric cloud masses, an identifiable sun opening and rays that explain illuminated ridges.
5. **Composition lacks foreground and negative-space anchors.** The mountain occupies most of the frame with little scale comparison. The target balances sky, mountains, forest, water and foreground framing, making the mountains feel larger rather than merely closer.

## Working matrix

| Visual category | Current | Target | Difference | Hypothesis | Planned solution | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Forest / scale cues | Green surface noise; canopy points do not resolve as trees; no strong bank forest silhouette. | Individual foreground trees, readable midground trunks/crowns, canopy masses, then fine distant grain. | Missing object-scale and silhouette hierarchy. | A small number of clearly modelled foreground/midground trees plus clustered forest geometry will create more visual evidence than additional surface noise. | Reallocate budget from weak canopy points to shared instanced tree geometry, with large edge framing and smaller bank stands. | **REFINE:** photographic conifer/broadleaf instancing establishes tree scale, but forest density and repeated silhouettes remain below Target. |
| Mountain hierarchy | One connected massif dominates; lower slopes remain smooth. | Independent rock ridges, forest masses, gullies and far peaks overlap in depth. | Occlusion and distance layers are too weak. | Separate mid/far ridge silhouettes and foothill forest layers must be visibly framed through the central valley. | Recompose/add independent ridge and foothill layers while preserving the hero massif scale and story camera. | **REFINE:** wider fixed framing exposes more sky, water and valley depth; the base massif still reads as one continuous terrain on broad lower slopes. |
| River | Pale cyan reflective sheet; depth change and bed are weak at Hero distance. | Turquoise deep channel, clear shallows, submerged stones, broken reflections and directional flow. | Water signals are blended into one broad material response. | Distinct channel, shallow-bed and highlight masks plus visible submerged geometry will read as water. | Deepen central channel, expose bed near shore, add instanced submerged stones and restrained flow highlights. | **ACCEPT:** darker turquoise centre, reduced white reflection and stronger shallow/deep separation now read more clearly as water. |
| Riverbank | Smooth green banks and pale authored bar edges. | Irregular wet stone, gravel, grass, shrub and forest overlap. | Source mesh contour remains legible. | Silhouette interruption must come from geometry at important foreground/midground areas, not another narrow ribbon. | Add irregular gravel islands, stone/shrub clusters and bank forest overlap; reject regular strips. | **REFINE:** irregular gravel patches and tree overlap interrupt the edge, but the pale bars still lack the Target's stone-scale variation. |
| Atmosphere / depth | Global haze but similar surface acuity across most of the massif. | Clear near/mid/far contrast and saturation falloff; mist follows valleys. | Fog is not anchored to independent layers. | Separate geometry layers with their own values will make atmospheric perspective legible. | Tune each ridge/forest layer independently; add low valley mist only after geometry reads. | **ACCEPT / limited:** reduced near haze and fill recover ridge contrast while the widened frame creates clearer water–mountain–sky layering. Far depth remains weaker than Target. |
| Sky / cloud | Blue gradient; a thin horizontal cloud streak; light source is ambiguous. | Large but sparse cloud volumes, sun opening, peak mist and rays. | Cloud silhouette, vertical volume and light relationship are missing. | Low-cost 3D lobe clusters placed in world space can outperform flat cards. | Build layered world-space cloud volumes, retain cursor-independent motion, align opening with directional light. | **REFINE:** generated world-space additive clouds restore visible sky structure without camera-follow; still flatter and smaller than Target volumes. |
| Lighting | Broad pale fill makes surface visible but does not clearly explain form. | Directional warm light and cool shadow describe ridges, forest and depth. | Light hierarchy is compressed. | Foreground/midground objects and stronger directional ratios will make the same light legible. | Tune after structural layers: warm sun, reduced fill, cooler aerial shadows, restrained bloom. | **ACCEPT:** stronger directional sun and lower ambient/fill improve ridge and valley separation without changing the time transition. |
| Composition | Mountain surface fills most of the frame; foreground lacks framing; river is broad but empty. | Sky, tree frame, mountain, river and negative space coexist. | Mountain dominance lacks comparative scale. | Edge trees and a better-visible central depth corridor can increase perceived scale without shrinking the mountain. | Preserve story camera; first change world contents, then consider only a documented small FOV/target adjustment if still needed. | **ACCEPT:** pull-back/FOV adjustment keeps mountain scale while materially increasing sky, river and valley context. |

## Cycle decisions

Each visual pass is recorded here as **ACCEPT**, **REFINE**, or **REJECT** after a fixed browser capture and direct Target comparison.

| Cycle | Gap | Change | Screenshot | Decision | Reason / next step |
| --- | --- | --- | --- | --- | --- |
| 0 | Baseline | Phase 2 current state | `/private/tmp/journey-phase2-final-day.png` | BASELINE | Large smooth lower massif, pale river, almost no tree-scale evidence or visible clouds. |
| 1 | Forest cue prototype | Instanced synthetic cone/crown geometry and code-drawn atlas tests | browser fixed Day frame | **REJECT** | Read as black symbols, beads or illustration; did not reduce CG feel. |
| 2 | Photographic forest scale | Generated transparent conifer and broadleaf cluster atlases, instanced along the river corridor | `/private/tmp/journey-phase3-cloud-review.png` | **REFINE** | Immediately recognisable as trees, but first scale was too large and repeated. Reduced tree height for the accepted pass. |
| 3 | River and riverbank | Deeper turquoise body, lower reflection weight, irregular gravel patches | browser fixed Day frame | **ACCEPT / REFINE** | Water improved clearly. First large brown bank patch was rejected; smaller pale patches retained at lower opacity. |
| 4 | Cloud volume attempt A | Nine additive cloud sprites across similar peak height | `/private/tmp/journey-phase3-cloud-review.png` | **REJECT** | Formed an obvious horizontal band across the mountains. |
| 5 | Cloud volume attempt B | Five depth-separated layers; three high clouds and two mountain wisps | `/private/tmp/journey-phase3-final-day.png` | **REFINE** | Banding removed and clouds remain world-space; upper clouds read in the sky but remain flatter than Target. |
| 6 | Performance rejection | Additional massif raycast placement for slope forests | browser load review | **REJECT** | Runtime raycasts against the full high-poly massif stalled first render; removed rather than spending the visual budget invisibly. |

## Final Phase 3 Day assessment

The adopted frame is visibly more legible than Phase 2: river, riverbank trees, mountain, and sky now provide a usable scale ladder; water has a turquoise centre; the frame includes more negative space; and clouds are visible in the sky without following the cursor. The result does **not** fully match the supplied SOTD target. The remaining gap is structural: broad lower mountain regions still use the source massif surface, the forest atlas instances are sparse and repeated, the gravel lacks stone-scale geometry, and the clouds do not self-shadow. The correct next step is an offline-authored/baked forest-and-rock massif replacement, not more runtime raycasts or another global noise layer.
