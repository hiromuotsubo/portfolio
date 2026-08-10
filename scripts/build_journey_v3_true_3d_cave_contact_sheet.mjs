import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const directory = join(root, 'docs/references/journey-v3/baselines/massing/true-3d-cave')
const frames = [
  ['11-5', 'progress 11.5'],
  ['13-5', 'progress 13.5'],
  ['16', 'progress 16'],
  ['20', 'progress 20'],
  ['23-5', 'progress 23.5'],
  ['25', 'progress 25'],
  ['28-25', 'progress 28.25'],
  ['30', 'progress 30'],
]

const tileWidth = 720
const tileHeight = 450
const labelHeight = 42
const columns = 2

async function contactSheet(suffix, outputName, title) {
  const composites = []
  for (let index = 0; index < frames.length; index += 1) {
    const [slug, label] = frames[index]
    const path = join(directory, `true-3d-cave-progress-${slug}${suffix}.png`)
    await access(path)
    const left = (index % columns) * tileWidth
    const top = Math.floor(index / columns) * (tileHeight + labelHeight)
    composites.push({
      input: await sharp(path).resize(tileWidth, tileHeight, { fit: 'fill' }).png().toBuffer(),
      left,
      top,
    })
    composites.push({
      input: Buffer.from(`<svg width="${tileWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#0b1117"/><text x="16" y="27" fill="#fff" font-family="Arial,sans-serif" font-size="17">${title} — ${label}</text></svg>`),
      left,
      top: top + tileHeight,
    })
  }
  await sharp({
    create: {
      width: columns * tileWidth,
      height: 4 * (tileHeight + labelHeight),
      channels: 4,
      background: '#0b1117',
    },
  }).composite(composites).png().toFile(join(directory, outputName))
}

await contactSheet('', 'true-3d-cave-camera-sweep-contact-sheet.png', 'True 3D clay')
await contactSheet('-silhouette', 'true-3d-cave-silhouette-contact-sheet.png', 'True 3D silhouette')
await contactSheet('-top-down', 'true-3d-cave-top-down-contact-sheet.png', 'True 3D top-down')
console.log('True 3D cave contact sheets generated')
