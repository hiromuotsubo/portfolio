# Journey V3 — Phase 1 implementation brief

## Read first

Read the repository-root `AGENTS.md` before editing anything and follow it as the source of truth.

Then inspect the current official Journey implementation, Journey v1. Journey v1 is the behavioral and narrative baseline for this task.

Journey v2 is an experiment. Do not use Journey v2 as the implementation baseline. You may inspect it only for isolated reusable ideas after understanding Journey v1.

Also read:

- `docs/references/journey-v3/REFERENCE_INDEX.md`
- `docs/references/journey-v3/ASSET_CHECKLIST.md`
- every primary still image listed in the reference index
- the Journey v1 recordings for timing and continuity

Run `git status` first. Do not discard, overwrite, reset, or silently replace unrelated work.

## Scope boundary

Create Journey v3 as a separate implementation and route, preferably `/journey-v3`.

Do not replace, refactor, or visually modify the existing `/journey` route in this task.
Do not promote Journey v3 to the main Journey route yet.
Do not use `/journey-v2` as the base route or main source of truth.

This phase ends at the completed daytime Clear Hero Valley state.

Do not implement sunset, night, Milky Way, the final pull-back, silhouettes, Thank-you transition, or ending in this task.

## Goal

Build Journey v3 as a visual evolution of Journey v1 that:

1. preserves Journey v1's Loading → Cave → Fog/HOLD → Clear progression;
2. preserves Journey v1's authored scroll and HOLD behavior;
3. connects the cave exit to the Hero Valley without a visible asset swap;
4. matches the composition and emotional impact of `01_hero_valley_target.png`;
5. approaches the coherent lighting, haze, depth, water integration, and restrained motion shown in the Montfort references;
6. keeps the authored camera composition stable;
7. changes pointer input from camera/parallax movement into a local wind force that bends foreground flowers in the direction of pointer movement.

The intended feeling is physically believable, slightly more beautiful than reality, quiet, vast, and worth lingering in.

## Core interaction principle

> The story moves the camera. The pointer moves the air.

The Journey progression may move the camera in an authored, controlled way.
Pointer input must not move the camera or the whole landscape.

## Reference hierarchy

Do not blend every reference indiscriminately. Use each one for a specific responsibility.

### Primary composition target

`docs/references/journey-v3/visual-references/01_hero_valley_target.png`

Use it for:

- the colorful flower meadow in the foreground;
- the turquoise river as a leading line;
- the wide green valley;
- the large, close mountain range;
- the blue/green color contrast;
- the immediate emotional impact.

It is a 4:3 concept reference, not the final runtime master. Never stretch it non-uniformly. Document any crop limitations and production-asset gaps.

### Naturalism target

`docs/references/journey-v3/visual-references/02_kamikochi_natural_reference.jpg`

Use it for:

- believable vegetation scale and density;
- restrained saturation;
- atmospheric perspective;
- real-world mountain, river, and forest relationships.

### Rendering-quality target

`docs/references/journey-v3/visual-references/03_montfort_lighting_atmosphere.jpg`

and:

- `keyframes/04_montfort_transition_contact_sheet.jpg`
- `keyframes/05_montfort_fog_transition.jpg`
- `recordings/12_montfort_motion_reference.mp4`
- `https://mont-fort.com/capital/`

Use them only for:

- coherent sun direction;
- terrain volume revealed by light and shadow;
- haze separating distance layers;
- integrated water reflection;
- slow, restrained motion;
- fog that wraps the terrain rather than covering the screen as a flat card.

Do not copy Montfort's mountain shape, branding, UI, typography, exact composition, or exact color grade.

### Journey v1 behavior target

Use the Journey v1 keyframes, recordings, and current source code to preserve:

- the cave threshold;
- the progression timing;
- the HOLD interaction;
- the narrative order;
- the UI language and tone.

Treat `07_journey_v1_day_negative_baseline.jpg` as a negative visual baseline, not a target.

## Required implementation strategy

Use a hybrid representation suited to a directed camera path. Do not rebuild the entire Hero Valley as a dense Blender-style full-3D world.

Recommended division:

- Cave and threshold: preserve/refine Journey v1's close spatial treatment.
- Far mountains and sky: high-quality image/depth layers or image projected onto shallow depth geometry.
- Mid valley: depth-aware layered mesh/masks with only authored story motion.
- River: aligned photographic base plus a masked, subtle WebGL distortion/reflection layer.
- Foreground meadow: static photographic density underneath plus a real instanced flower layer above it.
- Fog: local depth/height layers gathering in the valley and around the river, never a fullscreen white card.
- UI: DOM/CSS above WebGL.

Use the existing React, Three.js, React Three Fiber, drei, and GSAP stack when available. Avoid adding a large dependency unless clearly necessary and documented.

Suggested structure; adapt only when the repository suggests a better split:

```text
src/journey-v3/
  JourneyV3.jsx
  JourneyV3Scene.jsx
  CaveThreshold.jsx
  HeroValley.jsx
  ValleyFog.jsx
  RiverShimmer.jsx
  FlowerMeadow.jsx
  usePointerWind.js
  journeyV3Config.js
  shaders/
    flowerWind.js
```

Keep route/orchestration responsibilities separate from scene components. Do not create another very large single component.

## Preserve Journey v1 progression

Journey v3 should reuse or faithfully reproduce Journey v1's progression logic without modifying Journey v1 itself.

Required Phase 1 sequence:

1. Loading
2. Cave
3. Cave exit approach
4. Fog/HOLD checkpoint
5. Clear Hero Valley
6. Short visual stillness window
7. Pointer-driven flower wind becomes available

The sequence must be reversible where Journey v1 is reversible.

## Cave → fog → clear connection

Use the same Hero Valley source behind the cave from the beginning so there is no late visual swap.

During the cave stage:

- lower exterior exposure and saturation;
- conceal fine detail with local valley fog;
- preserve the cave silhouette and threshold framing;
- keep the distant mountain silhouette consistent with the final Clear frame.

As the viewer approaches the exit:

- move the cave edge naturally out of frame through authored progression;
- gradually raise exterior exposure;
- reveal the mountain silhouette before fine texture;
- reveal the river color next;
- reveal the flower color last;
- uncover layers by depth rather than fading the entire scene uniformly.

At the fog checkpoint, preserve Journey v1's HOLD behavior. HOLD thins valley fog; it must not suddenly spawn or fade in objects.

## Hero composition

At 1440×900 in the Clear state:

- flowers occupy roughly the lower 20–30% without blocking the river;
- the river begins in the lower-middle/right area and leads toward the valley center;
- the mountain range dominates the upper-middle image and feels near and immense;
- the sky occupies roughly 20–27%;
- the valley remains open enough to communicate scale;
- no prominent foreground conifer interrupts the view;
- the composition remains stable under pointer movement.

The scene must be attractive and emotionally complete with no interaction.

## Camera and pointer rule

Pointer input must not change:

- camera position;
- camera quaternion or rotation;
- camera field of view;
- mountain, sky, river, cave, or whole-landscape transforms.

Remove pointer-driven camera or whole-scene parallax from the Clear Hero Valley.

Authored scroll/HOLD motion may move the camera, but pointer motion must not add a viewpoint offset.

## Pointer-driven flower wind

Implement wind from pointer velocity and direction, not absolute cursor position.

Expected behavior:

- rightward movement creates a local rightward gust;
- leftward movement creates the opposite response;
- faster movement creates a stronger gust within a restrained clamp;
- the gust decays naturally after the pointer stops;
- flowers near the pointer's projected meadow position react most strongly;
- the response propagates slightly through nearby flowers rather than affecting the entire meadow instantly;
- a weak ambient wind remains when the pointer is still;
- the meadow does not sway in perfect synchronization.

### Input mapping

Track current and previous pointer positions with timestamps.
Low-pass filter noisy deltas.
Convert screen-space movement into a world-space direction using camera right/up projected onto the meadow plane.
Raycast the pointer into a simple meadow interaction plane to determine the gust origin.

Use refs and shader uniforms. Do not update React state every frame for pointer motion.

Suggested uniforms:

```text
uTime
uAmbientDirection
uAmbientStrength
uGustOrigin
uGustDirection
uGustStrength
uGustRadius
uGustAge
```

Suggested per-instance attributes:

```text
root position
scale
phase
stiffness
species/atlas cell
small color variation
```

### Flower geometry and shader behavior

Use GPU instancing. Do not create one React component or draw call per flower.

Use a small number of flower/grass clump geometries, such as two to four crossed alpha-tested cards per clump. Keep material and draw-call groups low.

In the vertex shader:

- keep roots fixed;
- increase bend toward the tip;
- combine low-amplitude ambient wind with the local gust;
- use spatial falloff from the gust origin;
- add per-instance phase and stiffness variation;
- add a short propagation delay so the response reads as air travelling through flowers;
- damp naturally after the gust;
- clamp maximum bend so it never looks rubbery or storm-like.

Target feel:

- attack around 50–120 ms;
- visible decay around 0.7–1.2 seconds;
- normal maximum bend around 8–12 degrees;
- ambient movement barely visible until the viewer pays attention.

A tiny number of pollen or seed particles may appear only during a stronger gust, but keep this optional, subtle, natural, and performant. Do not create a magical cursor trail.

### Touch and reduced motion

Do not conflict with vertical swipe/scroll progression.

On touch devices, use ambient wind by default. A tap may create one subtle local radial gust after Clear, but do not hijack vertical swipes.

Respect `prefers-reduced-motion` by reducing or disabling gusts, ambient swaying, fog drift, and river distortion while preserving a complete static scene.

## Flower placement

The immediate foreground must read as a colorful flower meadow, not a forest.

- Do not add individual foreground conifer trees.
- Use purple/blue, yellow, white, and pink flowers.
- Create natural clusters, gaps, and species variation.
- Exclude the river, gravel, and rocks with a density/exclusion mask.
- Keep dense static flowers in the underlying image and animate only a carefully placed foreground subset.
- Ensure no flowers float, intersect the river, or form a repeated grid.

## River

Do not rebuild the river as a flat cyan plane.

For Phase 1, preserve the photographic river base and add a masked, subtle animated layer:

- low-frequency flow distortion following the river direction;
- soft reflection/highlight response;
- slightly clearer or shallower edges;
- restrained whitewater only where suggested by the source image;
- no motion outside the river mask;
- no visible polygon edge or rectangular overlay;
- no neon emission.

## Lighting and atmosphere

The target is not literal photographic detail everywhere. The target is one coherent world.

Implement:

- one clear directional sun consistent across mountains, meadow, fog, and water;
- low-frequency mountain-surface variation;
- soft atmospheric perspective separating near, middle, and far ridges;
- restrained exposure and tone mapping;
- a slight warm/cool relationship between sunlight and sky shadow;
- subtle water reflection integrated with the scene;
- shadowed areas that retain detail;
- distant detail softened by depth.

Avoid:

- fullscreen bloom wash;
- overexposed white sky covering a large area;
- uniform green materials;
- high-frequency repeated texture noise;
- neon water;
- a global color filter pretending to be lighting;
- oversaturation that resembles an AI travel poster.

Configure Three.js color space and tone mapping correctly.

## Performance budget

- Keep draw calls low.
- Use instancing for flowers.
- Prefer alpha test or alpha hash over many fully transparent sorted surfaces where practical.
- Cap DPR appropriately, for example around 1.5 on desktop and lower on mobile.
- Lower flower density, fog quality, and river distortion on mobile.
- Avoid high-poly distant geometry.
- Reuse textures and materials.
- Dispose resources on unmount.
- Avoid per-frame React state updates.
- Preserve accessibility and responsive behavior.

Target smooth desktop behavior on an M1 MacBook-class machine and a graceful mobile fallback.

## Visual validation workflow

Do not consider the task complete because the code builds.

Use the existing preview query mechanism or add an equivalent stable debug mechanism for:

- Loading
- Cave
- Fog/HOLD
- Clear

Capture fixed screenshots at:

- 1440×900 desktop;
- 390×844 mobile.

Compare Clear directly against:

- `01_hero_valley_target.png` for composition;
- `02_kamikochi_natural_reference.jpg` for naturalism;
- `03_montfort_lighting_atmosphere.jpg` for lighting and atmosphere;
- `07_journey_v1_day_negative_baseline.jpg` to confirm the model feel has materially decreased.

Iterate after the first implementation. Do not stop at the first visually plausible frame.

Manually verify:

1. pointer movement never changes the camera or whole landscape;
2. rightward pointer movement creates a rightward local gust;
3. flowers settle naturally after the pointer stops;
4. flowers do not move in sync;
5. no flower appears in the river;
6. cave-to-valley transition does not reveal separate flat images;
7. fog has depth and never becomes a white card;
8. the Clear frame remains attractive with the pointer still;
9. mobile vertical swipes still work;
10. reduced-motion mode remains complete and usable.

## Required checks before completion

Run:

```bash
npm run lint
npm run build
```

Resolve relevant errors and warnings.
Check the browser console.

Summarize:

- files changed;
- architecture chosen;
- how Journey v1 behavior was preserved without modifying `/journey`;
- how pointer velocity maps to wind;
- performance decisions;
- visual comparisons performed;
- remaining production-asset gaps, especially the 16:10 Hero master, masks, depth map, and flower atlas.

## Acceptance criteria

The phase passes only when all are true:

- `/journey` remains unchanged as Journey v1;
- `/journey-v3` exists as a separate implementation;
- Journey v2 was not used as the baseline;
- Loading → Cave → Fog/HOLD → Clear works in Journey v3;
- the cave exit and final valley use one visually continuous landscape;
- the Clear frame is compositionally close to the Hero target;
- mountains feel large and volumetric rather than like a stretched model;
- the foreground is a flower meadow with no prominent conifers;
- the river is integrated and not a flat cyan strip;
- fog occupies the valley by depth;
- pointer movement does not move the viewpoint;
- pointer direction and speed create local, decaying flower wind;
- the scene is beautiful and complete without interaction;
- desktop and mobile remain usable and performant;
- lint/build pass and no relevant console errors remain.
