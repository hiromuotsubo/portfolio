import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const OUTPUT = join(ROOT, 'docs/references/journey-v3/baselines/art-direction-v004')
const DIAGNOSTIC = join(OUTPUT, 'diagnostic')
const BROWSER = join(OUTPUT, 'browser')
const VOLUMETRIC = join(ROOT, 'docs/references/journey-v3/baselines/volumetric')
const VISUAL = join(ROOT, 'docs/references/journey-v3/visual-references')
const VIEWPORT = { width: 1440, height: 900 }

const image = (path, label) => ({ path, label })

async function makeSheet(output, entries, columns, cellWidth = 720, cellHeight = 450) {
  const labelHeight = 42
  const rows = Math.ceil(entries.length / columns)
  const composites = []
  for (const [index, entry] of entries.entries()) {
    const left = (index % columns) * cellWidth
    const top = Math.floor(index / columns) * (cellHeight + labelHeight)
    const buffer = await sharp(entry.path)
      .resize(cellWidth, cellHeight, { fit: 'contain', background: '#14252b' })
      .png()
      .toBuffer()
    composites.push({ input: buffer, left, top })
    const safe = entry.label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    const label = Buffer.from(`<svg width="${cellWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#14252b"/><text x="18" y="29" fill="white" font-size="22" font-family="Arial">${safe}</text></svg>`)
    composites.push({ input: label, left, top: top + cellHeight })
  }
  await sharp({ create: { width: columns * cellWidth, height: rows * (cellHeight + labelHeight), channels: 3, background: '#14252b' } })
    .composite(composites)
    .png()
    .toFile(output)
}

async function silhouetteMetrics(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1
  for (let offset = 0; offset < data.length; offset += 3) {
    const luminance = (data[offset] + data[offset + 1] + data[offset + 2]) / 3
    if (luminance < 150) continue
    const pixel = offset / 3
    const x = pixel % info.width
    const y = Math.floor(pixel / info.width)
    count += 1
    minX = Math.min(minX, x); minY = Math.min(minY, y)
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y)
  }
  return {
    maskMethod: 'emissive white terrain over black world, luminance >= 150',
    visibleTerrainPixels: count,
    visibleTerrainFraction: count / (info.width * info.height),
    skyFraction: 1 - count / (info.width * info.height),
    mountainSilhouetteBoundsPixels: count ? { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
  }
}

async function browserApproximation(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let sky = 0
  let river = 0
  let minTerrainY = info.height
  let minTerrainX = info.width
  let maxTerrainX = -1
  let riverMinX = info.width
  let riverMaxX = -1
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * 3
      const red = data[offset]
      const green = data[offset + 1]
      const blue = data[offset + 2]
      const isSky = y < info.height * 0.78 && blue > red * 1.08 && blue > green * 0.92
      const isRiver = y > info.height * 0.45 && blue > red * 1.18 && green > red * 1.06
      if (isSky) sky += 1
      else if (y < info.height * 0.75) {
        minTerrainY = Math.min(minTerrainY, y)
        minTerrainX = Math.min(minTerrainX, x)
        maxTerrainX = Math.max(maxTerrainX, x)
      }
      if (isRiver) {
        river += 1
        riverMinX = Math.min(riverMinX, x)
        riverMaxX = Math.max(riverMaxX, x)
      }
    }
  }
  return {
    maskMethod: 'documented RGB approximation; browser PBR/cloud/UI image has no semantic mask',
    skyFractionApprox: sky / (info.width * info.height),
    mountainTopYApprox: minTerrainY === info.height ? null : minTerrainY,
    mountainSilhouetteWidthApprox: maxTerrainX < 0 ? null : maxTerrainX - minTerrainX + 1,
    riverVisibleWidthApprox: riverMaxX < 0 ? null : riverMaxX - riverMinX + 1,
    riverPixelFractionApprox: river / (info.width * info.height),
  }
}

async function main() {
  await mkdir(DIAGNOSTIC, { recursive: true })
  for (const candidate of ['m', 'h']) {
    const entries = [
      image(join(OUTPUT, `candidate-${candidate}-cave-exit.png`), 'Cave Exit'),
      image(join(OUTPUT, `candidate-${candidate}-day-clear-clay.png`), 'Day Clear'),
      ...['sunset', 'night', 'river-hold', 'milky-way', 'seated-figure', 'final-wide', 'ending'].map((preview) =>
        image(join(DIAGNOSTIC, `candidate-${candidate}-story-${preview}.png`), preview)),
    ]
    await makeSheet(join(OUTPUT, `candidate-${candidate}-full-story-sweep.png`), entries, 3, 480, 300)
  }

  await makeSheet(join(OUTPUT, 'candidate-m-vs-h-day-clear.png'), [
    image(join(OUTPUT, 'candidate-m-day-clear-clay.png'), 'Candidate M — Montfort dominant'),
    image(join(OUTPUT, 'candidate-h-day-clear-clay.png'), 'Candidate H — Hero Valley dominant'),
  ], 2)
  await makeSheet(join(OUTPUT, 'candidate-m-vs-h-silhouette.png'), [
    image(join(OUTPUT, 'candidate-m-day-clear-silhouette.png'), 'Candidate M silhouette'),
    image(join(OUTPUT, 'candidate-h-day-clear-silhouette.png'), 'Candidate H silhouette'),
  ], 2)
  await makeSheet(join(OUTPUT, 'candidate-m-vs-h-final-wide.png'), [
    image(join(OUTPUT, 'candidate-m-final-wide.png'), 'Candidate M Final Wide'),
    image(join(OUTPUT, 'candidate-h-final-wide.png'), 'Candidate H Final Wide'),
  ], 2)
  await makeSheet(join(OUTPUT, 'candidate-m-vs-h-top-side.png'), [
    image(join(OUTPUT, 'candidate-m-top-view.png'), 'M Top'),
    image(join(OUTPUT, 'candidate-h-top-view.png'), 'H Top'),
    image(join(OUTPUT, 'candidate-m-side-view.png'), 'M Side'),
    image(join(OUTPUT, 'candidate-h-side-view.png'), 'H Side'),
  ], 2)
  await makeSheet(join(OUTPUT, 'montfort-hero-v003-m-h.png'), [
    image(join(VISUAL, '03_montfort_lighting_atmosphere.jpg'), 'Montfort — mass and slope reference'),
    image(join(VISUAL, '01_hero_valley_target.png'), 'Hero Valley — composition reference'),
    image(join(VOLUMETRIC, 'v003-day-clear-clay.png'), 'v003 continuous 3D foundation'),
    image(join(OUTPUT, 'candidate-m-day-clear-clay.png'), 'Candidate M'),
    image(join(OUTPUT, 'candidate-h-day-clear-clay.png'), 'Candidate H'),
  ], 3, 480, 300)

  const candidateM = JSON.parse(await readFile(join(OUTPUT, 'candidate-m-structure.json'), 'utf8'))
  const candidateH = JSON.parse(await readFile(join(OUTPUT, 'candidate-h-structure.json'), 'utf8'))
  const v003 = JSON.parse(await readFile(join(VOLUMETRIC, 'phase-1c2-v003-structure-validation.json'), 'utf8'))
  const metrics = {
    schemaVersion: 1,
    viewport: VIEWPORT,
    journeyV1: {
      dayClear: await browserApproximation(join(BROWSER, 'journey-v1-day-clear.png')),
      finalWide: await browserApproximation(join(BROWSER, 'journey-v1-final-wide.png')),
    },
    candidates: {
      M: {
        browserProjection: candidateM.screenMetrics,
        dayClearImageMask: await silhouetteMetrics(join(OUTPUT, 'candidate-m-day-clear-silhouette.png')),
        finalWideImageMask: await silhouetteMetrics(join(DIAGNOSTIC, 'candidate-m-final-wide-silhouette.png')),
      },
      H: {
        browserProjection: candidateH.screenMetrics,
        dayClearImageMask: await silhouetteMetrics(join(OUTPUT, 'candidate-h-day-clear-silhouette.png')),
        finalWideImageMask: await silhouetteMetrics(join(DIAGNOSTIC, 'candidate-h-final-wide-silhouette.png')),
      },
    },
  }
  await writeFile(join(OUTPUT, 'screen-space-measurements.json'), `${JSON.stringify(metrics, null, 2)}\n`)
  const geometry = {
    schemaVersion: 1,
    commonAuthoringGrid: '6 world-unit uniform height-field grid',
    v003: {
      grid: v003.grid,
      objects: v003.objects,
      deterministicSignature: v003.deterministicSignature,
    },
    candidateM: candidateM.geometryBudget,
    candidateH: candidateH.geometryBudget,
    notes: {
      indexPolicy: 'Each mesh remains below 65,536 vertices; 16-bit indices are sufficient per primitive.',
      currentDensity: 'Near, mid and far use the same authoring density; this is intentionally not a runtime LOD.',
      memoryUnits: 'blenderMaxRssRaw is the platform ru_maxrss value reported by Blender on macOS (bytes).',
      estimatedGeometrySize: 'Position, normal, UV, eight scalar masks and triangle indices; excludes materials, containers and compression.',
    },
  }
  await writeFile(join(OUTPUT, 'geometry-budget.json'), `${JSON.stringify(geometry, null, 2)}\n`)
}

await main()
