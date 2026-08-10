# Journey V3 — Codex reference index

Place this folder in the repository at:

`docs/references/journey-v3/`

These files are review/reference material only. Do not import them into production code, and do not serve them from `public/`.

## Baseline rule

- Journey v1 is the behavioral and narrative baseline.
- Journey v2 was an experiment and must not be used as the implementation baseline.
- Journey v3 must be created as a separate route and implementation.
- Existing `/journey` must remain unchanged until Journey v3 is approved.

## Visual references

### `visual-references/01_hero_valley_target.png`
**Role:** Primary composition and emotional art-direction target.

Use it for:
- the large, close mountain range;
- the turquoise river leading into the valley;
- the colorful flower meadow in the foreground;
- the blue/green contrast;
- the sense of scale and immediate emotional impact.

Do not treat it as the final runtime texture. It is a 4:3 concept reference and must eventually be replaced by a crop-safe 16:10 production master.

### `visual-references/02_kamikochi_natural_reference.jpg`
**Role:** Naturalism check.

Use it for:
- believable vegetation scale and density;
- restrained color;
- atmospheric perspective;
- natural mountain and river relationships;
- avoiding an oversaturated AI travel-poster look.

### `visual-references/03_montfort_lighting_atmosphere.jpg`
**Role:** Rendering-quality reference only.

Use it for:
- coherent directional sunlight;
- light haze and depth separation;
- terrain/material integration;
- water reflection;
- stable, cinematic framing.

Do not copy Montfort's terrain shape, brand, UI, typography, exact page composition, or exact color grade.

## Motion and transition references

### `keyframes/04_montfort_transition_contact_sheet.jpg`
**Role:** Reference for restrained motion and continuous fog-to-landscape transitions.

### `keyframes/05_montfort_fog_transition.jpg`
**Role:** Reference for fog wrapping around terrain volume instead of becoming a flat white screen.

### `keyframes/06_journey_v1_cave_exit.jpg`
**Role:** Preserve Journey v1's cave threshold, opening composition, and narrative continuity.

### `keyframes/07_journey_v1_day_negative_baseline.jpg`
**Role:** Negative baseline. Fix the stretched/modelled terrain feel, flat water, weak material variation, and insufficient foreground detail.

### `keyframes/08_journey_v1_night_regression.jpg`
**Role:** Regression reference only. Do not rebuild night during Phase 1.

### `keyframes/09_journey_v1_contact_sheet.jpg`
**Role:** Preserve Journey v1's complete narrative order and timing while `/journey-v3` is developed separately.

## Recordings

The MP4 files are motion/timing references. The still images above are the primary source of truth.

- `recordings/10_journey_v1_start_to_night.mp4`
- `recordings/11_journey_v1_night_to_end.mp4`
- `recordings/12_montfort_motion_reference.mp4`

## External reference URL

- `https://mont-fort.com/capital/`

Use this only for lighting, atmosphere, depth, water integration, and restrained motion. Do not reproduce the site's brand or composition.

## Production assets still required for final polish

Store final runtime assets under `public/journey-v3/`, not this reference folder.

Minimum recommended assets:

1. `hero/valley-day-16x10.webp` — 2560×1600 or larger with crop-safe margins.
2. `hero/valley-depth.png` — aligned grayscale depth map.
3. Aligned masks for `sky`, `far-mountains`, `mid-valley`, `river`, `foreground-meadow`, and `fog-zones`.
4. `flowers/flower-atlas.png` — transparent atlas with multiple species and silhouettes.
5. `flowers/flower-density.png` — legal placement area; exclude river, gravel, and rocks.
6. Optional `river/flow-map.png` and small tiling normal maps for restrained water motion.
