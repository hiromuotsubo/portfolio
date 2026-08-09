# Journey Look Development Phase 2 execution plan

Phase 1 established the shader, water, cloud, and review baseline. Phase 2 is a Blender-led environment-art pass. A pass is complete only after Blender/export integration where applicable, browser capture, reference comparison, a second refinement, evaluation, and a log update.

## Safety and baselines

- Preserve the starting commit with a local backup ref.
- Keep the supplied `current_day_before.png` and `current_night_before.png` as immutable baselines.
- Use fixed preview states and the same viewport for repeatable comparisons.
- Commit major passes separately so Mountain / Forest, River, Sky / Cloud, Atmosphere / Lighting, and Performance can be reviewed or reverted independently.

## Passes

1. **Phase 1 audit** — reread the repository rules, completed cycles, rejected canopy-normal and cloud-band tests, and the Phase 1 renderer baseline.
2. **Reference comparison** — compare Original Before, Phase 1 After, reality, target art direction, and the supplied Phase 1 motion capture at fixed day/night frames.
3. **Massif structure analysis** — inspect GLB object bounds, topology, materials, and camera path to identify safe structural additions without changing the hero massif scale.
4. **Distance-layer architecture** — author independent midground and far-background ridge silhouettes with their own depth, value, and atmospheric response.
5. **Mountain material zoning** — preserve the hero mesh while improving rock, scrub, sparse forest, dense forest, grass, drainage, and valley-shadow zoning.
6. **Forest canopy asset development** — use Blender to author reusable low-poly canopy clusters and WebGL instancing/LOD rather than relying on one procedural colour noise field.
7. **Midground forest silhouette** — establish recognisable crown edges and stand masses where the valley floor meets the mountain.
8. **Vegetation transition** — integrate canopy assets with slope-, altitude-, valley-, and moisture-aware material transitions.
9. **Riverbank overlap assets** — author irregular Blender shoreline patches, gravel bars, and wet-stone clusters that interrupt the source river edge.
10. **River refinement** — integrate the overlap assets with depth colour, bed visibility, reflection, and flow without breaking the river-to-Milky-Way transition.
11. **Cloud depth improvement** — replace the single-plane read with crossed world-space cloud cards and separated peak/far/mist depth groups.
12. **Atmosphere / distant layers** — tune contrast, saturation, detail, and atmospheric colour independently for foreground through far background.
13. **Blender → WebGL integration** — export a dedicated Phase 2 environment GLB, optimise it, load it independently from the immutable story/camera GLB, and verify in browser.
14. **Hero Frame A review** — complete at least two visual comparisons and refinements against Phase 1 Day and both references.
15. **Hero Frame B review** — complete at least two visual comparisons and refinements against Phase 1 Night while preserving person, river, Milky Way, and pull-back.
16. **Performance validation** — compare draw calls, triangles, points, textures, programs, Journey chunk, and frame pacing against Phase 1.
17. **Final visual review** — replay all fixed narrative checkpoints, record rejected approaches, list remaining prototype cues honestly, and update the award-level assessment.

## Cycle gate

For every major pass: inspect current browser frame, capture, compare with references, identify at most three dominant CG cues, change the highest-impact cue, build and run, recapture, evaluate visual impact, log the result, then either iterate with a new hypothesis or proceed.

## Phase 2 completion record

All 17 passes were executed. Mountain/forest, river/riverbank, and cloud/atmosphere each received an initial Blender/WebGL implementation, browser review, rejection or acceptance decision, and a second refinement. The final asset retains only adopted geometry. Fixed Day, sunset, night, forming, figure, and wide frames, build, lint, and renderer metrics were reviewed. Remaining source-massif, gravel-bar, and card-cloud limitations are documented in `docs/journey-lookdev-log.md`; they are not treated as visually complete or SOTD-level.
