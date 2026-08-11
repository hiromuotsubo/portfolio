# Journey V1 production-completion pass

## Scope lock

`/journey` remains the V1 experience. Its authored camera animation, scroll and
hold mechanics, cave-to-valley story progression, Day → Sunset → Night cadence,
Milky Way sequence, and ending remain in place. The V3 route and its working
files were not used as runtime geometry and are intentionally outside this
change set.

## Production changes

- Narrowed the shader-trimmed, authored S-river at its foreground end while
  retaining its existing centreline and late-story water mesh.
- Made the procedural alluvial overlays darker and lower-opacity so that they
  read as wet gravel rather than pale geometric islands.
- Rendered cave shell material from both sides. The entry camera can now read
  the inside of the existing cave rather than appearing as a black interval.
- Mounted the progress bridge after the suspense-resolved scene. This removes
  the first-load React warning caused by loader-store updates during scene
  suspension, without changing the loading overlay contract.

## Browser review

Local fixed-frame review used the development-only `/journey?preview=`
checkpoints after GLB/shader loading settled:

| Checkpoint | Result |
| --- | --- |
| `cave` | Interior cave shell and exit are readable; authored cave path retained. |
| `foghold`, `day` | Continuous valley framing with a materially narrower S-river and subdued gravel overlays. |
| `sunset`, `night` | Existing time-of-day handoff remains visible and stable. |
| `final`, `wide` | Existing Milky Way, river light and ending figure remain in the V1 sequence. |
| Mobile 390×844 (`day`, `final`) | Portrait framing, river centreline, star field and ending figure remain within the viewport. |

The viewport override was reset after mobile review. Console review after the
loader fix found no React runtime error or shader compilation error. The
existing Three.js `Clock` deprecation warning remains upstream of this change.

## Verification

```text
npm run lint  # pass
npm run build # pass
```

Vite continues to report its existing large-chunk advisory for the KTX2 loader;
it is a build-size advisory, not a build failure.

## Release record

- Git commit: `c39b7ee` — `fix(journey): refine v1 river and cave readability`
- Production deployment: <https://portfolio-5rmpi6ak0-hiromu2.vercel.app/journey>
- Deployment check: Vercel reported **Ready** for Production and the public
  page completed asset loading and entered the cave start frame.
