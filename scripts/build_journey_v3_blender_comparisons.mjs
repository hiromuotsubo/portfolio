import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCREENSHOT_DIR = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/screenshots',
)
const OUTPUT_DIR = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/blender',
)
const KEYS = ['cave-exit', 'day-clear-start', 'day-clear-late']

const readRgba = async (path) => {
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, info }
}

const luminance = (data, pixelIndex) =>
  data[pixelIndex * 4] * 0.2126 +
  data[pixelIndex * 4 + 1] * 0.7152 +
  data[pixelIndex * 4 + 2] * 0.0722

function sobel(data, width, height) {
  const output = new Uint8Array(width * height)
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1]
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1]
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let horizontal = 0
      let vertical = 0
      let kernelIndex = 0
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const value = luminance(data, (y + offsetY) * width + x + offsetX)
          horizontal += value * gx[kernelIndex]
          vertical += value * gy[kernelIndex]
          kernelIndex += 1
        }
      }
      output[y * width + x] = Math.min(255, Math.hypot(horizontal, vertical))
    }
  }
  return output
}

await mkdir(OUTPUT_DIR, { recursive: true })
const report = { schemaVersion: 1, comparisons: [] }

for (const key of KEYS) {
  const baselinePath = join(SCREENSHOT_DIR, `${key}-1440x900-canvas.png`)
  const browserPath = join(OUTPUT_DIR, `${key}-browser.png`)
  const blenderPath = join(OUTPUT_DIR, `${key}-blender.png`)
  const overlayPath = join(OUTPUT_DIR, `${key}-overlay.png`)
  const edgePath = join(OUTPUT_DIR, `${key}-edges.png`)
  await sharp(baselinePath).png().toFile(browserPath)
  const browser = await readRgba(browserPath)
  const blender = await readRgba(blenderPath)
  if (
    browser.info.width !== blender.info.width ||
    browser.info.height !== blender.info.height
  ) {
    throw new Error(`Non-matching comparison dimensions for ${key}`)
  }
  const { width, height } = browser.info
  const overlay = Buffer.alloc(width * height * 4)
  let absoluteDifference = 0
  for (let index = 0; index < width * height; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const browserValue = browser.data[index * 4 + channel]
      const blenderValue = blender.data[index * 4 + channel]
      overlay[index * 4 + channel] = Math.round(
        browserValue * 0.5 + blenderValue * 0.5,
      )
      absoluteDifference += Math.abs(browserValue - blenderValue)
    }
    overlay[index * 4 + 3] = 255
  }
  await sharp(overlay, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(overlayPath)

  const browserEdges = sobel(browser.data, width, height)
  const blenderEdges = sobel(blender.data, width, height)
  const edges = Buffer.alloc(width * height * 4)
  let browserEdgePixels = 0
  let blenderEdgePixels = 0
  for (let index = 0; index < width * height; index += 1) {
    const browserEdge = browserEdges[index] >= 48 ? browserEdges[index] : 0
    const blenderEdge = blenderEdges[index] >= 48 ? blenderEdges[index] : 0
    if (browserEdge) browserEdgePixels += 1
    if (blenderEdge) blenderEdgePixels += 1
    edges[index * 4] = browserEdge
    edges[index * 4 + 1] = blenderEdge
    edges[index * 4 + 2] = blenderEdge
    edges[index * 4 + 3] = 255
  }
  await sharp(edges, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(edgePath)
  report.comparisons.push({
    key,
    width,
    height,
    browser: browserPath,
    blender: blenderPath,
    overlay: overlayPath,
    edges: edgePath,
    edgeLegend: { browser: 'red', blender: 'cyan', overlap: 'near white' },
    meanAbsoluteRgbDifference: absoluteDifference / (width * height * 3),
    browserEdgePixels,
    blenderEdgePixels,
    interpretation:
      'Color difference is diagnostic only. Projection validity is determined by mesh-derived landmark pixel error.',
  })
}

await writeFile(
  join(OUTPUT_DIR, 'image-comparison-summary.json'),
  `${JSON.stringify(report, null, 2)}\n`,
)
console.log(JSON.stringify(report, null, 2))
