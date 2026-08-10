import * as THREE from 'three'

export const JOURNEY_V3_CAPTURE_SCHEMA_VERSION = 1
export const THREE_MATRIX_ELEMENT_ORDER =
  'Three.js Matrix4.elements order (column-major storage)'

const vector3 = (value) => value.toArray()
const quaternion = (value) => value.toArray()
const matrix = (value) => value.toArray()

const objectTransform = (label, object) => {
  if (!object) return null
  return {
    label,
    name: object.name || null,
    type: object.type,
    position: vector3(object.position),
    quaternion: quaternion(object.quaternion),
    scale: vector3(object.scale),
    matrixWorld: matrix(object.matrixWorld),
  }
}

const relativeMatrix = (camera, root) => {
  if (!camera || !root) return null
  return matrix(
    new THREE.Matrix4()
      .copy(root.matrixWorld)
      .invert()
      .multiply(camera.matrixWorld),
  )
}

export function createJourneyV3CameraCapture({
  renderer,
  scene,
  camera,
  mainRoot,
  phase2Root,
  upperGroup,
  clip,
  clipTime,
  normalizedClipProgress,
  storyProgress,
  mappedClipProgress,
  activeGate,
  holdProgress,
  fogCompleted,
  skyConnectionProgress,
  preview,
  gitCommit,
  viewport,
  sunsetProgress,
  nightProgress,
}) {
  scene.updateMatrixWorld(true)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  const drawingBuffer = renderer.getDrawingBufferSize(new THREE.Vector2())
  const cameraParent = camera.parent

  return {
    schemaVersion: JOURNEY_V3_CAPTURE_SCHEMA_VERSION,
    matrixElementOrder: THREE_MATRIX_ELEMENT_ORDER,
    metadata: {
      route: window.location.pathname,
      preview,
      progress: storyProgress,
      fogHoldProgress: fogCompleted
        ? 1
        : activeGate === 'fog'
          ? holdProgress
          : 0,
      riverHoldProgress: activeGate === 'river'
        ? holdProgress
        : skyConnectionProgress > 0
          ? 1
          : 0,
      timeOfDayProgress: storyProgress,
      visualTimeOfDay: {
        sunsetProgress,
        nightProgress,
      },
      captureTimestamp: new Date().toISOString(),
      currentGitCommit: gitCommit || null,
      viewportCssWidth: viewport.width,
      viewportCssHeight: viewport.height,
      drawingBufferWidth: drawingBuffer.x,
      drawingBufferHeight: drawingBuffer.y,
      devicePixelRatio: window.devicePixelRatio,
      rendererPixelRatio: renderer.getPixelRatio(),
      deterministicRuntimeTimeSeconds: 0,
    },
    camera: {
      name: camera.name || null,
      position: vector3(camera.position),
      quaternion: quaternion(camera.quaternion),
      rotationOrder: camera.rotation.order,
      up: vector3(camera.up),
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
      aspect: camera.aspect,
      zoom: camera.zoom,
      matrix: matrix(camera.matrix),
      matrixWorld: matrix(camera.matrixWorld),
      matrixWorldInverse: matrix(camera.matrixWorldInverse),
      projectionMatrix: matrix(camera.projectionMatrix),
      projectionMatrixInverse: matrix(camera.projectionMatrixInverse),
    },
    animation: {
      clipName: clip?.name ?? null,
      clipDuration: clip?.duration ?? null,
      evaluatedClipTime: clipTime,
      normalizedClipProgress,
      storyProgress,
      storyProgressToClipProgressOutput: mappedClipProgress,
    },
    sceneRoots: {
      journeySceneRoot: objectTransform('Journey scene root', scene),
      mainGlbRoot: objectTransform('Main Journey GLB root', mainRoot),
      phase2EnvironmentRoot: objectTransform(
        'Journey Phase 2 environment GLB root',
        phase2Root,
      ),
      cameraParent: objectTransform('Camera parent object', cameraParent),
      journeyV3UpperGroup: objectTransform(
        'Journey V3 runtime upper group',
        upperGroup,
      ),
    },
    relativeCameraMatrices: {
      cameraRelativeToJourneySceneRoot: relativeMatrix(camera, scene),
      cameraRelativeToMainGlbRoot: relativeMatrix(camera, mainRoot),
      cameraRelativeToPhase2EnvironmentRoot: relativeMatrix(camera, phase2Root),
    },
  }
}

export function publishJourneyV3CameraCapture(snapshot) {
  const api = {
    status: 'ready',
    snapshot,
    getSnapshot: () => structuredClone(snapshot),
  }
  window.__JOURNEY_V3_CAPTURE__ = api
  window.dispatchEvent(new CustomEvent('journey-v3-capture-ready'))
}
