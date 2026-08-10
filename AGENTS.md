# Repository working agreement

## Journey purpose

Journey exists to let a visitor re-experience the awe of standing before the vast landscape of Kamikochi. The target is a place that feels physically believable, slightly more beautiful than reality, quiet, and worth lingering in.

## Journey visual rules

- Preserve the core story: cave, exit, fog, HOLD, clearing, day, evening, night, river light, Milky Way, seated person, camera pull-back, and ending.
- Preserve the overwhelming scale of the mountains. Do not solve a wall-like image by simply shrinking or moving the mountains far away.
- Prefer naturalism, quietness, atmosphere, and immersion over conspicuous effects.
- The purpose of look development is to reduce the perception of a 3D model and increase the perception of a living landscape.
- Do not solve realism only by adding geometry. Use scale cues, material variation, light, shadow, atmosphere, and distance-appropriate representations.
- Preserve WebGL performance. Prefer shaders, baked or procedural detail, instancing, LOD, and distance-based representation over brute force.
- After every material look change, inspect the actual browser output at the same camera and story positions.
- Compare before and after captures at fixed Hero Frame positions; do not rely on memory.
- Do not mark look development complete after one successful implementation or build.
- Compare against both the Kamikochi reality reference and the target art-direction reference.
- If an approach produces only a small visual improvement, record it and try a materially different approach.
- Preserve interactions, timing, mobile controls, and narrative beats that already work.
- Treat build success as a regression check, never as evidence of visual success.

## Fixed review frames

- Hero Frame A: the open daytime valley immediately after the fog has cleared.
- Hero Frame B: the final night-wide composition with river, seated person, mountain, Milky Way, and sky.
- Additional regression frames: cave exit, fog HOLD, evening, river HOLD, figure formation, and ending.

## Delivery workflow

- After requested changes are implemented, visually or technically verified, and committed, push the completed commits to the current upstream branch even when the user does not explicitly repeat a push request.
- Do not push unfinished, failing, or knowingly broken work merely to satisfy this default; finish the relevant verification first.

## Journey V2 isolation

- Build Journey V2 as a separate `/journey-v2` route. Do not replace or refactor `/journey` while V2 is being evaluated.
- Treat the viewer's real Kamikochi photographs as topology, scale and light truth; AI may transform materials but must not invent the base landscape.
- Build the V2 proof of concept in this order: Loading → Cave → Fog → Clear. Do not extend the representation to Sunset/Night/Awe until the threshold and reveal pass visual and motion review.
- Prefer layered 2D/2.5D, masks, local shaders and directed camera motion. Use Blender only when a close spatial element cannot be expressed convincingly by those means.
- A beautiful center frame does not pass if the threshold, reveal, pointer parallax or motion exposes separate images.

## Journey V3 authoritative directive

This section is the authoritative rule for all work on `/journey-v3`.
It overrides the Journey V2 isolation rules when working on Journey V3.

- Journey V3 must use the existing `/journey` implementation, called Journey V1, as its sole implementation and behavioral baseline.
- Journey V3 is a direct evolution of Journey V1, not an evolution of Journey V2.
- Do not use `JourneyV2.jsx`, `JourneyV2.css`, Journey V2 scene architecture, or Journey V2 assets as the base of Journey V3.
- Do not import Journey V2 components into Journey V3.
- Preserve Journey V1's cave, continuous 3D space, camera path, scroll progression, HOLD interactions, fog reveal, daytime, sunset, night, river light, Milky Way, figure, pull-back, sound, UI, and ending.
- Build Journey V3 as a Blender-led 3D and WebGL look-development pass.
- Blender is a first-class production tool for Journey V3, not a last-resort tool.
- Use Blender for terrain massing, mountain silhouettes, valley structure, riverbanks, shoreline assets, meadow geometry, vegetation authoring, UVs, material masks, baking, LOD preparation, and GLB export where appropriate.
- Use WebGL for runtime lighting, atmosphere, fog, water, time-of-day transitions, flower wind, interaction, animation, sound synchronization, and performance-aware rendering.
- Do not use layered CSS images or a flat 2D/2.5D scene as the primary Journey V3 world.
- Image projection, matte painting, depth plates, and 2.5D techniques may only be used as supporting detail for distant scenery, while preserving a continuous spatial 3D world.
- The Hero Valley image is an art-direction and composition target, not a replacement for the Journey V1 world.
- Montfort is a lighting, atmosphere, depth, water, and motion-restraint reference. Do not copy its terrain, UI, branding, or scene architecture.
- Preserve `/journey` unchanged while `/journey-v3` is evaluated.
- Back up the existing V2-derived Journey V3 prototype before replacing it.
- Before implementation, produce a file and asset map proving that Journey V1, not Journey V2, is the selected base.
- For Journey V3 mountain reconstruction, the mountain landscape shown at https://mont-fort.com/capital/ is the primary mountain look-development reference for macro terrain massing, ridge silhouette, slope continuity, valley carving, erosion structure, rock-and-vegetation integration, perceived scale, lighting, and atmosphere.
- Do not copy Montfort's exact terrain geometry. Reinterpret those mountain qualities within Journey V1's fixed camera path and the Hero Valley composition.
- When references conflict, use this priority order: Journey V1 camera, behavior, and continuous 3D space first; Montfort mountain form and look development second; Hero Valley overall composition third; Kamikochi naturalism and vegetation fourth.

## Journey V3 delta contract

Journey V3 is Journey V1 with a rebuilt and improved natural environment. It is not a different story, camera experience, or interaction structure.

Unless a difference is explicitly listed below, Journey V3 must match Journey V1 in camera path, progress mapping, HOLD gates, timing, sound, UI, daytime transition, sunset, night, river-light sequence, Milky Way, seated figure, final pull-back, and ending.

The required Journey V3 differences are:

1. The foreground and valley floor include a naturally clustered, colorful flower meadow. Purple, blue, yellow, white, and pink flowers should make the daytime frame more colorful than Journey V1 without resembling uniformly scattered decorative objects.

2. The mountains are rebuilt through Blender-led look development. The mountain environment shown at https://mont-fort.com/capital/ is the primary reference for mountain massing, ridge silhouette, slope continuity, valley carving, erosion structure, rock-and-vegetation integration, perceived scale, lighting, and atmospheric depth.

3. Pointer movement no longer changes the camera viewpoint. Pointer direction and velocity generate a local wind field that may affect physically wind-reactive elements such as foreground flowers, grass, low shrubs, slope vegetation, forest canopy, light fog, pollen, and subtle water ripples.

4. Wind must not deform bedrock, terrain mass, mountain silhouettes, cave geometry, riverbanks, or the authored camera path. “Mountain surface movement” means subtle movement in vegetation growing on the mountain surface, not movement of the mountain itself.

5. River, ground, vegetation, and material boundaries must be naturally separated. Green terrain must not leak into the river, vegetation must not appear in water or float above terrain, shoreline materials must not create rectangular or stretched artifacts, and masks must follow the actual geometry.

6. Journey V3 must preserve a continuous 3D world. Hero Valley imagery is an art-direction target, not a fullscreen background replacement.

Reference priority:

1. Journey V1 camera, behavior, timing, and continuous 3D space
2. Montfort mountain form and look development
3. Hero Valley overall valley, river, meadow, and color composition
4. Kamikochi naturalism, vegetation, and restrained color