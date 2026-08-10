import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO, getBounds } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SOURCE = join(PROJECT_ROOT, 'public/journey/models/journey-v16-pbr-ktx2.glb')
const DEFAULT_OUTPUT = join(
  PROJECT_ROOT,
  'work/blender/journey-v3/phase1b/reference/journey-v16-spatial-reference.glb',
)
const outputArgumentIndex = process.argv.indexOf('--output')
const OUTPUT = outputArgumentIndex >= 0
  ? resolve(PROJECT_ROOT, process.argv[outputArgumentIndex + 1])
  : DEFAULT_OUTPUT
const REPORT = OUTPUT.replace(/\.glb$/i, '-validation.json')

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fileSha256 = async (path) => sha256(await readFile(path))

await MeshoptDecoder.ready
await MeshoptEncoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.decoder': MeshoptDecoder,
    'meshopt.encoder': MeshoptEncoder,
  })

const typedArrayBytes = (array) => Buffer.from(
  array.buffer,
  array.byteOffset,
  array.byteLength,
)

function accessorSignature(accessor) {
  const array = accessor?.getArray()
  if (!accessor || !array) return null
  return {
    componentType: accessor.getComponentType(),
    normalized: accessor.getNormalized(),
    type: accessor.getType(),
    count: accessor.getCount(),
    byteLength: array.byteLength,
    valueSha256: sha256(typedArrayBytes(array)),
  }
}

function animationDuration(animation) {
  let duration = 0
  for (const sampler of animation.listSamplers()) {
    const input = sampler.getInput()
    const array = input?.getArray()
    if (!array) continue
    for (const value of array) duration = Math.max(duration, Number(value))
  }
  return duration
}

function documentAudit(document) {
  const root = document.getRoot()
  const primitiveAccessors = []
  let primitiveCount = 0
  root.listMeshes().forEach((mesh, meshIndex) => {
    mesh.listPrimitives().forEach((primitive, primitiveIndex) => {
      primitiveCount += 1
      primitiveAccessors.push({
        meshIndex,
        meshName: mesh.getName(),
        primitiveIndex,
        position: accessorSignature(primitive.getAttribute('POSITION')),
        indices: accessorSignature(primitive.getIndices()),
      })
    })
  })
  const nodes = root.listNodes().map((node, index) => ({
    index,
    name: node.getName(),
    translation: node.getTranslation(),
    rotation: node.getRotation(),
    scale: node.getScale(),
    matrix: node.getMatrix(),
    worldMatrix: node.getWorldMatrix(),
    mesh: node.getMesh()?.getName() ?? null,
    camera: node.getCamera()?.getName() ?? null,
    children: node.listChildren().map((child) => child.getName()),
  }))
  const scenes = root.listScenes().map((scene) => ({
    name: scene.getName(),
    rootNodes: scene.listChildren().map((node) => node.getName()),
    bounds: getBounds(scene),
  }))
  const aggregateGeometryHash = sha256(Buffer.from(JSON.stringify(primitiveAccessors)))
  return {
    counts: {
      scenes: root.listScenes().length,
      nodes: root.listNodes().length,
      meshes: root.listMeshes().length,
      primitives: primitiveCount,
      accessors: root.listAccessors().length,
      materials: root.listMaterials().length,
      textures: root.listTextures().length,
      cameras: root.listCameras().length,
      animations: root.listAnimations().length,
      skins: root.listSkins().length,
    },
    nodeNames: root.listNodes().map((node) => node.getName()),
    meshNames: root.listMeshes().map((mesh) => mesh.getName()),
    materialNames: root.listMaterials().map((material) => material.getName()),
    cameraNames: root.listCameras().map((camera) => camera.getName()),
    animations: root.listAnimations().map((animation) => ({
      name: animation.getName(),
      duration: animationDuration(animation),
      channels: animation.listChannels().length,
      samplers: animation.listSamplers().length,
    })),
    scenes,
    nodes,
    primitiveAccessors,
    aggregateGeometryHash,
  }
}

const stableComparableAudit = (audit) => ({
  counts: {
    ...audit.counts,
    textures: undefined,
  },
  nodeNames: audit.nodeNames,
  meshNames: audit.meshNames,
  materialNames: audit.materialNames,
  cameraNames: audit.cameraNames,
  animations: audit.animations,
  scenes: audit.scenes,
  nodes: audit.nodes,
  primitiveAccessors: audit.primitiveAccessors,
  aggregateGeometryHash: audit.aggregateGeometryHash,
})

await mkdir(dirname(OUTPUT), { recursive: true })
const sourceDocument = await io.read(SOURCE)
const sourceAudit = documentAudit(sourceDocument)

for (const texture of sourceDocument.getRoot().listTextures()) texture.dispose()
for (const extension of sourceDocument.getRoot().listExtensionsUsed()) {
  if (extension.extensionName === 'KHR_texture_basisu') extension.dispose()
}

await io.write(OUTPUT, sourceDocument)
const outputDocument = await io.read(OUTPUT)
const outputAudit = documentAudit(outputDocument)
const sourceComparable = stableComparableAudit(sourceAudit)
const outputComparable = stableComparableAudit(outputAudit)
const geometryEquivalent = JSON.stringify(sourceComparable) === JSON.stringify(outputComparable)

const report = {
  schemaVersion: 1,
  sourcePath: SOURCE,
  outputPath: OUTPUT,
  sourceSha256: await fileSha256(SOURCE),
  outputSha256: await fileSha256(OUTPUT),
  sourceBytes: (await stat(SOURCE)).size,
  outputBytes: (await stat(OUTPUT)).size,
  allowedTransformation: 'Removed textures and KHR_texture_basisu only; material names and slots retained.',
  source: sourceAudit,
  output: outputAudit,
  geometryEquivalent,
  comparisonSha256: {
    source: sha256(Buffer.from(JSON.stringify(sourceComparable))),
    output: sha256(Buffer.from(JSON.stringify(outputComparable))),
  },
}
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`)

if (!geometryEquivalent) {
  throw new Error(`Geometry-only spatial reference validation failed. See ${REPORT}`)
}
console.log(JSON.stringify({
  output: OUTPUT,
  report: REPORT,
  geometryEquivalent,
  sourceSha256: report.sourceSha256,
  outputSha256: report.outputSha256,
  counts: outputAudit.counts,
  bounds: outputAudit.scenes,
}, null, 2))
