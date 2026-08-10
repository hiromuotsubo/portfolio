import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Camera, Document, NodeIO } from '@gltf-transform/core'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const BASELINE_DIR = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/camera',
)
const DEFAULT_OUTPUT = join(
  PROJECT_ROOT,
  'work/blender/journey-v3/phase1b/reference/journey-v3-camera-baselines.glb',
)
const outputArgumentIndex = process.argv.indexOf('--output')
const OUTPUT = outputArgumentIndex >= 0
  ? resolve(PROJECT_ROOT, process.argv[outputArgumentIndex + 1])
  : DEFAULT_OUTPUT
const REPORT = OUTPUT.replace(/\.glb$/i, '-manifest.json')

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const BASELINES = [
  {
    name: 'CAM_V3_CAVE_EXIT_1440x900',
    path: join(BASELINE_DIR, 'cave-exit-1440x900.json'),
  },
  {
    name: 'CAM_V3_DAY_CLEAR_START_1440x900',
    path: join(BASELINE_DIR, 'day-clear-start-1440x900.json'),
  },
  {
    name: 'CAM_V3_DAY_CLEAR_LATE_1440x900',
    path: join(BASELINE_DIR, 'day-clear-late-1440x900.json'),
  },
]

const formatProgress = (progress) => progress
  .toFixed(2)
  .padStart(6, '0')
  .replace('.', '_')

const document = new Document()
const scene = document.createScene('Journey V3 Browser Final Camera Baselines')
const manifest = []

function addCamera(name, snapshot, role, sourcePath) {
  const cameraData = snapshot.camera
  const camera = document.createCamera(name)
    .setType(Camera.Type.PERSPECTIVE)
    .setYFov(cameraData.fov * Math.PI / 180)
    .setAspectRatio(cameraData.aspect)
    .setZNear(cameraData.near)
    .setZFar(cameraData.far)
  const metadata = {
    journeyRole: role,
    preview: snapshot.metadata.preview,
    progress: snapshot.metadata.progress,
    clipTime: snapshot.animation.evaluatedClipTime,
    normalizedClipProgress: snapshot.animation.normalizedClipProgress,
    browserMatrixWorld: cameraData.matrixWorld,
    browserProjectionMatrix: cameraData.projectionMatrix,
    sourceBaselineJson: sourcePath,
    matrixElementOrder: snapshot.matrixElementOrder,
  }
  const node = document.createNode(name)
    .setMatrix(cameraData.matrixWorld)
    .setCamera(camera)
    .setExtras(metadata)
  scene.addChild(node)
  manifest.push({
    name,
    role,
    preview: metadata.preview,
    progress: metadata.progress,
    clipTime: metadata.clipTime,
    yfovRadians: camera.getYFov(),
    aspectRatio: camera.getAspectRatio(),
    znear: camera.getZNear(),
    zfar: camera.getZFar(),
    matrixWorld: cameraData.matrixWorld,
    nodeTranslation: node.getTranslation(),
    nodeRotation: node.getRotation(),
    nodeScale: node.getScale(),
    sourcePath,
  })
}

for (const baseline of BASELINES) {
  addCamera(
    baseline.name,
    await readJson(baseline.path),
    'comparison-baseline',
    baseline.path,
  )
}

const sweepPath = join(BASELINE_DIR, 'cave-to-day-camera-sweep-1440x900.json')
const sweep = await readJson(sweepPath)
for (const representative of sweep.representatives) {
  const snapshot = representative.snapshot
  addCamera(
    `CAM_V3_SWEEP_P${formatProgress(snapshot.metadata.progress)}`,
    snapshot,
    'cave-to-day-sweep',
    sweepPath,
  )
}

await mkdir(dirname(OUTPUT), { recursive: true })
const io = new NodeIO()
await io.write(OUTPUT, document)
const outputBytes = await readFile(OUTPUT)
const outputDocument = await io.read(OUTPUT)
const outputCameras = outputDocument.getRoot().listNodes()
  .filter((node) => node.getCamera())
  .map((node) => ({
    name: node.getName(),
    matrix: node.getMatrix(),
    yfovRadians: node.getCamera().getYFov(),
    aspectRatio: node.getCamera().getAspectRatio(),
    znear: node.getCamera().getZNear(),
    zfar: node.getCamera().getZFar(),
    extras: node.getExtras(),
  }))

const report = {
  schemaVersion: 1,
  outputPath: OUTPUT,
  outputBytes: (await stat(OUTPUT)).size,
  outputSha256: sha256(outputBytes),
  cameraCount: manifest.length,
  coordinateConvention: 'glTF and Three.js: Y-up, right-handed, camera forward -Z.',
  transferMethod: 'Browser final camera matrixWorld assigned directly to glTF camera node; Blender glTF importer performs basis conversion.',
  sourceBaselineSha256: Object.fromEntries(
    await Promise.all(
      [...BASELINES.map(({ path }) => path), sweepPath].map(async (path) => [
        path,
        sha256(await readFile(path)),
      ]),
    ),
  ),
  cameras: manifest,
  roundTripCameras: outputCameras,
}
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  output: OUTPUT,
  report: REPORT,
  sha256: report.outputSha256,
  cameraCount: report.cameraCount,
  cameras: manifest.map(({ name, progress }) => ({ name, progress })),
}, null, 2))
