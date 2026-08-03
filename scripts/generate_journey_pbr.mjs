import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const projectRoot = path.resolve(import.meta.dirname, '..')
const sourceDirectory = path.join(projectRoot, 'work/pbr/extracted')
const sourceGltf = path.join(sourceDirectory, 'journey.gltf')
const outputGltf = path.join(sourceDirectory, 'journey-pbr.gltf')

const clampByte = (value) => Math.max(0, Math.min(255, Math.round(value)))

async function derivePbrMaps(imagePath, strength, roughnessBase) {
  const { data, info } = await sharp(imagePath)
    .greyscale()
    .blur(0.85)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const normal = Buffer.alloc(info.width * info.height * 3)
  const metalRough = Buffer.alloc(info.width * info.height * 3)
  const sample = (x, y) => {
    const wrappedX = (x + info.width) % info.width
    const wrappedY = (y + info.height) % info.height
    return data[wrappedY * info.width + wrappedX] / 255
  }

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const left = sample(x - 1, y)
      const right = sample(x + 1, y)
      const up = sample(x, y - 1)
      const down = sample(x, y + 1)
      const center = sample(x, y)
      const dx = (right - left) * strength
      const dy = (down - up) * strength
      const length = Math.hypot(dx, dy, 1)
      const offset = (y * info.width + x) * 3
      normal[offset] = clampByte(((-dx / length) * 0.5 + 0.5) * 255)
      normal[offset + 1] = clampByte(((dy / length) * 0.5 + 0.5) * 255)
      normal[offset + 2] = clampByte((1 / length * 0.5 + 0.5) * 255)

      const edge = Math.min(1, Math.abs(dx) + Math.abs(dy))
      const roughness = Math.min(0.97, roughnessBase + (1 - center) * 0.13 + edge * 0.1)
      metalRough[offset] = 0
      metalRough[offset + 1] = clampByte(roughness * 255)
      metalRough[offset + 2] = 0
    }
  }

  const stem = path.basename(imagePath, path.extname(imagePath))
  const normalName = `${stem}-normal.png`
  const metalRoughName = `${stem}-metalrough.png`
  await Promise.all([
    sharp(normal, { raw: { width: info.width, height: info.height, channels: 3 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(path.join(sourceDirectory, normalName)),
    sharp(metalRough, { raw: { width: info.width, height: info.height, channels: 3 } })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(path.join(sourceDirectory, metalRoughName)),
  ])
  return { normalName, metalRoughName }
}

const gltf = JSON.parse(await readFile(sourceGltf, 'utf8'))
const mapsByImage = new Map()
const sourceImageCount = gltf.images.length

for (let imageIndex = 0; imageIndex < sourceImageCount; imageIndex += 1) {
  const image = gltf.images[imageIndex]
  const isVegetation = image.name?.includes('vegetation')
  const isCave = image.name?.includes('cave')
  const maps = await derivePbrMaps(
    path.join(sourceDirectory, image.uri),
    isVegetation ? 1.65 : isCave ? 2.75 : 2.35,
    isVegetation ? 0.79 : isCave ? 0.7 : 0.74,
  )
  const normalImageIndex = gltf.images.push({
    name: `${image.name}-normal-generated`,
    mimeType: 'image/png',
    uri: maps.normalName,
  }) - 1
  const metalRoughImageIndex = gltf.images.push({
    name: `${image.name}-metalrough-generated`,
    mimeType: 'image/png',
    uri: maps.metalRoughName,
  }) - 1
  const normalTextureIndex = gltf.textures.push({ source: normalImageIndex, sampler: 0 }) - 1
  const metalRoughTextureIndex = gltf.textures.push({ source: metalRoughImageIndex, sampler: 0 }) - 1
  mapsByImage.set(imageIndex, { normalTextureIndex, metalRoughTextureIndex })
}

for (const material of gltf.materials) {
  const baseTextureInfo = material.pbrMetallicRoughness?.baseColorTexture
  if (!baseTextureInfo) continue
  const sourceImage = gltf.textures[baseTextureInfo.index]?.source
  const generated = mapsByImage.get(sourceImage)
  if (!generated) continue
  const textureCoordinates = {
    ...(baseTextureInfo.texCoord == null ? {} : { texCoord: baseTextureInfo.texCoord }),
    ...(baseTextureInfo.extensions ? { extensions: baseTextureInfo.extensions } : {}),
  }
  material.normalTexture = {
    index: generated.normalTextureIndex,
    scale: material.name?.includes('Cave') || material.name?.includes('CAVE') ? 0.72 : 0.54,
    ...textureCoordinates,
  }
  material.pbrMetallicRoughness.metallicRoughnessTexture = {
    index: generated.metalRoughTextureIndex,
    ...textureCoordinates,
  }
  material.pbrMetallicRoughness.roughnessFactor = 1
  material.pbrMetallicRoughness.metallicFactor = 0
}

await writeFile(outputGltf, `${JSON.stringify(gltf, null, 2)}\n`)
console.log(`Generated PBR texture set: ${outputGltf}`)
