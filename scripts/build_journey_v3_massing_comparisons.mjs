import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import sharp from 'sharp'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUT = resolve(ROOT, 'docs/references/journey-v3/baselines/massing')
const REFERENCES = resolve(ROOT, 'docs/references/journey-v3')

const sweep = ['11_50', '12_00', '13_50', '16_00', '20_00', '22_00', '23_50', '25_00', '28_25', '30_00']

function labelSvg(width, height, label) {
  const escaped = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  return Buffer.from(`<svg width="${width}" height="${height}">
    <rect x="0" y="${height - 38}" width="${width}" height="38" fill="rgba(8,18,23,0.72)"/>
    <text x="16" y="${height - 13}" font-family="Arial,sans-serif" font-size="20" fill="white">${escaped}</text>
  </svg>`)
}

async function tile(path, width, height, label) {
  return sharp(path)
    .resize(width, height, { fit: 'contain', background: '#16252c' })
    .composite([{ input: labelSvg(width, height, label), left: 0, top: 0 }])
    .png()
    .toBuffer()
}

async function contactSheet(entries, columns, tileWidth, tileHeight, output) {
  const rows = Math.ceil(entries.length / columns)
  const composites = []
  for (const [index, entry] of entries.entries()) {
    composites.push({
      input: await tile(entry.path, tileWidth, tileHeight, entry.label),
      left: (index % columns) * tileWidth,
      top: Math.floor(index / columns) * tileHeight,
    })
  }
  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * tileHeight,
      channels: 3,
      background: '#16252c',
    },
  })
    .composite(composites)
    .png()
    .toFile(output)
}

await mkdir(OUT, { recursive: true })

await contactSheet(
  sweep.map((progress) => ({
    path: resolve(OUT, `selected-sweep-p${progress}.png`),
    label: `Journey V1 final camera — progress ${progress.replace('_', '.')}`,
  })),
  5,
  480,
  300,
  resolve(OUT, 'selected-camera-sweep-contact-sheet.png'),
)

await contactSheet(
  [
    ['candidate-a-day-clear-clay.png', 'Candidate A — Montfort mass'],
    ['candidate-a-day-clear-zones.png', 'Candidate A — zones'],
    ['candidate-b-day-clear-clay.png', 'Candidate B — open valley'],
    ['candidate-b-day-clear-zones.png', 'Candidate B — zones'],
    ['selected-day-clear-start-clay.png', 'Selected Hybrid — Cycle 2'],
    ['selected-day-clear-zones.png', 'Selected Hybrid — zones'],
  ].map(([file, label]) => ({ path: resolve(OUT, file), label })),
  3,
  480,
  300,
  resolve(OUT, 'phase-1c-candidate-comparison-contact-sheet.png'),
)

await contactSheet(
  [
    ['visual-references/03_montfort_lighting_atmosphere.jpg', 'Montfort — massif and slope continuity'],
    ['visual-references/01_hero_valley_target.png', 'Hero Valley — valley, river, meadow'],
    ['baselines/screenshots/day-clear-start-1440x900-canvas.png', 'Journey V1 camera baseline'],
    ['baselines/massing/selected-day-clear-start-clay.png', 'Selected Phase 1C macro'],
  ].map(([file, label]) => ({ path: resolve(REFERENCES, file), label })),
  2,
  720,
  450,
  resolve(OUT, 'phase-1c-reference-comparison-contact-sheet.png'),
)

const browser = resolve(REFERENCES, 'baselines/screenshots/day-clear-start-1440x900-canvas.png')
const selected = resolve(OUT, 'selected-day-clear-start-clay.png')
const selectedHalf = await sharp(selected)
  .resize(1440, 900, { fit: 'contain', background: '#000' })
  .removeAlpha()
  .ensureAlpha(0.5)
  .png()
  .toBuffer()
await sharp(browser)
  .resize(1440, 900, { fit: 'contain', background: '#000' })
  .composite([
    { input: selectedHalf },
    {
      input: labelSvg(1440, 900, '50% overlay — Journey V1 browser + Phase 1C selected macro'),
      left: 0,
      top: 0,
    },
  ])
  .png()
  .toFile(resolve(OUT, 'selected-silhouette-overlay.png'))

console.log('Journey V3 Phase 1C comparison sheets regenerated.')
