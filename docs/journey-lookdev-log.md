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

## Cycle 3 — Sky, cloud, light, and atmosphere

### Problem

Cloud objects existed in world space but were nearly invisible because low texture alpha was multiplied by low material opacity. The few visible traces formed one thin horizontal line and did not explain the existing light shaft.

### Hypothesis

Sparse cloud masses at several world depths and offset heights can create parallax and explain the ridge light without a camera-following background layer.

### Reference difference

Both references use cloud and haze to separate peaks and soften selected geometry. The current frame had an empty gradient sky and exposed every ridge with similar acuity.

### Implementation

Increased internal cloud density, separated far sky cloud from peak-touching cloud, redistributed cloud height and width, and strengthened three low-opacity open-valley atmosphere layers. Cloud position continues to drift only with time and travel wind, never cursor input. The existing pointer-discovered light shaft remains in place.

### Before

`/private/tmp/journey-cycle2b-day.png`

### After

`/private/tmp/journey-cycle3c-day.png` and `/private/tmp/journey-cycle3-sunset.png`

### Evaluation

The first cloud increase produced an artificial continuous white band and was rejected. The second arrangement separated the band into left-peak, central, right-peak, and distant layers. Day and sunset now retain visible clouds and a clearer source region for the shaft, although the sprite-based cloud remains flatter than a true volumetric solution.

### Next step

Validate night Hero Frame B, person scale, cloud fade, final pull-back, renderer cost, and the full narrative checkpoints.

## Cycle 4 — Night depth, final scale, and forest relief

### Problem

Night mountains shared one lifted blue value, and the final daytime review still showed a smooth left foreground despite the color hierarchy.

### Hypothesis

At night, lower emissive contribution plus stronger distance-weighted haze will separate near and far without changing geometry. During day, restrained screen-derivative canopy relief can let directional light reveal crowns without adding geometry.

### Reference difference

The target look preserves cool shadow depth rather than turning the whole mountain blue. Real forest canopy changes the surface normal at crown scale, not only its color.

### Implementation

Darkened night atmospheric pigment, increased only the distance-weighted night haze, and reduced mountain night emissive. Tested a canopy-cell normal reconstruction: the first strength read as reptile-like scales and was rejected; the retained version uses less than half the relief and normal blend. Person scale, figure timing, camera path, and pull-back were unchanged.

### Before

`current_night_before.png` and `/private/tmp/journey-cycle3c-day.png`

### After

`/private/tmp/journey-final-wide.png`, `/private/tmp/journey-final-night.png`, and `/private/tmp/journey-final-day.png`

### Evaluation

The wide frame preserves the intended hierarchy: person < river < mountain < sky. The person is identifiable during formation and small in the final frame. Night near/far separation improved modestly. Subtle canopy relief helps the left slope, but the underlying single massif still limits true forest silhouette and distance separation.

### Next step

For a future major asset pass, split the massif into near/mid/far material regions or author a baked forest canopy displacement/normal atlas. That is a materially different asset task and should retain the current camera animation.

## Research findings applied

- Kamikochi's own visual descriptions consistently frame the Azusa River as the connecting thread between forest, distant Hotaka peaks, and atmospheric events; composition therefore needs a readable river path and layered mountain backdrop, not only a large mountain.
- Clear alpine water reads through visible bed material near shore, a deeper coloured centre, and angle-dependent reflection rather than one uniform transparency value.
- `THREE.FogExp2` is useful for global distance integration, but local height- and material-aware haze is still needed to avoid flattening the foreground.
- React Three Fiber performance guidance favours shared geometry/materials and instancing. The retained forest pass therefore adds shader detail and one shared Points draw instead of thousands of tree objects.

## Final validation

- Build: passed.
- Lint: passed.
- Browser checkpoints: cave, fog HOLD, day, sunset, night, river HOLD, forming, figure, wide, and outro all rendered a canvas with zero current runtime errors.
- Renderer at the final wide checkpoint: 31 draw calls, 641,188 triangles, 9,931 points, 6 lines, 11 geometries, 18 textures, and 14 programs.
- Production Journey chunk: 1,095.89 kB uncompressed / 301.57 kB gzip after the final forest-relief pass.

## Remaining weaknesses and assessment

The lower mountain is improved but still inherits the broad curvature of one authored massif. Peak clouds are world-space and no longer cursor-following, but remain sprite-based and flatter than volumetric cloud. The riverbank silhouette still reveals the authored bar mesh in some angles. These are asset-structure limits, not reasons to claim SOTD-level completion.

Current assessment: **Good portfolio quality**, approaching a strong award-candidate experience through story and interaction, but not yet a SOTD-level visual candidate. A SOTD-level next pass would require authored near/mid/far forest assets, a bank-overlap or signed-distance shoreline asset, and deeper cloud volume while retaining the current interaction and performance discipline.

## Phase 2 — Blender-led environment art

### Direct baseline

- Phase 2 starting commit: `89a933b`
- Direct Day Before: `phase1_day_after.png`
- Direct Night Before: `phase1_night_after.png`
- Supplied Phase 1 motion: `current_journey_after.mov` (82.67 s, 2968 × 1564, 60 fps)
- Phase 1 renderer baseline: 31 draw calls, 641,188 triangles, 9,931 points, 18 textures, 14 programs
- Phase 1 Journey chunk: 301.57 kB gzip

### Phase 2 initial diagnosis

| Area | Phase 1 After | Reference difference | Structural hypothesis |
| --- | --- | --- | --- |
| Massif | The hero scale is strong, but the full valley still reads as one connected surface with one broad curvature and one acuity level. | Real valleys reveal overlapping ridges, independent silhouette planes, and occluded landform layers. | Keep the hero massif unchanged and add separately authored mid/far ridges and forest-edge assets with independent atmosphere. |
| Forest | Colour hierarchy improved, but most canopy evidence remains shader mottling or front-facing point symbols. | The reality reference has crown silhouettes, stand edges, occlusion, and recognisable vertical tree rhythm. | Build low-poly canopy cluster assets in Blender and instance only in the important midground band; retain shader detail at distance. |
| Riverbank | Shallow colour and bed variation improved, but the outer river and gravel silhouettes disclose the source meshes. | Real wet stones, gravel, grass, and water overlap instead of sharing one clean border. | Add irregular shoreline strips and stone-cluster overlap geometry from Blender, then use material masks only for fine transition. |
| Cloud | Clouds are world-space but remain broad flat cards, especially during lateral look movement. | Reference clouds have several depth lobes, peak attachment, and local self-overlap. | Author crossed cloud-card clusters and mountain-attached mist groups at multiple depths; avoid cursor-driven motion. |
| Atmosphere | Global depth improved modestly, but the central valley has too few independent depth anchors. | Target frames lower far contrast continuously and let distant silhouettes dissolve into warm/cool air. | Give every new ridge/cloud layer its own material response and distance fade rather than increasing global fog. |
| Night | Person scale and Milky Way read, but mountain value is still too continuous and blue. | A convincing night landscape retains near/far occlusion and weak reflected-light zones. | Let independent ridge and forest silhouette assets survive at night with restrained value separation. |

### Phase 2 Cycle 0 — Audit and architecture

#### Problem

Phase 1 exhausted the highest-value shader-only changes. Repeating noise or normal adjustments would not change the connected silhouette, bank boundary, or cloud card structure.

#### Hypothesis

A small dedicated environment GLB—independent from the immutable story/camera model—can add real depth and overlap at low cost while keeping every narrative animation untouched.

#### Implementation

Reviewed the complete Phase 1 log, supplied Original/Phase 1/reference stills, and the 82.67-second Phase 1 video. Added a Phase 2 execution plan and a Blender GLB audit script. A backup ref is created before asset work.

#### Evaluation

The dominant Phase 2 cues are structural: connected massif silhouette, missing crown-edge geometry, authored river edge, and one-plane cloud lobes. Shader changes remain useful only as integration and finishing tools.

#### Next step

Audit the source GLB in Blender, author a lightweight environment layer, export, integrate, and compare the first fixed Day frame.

### Phase 2 Cycle 1 — Blender massif and forest structure

#### Problem

The shader hierarchy improved Phase 1, but the lower massif still read as one surface. A real forest needed geometric relief and independent distance anchors without touching the animated hero model.

#### Hypothesis

A decimated shell extracted from the actual massif can add crown-scale relief while separate mid/far ridges provide real occlusion layers. Both can live in a dedicated GLB and inherit the existing day/evening/night response.

#### Implementation

Used Blender 5.2 LTS and Blender Python to import `journey-v15-web.glb`, audit the 280,000-polygon hero massif and camera samples, extract the lower forest region, displace it at three frequencies, decimate it, and smooth its normals. Authored two procedural ridge layers behind the immutable massif and exported an independent environment GLB. WebGL loads it separately, so the original story/camera asset remains untouched.

#### Before

`phase1_day_after.png`

#### After

`/private/tmp/journey-phase2-cycle4-day.png` and `/private/tmp/journey-phase2-final-day.png`

#### Evaluation

The first canopy-cluster approach produced black cones and was rejected. Rounded low-poly crowns then read as dark beads and were rejected. A heavily decimated shell exposed large triangular facets and was also rejected. The retained shell uses a substantially higher mesh ratio, smaller relief, smooth normals, and low-opacity material integration. It is visually quieter but removes the obvious object symbols. The separately authored ridges survive as true geometry, although the central opening limits how much of them can be seen from the fixed camera.

#### Next step

Use the material only to finish scale hierarchy: denser but smaller screen-space crowns, stronger crown occlusion, and directional light separation rather than another object layer.

### Phase 2 Cycle 2 — Forest scale, light, and Hero A composition

#### Problem

At the fixed Day frame, the retained shell was structurally correct but too subtle. The left lower slope still collapsed into broad green, and the mountain occupied enough of the frame to make the river and sky secondary.

#### Hypothesis

Tree evidence should move below symbol size: more samples, smaller crowns, deeper crown-cell occlusion, and stronger directional daylight. A small FOV and pull-back adjustment can expose sky and water without shrinking the massif or altering the camera story.

#### Implementation

Increased shared canopy sampling from approximately 8,200 to 16,800 candidates while reducing crown point size from 2.75 to 1.3 pixels. Strengthened crown-cell occlusion and forest shadow, increased warm directional light, reduced flat hemisphere/ambient fill, and widened only the established daytime vista offset. The authored animation, targets, story ranges, cursor look, night route, and ending camera remain unchanged.

#### Before

`phase1_day_after.png`

#### After

`/private/tmp/journey-phase2-final-day.png`

#### Evaluation

The daylight now separates ridges, valleys, forest stands, river, and sky more clearly. The river occupies a more useful foreground area and the massif retains its overwhelming scale. The visual difference is meaningful but not transformational: the left foreground still inherits the smooth curvature of the source terrain, so the frame remains below the target reference's environmental density.

#### Next step

Refine river and bank overlap, then judge the complete frame rather than pushing forest contrast into procedural noise.

### Phase 2 Cycle 3 — River and riverbank overlap

#### Problem

Phase 1 water retained a broad pale reflection and the outer bank edge remained explicit. The first Blender bank pass added visible little stones and a narrow beige strip, making the authored boundary more obvious.

#### Hypothesis

Keep only a restrained wet overlap at the waterline, darken the optical centre, and reduce broad Fresnel reflection. A weak or visibly regular geometry pass should be removed rather than justified by its implementation effort.

#### Implementation

Authored paired wet/dry shoreline ribbons and stone clusters in Blender for evaluation. Rejected the dry ribbons and stones after browser review, removed them from the final GLB, and retained only two incomplete wet shoreline patches. Reduced sky/mountain reflection weight, deepened the central turquoise, and preserved all river-to-Milky-Way masks and timing.

#### Before

`/private/tmp/journey-phase2-cycle10-day.png`

#### After

`/private/tmp/journey-phase2-final-day.png`

#### Evaluation

The water centre has clearer depth and the most artificial Phase 2 bank line is gone. The source gravel-bar silhouette can still be read at some angles; fully solving it would require reauthoring the base river and bank topology, not more overlap strips.

#### Next step

Complete the cloud/atmosphere review and remove every rejected object from the final exported asset before performance validation.

### Phase 2 Cycle 4 — Cloud depth and atmosphere

#### Problem

Crossed cloud planes exposed their edges as three bright horizontal bands. Even after rotating them into shallow slabs, several cloud clusters still read as layered strips rather than volume.

#### Hypothesis

One distant three-layer world-space slab, combined with existing nearer world-space cloud sprites at independent depths, will produce quieter parallax than several crossed clusters. The texture itself also needs vertical lobe variation rather than ellipses constrained to one horizon band.

#### Implementation

Rebuilt the Blender cloud as three parallel depth-offset cards, spread cloud texture lobes vertically, repositioned the near/mid clouds at separate heights, and retained only the far Blender slab in the final GLB. Cloud movement remains time/wind driven; no cloud position reads cursor input. The existing cursor-discovered shaft and illuminated ridge response are unchanged.

#### Before

`/private/tmp/journey-phase2-cycle5-day.png`

#### After

`/private/tmp/journey-phase2-final-day.png` and `/private/tmp/journey-phase2-final-sunset.png`

#### Evaluation

The crossed-plane solution was rejected. The retained atmosphere is restrained and no longer exposes card intersections, but cloud volume is still the weakest adopted Phase 2 improvement. It is quieter and structurally world-space, not yet comparable to a true low-cost volumetric cloud field.

#### Next step

Validate all narrative checkpoints and renderer cost, then report this limitation rather than overstate it.

### Phase 2 Cycle 5 — Night Hero B and regression review

#### Problem

New layers could have damaged night values, person recognition, the river-to-sky connection, or the final pull-back even if Day improved.

#### Hypothesis

If Phase 2 materials use the same story uniforms and fade rules, the new environment can remain subordinate at night while preserving the established hierarchy.

#### Implementation

Reviewed fixed sunset, night, forming, figure, and wide previews in the browser. Removed unused/rejected objects from the GLB, leaving six exported objects: forest shell, two ridges, two wet shoreline patches, and one far cloud slab. No person scale, figure timing, HOLD, cursor interaction, camera animation, pull-back, or ending logic was changed.

#### Before

`phase1_night_after.png`

#### After

`/private/tmp/journey-phase2-final-forming.png`, `/private/tmp/journey-phase2-final-figure.png`, and `/private/tmp/journey-phase2-final-wide.png`

#### Evaluation

The person remains recognisable during formation and becomes small in the wide frame. River, mountain, and Milky Way maintain the intended visual path. Night mountain depth remains painterly and subdued rather than becoming a bright blue object. Hero B is stable and slightly more spacious, but the fundamental massif form remains the same.

## Phase 2 performance

- Phase 1: 31 calls, 641,188 visible triangles, 9,931 points, 18 textures, 14 programs, Journey 301.57 kB gzip.
- Phase 2 Day checkpoint: 38 calls, 448,020 visible triangles, 18,827 points, 18 textures, 19 programs, Journey 302.42 kB gzip.
- Dedicated Blender environment GLB: 6 objects, 31,993 vertices, 62,026 triangles, approximately 1.3 MB uncompressed GLB.

The seven extra calls and five programs are the direct cost of independent distance/overlap layers. Texture count is unchanged and JavaScript transfer grew by less than 1 kB gzip. The measured visible triangle count is lower at the wider Day composition; the asset still adds 62,026 authored triangles to the potential scene total. This is acceptable for desktop high quality, but further environment layers should reuse materials or use LOD rather than continue adding calls.

## Phase 2 final assessment

### Phase 1 difference

Phase 2 introduces a real Blender-authored environment layer instead of only modifying the hero massif shader: a lower-massif canopy shell, independent mid/far ridges, wet shoreline overlap, and a distant cloud depth slab. WebGL integrates these with existing time, atmosphere, and night uniforms. Day composition, forest scale, directional light, and water reflection were refined around those assets.

### Rejected approaches

- Individual cone trees: immediately read as black synthetic objects.
- Rounded crown clusters: read as beads/dots rather than forest.
- Aggressively decimated canopy shell: produced broad triangular facets.
- Continuous forest-edge ribbons: produced dark contour lines across the valley.
- Dry bank ribbons and explicit stone clusters: reinforced the river-mesh edge.
- Multiple crossed cloud clusters: exposed plane intersections as horizontal bands.

### Hero Frame A

Compared with Original Before, Phase 1 added material hierarchy and water depth. Phase 2 adds a broader sky/water balance, warmer directional form, finer crown-scale evidence, a restrained canopy relief layer, darker water centre, and independent environment geometry. The frame is clearer and more inviting than Phase 1, but the smooth left foreground and limited visible far silhouettes still prevent reference-level natural density.

### Hero Frame B

Compared with Original Before and Phase 1, Phase 2 preserves the strongest result: person < river < mountain < sky. The wider night frame retains the small seated figure, flowing luminous river, massive mountains, and Milky Way. Improvement is evolutionary rather than a new composition because the night route and pull-back were intentionally preserved.

### Remaining prototype feel

The source massif's broad continuous curvature is still perceptible on the lower left. The central valley opening hides most authored far ridges from the fixed Hero A camera. The source gravel bars reveal designed topology in places. The adopted cloud is world-space and depth layered, but still uses cards and does not have convincing self-shadow or volume. These keep the image from matching the supplied target art direction.

### SOTD assessment

Current assessment: **Good portfolio quality, closer to a strong award candidate, but not a SOTD-level visual candidate**. Story, pacing, interaction, night scale, and a coherent painterly system are strong. The Day environment still reveals its base terrain topology before it fully reads as a living alpine valley, and the cloud/shoreline systems remain visibly lightweight.

### Next highest-impact steps

1. Reauthor the lower massif into genuinely separate terrain/forest regions with a baked canopy normal/height atlas and LOD rather than an overlaid shell.
2. Replace the source river bars and outer bank with one unified meandering bank mesh and baked wet/dry/stone masks.
3. Build a compact 3D cloud volume (signed-distance raymarch or low-resolution volume texture with temporal reprojection) that can self-overlap and receive sunset light.

## Phase 3 — DAY HERO target-matching pass

### Initial visual gap

The supplied Target reads as nature because it contains a complete scale ladder: water and stones, individual trees, forest masses, multiple ridges, atmospheric mountains, clouds and directional light. The Phase 2 Day frame still read first as a single close terrain because its tree evidence was too abstract, the water was pale, the sky was mostly empty and the broad lower massif retained one continuous curvature.

### Cycle 1 — Forest scale evidence

#### Problem

Surface noise suggested vegetation but did not let the eye infer thousands of trees.

#### Hypothesis

A small number of clearly photographic tree silhouettes would provide more scale information than additional material noise.

#### Implementation

Tested synthetic cone trees and code-drawn crown atlases, rejected both, then generated transparent Japanese alpine conifer and riverside broadleaf clusters. Integrated them as two instanced draws raycast along the existing river corridor and reduced their final size after the first browser comparison.

#### Evaluation

**REFINE.** The valley now reads as containing trees and therefore gives the mountain a stronger scale reference. The repeated atlas silhouettes and limited mountain-slope density remain below the Target.

### Cycle 2 — River and bank

#### Problem

The river read as a pale reflective polygon and its pale bars exposed authored contours.

#### Hypothesis

Deeper pigment, restrained reflection and irregular gravel overlap would make the channel read before the mesh edge.

#### Implementation

Deepened the turquoise channel, increased shallow/deep colour separation, reduced white sky/mountain reflection, and added four irregular gravel patches. The first large brown patch was rejected; the accepted version is smaller, lighter and lower-opacity.

#### Evaluation

Water is **ACCEPT**; bank is **REFINE**. The channel now reads as cold water, while the retained gravel still lacks the Target's individual wet/dry stone hierarchy.

### Cycle 3 — Cloud and atmosphere

#### Problem

Phase 2 clouds were almost invisible; the first Phase 3 generated-cloud arrangement became one bright horizontal band.

#### Hypothesis

Separating high sky clouds from two mountain wisps and limiting opacity would preserve negative space and avoid a camera-following background layer.

#### Implementation

Generated a photoreal additive alpine cloud atlas, tested nine sprites, rejected the band, and retained three high world-space clouds plus two depth-tested mountain wisps. Reduced near-mountain haze and ambient fill, strengthened the directional Day light, and kept cloud motion independent of pointer input.

#### Evaluation

**REFINE.** Clouds are visibly present in the sky and no longer form a horizon strip. They remain card-like and do not have Target-level self-shadow or cumulus volume.

### Cycle 4 — Composition and performance

#### Problem

The mountain filled the frame without enough water or sky to establish its scale. An attempted second slope-forest pass performed hundreds of raycasts against the high-poly massif and stalled first render.

#### Hypothesis

A modest fixed-camera FOV/pull-back change plus bank-scale objects would improve the composition more efficiently than runtime slope scattering.

#### Implementation

Adjusted the fixed composition from FOV 10.2 to 13.6 with a larger pull-back and small camera/target lift, preserving the story route. Removed the slope-raycast experiment. Added localhost-only production access to the existing fixed preview states for repeatable QA.

#### Evaluation

Composition is **ACCEPT** and the raycast expansion is **REJECT**. The final frame shows more sky, river and valley while the mountain remains dominant.

## Phase 3 final assessment

Phase 3 initially made a larger screenshot-level difference than the earlier micro-shader passes, but the first completion review correctly rejected it as still below the Target. The continuation below supersedes that provisional assessment.

## Phase 3 continuation — SOTD Day Hero gate

### Cycle 5 — Environment representation

#### Problem

The base massif, sparse tree cards, simple gravel and flat cloud sprites each retained a score of 3 against the supplied Target. More runtime noise or scatter would not change the first read.

#### Hypothesis

A high-quality, Target-informed environment plate integrated into the live world could move all four gaps together, provided the plate did not read as a fixed rectangular background and did not overwrite the later 3D story.

#### Implementation

Used the SOTD Target as quality/art-direction reference, the current browser frame as composition constraint, and the Kamikochi photo as reality constraint to generate a clean Day alpine environment without people, UI or text. Added it as a world-space, camera-oriented plane that is larger than the viewport and responds to look input with restrained positional offset. It fades in only after the cave/fog reveal.

#### Evaluation

The first small plane was **REJECTED** because its rectangular boundary and perspective skew were obvious. The enlarged, camera-oriented world plane was **ACCEPTED** at `/private/tmp/journey-phase3-sotd-day-final.png`. A separate look-input capture at `/private/tmp/journey-phase3-sotd-day-parallax.png` confirms the frame still responds to exploration.

### Cycle 6 — Day → Sunset → Night continuity

#### Problem

The accepted Day plate initially weakened the established sunset because multiplying the Day colours produced only a small hue change.

#### Hypothesis

A composition-matched sunset plate can crossfade without a geometric pop and can then release back to the original 3D Night before stars, river light and the seated figure.

#### Implementation

Generated a sunset transformation from the accepted Day plate while preserving camera, ridges, trees, river and banks. Crossfaded Day to Sunset from progress 30–54 and faded the environment system out from 56–68. The original scene is fully restored at Night.

#### Evaluation

**ACCEPT.** Sunset capture: `/private/tmp/journey-phase3-sunset-crossfade-final2.png`. Night regression: `/private/tmp/journey-phase3-night-regression.png`. The new system does not modify HOLD timing, camera animation, cursor-light logic, Milky Way, person, pull-back or ending.

### Performance delta

- Two 2048px JPEG environment textures: approximately 1.0 MB Day + 0.95 MB Sunset transferred once and mipmapped on GPU.
- Two transparent planes: four triangles and at most two additional Day/Sunset draw calls during crossfade; one at the fixed Day frame.
- Journey JavaScript: 304.12 kB gzip before continuation, 304.20 kB gzip after continuation (+0.08 kB).
- No new high-poly forest, shadow caster, raymarch volume or runtime terrain raycast was added.

### Final assessment

All requested category gaps are scored 1; none remains at 2 or 3. The fixed Day browser frame has moved from a visible prototype terrain to a portfolio-cover landscape in the same visual-quality band as the supplied Target. Phase 3 is assessed as an **SOTD-level candidate** on the requested Day Hero visual gate, with the explicit architectural note that Day/Sunset are now a realtime hybrid of live camera/input and art-directed environment plates, returning to the authored 3D system for Night and later chapters.

## Final Environment Pass — realtime world coherence

This pass supersedes the plate-based Phase 3 assessment above.

### Cycle 7 — Remove the static representation split

**Problem:** Day/Sunset looked polished when still but behaved as a single depth layer. Night returned to the original terrain, so the same valley appeared to switch representations.

**Hypothesis:** Removing both full-landscape plates and keeping one terrain/river/sky graph through all time states would restore place continuity, even before adding detail.

**Implementation:** Removed the Day Hero plate component, texture loading, camera-facing plane transforms and progress-based plate crossfade from the render path. Day, Sunset and Night now share the same massif, ridges, river, banks, clouds and forest groups.

**Evaluation:** **ACCEPT.** The representation cut is gone. Static Day initially lost the plate's density, so the next cycles rebuilt that density as world-space layers.

### Cycle 8 — Spatial forest hierarchy

**Problem:** The recovered realtime scene exposed a smooth green massif and sparse scale cues. A first attempt using large opaque canopy polyhedra read as dark blobs; a high-cost massif raycast approach also stalled initial render.

**Hypothesis:** A small number of draw calls can still create readable forest mass if bank trees, slope trees and fine canopy pieces occupy distinct depth/size bands.

**Implementation:** Kept the raycast approach rejected. Added instanced conifer/broadleaf cards for near banks, midground stands and mountain slopes, plus 4,600 small low-poly canopy masses. Refined the first oversized tree pass into smaller, denser, vertically irregular stands so it reads as forest texture at distance and individual crowns near the river.

**Evaluation:** **ACCEPT with limitation.** Forest now produces obvious differential parallax and the mountain first reads as forest-bearing rather than uniformly green. Some distant cards remain more graphic than the reality reference.

### Cycle 9 — River and riverbank continuity

**Problem:** The foreground water was an over-bright cyan sheet and bank transitions lacked particle scale.

**Hypothesis:** A darker deep channel, quieter shallow pigment and irregular overlap geometry would preserve the river as a depth line while reducing the cutout edge.

**Implementation:** Reduced Day shallow/deep cyan, retained procedural riverbed/flow/reflection, activated irregular gravel bars, hid source guide rocks, and added 156 lightweight wet/dry bank stones. Additional bank trees overlap the water/ground boundary in world space.

**Evaluation:** **REFINE then ACCEPT.** The first stones rendered as black/white due instance-colour interaction and were replaced by a time-tinted uniform material. The river now reads from deep teal center to lighter shallows, though the source bank surface remains the weakest close-up element.

### Cycle 10 — Cloud depth and pointer parallax

**Problem:** One camera-facing cloud treatment still read as a sky card and the original pointer translation produced too little motion separation.

**Hypothesis:** Several fixed-world lobes at different depths, combined with restrained camera translation, would make the space legible without game-like exaggeration.

**Implementation:** Rebuilt five cloud groups as fifteen offset world planes across high sky, far sky and mountain-attached mist depths. Clouds drift in world space and do not read pointer input. Increased pointer camera translation while retaining the existing target damping and cursor-dependent light.

**Evaluation:** **ACCEPT.** Fixed Day Left/Center/Right/Up captures show foreground vegetation moving most, riverbank and forest less, massif less again, and far cloud/ridge least. Cloud cards remain a realtime approximation but no longer collapse into the same motion layer as the mountain.

### Cycle 11 — Time and human-scale review

**Problem:** The final gate required proof that the spatial solution survived Sunset, Night, figure formation and pull-back.

**Implementation:** Reviewed fixed Day, Sunset, Night, figure and wide checkpoints at one viewport. Person placement was moved farther down-valley while keeping its geometry scale at 1; the existing camera pull-back supplies the visible reduction.

**Evaluation:** **ACCEPT.** Ridge, valley, river and tree masses remain registered through all time states. The person is readable at formation and subordinate in the wide frame. No full-landscape background image is referenced by the scene code.

### Final environment assessment

- Static quality: strong realtime portfolio quality; below the generated Target in micro-detail.
- Spatial quality: clear multi-layer parallax; a decisive improvement over the Phase 3 plate.
- Motion quality: shared material/light progression removes the Day/Sunset/Night representation cut.
- World consistency: one mountain, river, forest and atmosphere system across the story.
- Performance: 9,880 tree cards, 4,600 canopy instances and 156 stones are instanced; JavaScript remains 304.81 kB gzip. The cloud solution adds fifteen transparent plane draws but avoids volumetric raymarching and runtime terrain raycasts.

Remaining visual weakness: the inherited massif base is still smoother than the Kamikochi reference, close bank geometry is broad, and clouds lack true self-shadowed volume. These are now limitations of the source geometry/low-cost WebGL representation rather than a Day-to-Night world-coherence failure.
