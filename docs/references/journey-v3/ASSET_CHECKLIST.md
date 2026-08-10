# Journey V3 — production asset checklist

## Reference material already included

- [x] Hero Valley concept image
- [x] Real Kamikochi naturalism reference
- [x] Montfort lighting/atmosphere screenshot
- [x] Montfort motion/fog keyframes
- [x] Journey v1 cave/day/night keyframes
- [x] Compressed Journey v1 and Montfort motion recordings

## Before final visual polish

- [ ] Generate or outpaint a 16:10 Hero Valley master at 2560×1600 or larger.
- [ ] Keep extra safe area on left, right, and top for responsive cropping.
- [ ] Slightly reduce AI-poster saturation while retaining the blue/green contrast.
- [ ] Produce an aligned depth map.
- [ ] Produce aligned masks for sky, far mountains, mid valley, river, foreground meadow, and fog zones.
- [ ] Produce a transparent flower atlas with multiple species and silhouettes.
- [ ] Produce a flower density/exclusion mask that removes river, gravel, and rocks.
- [ ] Optionally produce a river flow map and two small tiling normal maps.
- [ ] Convert runtime textures to suitable compressed web formats.
- [ ] Keep all review screenshots and recordings under `docs/`, never `public/`.

## Phase order

1. Daytime Clear Hero composition.
2. Cave-to-Hero continuity.
3. Fog/HOLD reveal.
4. Pointer-driven flower wind.
5. Performance, mobile, and reduced-motion support.
6. Only after approval: sunset → night → Milky Way → ending.
