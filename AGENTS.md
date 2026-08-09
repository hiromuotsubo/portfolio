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
