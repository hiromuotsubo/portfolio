# Journey long-horizon look development execution plan

This plan is a living checkpoint. A pass is complete only after browser capture, reference comparison, evaluation, and a log update.

## Safety and baselines

- Preserve the starting commit with a local backup ref.
- Keep the supplied `current_day_before.png` and `current_night_before.png` as immutable baselines.
- Use fixed preview states and the same viewport for repeatable comparisons.
- Commit major passes separately so Mountain / Forest, River, Sky / Cloud, Atmosphere / Lighting, and Performance can be reviewed or reverted independently.

## Passes

1. **Current Scene audit** — inspect source assets, shader branches, draw calls, timings, interactions, and the complete supplied video.
2. **Reference analysis** — compare reality, target art direction, daytime before, and nighttime before across mountain, forest, river, riverbank, sky, cloud, atmosphere, lighting, composition, and scale.
3. **Mountain / forest pass** — establish large forest masses, canopy clusters, crown-scale breakup, drainage, and distance-aware detail.
4. **Vegetation transition pass** — blend rock, scrub, sparse forest, dense forest, grass, and riverbank using altitude, slope, valley moisture, and noise.
5. **River / riverbank pass** — add water-depth color, transparent shallows, riverbed cues, reflection breakup, flow, wet gravel, and irregular bank transitions.
6. **Sky / cloud pass** — restore thin world-space cloud layers, peak-touching cloud, distant cloud, and a credible opening for the existing light shaft.
7. **Atmosphere / depth pass** — separate foreground, midground, background, far background, and sky with progressive contrast, saturation, detail, and haze.
8. **Lighting pass** — use directional light to explain ridges, valleys, rock faces, canopy, and the cloud-opening-to-lit-ridge relationship in day, evening, and night.
9. **Composition pass** — make small framing changes only when necessary to share mountain, sky, water, far distance, light, and negative space without reducing mountain scale or changing the camera story.
10. **Hero Frame A** — iterate the post-fog daytime frame until it reads as a place before it reads as a WebGL terrain.
11. **Hero Frame B** — iterate the final wide night frame until person < river < mountain < sky reads immediately.
12. **Performance validation** — compare renderer statistics, asset size, build output, frame pacing, and mobile quality; remove detail whose visual benefit is too small.
13. **Final visual review** — replay every narrative beat, compare fixed before/after frames, list remaining weaknesses honestly, and update the SOTD assessment.

## Cycle gate

For every major pass: inspect current browser frame, capture, compare with references, identify at most three dominant CG cues, change the highest-impact cue, build and run, recapture, evaluate visual impact, log the result, then either iterate with a new hypothesis or proceed.

