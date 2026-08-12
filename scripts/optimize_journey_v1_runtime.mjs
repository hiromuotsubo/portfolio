import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { prune, simplifyPrimitive } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'

const inputPath = new URL('../public/journey/models/journey-v16-pbr-ktx2.glb', import.meta.url).pathname
const outputPath = new URL('../public/journey/models/journey-v17-runtime-optimized.glb', import.meta.url).pathname

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  })

await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready])

const document = await io.read(inputPath)
const root = document.getRoot()
const removableNodes = new Set([
  'BAR_V13_LEFT_MID',
  'BAR_V13_RIGHT_FOREGROUND',
  'FX_V13_WATER_RIPPLES',
  'RIV_V13_VISIBLE_PEBBLE_BED.001',
  'WEB_RIVERBANK_ROCKS_PLACED_00',
  'WEB_RIVERBANK_ROCKS_PLACED_01',
])

for (const node of root.listNodes()) {
  if (removableNodes.has(node.getName())) node.dispose()
}

// JourneyScene keeps this semantic node as the clear-river material anchor,
// then swaps in the procedural S-river geometry. Keep one microscopic valid
// triangle instead of shipping the unused 6,720-triangle source channel.
const riverNode = root.listNodes()
  .find((node) => node.getName() === 'RIV_V13_EMERALD_S_WATER.001')
const riverPrimitive = riverNode?.getMesh()?.listPrimitives()[0]
if (!riverPrimitive) throw new Error('Journey V1 river anchor was not found.')
riverPrimitive.getAttribute('POSITION')
  .setArray(new Float32Array([
    0, 0, 0,
    0.000001, 0, 0,
    0, 0, -0.000001,
  ]))
  .setNormalized(false)
riverPrimitive.getAttribute('NORMAL')
  .setArray(new Float32Array([
    0, 1, 0,
    0, 1, 0,
    0, 1, 0,
  ]))
  .setNormalized(false)
riverPrimitive.getIndices()
  .setArray(new Uint16Array([0, 1, 2]))
  .setNormalized(false)

const simplifyTargets = [
  ['GEO_V13_FICTIONAL_NAGANO_MASSIF.001', 0.35, 0.0015],
  ['GEO_V13_FAR_CENTRAL_RIDGE.001', 0.25, 0.002],
]
for (const [name, ratio, error] of simplifyTargets) {
  const mesh = root.listMeshes().find((candidate) => candidate.getName() === name)
  const primitive = mesh?.listPrimitives()[0]
  if (!primitive) throw new Error(`Journey V1 simplify target was not found: ${name}`)
  simplifyPrimitive(primitive, {
    simplifier: MeshoptSimplifier,
    ratio,
    error,
    lockBorder: true,
  })
}

await document.transform(prune({
  keepLeaves: true,
  keepAttributes: true,
  keepSolidTextures: true,
}))

await io.write(outputPath, document)
