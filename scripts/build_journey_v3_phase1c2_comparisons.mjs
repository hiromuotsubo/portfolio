import { resolve } from 'node:path'
import sharp from 'sharp'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'docs/references/journey-v3/baselines/volumetric')
const DIAGNOSTIC = resolve(OUT, 'diagnostic')
const MASSING = resolve(ROOT, 'docs/references/journey-v3/baselines/massing')
const REFERENCES = resolve(ROOT, 'docs/references/journey-v3/visual-references')

const escapeXml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

async function tile(path, label, width, height) {
  const image = await sharp(path)
    .resize(width, height - 42, { fit: 'contain', background: '#10181d' })
    .png()
    .toBuffer()
  const labelSvg = Buffer.from(`
    <svg width="${width}" height="42" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#10181d"/>
      <text x="18" y="27" fill="#eef5f7" font-family="Arial,sans-serif" font-size="18">${escapeXml(label)}</text>
    </svg>`)
  return sharp({
    create: { width, height, channels: 4, background: '#10181d' },
  }).composite([
    { input: image, left: 0, top: 0 },
    { input: labelSvg, left: 0, top: height - 42 },
  ]).png().toBuffer()
}

async function sheet(items, output, columns, tileWidth = 720, tileHeight = 492) {
  const rows = Math.ceil(items.length / columns)
  const composites = []
  for (const [index, item] of items.entries()) {
    composites.push({
      input: await tile(item.path, item.label, tileWidth, tileHeight),
      left: (index % columns) * tileWidth,
      top: Math.floor(index / columns) * tileHeight,
    })
  }
  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * tileHeight,
      channels: 4,
      background: '#10181d',
    },
  }).composite(composites).png().toFile(resolve(OUT, output))
}

const caveProgress = ['11-5', '13-5', '16-0', '20-0', '23-5', '25-0', '28-25', '30-0']
await sheet(
  caveProgress.map((progress) => ({
    path: resolve(DIAGNOSTIC, `v003-cave-geometry-p${progress}.png`),
    label: `Geometry-only · progress ${progress.replace('-', '.')}`,
  })),
  'v003-cave-true-3d-contact-sheet.png',
  4,
)

const sweepProgress = ['11-5', '12-0', '13-5', '16-0', '20-0', '22-0', '23-5', '25-0', '28-25', '30-0']
await sheet(
  sweepProgress.map((progress) => ({
    path: resolve(DIAGNOSTIC, `v003-sweep-p${progress}.png`),
    label: `Runtime-equivalent · progress ${progress.replace('-', '.')}`,
  })),
  'v003-cave-to-day-camera-sweep.png',
  5,
  576,
  402,
)

const story = ['sunset', 'night', 'river-hold', 'milky-way', 'seated-figure', 'final-wide', 'ending']
await sheet(
  story.map((preview) => ({
    path: resolve(DIAGNOSTIC, `v003-story-${preview}.png`),
    label: preview,
  })),
  'v003-full-story-camera-sweep.png',
  4,
)

await sheet([
  { path: resolve(MASSING, 'selected-v002-top-view.png'), label: 'v002 top · rejected ribbon structure' },
  { path: resolve(OUT, 'v003-top-view.png'), label: 'v003 top · continuous 2D footprint' },
  { path: resolve(MASSING, 'selected-v002-side-view.png'), label: 'v002 side · curtain / arch profiles' },
  { path: resolve(OUT, 'v003-side-view.png'), label: 'v003 side · multi-section terrain depth' },
], 'v002-vs-v003-top-side-comparison.png', 2)

await sheet([
  { path: resolve(REFERENCES, '03_montfort_lighting_atmosphere.jpg'), label: 'Montfort · massif continuity / perceived scale' },
  { path: resolve(REFERENCES, '01_hero_valley_target.png'), label: 'Hero Valley · valley / river / meadow composition' },
  { path: resolve(MASSING, 'selected-v002-day-clear-clay.png'), label: 'v002 · composition pass, structural reject' },
  { path: resolve(OUT, 'v003-day-clear-clay.png'), label: 'v003 · volumetric macro terrain' },
], 'montfort-hero-v002-v003-comparison.png', 2)

console.log('Journey V3 Phase 1C.2 comparison sheets generated')
