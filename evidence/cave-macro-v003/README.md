# Journey V1 Cave macro v003 — QA evidence

The PNGs in this folder are local visual checkpoints captured during the
three-pass Cave rebuild at 1440×900 and 390×844. They are intentionally not
Production assets.

- `desktop-cave-start.png`: straight-camera start
- `desktop-cave-middle.png`: continuous shell / portal approach during lookdev
- `desktop-cave-exit.png`: exit checkpoint from the refinement pass
- `desktop-fog-clear.png`: same-position Fog/HOLD valley reveal
- `mobile-cave-middle-390x844.png`: portrait corridor coverage
- `ending-home-settled.png`: final Memory → Home settled composition

The Loader-only mobile capture is retained as a visual-ready regression
checkpoint. After the captured lookdev pass, the separate puddle mesh was
removed because runtime approach made it read as a placed prop; dampness is
now integrated into the stone/floor shader. The final implementation was also verified by the deterministic
camera audit: X, Y, FOV, yaw, pitch, and roll remain fixed from progress 0 to
13.5; only Z changes monotonically.
