import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Camera, Document, NodeIO } from '@gltf-transform/core'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SOURCE = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/volumetric/full-story-camera-baselines-1440x900.json',
)
const OUTPUT = join(
  PROJECT_ROOT,
  'work/blender/journey-v3/phase1c2/reference/journey-v3-full-story-cameras.glb',
)
const MANIFEST = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/volumetric/full-story-camera-gltf-manifest.json',
)

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const sourceBytes = await readFile(SOURCE)
const source = JSON.parse(sourceBytes)
const document = new Document()
const scene = document.createScene('Journey V3 Full Story Browser-Final Cameras')
const records = []

const cameraName = (preview) =>
  `CAM_V3_STORY_${preview.toUpperCase().replaceAll('-', '_')}_1440x900`

for (const snapshot of source.captures) {
  const name = cameraName(snapshot.metadata.preview)
  const cameraData = snapshot.camera
  const camera = document.createCamera(name)
    .setType(Camera.Type.PERSPECTIVE)
    .setYFov(cameraData.fov * Math.PI / 180)
    .setAspectRatio(cameraData.aspect)
    .setZNear(cameraData.near)
    .setZFar(cameraData.far)
  const extras = {
    journeyRole: 'full-story-comparison-camera',
    preview: snapshot.metadata.preview,
    progress: snapshot.metadata.progress,
    browserMatrixWorld: cameraData.matrixWorld,
    browserProjectionMatrix: cameraData.projectionMatrix,
    sourceBaselineJson: SOURCE,
    matrixElementOrder: snapshot.matrixElementOrder,
  }
  scene.addChild(
    document.createNode(name)
      .setMatrix(cameraData.matrixWorld)
      .setCamera(camera)
      .setExtras(extras),
  )
  records.push({
    name,
    preview: extras.preview,
    progress: extras.progress,
    fovDegrees: cameraData.fov,
    aspect: cameraData.aspect,
    matrixWorld: cameraData.matrixWorld,
  })
}

await mkdir(dirname(OUTPUT), { recursive: true })
const io = new NodeIO()
await io.write(OUTPUT, document)
const outputBytes = await readFile(OUTPUT)
const manifest = {
  schemaVersion: 1,
  source: SOURCE,
  sourceSha256: sha256(sourceBytes),
  output: OUTPUT,
  outputBytes: (await stat(OUTPUT)).size,
  outputSha256: sha256(outputBytes),
  cameraCount: records.length,
  coordinateConvention: 'Three.js/glTF Y-up, right-handed, camera forward -Z; Blender glTF importer performs basis conversion.',
  transferMethod: 'Browser-final matrixWorld assigned directly to camera-only glTF nodes; no Euler or camera hand adjustment.',
  cameras: records,
}
await mkdir(dirname(MANIFEST), { recursive: true })
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify(manifest, null, 2))
