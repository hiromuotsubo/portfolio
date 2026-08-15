import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const inputPath = new URL(
  '../work/blender/journey-v1-cave-macro-v004/journey-cave-macro-v004.glb',
  import.meta.url,
).pathname
const outputPath = new URL(
  '../public/journey/models/journey-cave-macro-v004.glb',
  import.meta.url,
).pathname

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  })

await MeshoptEncoder.ready

const document = await io.read(inputPath)
await document.transform(meshopt({
  encoder: MeshoptEncoder,
  level: 'high',
  // The cave spans roughly 34 world units. Sixteen position bits keep the
  // maximum quantization interval below one millimetre while preserving the
  // authored topology, silhouette, material assignment, and camera path.
  quantizePosition: 16,
  quantizeNormal: 16,
  quantizationVolume: 'mesh',
}))

await io.write(outputPath, document)
