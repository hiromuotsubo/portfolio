import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const MASSING = join(ROOT, 'docs/references/journey-v3/baselines/massing')
const RUNTIME = join(ROOT, 'work/blender/journey-v3/phase1c/cave-runtime')

const progressSlug = (value) => value.toFixed(2).replace('.', '_')

async function requireFiles(paths) {
  for (const path of paths) await access(path)
}

async function fadedOverlay(path, opacity) {
  const { width, height } = await sharp(path).metadata()
  const alpha = Buffer.alloc(width * height, Math.round(opacity * 255))
  return sharp(path)
    .removeAlpha()
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer()
}

async function caveComposite(macroPath, runtimePath, outputPath, label) {
  const macro = await sharp(macroPath).png().toBuffer()
  const labelSvg = Buffer.from(`<svg width="1440" height="72">
    <rect width="1440" height="72" fill="#0b1118" fill-opacity="0.84"/>
    <text x="28" y="30" fill="#ffffff" font-family="Arial,sans-serif" font-size="20">${label}</text>
    <text x="28" y="55" fill="#9fc6d5" font-family="Arial,sans-serif" font-size="15">v002 clean macro + Journey V1 runtime cave/story diagnostic layer (32%)</text>
  </svg>`)
  await sharp(macro)
    .composite([
      { input: await fadedOverlay(runtimePath, 0.32), blend: 'over' },
      { input: labelSvg, left: 0, top: 0 },
    ])
    .png()
    .toFile(outputPath)
}

async function sheet(items, output, columns = 2, tileWidth = 720, tileHeight = 450) {
  const labelHeight = 42
  const rows = Math.ceil(items.length / columns)
  const composite = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const left = (index % columns) * tileWidth
    const top = Math.floor(index / columns) * (tileHeight + labelHeight)
    composite.push({
      input: await sharp(item.path).resize(tileWidth, tileHeight, { fit: 'contain', background: '#10171c' }).png().toBuffer(),
      left,
      top,
    })
    composite.push({
      input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#0c1217"/><text x="16" y="27" fill="#fff" font-family="Arial,sans-serif" font-size="17">${item.label}</text></svg>`),
      left,
      top: top + tileHeight,
    })
  }
  await sharp({
    create: {
      width: columns * tileWidth,
      height: rows * (tileHeight + labelHeight),
      channels: 4,
      background: '#10171c',
    },
  }).composite(composite).png().toFile(output)
}

async function addLegend(path, title, entries) {
  const buffer = await sharp(path).png().toBuffer()
  const columns = 4
  const legend = entries.map((entry, index) => {
    const x = 24 + (index % columns) * 250
    const y = 45 + Math.floor(index / columns) * 30
    return `<rect x="${x}" y="${y - 16}" width="18" height="18" fill="${entry.color}"/><text x="${x + 28}" y="${y}" fill="#fff" font-family="Arial,sans-serif" font-size="15">${entry.label}</text>`
  }).join('')
  const svg = Buffer.from(`<svg width="1040" height="112"><rect width="1040" height="112" rx="8" fill="#071016" fill-opacity="0.86"/><text x="24" y="25" fill="#fff" font-family="Arial,sans-serif" font-size="17">${title}</text>${legend}</svg>`)
  await sharp(buffer).composite([{ input: svg, left: 20, top: 768 }]).png().toFile(path)
}

async function main() {
  const caveProgress = [11.5, 13.5, 16, 20, 30]
  const required = []
  for (const progress of caveProgress) {
    required.push(join(MASSING, `selected-v002-cave-p${progressSlug(progress)}.png`))
    required.push(join(RUNTIME, `journey-v1-cave-p${progressSlug(progress)}.png`))
  }
  await requireFiles(required)

  await caveComposite(
    join(MASSING, 'candidate-a2-cave-composite.png'),
    join(RUNTIME, 'journey-v1-cave-p13_50.png'),
    join(MASSING, 'candidate-a2-cave-composite.png'),
    'Candidate A2 — progress 13.5 Cave Composite',
  )
  await caveComposite(
    join(MASSING, 'candidate-b2-cave-composite.png'),
    join(RUNTIME, 'journey-v1-cave-p13_50.png'),
    join(MASSING, 'candidate-b2-cave-composite.png'),
    'Candidate B2 — progress 13.5 Cave Composite',
  )

  const caveCompositeFrames = []
  for (const progress of caveProgress) {
    const slug = progressSlug(progress)
    const path = join(MASSING, `selected-v002-cave-composite-p${slug}.png`)
    await caveComposite(
      join(MASSING, `selected-v002-cave-p${slug}.png`),
      join(RUNTIME, `journey-v1-cave-p${slug}.png`),
      path,
      `Selected v002 — progress ${progress.toFixed(2)}`,
    )
    caveCompositeFrames.push({ path, label: `progress ${progress.toFixed(2)}` })
  }
  await sheet(caveCompositeFrames, join(MASSING, 'selected-v002-cave-composite.png'), 2, 720, 450)

  const sweepProgress = [11.5, 12, 13.5, 16, 20, 22, 23.5, 25, 28.25, 30]
  await sheet(
    sweepProgress.map((progress) => ({
      path: join(MASSING, `selected-v002-sweep-p${progressSlug(progress)}.png`),
      label: `progress ${progress.toFixed(2)}`,
    })),
    join(MASSING, 'selected-v002-camera-sweep-contact-sheet.png'),
    2,
    720,
    450,
  )

  await addLegend(join(MASSING, 'selected-v002-day-clear-zones.png'), 'Diagnostic Zone Review — blended guides, not final materials', [
    { label: 'ROCK', color: '#61574f' },
    { label: 'GRASS', color: '#4c8a29' },
    { label: 'FOREST', color: '#0c3817' },
    { label: 'SNOW', color: '#e1eaf2' },
    { label: 'WET', color: '#1a574a' },
    { label: 'FLOWER POTENTIAL', color: '#b3338c' },
    { label: 'RIVER EXCLUSION', color: '#076bab' },
    { label: 'WIND VEGETATION', color: '#e6991a' },
  ])
  await addLegend(join(MASSING, 'selected-v002-day-clear-river-guides.png'), 'River Structure Review', [
    { label: 'CENTERLINE', color: '#078cff' },
    { label: 'LEFT / RIGHT BANK', color: '#ff6110' },
    { label: 'RIVERBED', color: '#1c4a5c' },
  ])

  await sheet([
    { path: join(MASSING, 'selected-day-clear-start-clay.png'), label: 'Phase 1C v001 — visual rejected' },
    { path: join(MASSING, 'selected-v002-day-clear-clay.png'), label: 'Phase 1C.1 v002 — selected clean macro' },
    { path: join(MASSING, 'selected-day-clear-zones.png'), label: 'v001 zones — artificial boundaries' },
    { path: join(MASSING, 'selected-v002-day-clear-zones.png'), label: 'v002 zones — blended natural guides' },
  ], join(MASSING, 'phase1c-v001-vs-v002-contact-sheet.png'))

  await sheet([
    { path: join(ROOT, 'docs/references/journey-v3/visual-references/03_montfort_lighting_atmosphere.jpg'), label: 'Montfort — mountain mass / slope continuity' },
    { path: join(ROOT, 'docs/references/journey-v3/visual-references/01_hero_valley_target.png'), label: 'Hero Valley — open valley / river leading line' },
    { path: join(MASSING, 'selected-day-clear-start-clay.png'), label: 'Phase 1C v001 — canyon-wall technical pass' },
    { path: join(MASSING, 'selected-v002-day-clear-clay.png'), label: 'Phase 1C.1 v002 — asymmetric open macro' },
  ], join(MASSING, 'montfort-hero-v001-v002-comparison.png'))

  console.log('Phase 1C.1 comparison images generated')
}

await main()
