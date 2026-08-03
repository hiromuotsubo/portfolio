import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const photos = [
  ['portrait-soba.png', 'about-portrait.webp', 0.72],
  ['perspective-mountain.png', 'about-perspective.webp', 0.74],
  ['stillness-mist.png', 'about-stillness.webp', 0.82],
  ['origin-kamikochi.png', 'about-origin.webp', 0.76],
]

for (const [input, output, saturation] of photos) {
  await sharp(fileURLToPath(new URL(`../work/about/source/${input}`, import.meta.url)))
    .resize(1500, 1000, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: 0.98, saturation })
    .linear(0.92, 10)
    .sharpen({ sigma: 0.45 })
    .webp({ quality: 84, effort: 6 })
    .toFile(fileURLToPath(new URL(`../public/portfolio/${output}`, import.meta.url)))
}
