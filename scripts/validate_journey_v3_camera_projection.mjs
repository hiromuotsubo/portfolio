import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'

const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const REFERENCE_GLB = join(
  PROJECT_ROOT,
  'work/blender/journey-v3/phase1b/reference/journey-v16-spatial-reference.glb',
)
const OUTPUT = join(
  PROJECT_ROOT,
  'work/blender/journey-v3/phase1b/reference/journey-v3-landmarks.json',
)
const CAMERA_DIR = join(
  PROJECT_ROOT,
  'docs/references/journey-v3/baselines/camera',
)
const VIEWPORT = { width: 1440, height: 900 }
const TARGETS = [
  [-0.78, 0.68], [-0.28, 0.68], [0.28, 0.68], [0.78, 0.68],
  [-0.82, 0.18], [-0.3, 0.18], [0.3, 0.18], [0.82, 0.18],
  [-0.76, -0.58], [-0.26, -0.58], [0.26, -0.58], [0.76, -0.58],
]

const CAMERAS = [
  {
    key: 'cave-exit',
    name: 'CAM_V3_CAVE_EXIT_1440x900',
    path: join(CAMERA_DIR, 'cave-exit-1440x900.json'),
  },
  {
    key: 'day-clear-start',
    name: 'CAM_V3_DAY_CLEAR_START_1440x900',
    path: join(CAMERA_DIR, 'day-clear-start-1440x900.json'),
  },
  {
    key: 'day-clear-late',
    name: 'CAM_V3_DAY_CLEAR_LATE_1440x900',
    path: join(CAMERA_DIR, 'day-clear-late-1440x900.json'),
  },
]

const transformPoint = (matrix, point) => {
  const [x, y, z] = point
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15]
  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w,
  ]
}

const transformClip = (matrix, point) => {
  const [x, y, z] = point
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
  ]
}

const multiplyMatrices = (left, right) => {
  const result = new Array(16).fill(0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        result[column * 4 + row] += left[inner * 4 + row] * right[column * 4 + inner]
      }
    }
  }
  return result
}

const project = (camera, worldPosition) => {
  const viewProjection = multiplyMatrices(
    camera.camera.projectionMatrix,
    camera.camera.matrixWorldInverse,
  )
  const clip = transformClip(viewProjection, worldPosition)
  if (clip[3] <= 0) return null
  const ndc = clip.slice(0, 3).map((value) => value / clip[3])
  return {
    ndc,
    pixel: [
      (ndc[0] + 1) * 0.5 * VIEWPORT.width,
      (1 - ndc[1]) * 0.5 * VIEWPORT.height,
    ],
  }
}

await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
const document = await io.read(REFERENCE_GLB)
const candidates = []

for (const node of document.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const worldMatrix = node.getWorldMatrix()
  mesh.listPrimitives().forEach((primitive, primitiveIndex) => {
    const position = primitive.getAttribute('POSITION')
    if (!position) return
    const stride = Math.max(1, Math.floor(position.getCount() / 9000))
    const local = [0, 0, 0]
    for (let vertexIndex = 0; vertexIndex < position.getCount(); vertexIndex += stride) {
      position.getElement(vertexIndex, local)
      candidates.push({
        nodeName: node.getName(),
        meshName: mesh.getName(),
        primitiveIndex,
        vertexIndex,
        localPosition: [...local],
        threeWorldPosition: transformPoint(worldMatrix, local),
      })
    }
  })
}

const cameras = []
for (const definition of CAMERAS) {
  const camera = JSON.parse(await readFile(definition.path, 'utf8'))
  const visible = candidates
    .map((candidate) => ({
      ...candidate,
      projection: project(camera, candidate.threeWorldPosition),
    }))
    .filter(({ projection }) =>
      projection &&
      projection.ndc[0] >= -1.08 && projection.ndc[0] <= 1.08 &&
      projection.ndc[1] >= -1.08 && projection.ndc[1] <= 1.08 &&
      projection.ndc[2] >= -1 && projection.ndc[2] <= 1,
    )

  const selectedIndices = new Set()
  const landmarks = TARGETS.map((target, targetIndex) => {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    visible.forEach(({ projection }, index) => {
      if (selectedIndices.has(index)) return
      const dx = projection.ndc[0] - target[0]
      const dy = projection.ndc[1] - target[1]
      const distance = dx * dx + dy * dy
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = index
      }
    })
    if (bestIndex < 0) throw new Error(`No landmark candidate for ${definition.key}`)
    selectedIndices.add(bestIndex)
    const selected = visible[bestIndex]
    return {
      id: `${definition.key}-${String(targetIndex + 1).padStart(2, '0')}`,
      label: `Mesh-derived screen landmark ${targetIndex + 1}`,
      targetNdc: target,
      ...selected,
    }
  })
  cameras.push({
    ...definition,
    browserCameraMatrixWorld: camera.camera.matrixWorld,
    browserProjectionMatrix: camera.camera.projectionMatrix,
    landmarks,
  })
}

const output = {
  schemaVersion: 1,
  referenceGlb: REFERENCE_GLB,
  coordinateConvention: 'Three.js/glTF Y-up; pixel origin at top-left.',
  viewport: VIEWPORT,
  selection: {
    method: 'Nearest sampled mesh vertex to each of 12 screen-space target cells per comparison camera.',
    targetNdc: TARGETS,
    candidateCount: candidates.length,
  },
  cameras,
}
await mkdir(dirname(OUTPUT), { recursive: true })
await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`)
console.log(JSON.stringify({
  output: OUTPUT,
  candidateCount: candidates.length,
  cameraLandmarks: Object.fromEntries(cameras.map(({ key, landmarks }) => [key, landmarks.length])),
}, null, 2))
