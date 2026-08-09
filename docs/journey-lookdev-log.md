# Journey look development log

## Baseline

- Starting commit: `1408d5c`
- Supplied motion baseline: `current_journey_before.mov` (94.49 s, 2968 × 1564, 60 fps)
- Hero Frame A baseline: `current_day_before.png`
- Hero Frame B baseline: `current_night_before.png`
- Reality reference: `reference_kamikochi_real.jpg`
- Art-direction reference: `reference_target_art_direction.png`

## Initial reference analysis

| Area | Current | Reference | Difference | Initial hypothesis |
| --- | --- | --- | --- | --- |
| Mountain | Convincing silhouette and scale; lower half reads as a continuous smooth surface. | Large landform is broken into ridges, gullies, forest stands, exposed rock, and occlusion. | Mid and small scale structure collapses below the summit. | Use hierarchical detail and drainage-shaped masks; preserve the mesh and silhouette. |
| Forest | Low-frequency green patches with some fine noise and point sprites. | Thousands of crowns read as irregular masses, then clusters, then individual crown grain. | Detail frequencies do not form a coherent real-world scale hierarchy. | Strengthen large stand boundaries, crown-sized cellular breakup, conifer vertical rhythm, and distance fading. |
| River | Turquoise direction and flow are readable but the surface often reads as one opaque ribbon. | Cold transparent water reveals bed and depth; reflection varies by angle and current. | Depth, riverbed visibility, and reflection breakup are not sufficiently independent. | Separate deep body, shallows, submerged stones, Fresnel reflection, and flow into different masks. |
| Riverbank | Bars exist but read as pale polygons and their edges disclose the authored meshes. | Wet stones, gravel, dry stones, grass, and shrubs overlap irregularly. | Material variation occurs inside a geometric boundary instead of dissolving it. | Add multi-scale stone cells, wet-edge bands, grass incursions, and water-side optical overlap. |
| Sky | Attractive color transition but large areas are visually empty. | Sky contains tonal depth, thin clouds, peak cloud, and haze. | Missing depth anchors make the mountains feel close to the camera. | Use sparse world-space cloud layers at different depths and a subtle horizon gradient. |
| Cloud | Present in code, barely legible in the baseline day frame. | Thin cloud explains light direction and touches the terrain in places. | Opacity, placement, depth test, and value separation make clouds disappear or feel detached. | Recompose cloud layers around peaks and the existing light opening without cursor-follow behavior. |
| Atmosphere | Fog changes with story, but open-valley separation is modest. | Contrast, saturation, and detail decrease continuously with distance; mountain feet dissolve. | Near and far surfaces share similar acuity and color weight. | Increase distance and height-aware aerial perspective while retaining foreground contrast. |
| Lighting | Day, evening, and night transitions are successful; daylight is broad and even. | Local light describes ridge direction; warm light and cool shade form depth. | Broad illumination exposes the terrain surface more than the geological and forest structure. | Add restrained directional ridge/canopy response and connect the highlight to the cloud opening. |
| Composition | Mountain scale is strong; large parts of the frame repeat the same surface. | Mountain, sky, water, far ridge, haze, and negative space coexist. | Insufficient distance layers make scale look like camera proximity. | Keep mountain size and camera route; reveal far valley and sky through atmosphere and only small framing offsets if required. |
| Scale | Night person gives a useful cue; daytime lacks a familiar-size cue in the forest. | Crown grain, river stones, layered ridges, and trees communicate kilometres. | Procedural marks are not consistently tied to natural object scales. | Calibrate every detail frequency to forest mass, cluster, crown, stone, or ripple scale. |

## Cycle 0 — Audit and working system

### Problem

Previous passes accumulated many useful procedural features, but visual review was not recorded in a repeatable fixed-frame process.

### Hypothesis

A fixed Hero Frame workflow and explicit record of failed or low-impact approaches will prevent build success from being mistaken for visual completion.

### Reference difference

The supplied daytime frame reads first as a large smooth green terrain. The reality reference reads first as a forested valley because crown scale, irregular bank overlap, and distance layering support each other.

### Implementation

Added repository-level Journey rules, this execution plan, immutable baseline definitions, and a structured cycle log. Reviewed the supplied 94.49-second video at ten-second intervals.

### Before

Supplied day and night frames at the starting commit.

### After

No visual change in Cycle 0.

### Evaluation

The dominant daytime CG cues are: (1) lower mountain detail collapsing into low-frequency green, (2) river and bank silhouettes reading as authored polygons, and (3) insufficient cloud and aerial-depth anchors. At night, uniform blue mountain response and a broad luminous water sheet reduce depth.

### Next step

Establish a repeatable browser capture and performance baseline, then begin with mountain / forest because it occupies the greatest image area.

## Cycle 1 — Mountain, forest, and vegetation hierarchy

### Problem

The lower massif read as continuous green material, especially on the left foreground slope. Existing high-frequency noise was visible only as mottling and the scene's broad fill light compressed forest values.

### Hypothesis

The forest needs three coordinated scales—stand, crown cluster, and crown—plus darker valley-moisture stands and less fill-light compression. Increasing procedural noise alone will not establish scale.

### Reference difference

Kamikochi's real canopy contains dark large stands, lighter crown clusters, and small crown occlusion. The target look keeps that hierarchy legible even under soft painterly light.

### Implementation

Added crown-cell distance fields at two offset frequencies, vertical stand breakup, valley-moisture weighting, darker lower-forest values, and denser shared canopy points. Rebalanced daytime exposure, sun, hemisphere, and ambient contributions toward directional form while retaining the existing evening and night transitions.

### Before

`/private/tmp/journey-baseline-day.png`

### After

`/private/tmp/journey-cycle1c-day.png`

### Evaluation

Three comparisons were made. Crown hierarchy materially improved the right lower mountain and valley shadows. Increasing point count alone made little visible difference and is not treated as a successful primary technique. Lighting rebalance recovered midtone separation across the massif. The left foreground remains too smooth and the cellular field can still read as mottling instead of tree crowns; this cycle is an improvement, not completion.

### Next step

Improve river and bank silhouettes next because their pale geometric boundaries currently reinforce the synthetic read. Reassess the left foreground during the atmosphere and final composition cycles rather than adding brute-force trees now.

## Cycle 2 — River and riverbank

### Problem

The river read as a pale cyan sheet, the authored bank edge stayed too explicit, and the procedural riverbed was only random square variation.

### Hypothesis

Water will read more clearly when deep body color, bank shallows, discrete submerged stones, angle-dependent reflection, and flow highlights use separate masks. Gravel needs neutral stone variation rather than a green material.

### Reference difference

The reality reference shows a turquoise centre, visible stones near shallow edges, interrupted reflections, and dry grey gravel bars with irregular green incursions.

### Implementation

Added elliptical submerged pebble cells, shallow-weighted bed visibility, more distinct deep and shallow turquoise, reduced broad bank overlay, restrained caustic threads, and neutral wet/dry gravel variation. Kept the existing river-to-Milky-Way emissive logic intact.

### Before

`/private/tmp/journey-cycle1c-day.png`

### After

`/private/tmp/journey-cycle2b-day.png`

### Evaluation

The first iteration overexposed the riverbed and made the whole river grey. A second iteration restricted the bed to shallows and restored the central turquoise body. Depth and near-surface variation improved, but the river's authored outer silhouette remains visible and cannot be fully removed without changing the source mesh or adding a dedicated bank-overlap asset.

### Next step

Restore readable world-space clouds and stronger aerial layering; then judge water value again under the final daytime atmosphere.
