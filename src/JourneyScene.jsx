import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { getJourneyTimeOfDay } from './journeyVisualState.js'
import {
  getJourneyFogArrival,
  getJourneyOutdoorPresence,
  getJourneyValleyDetailPresence,
  getJourneyValleyFarPresence,
  getJourneyValleyGroundPresence,
  getJourneyValleyPresence,
  getJourneyValleyRiverPresence,
  JOURNEY_CAVE_SEQUENCE,
  JOURNEY_NIGHT_SEQUENCE,
} from './journeyStoryTimeline.js'

// Versioned query prevents a previously cached GLB from reviving removed assets.
const MODEL_URL = '/journey/models/journey-v17-runtime-optimized.glb?v=1-selective-runtime'
const CAVE_LOOKDEV_URL = '/journey/models/journey-cave-macro-v004.glb?v=12-meshopt-shape-preserved'
const PHASE2_ENVIRONMENT_URL = '/journey/models/journey-phase2-environment.glb?v=5-distance-forest'
const ALPINE_BIOME_MACRO_URL = '/journey/textures/surface/alpine-biome-macro-v1.jpg'

// Pointer samples arrive much faster than a perceptible gust. A slightly wider
// history plus a fixed emission cadence lets each accepted gust keep its own
// direction while it crosses the meadow instead of being rewritten by the
// next pointer event.
// 30 slots retain a full 2.6-second trail at the 90ms emission cadence.
// WebGL2 guarantees enough vertex uniforms for the two vec4 arrays, while the
// fixed-size shader loop keeps the history entirely on the GPU.
const MEADOW_WIND_IMPULSE_COUNT = 30
const MEADOW_WIND_EMIT_INTERVAL = 0.09
const MEADOW_WIND_REVERSAL_HOLD = 0.28
const MEADOW_WIND_POINTER_PAUSE_RESET = 0.18
const MEADOW_WIND_MAX_AGE = 2.6

const ENDING_CAMERA = {
  liftStart: 78,
  liftEnd: 90,
  wideStart: 86,
  wideEnd: 100,
  pullBack: 13.5,
  cameraLift: 0.16,
  lift: 0.08,
  fov: 26,
}

// V1 framing is preserved on backup/journey-lookdev-v1-e5ec4a3.
// These offsets leave the authored animation path intact and only widen the
// open-valley composition so sky, water and distant ridges can share the frame.
const LOOKDEV_V2_COMPOSITION = {
  // The complete daytime valley is already present when the viewer clears
  // the portal. Fog conceals its lower depth; later scrolling explores the
  // same composition instead of revealing a second, wider camera setup.
  vistaStart: 13.5,
  vistaFull: 20,
  vistaFadeStart: 56,
  vistaFadeEnd: 68,
  // The source clip opens on a close valley floor. A more deliberate pullback
  // lets the S-curve, alluvial floor and the two mountain shoulders read as a
  // single landscape rather than as an isolated mountain cleft.
  pullBack: 8.0,
  cameraLift: 1.02,
  targetLift: 0.02,
  fov: 15,
}

const CAVE_LOOK = {
  exposure: 1.24,
  sunIntensity: 0.14,
  skyIntensity: 0.19,
  ambientIntensity: 0.14,
  guideLightIntensity: 18,
  exitLightIntensity: 14,
  materialTint: '#303833',
}

const CAVE_CAMERA = Object.freeze({
  x: 0,
  y: 2.34375,
  fov: 39.760707,
})

// Portrait viewports need their own composition, not a second story camera.
// Every value is blended by portraitFactor, so the authored desktop path is
// mathematically unchanged while mobile keeps the cave walls and meadow banks
// inside its much narrower horizontal field of view.
const MOBILE_JOURNEY_COMPOSITION = Object.freeze({
  caveFov: 66,
  // A modest mobile-only retreat restores both meadow banks before widening
  // the lens. The former positive values pushed the eye farther into the
  // river, so water occupied the lower half while the grass became a strip.
  valleyPullBackNear: -1.4,
  valleyPullBackFar: -2.6,
  // Keep the authored desktop centre line. The former twelve-unit lateral
  // move turned the portrait view into a different camera and cropped the
  // opposite mountain, river reflection and seated figure out of sequence.
  valleyLateralNear: 0,
  valleyLateralFar: 0,
  valleyCameraLiftNear: 0.02,
  valleyCameraLiftFar: 0.06,
  // Let the portrait eye settle a few degrees above the river surface. This
  // keeps the S-curve as the foreground lead while returning visual weight to
  // the mountain bowl and its meadow shoulders.
  valleyTargetLiftNear: 0.035,
  valleyTargetLiftFar: 0.055,
  valleyTargetRightNear: 0,
  valleyTargetRightFar: 0,
  // A portrait screen cannot retain the desktop horizontal field without an
  // extreme fisheye. This restrained wide-angle extension preserves the same
  // viewpoint while keeping both mountain shoulders, meadow and river legible.
  valleyFov: 18,
  // Compensate for the smaller projected blade size of the portrait wide
  // lens; this restores desktop-like meadow presence without touching seeds,
  // density or any desktop material value.
  grassHeightScale: 2.1,
  caveLightScale: 1.9,
})

const clamp01 = (value) => Math.min(1, Math.max(0, value))

const smoothstep = (edge0, edge1, value) => {
  const x = clamp01((value - edge0) / (edge1 - edge0))
  return x * x * (3 - 2 * x)
}

const CAVE_PORTAL_FADE_START_Z = -1.08
const CAVE_PORTAL_FADE_END_Z = -2.42
const CAVE_CAMERA_RELEASE_END = 20
const CAVE_CAMERA_CONTINUATION_DISTANCE = 2.15
// Depth fog supplies the cave-exit mist. Camera-facing cards are retained as
// rollback assets but stay disabled because their projection crosses the sky.
const USE_VIEW_FACING_FOG_CARDS = false

function applyCaveSurfaceDetail(material) {
  const previousCompile = material.onBeforeCompile
  const previousCacheKey = material.customProgramCacheKey?.bind(material)
  const caveSurfaceUniforms = {
    uJourneyCaveMobileClarity: { value: 0 },
  }
  material.userData.journeyCaveSurfaceUniforms = caveSurfaceUniforms
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer)
    Object.assign(shader.uniforms, caveSurfaceUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vJourneyCaveWorldPosition;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvJourneyCaveWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vJourneyCaveWorldPosition;',
          'uniform float uJourneyCaveMobileClarity;',
          'float journeyCaveHash(vec3 point) {',
          '  point = fract(point * 0.1031);',
          '  point += dot(point, point.yzx + 33.33);',
          '  return fract((point.x + point.y) * point.z);',
          '}',
          'float journeyCaveNoise(vec3 point) {',
          '  vec3 cell = floor(point);',
          '  vec3 local = fract(point);',
          '  local = local * local * (3.0 - 2.0 * local);',
          '  return mix(',
          '    mix(mix(journeyCaveHash(cell), journeyCaveHash(cell + vec3(1, 0, 0)), local.x),',
          '      mix(journeyCaveHash(cell + vec3(0, 1, 0)), journeyCaveHash(cell + vec3(1, 1, 0)), local.x), local.y),',
          '    mix(mix(journeyCaveHash(cell + vec3(0, 0, 1)), journeyCaveHash(cell + vec3(1, 0, 1)), local.x),',
          '      mix(journeyCaveHash(cell + vec3(0, 1, 1)), journeyCaveHash(cell + vec3(1, 1, 1)), local.x), local.y),',
          '    local.z',
          '  );',
          '}',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          'float journeyCaveBroad = 0.5 +',
          '  sin(vJourneyCaveWorldPosition.x * 0.31 + vJourneyCaveWorldPosition.z * 0.17) * 0.27 +',
          '  sin(vJourneyCaveWorldPosition.y * 0.53 - vJourneyCaveWorldPosition.z * 0.09 + 1.4) * 0.18;',
          'float journeyCaveStrata = sin(',
          '  vJourneyCaveWorldPosition.y * 1.15 +',
          '  vJourneyCaveWorldPosition.x * 0.12 +',
          '  sin(vJourneyCaveWorldPosition.z * 0.19) * 1.3',
          ') * 0.5 + 0.5;',
          'float journeyCaveMoisture = smoothstep(0.2, 0.92, journeyCaveBroad) *',
          '  smoothstep(0.18, 0.82, journeyCaveStrata);',
          'float journeyCaveMacroNoise = journeyCaveNoise(vJourneyCaveWorldPosition * 0.34);',
          'float journeyCaveMesoNoise = journeyCaveNoise(',
          '  vJourneyCaveWorldPosition * 1.12 + vec3(13.7, -8.4, 21.9)',
          ');',
          'float journeyCaveStone = journeyCaveMacroNoise * 0.68 + journeyCaveMesoNoise * 0.32;',
          'float journeyCaveFractureA = abs(sin(',
          '  vJourneyCaveWorldPosition.z * 0.72 +',
          '  vJourneyCaveWorldPosition.x * 0.46 +',
          '  journeyCaveMacroNoise * 3.1',
          '));',
          'float journeyCaveFractureB = abs(sin(',
          '  vJourneyCaveWorldPosition.z * 0.31 -',
          '  vJourneyCaveWorldPosition.y * 0.84 +',
          '  journeyCaveMesoNoise * 2.4 + 1.8',
          '));',
          'float journeyCaveFracture = max(',
          '  1.0 - smoothstep(0.035, 0.145, journeyCaveFractureA),',
          '  (1.0 - smoothstep(0.03, 0.12, journeyCaveFractureB)) * 0.72',
          ');',
          'float journeyCaveLowWet = (1.0 - smoothstep(0.12, 2.55, vJourneyCaveWorldPosition.y)) *',
          '  smoothstep(0.26, 0.82, journeyCaveBroad);',
          'diffuseColor.rgb *= mix(0.72, 1.14, clamp(journeyCaveBroad, 0.0, 1.0));',
          'float journeyCaveLayer = smoothstep(0.28, 0.74, journeyCaveStrata);',
          'diffuseColor.rgb *= mix(0.72, 1.08, journeyCaveLayer);',
          'diffuseColor.rgb *= mix(0.64, 1.26, journeyCaveStone);',
          'diffuseColor.rgb *= mix(1.0, 0.58, journeyCaveFracture);',
          'diffuseColor.rgb = mix(',
          '  diffuseColor.rgb * vec3(0.82, 0.76, 0.68),',
          '  diffuseColor.rgb * vec3(0.78, 0.98, 0.9),',
          '  journeyCaveMoisture * (0.32 + journeyCaveMesoNoise * 0.34)',
          ');',
          'diffuseColor.rgb = mix(',
          '  diffuseColor.rgb,',
          '  diffuseColor.rgb * vec3(0.78, 0.94, 0.87),',
          '  journeyCaveMoisture * 0.22',
          ');',
          'diffuseColor.rgb = mix(',
          '  diffuseColor.rgb,',
          '  diffuseColor.rgb * vec3(0.72, 0.9, 0.83),',
          '  journeyCaveLowWet * (0.18 + journeyCaveMesoNoise * 0.22)',
          ');',
          '// A portrait phone resolves fewer shaded pixels across the cave.',
          '// Restore neutral stone separation in the material itself so the',
          '// interior does not depend on a high-resolution shadow map.',
          'float journeyCaveMobileRelief = mix(',
          '  0.72,',
          '  1.34,',
          '  clamp(journeyCaveStone * 0.68 + journeyCaveLayer * 0.32, 0.0, 1.0)',
          ');',
          'vec3 journeyCaveMobileTone = diffuseColor.rgb *',
          '  vec3(1.1, 0.96, 0.84) * journeyCaveMobileRelief;',
          'diffuseColor.rgb = mix(',
          '  diffuseColor.rgb,',
          '  journeyCaveMobileTone,',
          '  uJourneyCaveMobileClarity * 0.72',
          ');',
        ].join('\n'),
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          'vec3 journeyCaveNormalWarp = vec3(',
          '  sin(vJourneyCaveWorldPosition.y * 1.47 + vJourneyCaveWorldPosition.z * 0.38),',
          '  sin(vJourneyCaveWorldPosition.x * 1.24 - vJourneyCaveWorldPosition.z * 0.71 + 1.2),',
          '  sin(vJourneyCaveWorldPosition.x * 0.92 + vJourneyCaveWorldPosition.y * 1.08 - 0.6)',
          ');',
          'journeyCaveNormalWarp += (journeyCaveMesoNoise - 0.5) * vec3(0.42, 0.26, 0.38);',
          '// The rebuilt mesh owns the broad face direction. This restrained',
          '// warp supplies only sub-plane erosion instead of rounding it again.',
          'normal = normalize(normal + journeyCaveNormalWarp * 0.12);',
        ].join('\n'),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor - journeyCaveLowWet * 0.2 + journeyCaveFracture * 0.06, 0.62, 1.0);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '// Stable indirect cave fill: the spatial bands preserve shaded',
          '// depth while preventing the unlit inner faces from collapsing',
          '// into one flat black silhouette.',
          'float journeyCaveIndirect = 0.42 +',
          '  sin(vJourneyCaveWorldPosition.x * 0.23 + vJourneyCaveWorldPosition.z * 0.11) * 0.18 +',
          '  sin(vJourneyCaveWorldPosition.y * 0.58 - vJourneyCaveWorldPosition.z * 0.07) * 0.1;',
          'float journeyCaveBounce = (0.24 + clamp(journeyCaveBroad, 0.0, 1.0) * 1.08) *',
          '  mix(0.72, 1.08, journeyCaveStrata);',
          'float journeyCaveFissure = 1.0 - smoothstep(',
          '  0.035, 0.18, abs(journeyCaveStrata - 0.46)',
          ');',
          'vec3 journeyCaveBounceColor = mix(',
          '  vec3(0.016, 0.019, 0.017),',
          '  vec3(0.057, 0.064, 0.056),',
          '  clamp(journeyCaveBroad * 0.72 + journeyCaveStrata * 0.28, 0.0, 1.0)',
          ');',
          'journeyCaveBounceColor *= 1.0 - journeyCaveFissure * 0.46;',
          'totalEmissiveRadiance += journeyCaveBounceColor *',
          '  clamp(journeyCaveIndirect, 0.24, 0.88) * journeyCaveBounce * 0.72;',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => (
    `${previousCacheKey?.() ?? ''}|journey-cave-surface-v6-shadow-independent-world-position`
  )
}

const blendTimeOfDayColor = (target, day, sunset, night, weights) => target.setRGB(
  day.r * weights.dayWeight + sunset.r * weights.sunsetWeight + night.r * weights.nightWeight,
  day.g * weights.dayWeight + sunset.g * weights.sunsetWeight + night.g * weights.nightWeight,
  day.b * weights.dayWeight + sunset.b * weights.sunsetWeight + night.b * weights.nightWeight,
)

// This is sampled from the source V1 river mesh, not an idealised spline.
// Every supplemental element (the clear-current overlay, gravel, grass,
// flowers and night glow) uses this one centreline. Keeping it here avoids a
// deceptively common failure mode where individually plausible layers drift
// through each other as the river turns through the valley.
const VALLEY_RIVER_PROFILE = [
  { z: 8, x: 6.2, halfWidth: 10.6, y: -0.31 },
  { z: -12, x: 7.8, halfWidth: 10.3, y: -0.23 },
  { z: -30, x: -2.2, halfWidth: 9.7, y: -0.11 },
  { z: -48, x: -12.4, halfWidth: 9.25, y: 0.02 },
  { z: -65, x: -5.1, halfWidth: 8.45, y: 0.15 },
  { z: -80, x: 11.1, halfWidth: 7.65, y: 0.28 },
  { z: -94, x: 17.0, halfWidth: 6.65, y: 0.41 },
  { z: -110, x: 7.1, halfWidth: 5.65, y: 0.56 },
  { z: -124, x: -2.0, halfWidth: 4.65, y: 0.74 },
  { z: -136, x: -3.1, halfWidth: 4.05, y: 0.91 },
  // Beyond the visible bend this becomes a hidden alpine drainage instead of
  // climbing the massif at an impossible 14–56% grade.
  { z: -150, x: -2.2, halfWidth: 3.7, y: 1.12 },
  { z: -166, x: 0.2, halfWidth: 3.25, y: 1.42 },
  { z: -190, x: -2.4, halfWidth: 2.75, y: 1.82 },
  { z: -210, x: -4.0, halfWidth: 2.35, y: 2.18 },
]

const NATURAL_RIVER_KNOTS = VALLEY_RIVER_PROFILE
const naturalRiverCurve = new THREE.CatmullRomCurve3(
  NATURAL_RIVER_KNOTS.map(({ x, y, z }) => new THREE.Vector3(x, y, z)),
  false,
  'centripetal',
  0.42,
)

const sampleNaturalRiverWidth = (t) => {
  const position = clamp01(t) * (NATURAL_RIVER_KNOTS.length - 1)
  const lower = Math.floor(position)
  const mix = position - lower
  return THREE.MathUtils.lerp(
    NATURAL_RIVER_KNOTS[lower].halfWidth,
    NATURAL_RIVER_KNOTS[Math.min(lower + 1, NATURAL_RIVER_KNOTS.length - 1)].halfWidth,
    mix,
  )
}

const getNaturalRiverStations = (count = 96) => Array.from({ length: count }, (_, index) => {
  const t = index / (count - 1)
  const point = naturalRiverCurve.getPoint(t)
  const tangent = naturalRiverCurve.getTangent(t).normalize()
  const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize()
  return {
    t,
    point,
    tangent,
    normal,
    halfWidth: sampleNaturalRiverWidth(t),
  }
})

const NATURAL_RIVER_STATIONS = getNaturalRiverStations(129)

const sampleNaturalRiverAtZ = (z) => {
  const first = NATURAL_RIVER_STATIONS[0]
  if (z >= first.point.z) return first
  const last = NATURAL_RIVER_STATIONS[NATURAL_RIVER_STATIONS.length - 1]
  if (z <= last.point.z) return last
  let nearIndex = 0
  let farIndex = NATURAL_RIVER_STATIONS.length - 1
  while (farIndex - nearIndex > 1) {
    const middle = Math.floor((nearIndex + farIndex) / 2)
    if (NATURAL_RIVER_STATIONS[middle].point.z >= z) nearIndex = middle
    else farIndex = middle
  }
  const near = NATURAL_RIVER_STATIONS[nearIndex]
  const far = NATURAL_RIVER_STATIONS[farIndex]
  const mix = (z - near.point.z) / (far.point.z - near.point.z)
  return {
    t: THREE.MathUtils.lerp(near.t, far.t, mix),
    point: near.point.clone().lerp(far.point, mix),
    tangent: near.tangent.clone().lerp(far.tangent, mix).normalize(),
    normal: near.normal.clone().lerp(far.normal, mix).normalize(),
    halfWidth: THREE.MathUtils.lerp(near.halfWidth, far.halfWidth, mix),
  }
}

const sampleValleyMeadowHeight = (z, side, bankOffset) => {
  const station = sampleNaturalRiverAtZ(z)
  const depth = clamp01((-z - 2) / 138)
  const slope = THREE.MathUtils.lerp(0.018, side < 0 ? 0.082 : 0.094, depth)
  const distance = Math.max(0, bankOffset)
  const terrace = Math.sin(z * 0.083 + side * 1.7) * 0.075 +
    Math.sin(z * 0.031 - distance * 0.17) * 0.055
  return station.point.y + 0.075 + distance * slope + terrace
}

function buildNaturalRiverGeometry({
  count = 96,
  widthScale = 1,
  yOffset = 0,
  reflectorSpace = false,
} = {}) {
  const stations = getNaturalRiverStations(count)
  const columns = 8
  const baseY = 0.08
  const positions = []
  const normals = []
  const uvs = []
  const across = []
  const along = []
  const indices = []
  stations.forEach((station, stationIndex) => {
    for (let column = 0; column <= columns; column += 1) {
      const cross = THREE.MathUtils.lerp(-1, 1, column / columns)
      const asymmetry = 1 + Math.sin(station.t * Math.PI * 5.3 + (cross < 0 ? 0.7 : 2.1)) * 0.035
      const width = station.halfWidth * widthScale * asymmetry
      const point = station.point.clone().addScaledVector(station.normal, cross * width)
      point.y += yOffset + Math.sin(station.t * Math.PI * 12 + cross * 2.4) * 0.004
      if (reflectorSpace) positions.push(point.x, -point.z, point.y - baseY)
      else positions.push(point.x, point.y, point.z)
      normals.push(...(reflectorSpace ? [0, 0, 1] : [0, 1, 0]))
      uvs.push(column / columns, station.t * 7.4)
      across.push(cross)
      along.push(station.t)
      if (stationIndex < stations.length - 1 && column < columns) {
        const stride = columns + 1
        const a = stationIndex * stride + column
        const b = a + stride
        // Stations advance toward -Z while columns advance toward the river's
        // +normal.  Winding across first keeps the generated face normal +Y,
        // matching the authored normal attribute and FrontSide water/bed.
        indices.push(a, a + 1, b, b, a + 1, b + 1)
      }
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('aJourneyAcross', new THREE.Float32BufferAttribute(across, 1))
  geometry.setAttribute('aJourneyAlong', new THREE.Float32BufferAttribute(along, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

const storyProgressToClipProgress = (progress) => {
  if (progress <= 13.5) {
    return THREE.MathUtils.lerp(0, 0.395, smoothstep(0, 13.5, progress))
  }
  if (progress <= 20) {
    return THREE.MathUtils.lerp(0.395, 0.447, smoothstep(13.5, 20, progress))
  }
  if (progress <= 70) {
    return THREE.MathUtils.lerp(0.447, 0.72, (progress - 20) / 50)
  }
  if (progress <= 90) {
    return THREE.MathUtils.lerp(0.72, 0.8, smoothstep(70, 90, progress))
  }
  return 0.8
}

const seededRandom = (seed) => {
  const value = Math.sin(seed * 91.719 + 17.31) * 43758.5453
  return value - Math.floor(value)
}

function buildStarField(count, radius, milkyWay = false) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const revealSeeds = new Float32Array(count)
  const stars = []

  for (let index = 0; index < count; index += 1) {
    const pathProgress = milkyWay ? seededRandom(index + 4100) : 0
    const pathCenter =
      -12 +
      Math.sin(pathProgress * 2.35 - 0.42) * 20 +
      pathProgress * 10
    const pathWidth = 6 + Math.pow(pathProgress, 1.75) * 145
    const edgeBiasSeed = seededRandom(index + 9300)
    const horizontalSpread = Math.sign(edgeBiasSeed - 0.5) * Math.pow(
      Math.abs(edgeBiasSeed - 0.5) * 2,
      0.74,
    )
    const horizontal = milkyWay
      ? pathCenter + (seededRandom(index + 1) - 0.5) * pathWidth
      : horizontalSpread * radius * 0.98 +
        Math.sin(index * 1.913) * (6 + seededRandom(index + 11200) * 18)
    const vertical = milkyWay
      ? -42 + pathProgress * 338 + (seededRandom(index + 2500) - 0.5) * 9
      : -34 + seededRandom(index + 800) * 315
    stars.push({
      horizontal,
      vertical,
      depth: -radius - seededRandom(index + 1700) * (milkyWay ? 95 : 190),
      size: 0.58 + Math.pow(seededRandom(index + 3600), 1.7) * 2.18,
      pathProgress,
    })
  }

  if (milkyWay) stars.sort((a, b) => a.pathProgress - b.pathProgress)
  stars.forEach((star, index) => {
    positions[index * 3] = star.horizontal
    positions[index * 3 + 1] = star.vertical
    positions[index * 3 + 2] = star.depth
    sizes[index] = star.size
    // A handful of brighter field stars arrive first, followed by the wider
    // dimmer population. Milky Way timing remains owned by its path reveal.
    revealSeeds[index] = milkyWay
      ? 0
      : clamp01(
        Math.pow(seededRandom(index + 14800), 0.92) -
        ((star.size - 0.58) / 2.18) * 0.065,
      )
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aJourneyRevealSeed', new THREE.BufferAttribute(revealSeeds, 1))
  return geometry
}

function buildSkyBridgeGeometry(count = 1100) {
  const positions = new Float32Array(count * 3)
  const sizes = new Float32Array(count)
  const pathProgress = new Float32Array(count)

  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1)
    const centerX = -12 + Math.sin(t * 2.35 - 0.42) * 20 + t * 10
    const y = -46 + t * 342
    const z = -505 - t * 28
    const spread = 0.8 + Math.pow(t, 1.65) * 52
    const offset = (seededRandom(index + 8200) - 0.5) * spread
    positions[index * 3] = centerX + offset
    positions[index * 3 + 1] = y + (seededRandom(index + 9100) - 0.5) * (2 + t * 8)
    positions[index * 3 + 2] = z + (seededRandom(index + 10400) - 0.5) * (3 + t * 18)
    sizes[index] = 0.55 + seededRandom(index + 12100) * 1.65
    pathProgress[index] = t
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute(
    'aJourneyPathProgress',
    new THREE.BufferAttribute(pathProgress, 1),
  )
  geometry.computeBoundingSphere()
  return geometry
}

function createSkyBridgeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uJourneyReveal: { value: 0 },
      uJourneyOpacity: { value: 0 },
      uJourneyTime: { value: 0 },
    },
    vertexShader: `
      attribute float aJourneyPathProgress;
      attribute float aSize;
      uniform float uJourneyTime;
      varying float vJourneyPathProgress;
      void main() {
        vJourneyPathProgress = aJourneyPathProgress;
        vec3 animatedPosition = position;
        animatedPosition.x += sin(uJourneyTime * 0.34 + aJourneyPathProgress * 19.0) * 0.55;
        vec4 viewPosition = modelViewMatrix * vec4(animatedPosition, 1.0);
        gl_PointSize = aSize * (1.2 + aJourneyPathProgress * 1.1);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uJourneyReveal;
      uniform float uJourneyOpacity;
      uniform float uJourneyTime;
      varying float vJourneyPathProgress;
      void main() {
        float pointDistance = length(gl_PointCoord - vec2(0.5));
        float softParticle = 1.0 - smoothstep(0.08, 0.5, pointDistance);
        float core = 1.0 - smoothstep(0.0, 0.13, pointDistance);
        float revealed = 1.0 - smoothstep(
          uJourneyReveal - 0.09,
          uJourneyReveal + 0.025,
          vJourneyPathProgress
        );
        float twinkle = 0.7 + 0.3 * sin(vJourneyPathProgress * 71.0 - uJourneyTime * 1.2);
        float taper = smoothstep(0.0, 0.055, vJourneyPathProgress) *
          (1.0 - smoothstep(0.91, 1.0, vJourneyPathProgress) * 0.32);
        float alpha = (softParticle * 0.72 + core * 0.42) * revealed * taper * twinkle * uJourneyOpacity;
        vec3 color = mix(
          vec3(0.26, 0.72, 1.0),
          vec3(0.82, 0.92, 1.0),
          vJourneyPathProgress
        );
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(color * (1.08 + core * 0.58), alpha * 0.66);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function createStarFieldMaterial(milkyWay = false) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uJourneyOpacity: { value: 0 },
      uJourneyTime: { value: 0 },
      uJourneyColor: {
        value: new THREE.Color(milkyWay ? '#c8dcff' : '#edf5ff'),
      },
      uJourneySize: { value: milkyWay ? 1.02 : 0.92 },
    },
    vertexShader: `
      attribute float aSize;
      attribute float aJourneyRevealSeed;
      uniform float uJourneySize;
      varying float vJourneyStarSeed;
      varying float vJourneyRevealSeed;
      void main() {
        vJourneyStarSeed = aSize;
        vJourneyRevealSeed = aJourneyRevealSeed;
        gl_PointSize = uJourneySize * (0.72 + aSize * 0.68);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uJourneyOpacity;
      uniform float uJourneyTime;
      uniform vec3 uJourneyColor;
      varying float vJourneyStarSeed;
      varying float vJourneyRevealSeed;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float softStar = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
        float core = 1.0 - smoothstep(0.0, 0.16, distanceFromCenter);
        float twinkle = 0.88 + 0.12 * sin(uJourneyTime * 0.72 + vJourneyStarSeed * 8.7);
        float populationReveal = smoothstep(
          vJourneyRevealSeed,
          min(1.0, vJourneyRevealSeed + 0.075),
          uJourneyOpacity
        );
        float alpha = (softStar * 0.68 + core * 0.42) *
          uJourneyOpacity * populationReveal * twinkle;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(uJourneyColor * (0.92 + core * 0.48), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function buildSeatedFigureGeometry(count) {
  const positions = new Float32Array(count * 3)
  const targets = new Float32Array(count * 3)

  const placeEllipse = (index, centerX, centerY, radiusX, radiusY, seed) => {
    const angle = seededRandom(seed) * Math.PI * 2
    const radius = Math.sqrt(seededRandom(seed + 1))
    targets[index * 3] = centerX + Math.cos(angle) * radiusX * radius
    targets[index * 3 + 1] = centerY + Math.sin(angle) * radiusY * radius
  }
  const placeSegment = (index, fromX, fromY, toX, toY, thickness, seed) => {
    const along = seededRandom(seed)
    const dx = toX - fromX
    const dy = toY - fromY
    const length = Math.max(Math.hypot(dx, dy), 0.001)
    const across = (seededRandom(seed + 1) - 0.5) * thickness
    targets[index * 3] = fromX + dx * along - (dy / length) * across
    targets[index * 3 + 1] = fromY + dy * along + (dx / length) * across
  }

  for (let index = 0; index < count; index += 1) {
    const region = seededRandom(index + 19000)
    const seed = index * 7 + 21000
    if (region < 0.14) {
      // Head, facing slightly toward the raised knees.
      placeEllipse(index, -0.18, 5.18, 0.72, 0.82, seed)
    } else if (region < 0.34) {
      // A compact, forward-curving torso rather than an amorphous star cloud.
      placeSegment(index, -0.35, 4.45, -0.72, 1.9, 1.22, seed)
    } else if (region < 0.57) {
      // Raised thigh: the long upper edge makes the triangular seated pose legible.
      placeSegment(index, -0.42, 1.78, 2.55, 2.18, 1.08, seed)
    } else if (region < 0.75) {
      // Shin and foot return to the gravel plane.
      placeSegment(index, 2.52, 2.1, 1.08, 0.16, 0.76, seed)
    } else if (region < 0.9) {
      // Both arms wrap around the knees.
      placeSegment(index, -0.18, 3.82, 2.38, 1.82, 0.38, seed)
    } else {
      // Grounded hip and the second folded leg complete the contact silhouette.
      placeSegment(index, -0.86, 0.46, 1.18, 0.14, 0.68, seed)
    }

    // Face the seated figure toward the Milky Way at the centre-left of the sky.
    targets[index * 3] *= -1

    const scatterAngle = seededRandom(index + 25000) * Math.PI * 2
    const scatterRadius = 7 + seededRandom(index + 27000) * 15
    positions[index * 3] = Math.cos(scatterAngle) * scatterRadius
    positions[index * 3 + 1] = Math.sin(scatterAngle) * scatterRadius * 0.72 + 0.7
    positions[index * 3 + 2] = (seededRandom(index + 29000) - 0.5) * 8
    targets[index * 3 + 1] = Math.max(0.06, targets[index * 3 + 1])
    targets[index * 3 + 2] = (seededRandom(index + 31000) - 0.5) * 0.48
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aJourneyFigureTarget', new THREE.BufferAttribute(targets, 3))
  geometry.computeBoundingSphere()
  return geometry
}

function createSeatedFigureMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uJourneyMorph: { value: 0 },
      uJourneyOpacity: { value: 0 },
      uJourneyTime: { value: 0 },
    },
    vertexShader: `
      attribute vec3 aJourneyFigureTarget;
      uniform float uJourneyMorph;
      uniform float uJourneyTime;
      varying float vJourneySeed;
      void main() {
        vJourneySeed = aJourneyFigureTarget.x + aJourneyFigureTarget.y * 0.73;
        vec3 gathered = aJourneyFigureTarget;
        gathered.x += sin(uJourneyTime * 0.32 + vJourneySeed * 2.1) * 0.035;
        gathered.y += cos(uJourneyTime * 0.27 + vJourneySeed * 1.7) * 0.028;
        vec3 finalPosition = mix(position, gathered, uJourneyMorph);
        vec4 viewPosition = modelViewMatrix * vec4(finalPosition, 1.0);
        gl_PointSize = 1.5 + uJourneyMorph * 1.15;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uJourneyOpacity;
      uniform float uJourneyTime;
      varying float vJourneySeed;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float softness = 1.0 - smoothstep(0.08, 0.5, distanceFromCenter);
        float twinkle = 0.84 + 0.16 * sin(uJourneyTime * 0.8 + vJourneySeed * 9.0);
        float alpha = softness * uJourneyOpacity * twinkle;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vec3(0.78, 0.88, 1.0), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function createSeatedSilhouetteTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = 'rgba(4, 11, 19, 0.96)'
  context.fillStyle = 'rgba(4, 11, 19, 0.96)'
  context.save()
  context.translate(canvas.width, 0)
  context.scale(-1, 1)

  // Head and a forward-curving back.
  context.beginPath()
  context.arc(177, 78, 39, 0, Math.PI * 2)
  context.fill()
  context.lineWidth = 79
  context.beginPath()
  context.moveTo(178, 135)
  context.bezierCurveTo(146, 188, 137, 265, 170, 330)
  context.stroke()

  // Folded legs establish the unmistakable triangular seated pose.
  context.lineWidth = 72
  context.beginPath()
  context.moveTo(174, 326)
  context.lineTo(332, 252)
  context.lineTo(421, 396)
  context.stroke()
  context.lineWidth = 58
  context.beginPath()
  context.moveTo(166, 348)
  context.lineTo(322, 410)
  context.lineTo(432, 410)
  context.stroke()

  // Arms wrap around the knees instead of reading as loose particle strands.
  context.lineWidth = 30
  context.beginPath()
  context.moveTo(190, 164)
  context.bezierCurveTo(230, 204, 276, 244, 326, 270)
  context.stroke()
  context.beginPath()
  context.moveTo(173, 184)
  context.bezierCurveTo(208, 247, 255, 283, 315, 286)
  context.stroke()
  context.restore()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function SeatedStarFigure({ groupRef, materialRef, silhouetteMaterialRef, qualityScale = 1 }) {
  const geometry = useMemo(
    () => buildSeatedFigureGeometry(Math.round(1180 * qualityScale)),
    [qualityScale],
  )
  const material = useMemo(() => createSeatedFigureMaterial(), [])
  const silhouetteTexture = useMemo(() => createSeatedSilhouetteTexture(), [])

  useLayoutEffect(() => {
    materialRef.current = material
  }, [material, materialRef])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => {
    material.dispose()
    silhouetteTexture.dispose()
  }, [material, silhouetteTexture])

  return (
    <group ref={groupRef} position={[9.6, 0.24, -70]}>
      <sprite position={[0.72, 2.52, 0.16]} scale={[6.5, 6.8, 1]} renderOrder={3}>
        <spriteMaterial
          ref={silhouetteMaterialRef}
          map={silhouetteTexture}
          color="#07111b"
          transparent
          opacity={0}
          alphaTest={0.018}
          depthWrite={false}
          depthTest
          toneMapped={false}
        />
      </sprite>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />
      <mesh
        name="JOURNEY_FIGURE_GROUND_SHADOW"
        position={[0.78, -0.17, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[2.45, 0.82, 1]}
        renderOrder={2}
      >
        <circleGeometry args={[1, 28]} />
        <meshBasicMaterial
          color="#06121c"
          transparent
          opacity={0}
          depthWrite={false}
          depthTest
        />
      </mesh>
    </group>
  )
}

function createCloudTexture(seed) {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 288
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.filter = 'blur(20px)'

  for (let index = 0; index < 18; index += 1) {
    const centerX = 82 + seededRandom(seed + index * 17) * 604
    const centerY = 58 + seededRandom(seed + index * 29) * 164
    const radiusX = 48 + seededRandom(seed + index * 41) * 92
    const radiusY = 26 + seededRandom(seed + index * 53) * 42
    const alpha = 0.19 + seededRandom(seed + index * 67) * 0.2
    context.beginPath()
    context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2)
    context.fillStyle = `rgba(255, 255, 252, ${alpha})`
    context.fill()
  }
  context.restore()

  context.globalCompositeOperation = 'destination-in'
  const horizontalMask = context.createLinearGradient(0, 0, canvas.width, 0)
  horizontalMask.addColorStop(0, 'rgba(255,255,255,0)')
  horizontalMask.addColorStop(0.16, 'rgba(255,255,255,1)')
  horizontalMask.addColorStop(0.84, 'rgba(255,255,255,1)')
  horizontalMask.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = horizontalMask
  context.fillRect(0, 0, canvas.width, canvas.height)

  const verticalMask = context.createLinearGradient(0, 0, 0, canvas.height)
  verticalMask.addColorStop(0, 'rgba(255,255,255,0)')
  verticalMask.addColorStop(0.24, 'rgba(255,255,255,1)')
  verticalMask.addColorStop(0.76, 'rgba(255,255,255,1)')
  verticalMask.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = verticalMask
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'source-over'

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.premultiplyAlpha = false
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createGroundFogTexture(seed) {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 256
  const context = canvas.getContext('2d')
  const image = context.createImageData(canvas.width, canvas.height)
  const pixels = image.data

  for (let y = 0; y < canvas.height; y += 1) {
    const vertical = y / (canvas.height - 1)
    for (let x = 0; x < canvas.width; x += 1) {
      const horizontal = x / (canvas.width - 1)
      const worldX = horizontal * 12.5
      const worldY = vertical * 5.2
      const valleyTop = 0.16 +
        Math.sin(worldX * 0.47 + seed * 0.0013) * 0.075 +
        Math.sin(worldX * 1.07 - seed * 0.0021) * 0.038 +
        (horizontal - 0.5) * Math.sin(seed * 0.00037) * 0.1
      const topFeather = THREE.MathUtils.smoothstep(
        vertical,
        valleyTop - 0.09,
        valleyTop + 0.27,
      )
      const groundFeather = 1 - THREE.MathUtils.smoothstep(vertical, 0.82, 0.99)
      const depthPocket = 0.64 +
        Math.sin(worldX * 0.29 + seed * 0.0047) * 0.13 +
        Math.sin(worldX * 0.83 - seed * 0.0019) * 0.08
      const broad =
        Math.sin(worldX * 0.62 + seed * 0.0017) * 0.5 +
        Math.sin(worldX * 1.13 - worldY * 0.78 + seed * 0.0031) * 0.27 +
        Math.sin(worldX * 2.18 + worldY * 1.36 + seed * 0.0049) * 0.13
      const fine = Math.sin(worldX * 4.4 - worldY * 2.2 + seed * 0.0083) * 0.1
      const sheet = THREE.MathUtils.smoothstep(broad + fine, -0.5, 0.62)
      const edge = Math.pow(Math.sin(Math.PI * horizontal), 0.54)
      const lowerDensity = THREE.MathUtils.lerp(0.62, 1.08, vertical)
      const alpha = clamp01(
        sheet * topFeather * groundFeather * edge * depthPocket * lowerDensity,
      )
      const offset = (y * canvas.width + x) * 4
      pixels[offset] = 255
      pixels[offset + 1] = 255
      pixels[offset + 2] = 255
      pixels[offset + 3] = Math.round(alpha * 255)
    }
  }

  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createCloudbreakTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 768
  const context = canvas.getContext('2d')
  const horizontal = context.createLinearGradient(0, 0, canvas.width, 0)
  horizontal.addColorStop(0, 'rgba(255,255,255,0)')
  horizontal.addColorStop(0.38, 'rgba(255,255,255,0.16)')
  horizontal.addColorStop(0.5, 'rgba(255,255,255,0.78)')
  horizontal.addColorStop(0.62, 'rgba(255,255,255,0.16)')
  horizontal.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = horizontal
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'destination-in'
  const vertical = context.createLinearGradient(0, 0, 0, canvas.height)
  vertical.addColorStop(0, 'rgba(255,255,255,0)')
  vertical.addColorStop(0.18, 'rgba(255,255,255,0.82)')
  vertical.addColorStop(0.62, 'rgba(255,255,255,0.42)')
  vertical.addColorStop(1, 'rgba(255,255,255,0)')
  context.fillStyle = vertical
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.globalCompositeOperation = 'source-over'
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createSkyAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uJourneyTopColor: { value: new THREE.Color('#4d9fba') },
      uJourneyHorizonColor: { value: new THREE.Color('#d8e7df') },
      uJourneySunColor: { value: new THREE.Color('#fff4cf') },
      uJourneySunDirection: {
        value: new THREE.Vector3(-0.48, 0.46, -0.74).normalize(),
      },
      uJourneyNight: { value: 0 },
    },
    vertexShader: `
      varying vec3 vJourneySkyDirection;
      void main() {
        vJourneySkyDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vJourneySkyDirection;
      uniform vec3 uJourneyTopColor;
      uniform vec3 uJourneyHorizonColor;
      uniform vec3 uJourneySunColor;
      uniform vec3 uJourneySunDirection;
      uniform float uJourneyNight;
      void main() {
        vec3 direction = normalize(vJourneySkyDirection);
        float heightMix = smoothstep(-0.12, 0.78, direction.y);
        heightMix = pow(heightMix, 0.72);
        vec3 color = mix(uJourneyHorizonColor, uJourneyTopColor, heightMix);
        float horizonMist = 1.0 - smoothstep(0.0, 0.24, abs(direction.y));
        color = mix(color, uJourneyHorizonColor * 1.08, horizonMist * (1.0 - uJourneyNight) * 0.22);
        float sunAmount = pow(max(dot(direction, normalize(uJourneySunDirection)), 0.0), 42.0);
        float sunHalo = pow(max(dot(direction, normalize(uJourneySunDirection)), 0.0), 7.5);
        color += uJourneySunColor * (sunAmount * 0.48 + sunHalo * 0.075) * (1.0 - uJourneyNight * 0.8);
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
  })
}

function SkyAtmosphere({ meshRef, materialRef }) {
  const material = useMemo(() => createSkyAtmosphereMaterial(), [])
  useEffect(() => {
    materialRef.current = material
    return () => material.dispose()
  }, [material, materialRef])

  return (
    <mesh ref={meshRef} scale={720} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[1, 32, 20]} />
      <primitive object={material} attach="material" />
    </mesh>
  )
}

function createWatercolorWashTexture(seed = 4200, softEdges = false) {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 512
  const context = canvas.getContext('2d')
  context.fillStyle = '#b8c8ae'
  context.fillRect(0, 0, canvas.width, canvas.height)

  for (let index = 0; index < 96; index += 1) {
    const x = seededRandom(seed + index * 7) * canvas.width
    const y = seededRandom(seed + index * 11) * canvas.height
    const radius = 32 + seededRandom(seed + index * 17) * 150
    const hue = seededRandom(seed + index * 23)
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    const color = hue > 0.72 ? '115, 147, 137' : hue > 0.38 ? '83, 122, 96' : '205, 213, 190'
    gradient.addColorStop(0, `rgba(${color}, ${0.055 + seededRandom(seed + index) * 0.09})`)
    gradient.addColorStop(1, `rgba(${color}, 0)`)
    context.fillStyle = gradient
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < image.data.length; index += 4) {
    const grain = (seededRandom(seed + index) - 0.5) * 15
    image.data[index] += grain
    image.data[index + 1] += grain
    image.data[index + 2] += grain
    if (softEdges) {
      const pixel = index / 4
      const x = (pixel % canvas.width) / (canvas.width - 1)
      const y = Math.floor(pixel / canvas.width) / (canvas.height - 1)
      const edgeX = smoothstep(0, 0.24, x) * smoothstep(0, 0.24, 1 - x)
      const edgeY = smoothstep(0, 0.3, y) * smoothstep(0, 0.3, 1 - y)
      const radialDistance = Math.hypot((x - 0.5) / 0.55, (y - 0.5) / 0.58)
      const radialFade = 1 - smoothstep(0.62, 1, radialDistance)
      image.data[index + 3] = Math.round(255 * edgeX * edgeY * radialFade)
    }
  }
  context.putImageData(image, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

let alpineWatercolorTexture = null
const getAlpineWatercolorTexture = () => {
  alpineWatercolorTexture ??= createWatercolorWashTexture(4831)
  return alpineWatercolorTexture
}

function buildMysticMotes(count) {
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (seededRandom(index + 5100) - 0.5) * 118
    positions[index * 3 + 1] = 7 + seededRandom(index + 6100) * 67
    positions[index * 3 + 2] = -24 - seededRandom(index + 7100) * 158
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  return geometry
}

function buildDistantBirdGeometry() {
  const positions = []
  const birds = [
    { x: 0, y: 0, size: 1 },
    { x: 5.8, y: -2.1, size: 0.72 },
    { x: 10.4, y: 1.4, size: 0.56 },
  ]
  birds.forEach(({ x, y, size }) => {
    positions.push(
      x - size * 1.6, y, 0,
      x, y - size * 0.52, 0,
      x, y - size * 0.52, 0,
      x + size * 1.6, y, 0,
    )
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return geometry
}

function DistantBirds({ groupRef, materialRef }) {
  const geometry = useMemo(() => buildDistantBirdGeometry(), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <lineSegments
      ref={groupRef}
      geometry={geometry}
      position={[24, 42, -210]}
      renderOrder={-1}
      frustumCulled={false}
    >
      <lineBasicMaterial
        ref={materialRef}
        color="#263e42"
        transparent
        opacity={0}
        depthWrite={false}
        depthTest
        toneMapped={false}
      />
    </lineSegments>
  )
}

function cloneMaterial(material) {
  const clone = material.clone()
  if ('roughness' in clone) clone.roughness = Math.max(0.72, clone.roughness ?? 0.8)
  if ('metalness' in clone) clone.metalness = 0
  return clone
}

function createAlpineLambertMaterial(source) {
  if (source.isMeshLambertMaterial) return source
  const material = new THREE.MeshLambertMaterial().copy(source)
  // MeshLambertMaterial.copy accepts the shared PBR texture/color fields, but
  // StandardMaterial does not define the legacy environment-map controls.
  // Keep deterministic Lambert defaults in case an authored ridge gains an
  // environment map later.
  material.combine ??= THREE.MultiplyOperation
  material.reflectivity = Number.isFinite(material.reflectivity) ? material.reflectivity : 1
  material.refractionRatio = Number.isFinite(material.refractionRatio)
    ? material.refractionRatio
    : 0.98
  return material
}

function reshapeV1MassifGeometry(object) {
  const geometry = object.geometry.clone()
  const position = geometry.attributes.position
  if (!position) return geometry
  object.updateWorldMatrix(true, false)
  const inverseWorld = object.matrixWorld.clone().invert()
  const local = new THREE.Vector3()
  const world = new THREE.Vector3()
  const delta = new THREE.Vector3()

  for (let index = 0; index < position.count; index += 1) {
    local.fromBufferAttribute(position, index)
    world.copy(local).applyMatrix4(object.matrixWorld)

    // Build a broad alluvial terrace around the same river used by every
    // supplemental layer. Only the low valley floor is affected; the cave,
    // river path and high skyline remain separate authored systems.
    if (world.z < 4 && world.z > -142) {
      const station = sampleNaturalRiverAtZ(world.z)
      delta.set(world.x - station.point.x, 0, world.z - station.point.z)
      const signedAcross = delta.dot(station.normal)
      const bankOffset = Math.abs(signedAcross) - station.halfWidth
      const corridorDistance = Math.max(0, bankOffset)
      const corridorMask = 1 - smoothstep(38, 62, corridorDistance)
      const depthFade = smoothstep(1, 18, -world.z) * (1 - smoothstep(126, 142, -world.z))
      const lowTerrain = 1 - smoothstep(34, 72, world.y)
      const targetHeight = bankOffset < 0
        ? station.point.y - 0.2
        : sampleValleyMeadowHeight(world.z, signedAcross < 0 ? -1 : 1, corridorDistance)
      const flatten = corridorMask * depthFade * lowTerrain * 0.9
      world.y = THREE.MathUtils.lerp(world.y, targetHeight, flatten)
    }

    // The source massif is one continuous wall. Moving only elevated inner
    // slopes outward and slightly back creates a legible near/mid/far valley
    // without touching the camera, river or summit height hierarchy.
    const mountainHeight = smoothstep(13, 48, world.y) * (1 - smoothstep(118, 194, world.y))
    const mountainDepth = smoothstep(28, 122, -world.z) * (1 - smoothstep(330, 382, -world.z))
    const innerSlope = 1 - smoothstep(112, 218, Math.abs(world.x))
    const openMask = mountainHeight * mountainDepth * innerSlope
    if (openMask > 0.0001) {
      const side = Math.tanh(world.x / 30)
      const depth = clamp01((-world.z - 34) / 245)
      world.x += side * (18 + depth * 24) * openMask
      const backShift = 9 + side * 2
      world.z -= backShift * (0.74 + depth * 0.46) * openMask
      const centralShoulder = 1 - smoothstep(72, 154, Math.abs(world.x))
      world.y -= centralShoulder * (4.0 + depth * 3.0) * openMask
    }

    local.copy(world).applyMatrix4(inverseWorld)
    position.setXYZ(index, local.x, local.y, local.z)
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  geometry.userData.journeyV1Overhaul = true
  return geometry
}

// Retained as a source-reference fallback while the production path below is
// intentionally much cheaper. Rollup removes this uncalled function.
// eslint-disable-next-line no-unused-vars
function applyAlpineIllustration(
  material,
  isFarRidge,
  biomeMacroTexture,
  forestSurfaceTexture = null,
) {
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return
  const hasAlpineMap = Boolean(material.map)
  const triplanarNormalMap = material.normalMap
  const triplanarRoughnessMap = material.roughnessMap
  material.normalMap = null
  material.roughnessMap = null
  const journeyUniforms = {
    uJourneySunset: { value: 0 },
    uJourneyNight: { value: 0 },
    uJourneyRiverLight: { value: 0 },
    uJourneyDiscovery: { value: 0 },
    uJourneyTime: { value: 0 },
    uJourneyWatercolor: { value: getAlpineWatercolorTexture() },
    uJourneyForestSurface: { value: forestSurfaceTexture },
    uJourneyBiomeMacro: { value: biomeMacroTexture },
    uJourneyTriplanarNormal: { value: triplanarNormalMap },
    uJourneyTriplanarRoughness: { value: triplanarRoughnessMap },
  }
  material.userData.journeyAlpineUniforms = journeyUniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, journeyUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyWorldPosition;
varying vec3 vJourneyWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vJourneyWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vJourneyWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyWorldPosition;
varying vec3 vJourneyWorldNormal;
uniform float uJourneySunset;
uniform float uJourneyNight;
uniform float uJourneyRiverLight;
uniform float uJourneyDiscovery;
uniform float uJourneyTime;
uniform sampler2D uJourneyWatercolor;
uniform sampler2D uJourneyForestSurface;
uniform sampler2D uJourneyBiomeMacro;
uniform sampler2D uJourneyTriplanarNormal;
uniform sampler2D uJourneyTriplanarRoughness;

float journeyHash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float journeyNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = journeyHash(cell);
  float b = journeyHash(cell + vec2(1.0, 0.0));
  float c = journeyHash(cell + vec2(0.0, 1.0));
  float d = journeyHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float journeyFbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.58;
  mat2 rotation = mat2(0.82, -0.57, 0.57, 0.82);
  for (int octave = 0; octave < 3; octave++) {
    value += journeyNoise(point) * amplitude;
    point = rotation * point * 2.03 + vec2(13.7, 9.2);
    amplitude *= 0.48;
  }
  return value;
}

float journeyTreeCanopy(vec2 point, float densitySeed) {
  float warp = journeyFbm(point * 0.075 + vec2(19.0, -11.0));
  point.x += (warp - 0.5) * 2.7;
  vec2 cell = floor(point);
  vec2 local = fract(point);
  float seed = journeyHash(cell + densitySeed);
  local.x += (journeyHash(cell + densitySeed + 17.0) - 0.5) * 0.42;
  float halfWidth = mix(0.045, mix(0.28, 0.43, seed), smoothstep(0.05, 0.84, local.y));
  float crown = 1.0 - smoothstep(halfWidth, halfWidth + 0.055, abs(local.x - 0.5));
  crown *= smoothstep(0.03, 0.12, local.y) * (1.0 - smoothstep(0.82, 0.98, local.y));
  crown *= smoothstep(0.2, 0.58, seed);
  return crown;
}

float journeyCanopyCells(vec2 point, float seedOffset) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  float nearest = 1.0;
  float crownSeed = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbour = vec2(float(x), float(y));
      vec2 id = cell + neighbour;
      vec2 offset = vec2(
        journeyHash(id + seedOffset),
        journeyHash(id + seedOffset + 37.17)
      );
      vec2 delta = neighbour + offset - local;
      float distanceToCrown = length(delta * vec2(0.9, 1.16));
      if (distanceToCrown < nearest) {
        nearest = distanceToCrown;
        crownSeed = journeyHash(id + seedOffset + 91.3);
      }
    }
  }
  float crown = 1.0 - smoothstep(0.28, 0.62, nearest);
  return crown * mix(0.62, 1.0, crownSeed);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float journeyAltitude = smoothstep(18.0, 51.0, vJourneyWorldPosition.y);
float journeySteepness = smoothstep(0.18, 0.88, 1.0 - abs(vJourneyWorldNormal.y));
vec2 journeyTerrainUv = vec2(
  vJourneyWorldPosition.x * 0.043 + vJourneyWorldPosition.y * 0.009,
  vJourneyWorldPosition.z * 0.039 - vJourneyWorldPosition.y * 0.006
);
float journeyMacro = journeyFbm(journeyTerrainUv);
float journeyFine = journeyFbm(journeyTerrainUv * 3.45 + vec2(21.4, -8.7));
float journeyWash = mix(journeyMacro, journeyFine, 0.28);
float journeyForestClusters = smoothstep(
  0.34,
  0.73,
  journeyMacro * 0.62 + journeyFine * 0.38 - journeySteepness * 0.16
);
float journeyErosion = 1.0 - abs(journeyFine * 2.0 - 1.0);
float journeyWetGully =
  smoothstep(0.72, 0.94, journeyErosion) *
  smoothstep(0.2, 0.78, journeySteepness) *
  (1.0 - smoothstep(0.74, 1.0, journeyAltitude));
vec3 journeyForest = mix(
  vec3(0.045, 0.135, 0.088),
  vec3(0.105, 0.255, 0.135),
  journeyForestClusters
);
vec3 journeySummer = mix(
  vec3(0.135, 0.285, 0.16),
  vec3(0.285, 0.44, 0.22),
  journeyMacro
);
vec3 journeyRock = mix(
  vec3(0.19, 0.225, 0.215),
  vec3(0.35, 0.37, 0.34),
  journeyFine
);
vec3 journeySnow = vec3(0.84, 0.87, 0.84);
float journeyRockMask = smoothstep(
  0.5,
  0.91,
  journeySteepness + journeyAltitude * 0.2 + journeyErosion * 0.12 - journeyForestClusters * 0.1
);
float journeySnowShelf =
  smoothstep(0.58, 0.92, journeyAltitude) *
  smoothstep(0.24, 0.86, 1.0 - journeySteepness) *
  smoothstep(0.38, 0.76, journeyMacro * 0.62 + journeyFine * 0.38);
float journeySnowGullyPattern = 0.5 + 0.5 * sin(
  vJourneyWorldPosition.x * 0.19 +
  sin(vJourneyWorldPosition.z * 0.052) * 2.7 -
  vJourneyWorldPosition.y * 0.035
);
float journeySnowGully =
  smoothstep(0.84, 0.97, journeySnowGullyPattern) *
  smoothstep(0.44, 0.88, journeyAltitude) *
  smoothstep(0.32, 0.88, journeySteepness) * 0.52;
float journeySnowMask = clamp(journeySnowShelf + journeySnowGully, 0.0, 1.0);
vec3 journeyPaint = mix(journeyForest, journeySummer, smoothstep(0.08, 0.58, journeyAltitude));
journeyPaint = mix(journeyPaint, journeyRock, journeyRockMask * 0.67);
float journeyForestSurface =
  (1.0 - smoothstep(0.62, 0.9, journeyAltitude)) *
  (1.0 - smoothstep(0.68, 0.96, journeyRockMask));
float journeyValleyMoisture = smoothstep(
  0.18,
  0.83,
  journeyFbm(vec2(
    journeyTerrainUv.x * 0.74 + journeyTerrainUv.y * 0.22,
    journeyTerrainUv.y * 1.72 - journeyAltitude * 1.8
  ) + vec2(-18.0, 47.0)) + journeyWetGully * 0.34
);
float journeyCanopyGrain = journeyNoise(
  journeyTerrainUv * 22.0 + vec2(journeyFine * 3.1, vJourneyWorldPosition.y * 0.24)
);
float journeyCanopyOpenings = smoothstep(0.76, 0.94, journeyCanopyGrain);
float journeyCanopyShadow = smoothstep(
  0.48,
  0.78,
  journeyNoise(journeyTerrainUv * 34.0 + vec2(journeyMacro * 7.0, -journeyFine * 5.0))
);
journeyPaint *= mix(
  vec3(1.0),
  mix(vec3(0.72, 0.78, 0.7), vec3(1.12, 1.16, 1.075), journeyCanopyGrain),
  journeyForestSurface * 0.58
);
journeyPaint = mix(
  journeyPaint,
  mix(vec3(0.035, 0.11, 0.066), vec3(0.13, 0.27, 0.12), journeyCanopyGrain),
  journeyForestSurface * journeyCanopyShadow * 0.24
);
journeyPaint = mix(
  journeyPaint,
  journeySummer * 1.08,
  journeyForestSurface * journeyCanopyOpenings * 0.08
);
// Readable canopy scale: irregular, overlapping forest masses keep the lower
// massif from reading as one green material without introducing a tiled pattern.
vec2 journeyCrownUv = vec2(
  vJourneyWorldPosition.x + vJourneyWorldPosition.z * 0.21,
  vJourneyWorldPosition.y - vJourneyWorldPosition.z * 0.055
) * 0.48;
float journeyVegetationDensity = smoothstep(
  0.28,
  0.74,
  journeyFbm(journeyTerrainUv * 0.72 + vec2(36.0, -19.0))
);
float journeyCanopyMass = journeyFbm(journeyCrownUv * 0.72 + vec2(13.0, -7.0));
float journeyCanopyNeedles = journeyNoise(
  journeyCrownUv * 3.15 + vec2(journeyCanopyMass * 5.8, -journeyMacro * 3.2)
);
float journeyCanopyTexture = clamp(
  journeyCanopyMass * 0.58 + journeyCanopyNeedles * 0.42,
  0.0,
  1.0
);
float journeyTreeBands = journeyFbm(vec2(
  journeyCrownUv.x * 1.75 + journeyCanopyMass * 2.4,
  journeyCrownUv.y * 4.9 - journeyMacro * 1.8
));
float journeyCrownPresence = journeyForestSurface *
  mix(0.38, 1.0, journeyVegetationDensity) * smoothstep(0.22, 0.8, journeyCanopyTexture);
vec3 journeyConiferDark = vec3(0.022, 0.095, 0.052);
vec3 journeyConiferLight = vec3(0.12, 0.285, 0.105);
vec3 journeyCrownColor = mix(journeyConiferDark, journeyConiferLight, journeyCanopyTexture);
journeyCrownColor *= mix(0.72, 1.16, journeyTreeBands);
journeyPaint = mix(journeyPaint, journeyCrownColor, journeyCrownPresence * 0.32);
// Crown-scale cellular breakup makes the green read as thousands of trees,
// while two offset frequencies avoid a tiled procedural carpet.
float journeyCrownCellsLarge = journeyCanopyCells(
  journeyCrownUv * vec2(0.72, 0.92) + vec2(journeyMacro * 2.1, 0.0),
  113.0
);
float journeyCrownCellsSmall = journeyCanopyCells(
  journeyCrownUv * vec2(1.46, 1.78) + vec2(19.0, -7.0),
  271.0
);
float journeyCrownCellField = max(journeyCrownCellsLarge, journeyCrownCellsSmall * 0.72);
float journeyCrownOcclusion = smoothstep(0.16, 0.78, journeyCrownCellField) *
  journeyForestSurface * mix(0.52, 1.0, journeyVegetationDensity);
vec3 journeyCrownLit = mix(
  vec3(0.016, 0.068, 0.036),
  vec3(0.17, 0.355, 0.105),
  smoothstep(0.2, 0.9, journeyCrownCellsLarge * 0.68 + journeyCrownCellsSmall * 0.32)
);
journeyCrownLit *= mix(0.68, 1.12, journeyMacro * 0.55 + journeyValleyMoisture * 0.45);
journeyPaint = mix(journeyPaint, journeyCrownLit, journeyCrownOcclusion * 0.11);
vec2 journeyTreeUv = vec2(
  vJourneyWorldPosition.x + vJourneyWorldPosition.z * 0.22,
  vJourneyWorldPosition.y - vJourneyWorldPosition.z * 0.035
);
float journeyTreeSilhouettes = max(
  journeyTreeCanopy(journeyTreeUv * 0.26, 31.0),
  journeyTreeCanopy(journeyTreeUv * 0.52 + vec2(8.0, 13.0), 79.0) * 0.72
);
float journeyTreeDistanceFade = 1.0 - smoothstep(255.0, 430.0, length(vViewPosition));
float journeyTreePresence = journeyTreeSilhouettes * journeyForestSurface *
  mix(0.32, 1.0, journeyVegetationDensity) * journeyTreeDistanceFade;
vec3 journeyTreeColor = mix(vec3(0.012, 0.052, 0.026), vec3(0.065, 0.17, 0.06), journeyCanopyMass);
journeyPaint = mix(journeyPaint, journeyTreeColor, journeyTreePresence * 0.06);
float journeyForestPatch = smoothstep(
  0.3,
  0.74,
  journeyFbm(journeyTerrainUv * vec2(1.72, 2.45) + vec2(28.0, -37.0))
);
float journeyForestStand = smoothstep(
  0.24,
  0.82,
  journeyFbm(journeyTerrainUv * vec2(1.35, 3.8) + vec2(-17.0, 12.0))
);
float journeyVerticalStand = smoothstep(
  0.32,
  0.76,
  journeyFbm(vec2(
    journeyCrownUv.x * 0.42 + journeyCrownUv.y * 0.08,
    journeyCrownUv.y * 2.9 + journeyMacro * 1.7
  ) + vec2(61.0, -28.0))
);
vec3 journeyForestStandColor = mix(
  vec3(0.012, 0.062, 0.034),
  vec3(0.13, 0.31, 0.095),
  journeyForestStand * 0.62 + journeyVerticalStand * 0.38
);
journeyPaint = mix(
  journeyPaint,
  journeyForestStandColor,
  journeyForestSurface * (0.20 + journeyVegetationDensity * 0.28) *
    mix(0.48, 1.0, journeyForestPatch) * mix(0.72, 1.0, journeyValleyMoisture)
);
float journeyScrubTransition =
  smoothstep(0.3, 0.5, journeyAltitude) *
  (1.0 - smoothstep(0.67, 0.84, journeyAltitude)) *
  (1.0 - journeyRockMask) *
  smoothstep(0.28, 0.76, journeyMacro * 0.58 + journeyFine * 0.42);
vec3 journeyScrubColor = mix(vec3(0.105, 0.205, 0.09), vec3(0.24, 0.34, 0.13), journeyFine);
journeyPaint = mix(journeyPaint, journeyScrubColor, journeyScrubTransition * 0.28);
float journeyLowerForestBelt =
  (1.0 - smoothstep(16.0, 48.0, vJourneyWorldPosition.y)) *
  (0.34 + smoothstep(0.08, 0.42, journeySteepness) * 0.66);
vec3 journeyLowerForestColor = mix(
  vec3(0.012, 0.058, 0.031),
  vec3(0.105, 0.265, 0.075),
  journeyCanopyGrain * 0.56 + journeyVegetationDensity * 0.44
);
journeyPaint = mix(
  journeyPaint,
  journeyLowerForestColor,
  journeyLowerForestBelt * (0.28 + journeyVegetationDensity * 0.22) *
    mix(0.45, 1.0, journeyForestPatch) * mix(0.74, 1.0, journeyValleyMoisture)
);
float journeyForestShadow = journeyForestSurface * smoothstep(
  0.54,
  0.88,
  journeyFbm(journeyTerrainUv * vec2(2.8, 8.6) + vec2(9.0, -24.0))
);
journeyPaint = mix(journeyPaint, journeyConiferDark, journeyForestShadow * 0.3);
float journeyClearing = journeyForestSurface * (1.0 - journeyVegetationDensity) *
  smoothstep(0.58, 0.94, vJourneyWorldNormal.y);
vec3 journeyGrassland = mix(vec3(0.19, 0.31, 0.12), vec3(0.34, 0.43, 0.17), journeyFine);
journeyPaint = mix(journeyPaint, journeyGrassland, journeyClearing * 0.34);
// Surface-only forest hierarchy. Large masses establish the biome, elongated
// mid-frequency breakup suggests overlapping canopy groups, and the fine term
// changes material response without drawing isolated tree silhouettes.
vec2 journeySurfaceDomain = vec2(
  vJourneyWorldPosition.x * 0.021 + vJourneyWorldPosition.z * 0.008,
  vJourneyWorldPosition.z * 0.018 - vJourneyWorldPosition.y * 0.015
);
float journeySurfaceWarp = journeyFbm(journeySurfaceDomain * 1.34 + vec2(73.0, -41.0));
float journeySurfaceLarge = journeyFbm(
  journeySurfaceDomain + vec2(journeySurfaceWarp * 1.8, -journeyMacro * 1.25)
);
float journeySurfaceMedium = journeyFbm(vec2(
  journeySurfaceDomain.x * 5.1 + journeySurfaceDomain.y * 0.76,
  journeySurfaceDomain.y * 9.4 - journeySurfaceDomain.x * 0.38
) + vec2(-29.0, 84.0));
float journeySurfaceFine = journeyNoise(vec2(
  journeySurfaceDomain.x * 31.0 + journeySurfaceMedium * 3.7,
  journeySurfaceDomain.y * 37.0 - journeySurfaceLarge * 4.2
) + vec2(17.0, -63.0));
float journeySurfaceFacing = dot(
  normalize(vJourneyWorldNormal),
  normalize(vec3(-0.55, 0.80, -0.24))
) * 0.5 + 0.5;
float journeySurfaceValleyShade = (1.0 - smoothstep(0.12, 0.62, journeySurfaceFacing)) *
  (0.46 + journeySteepness * 0.54);
float journeyForestBiome = smoothstep(
  0.18,
  0.78,
  journeySurfaceLarge * 0.64 + journeyValleyMoisture * 0.28 +
    journeyWetGully * 0.24 - journeyAltitude * 0.18 - journeyRockMask * 0.24
);
float journeySurfaceForestMask = journeyForestSurface * mix(0.68, 1.0, journeyForestBiome);
float journeyCanopyResponse = clamp(
  journeySurfaceMedium * 0.58 + journeySurfaceFine * 0.24 + journeySurfaceLarge * 0.18,
  0.0,
  1.0
);
vec3 journeyShadowForest = mix(
  vec3(0.018, 0.075, 0.043),
  vec3(0.052, 0.145, 0.068),
  journeyValleyMoisture
);
vec3 journeySunForest = mix(
  vec3(0.055, 0.145, 0.065),
  vec3(0.22, 0.31, 0.12),
  journeyCanopyResponse
);
vec3 journeySurfaceForest = mix(
  journeyShadowForest,
  journeySunForest,
  clamp(journeyCanopyResponse * 0.72 + journeySurfaceFacing * 0.38, 0.0, 1.0)
);
journeySurfaceForest *= mix(0.72, 1.12, smoothstep(0.16, 0.86, journeySurfaceMedium));
journeySurfaceForest *= mix(0.88, 1.10, journeySurfaceFine);
journeySurfaceForest = mix(
  journeySurfaceForest,
  journeyShadowForest * 0.72,
  journeyWetGully * 0.58 + journeySurfaceValleyShade * 0.18
);
journeySurfaceForest *= mix(0.76, 1.18, journeySurfaceLarge);
journeyPaint = mix(journeyPaint, journeySurfaceForest, journeySurfaceForestMask * 0.43);
vec3 journeySurfaceBlend = pow(abs(normalize(vJourneyWorldNormal)), vec3(5.0));
journeySurfaceBlend /= max(
  journeySurfaceBlend.x + journeySurfaceBlend.y + journeySurfaceBlend.z,
  0.0001
);
float journeyForestTextureScale = 0.038;
vec2 journeyForestWarpOffset = vec2(
  (journeySurfaceLarge - 0.5) * 0.16,
  (journeySurfaceWarp - 0.5) * 0.14
);
vec3 journeyForestTexX = texture2D(
  uJourneyForestSurface,
  vJourneyWorldPosition.zy * journeyForestTextureScale + journeyForestWarpOffset
).rgb;
vec3 journeyForestTexY = texture2D(
  uJourneyForestSurface,
  vJourneyWorldPosition.xz * journeyForestTextureScale + journeyForestWarpOffset.yx
).rgb;
vec3 journeyForestTexZ = texture2D(
  uJourneyForestSurface,
  vJourneyWorldPosition.xy * journeyForestTextureScale - journeyForestWarpOffset
).rgb;
vec3 journeyForestTexture =
  journeyForestTexX * journeySurfaceBlend.x +
  journeyForestTexY * journeySurfaceBlend.y +
  journeyForestTexZ * journeySurfaceBlend.z;
float journeyForestTextureLuma = dot(journeyForestTexture, vec3(0.22, 0.62, 0.16));
float journeyForestTextureRelief = smoothstep(0.18, 0.82, journeyForestTextureLuma);
journeyForestTexture = mix(
  journeySurfaceForest * mix(0.70, 1.16, journeyForestTextureRelief),
  journeyForestTexture * vec3(0.72, 0.93, 0.62),
  0.34
);
float journeyForestTextureMix = journeySurfaceForestMask *
  mix(0.24, 0.44, journeyForestBiome) * (1.0 - journeyRockMask * 0.72);
journeyPaint = mix(journeyPaint, journeyForestTexture, journeyForestTextureMix);
float journeySurfaceRockVein = smoothstep(
  0.7,
  0.94,
  journeyFbm(vec2(
    journeySurfaceDomain.x * 3.2 + vJourneyWorldPosition.y * 0.022,
    journeySurfaceDomain.y * 8.7 - vJourneyWorldPosition.x * 0.006
  ) + vec2(92.0, -18.0)) + journeySteepness * 0.31 + journeyAltitude * 0.14
);
float journeyBrokenRock = journeySurfaceRockVein *
  smoothstep(0.16, 0.88, journeySteepness + journeyAltitude * 0.24) *
  mix(0.46, 1.0, 1.0 - journeyForestBiome);
vec3 journeySurfaceRock = mix(
  vec3(0.16, 0.19, 0.17),
  vec3(0.46, 0.43, 0.34),
  journeySurfaceFine * 0.42 + smoothstep(0.4, 0.86, journeySurfaceFacing) * 0.58
);
journeyPaint = mix(journeyPaint, journeySurfaceRock, journeyBrokenRock * 0.86);
float journeyRiverGrass =
  (1.0 - smoothstep(5.0, 17.0, vJourneyWorldPosition.y)) *
  smoothstep(0.55, 0.92, vJourneyWorldNormal.y) *
  (1.0 - smoothstep(0.46, 0.78, journeyVegetationDensity)) *
  smoothstep(0.34, 0.76, journeyFine);
journeyPaint = mix(journeyPaint, journeyGrassland * 0.94, journeyRiverGrass * 0.3);
float journeySoilBreak = journeyForestSurface * smoothstep(
  0.79,
  0.96,
  journeyNoise(journeyTerrainUv * 5.8 + vec2(8.0, 31.0))
) * (0.38 + journeySteepness * 0.62);
journeyPaint = mix(journeyPaint, vec3(0.20, 0.165, 0.105), journeySoilBreak * 0.42);
journeyPaint = mix(journeyPaint, journeySnow, journeySnowMask * (0.54 + uJourneyNight * 0.12));
journeyPaint = mix(journeyPaint, vec3(0.038, 0.095, 0.082), journeyWetGully * 0.48);
float journeyLowerValley = 1.0 - smoothstep(7.0, 30.0, vJourneyWorldPosition.y);
float journeyValleyPigment = mix(0.79, 1.07, journeyMacro * 0.72 + journeyFine * 0.28);
journeyPaint *= mix(1.0, journeyValleyPigment, journeyLowerValley * 0.58);
// Keep the illustrative slope response aligned with the actual daylight rig.
vec3 journeyLightDirection = normalize(vec3(-0.55, 0.80, -0.24));
float journeyFacing = dot(normalize(vJourneyWorldNormal), journeyLightDirection) * 0.5 + 0.5;
float journeyRidgeLight = smoothstep(0.40, 0.86, journeyFacing);
float journeyValleyShade = (1.0 - smoothstep(0.12, 0.62, journeyFacing)) * (0.46 + journeySteepness * 0.54);
float journeyContour = journeyNoise(vec2(
  vJourneyWorldPosition.y * 0.16 + vJourneyWorldPosition.x * 0.027,
  vJourneyWorldPosition.z * 0.105 + journeyMacro * 2.2
));
journeyContour = smoothstep(0.79, 0.96, journeyContour) * journeySteepness;
float journeyStrata = journeyNoise(vec2(
  vJourneyWorldPosition.y * 0.72 + vJourneyWorldPosition.x * 0.12,
  vJourneyWorldPosition.z * 0.31
));
float journeyFracture = journeyNoise(vec2(
  vJourneyWorldPosition.x * 0.46 - vJourneyWorldPosition.z * 0.22,
  vJourneyWorldPosition.y * 0.38 + vJourneyWorldPosition.z * 0.09
));
float journeyRockDetail = smoothstep(0.74, 0.96, journeyStrata * 0.58 + journeyFracture * 0.42);
journeyRockDetail *= journeyRockMask * (0.38 + journeySteepness * 0.62);
// A warped, oblique field avoids the repeated near-vertical sine grooves that
// made the source relief read like melted wax. The secondary mask breaks the
// gullies into drainage fragments rather than continuous painted stripes.
vec2 journeyDrainageDomain = vec2(
  vJourneyWorldPosition.x * 0.021 + vJourneyWorldPosition.z * 0.017,
  vJourneyWorldPosition.y * 0.017 - vJourneyWorldPosition.z * 0.024 +
    vJourneyWorldPosition.x * 0.006
);
float journeyDrainageWarp = journeyFbm(
  journeyDrainageDomain * 0.72 + vec2(31.0, -17.0)
);
float journeyDrainageField = journeyFbm(
  journeyDrainageDomain * 1.42 +
    vec2(journeyDrainageWarp * 2.3, -journeyFine * 1.7) +
    vec2(-12.0, 43.0)
);
float journeyDrainage = 1.0 - smoothstep(
  0.035,
  0.13,
  abs(journeyDrainageField - 0.48)
);
journeyDrainage *= journeySteepness *
  (1.0 - smoothstep(0.78, 1.0, journeyAltitude)) *
  smoothstep(0.3, 0.74, journeyMacro * 0.58 + journeyFine * 0.42);
vec3 journeyShadow = mix(vec3(0.055, 0.13, 0.14), vec3(0.10, 0.16, 0.25), uJourneyNight);
journeyPaint = mix(journeyPaint, journeyShadow, journeyValleyShade * 0.18);
journeyPaint += vec3(0.10, 0.125, 0.095) * journeyRidgeLight * (0.052 + uJourneySunset * 0.065);
journeyPaint -= vec3(0.032, 0.046, 0.041) * journeyContour * 0.22;
journeyPaint -= vec3(0.034, 0.049, 0.052) * journeyRockDetail * (0.42 + uJourneyNight * 0.2);
journeyPaint = mix(
  journeyPaint,
  vec3(0.052, 0.092, 0.078),
  journeyDrainage * ${isFarRidge ? '0.025' : '0.07'}
);
vec3 journeyDayHaze = vec3(0.48, 0.65, 0.66);
vec3 journeySunsetHaze = vec3(0.72, 0.50, 0.43);
vec3 journeyNightHaze = vec3(0.105, 0.17, 0.31);
vec3 journeyAtmosphere = mix(journeyDayHaze, journeySunsetHaze, uJourneySunset * 0.72);
journeyAtmosphere = mix(journeyAtmosphere, journeyNightHaze, uJourneyNight);
float journeyViewDistance = length(vViewPosition);
float journeyDistanceHaze = smoothstep(62.0, 330.0, journeyViewDistance);
journeyPaint = mix(
  journeyPaint,
  journeyAtmosphere,
  journeyDistanceHaze * ${isFarRidge ? 'mix(0.62, 0.72, uJourneyNight)' : 'mix(0.16, 0.31, uJourneyNight)'}
);
float journeyFootMist = smoothstep(76.0, 265.0, journeyViewDistance) *
  (1.0 - smoothstep(9.0, 31.0, vJourneyWorldPosition.y)) *
  (0.58 + journeyMacro * 0.42);
journeyPaint = mix(
  journeyPaint,
  journeyAtmosphere * 1.035,
  journeyFootMist * ${isFarRidge ? '0.34' : '0.085'}
);
vec2 journeyWatercolorUv = vec2(
  vJourneyWorldPosition.x * 0.0038 + vJourneyWorldPosition.z * 0.0009,
  vJourneyWorldPosition.y * 0.0062 - vJourneyWorldPosition.z * 0.0011
);
vec3 journeyWatercolor = texture2D(uJourneyWatercolor, fract(journeyWatercolorUv)).rgb;
float journeyPigment = dot(journeyWatercolor, vec3(0.28, 0.52, 0.20));
journeyPaint *= mix(0.94, 1.07, journeyPigment);
journeyPaint = mix(journeyPaint, journeyPaint * journeyWatercolor * 1.16, 0.10);
float journeyDiscoveredSummit =
  exp(-pow((vJourneyWorldPosition.x - 54.0) / 46.0, 2.0)) *
  smoothstep(42.0, 72.0, vJourneyWorldPosition.y) *
  smoothstep(0.28, 0.82, journeyFacing);
vec3 journeyCloudbreakColor = mix(vec3(0.88, 0.96, 0.79), vec3(1.0, 0.66, 0.38), uJourneySunset);
journeyPaint += journeyCloudbreakColor * journeyDiscoveredSummit * uJourneyDiscovery * 0.38;
vec3 journeyAlbedoResponse = vec3(1.0);
${hasAlpineMap ? 'journeyAlbedoResponse = mix(vec3(0.86), journeyTriplanar * 1.08, 0.40);' : ''}
float journeyAlbedoWeight = mix(0.24, 0.43, clamp(journeyRockMask * 0.72 + journeyAltitude * 0.16, 0.0, 1.0));
diffuseColor.rgb = mix(
  journeyPaint,
  journeyPaint * journeyAlbedoResponse,
  journeyAlbedoWeight
) * mix(0.96, 1.045, journeyWash);
// Landscape-scale biome zoning replaces the previous single green wash.
float journeyNaturalMacro = journeyFbm(vec2(
  vJourneyWorldPosition.x * 0.0062 + vJourneyWorldPosition.z * 0.0018,
  vJourneyWorldPosition.z * 0.0054 - vJourneyWorldPosition.y * 0.0035
) + vec2(12.7, -31.4));
float journeyNaturalSecondary = journeyFbm(vec2(
  vJourneyWorldPosition.x * 0.011 - vJourneyWorldPosition.z * 0.0026,
  vJourneyWorldPosition.y * 0.009 + vJourneyWorldPosition.z * 0.008
) + vec2(-44.0, 18.0));
vec2 journeyBiomeWarp = vec2(
  (journeyNaturalMacro - 0.5) * 0.11,
  (journeyNaturalSecondary - 0.5) * 0.1
);
float journeyBiomeScale = 0.0068;
vec3 journeyBiomeX = texture2D(
  uJourneyBiomeMacro,
  vJourneyWorldPosition.zy * journeyBiomeScale + journeyBiomeWarp
).rgb;
vec3 journeyBiomeY = texture2D(
  uJourneyBiomeMacro,
  vJourneyWorldPosition.xz * journeyBiomeScale + journeyBiomeWarp.yx
).rgb;
vec3 journeyBiomeZ = texture2D(
  uJourneyBiomeMacro,
  vJourneyWorldPosition.xy * journeyBiomeScale - journeyBiomeWarp
).rgb;
vec3 journeyBiomeTexture =
  journeyBiomeX * journeySurfaceBlend.x +
  journeyBiomeY * journeySurfaceBlend.y +
  journeyBiomeZ * journeySurfaceBlend.z;
float journeyNaturalAltitude = smoothstep(28.0, 126.0, vJourneyWorldPosition.y);
vec2 journeyNaturalDrainageDomain = vec2(
  vJourneyWorldPosition.x * 0.018 + vJourneyWorldPosition.z * 0.014,
  vJourneyWorldPosition.y * 0.014 - vJourneyWorldPosition.z * 0.022 +
    vJourneyWorldPosition.x * 0.005
);
float journeyNaturalDrainageWarp = journeyFbm(
  journeyNaturalDrainageDomain * 0.64 + vec2(-27.0, 38.0)
);
float journeyNaturalDrainageField = journeyFbm(
  journeyNaturalDrainageDomain * 1.36 +
    vec2(journeyNaturalDrainageWarp * 2.1, -journeyNaturalMacro * 1.8) +
    vec2(53.0, -21.0)
);
float journeyNaturalDrainageLine = 1.0 - smoothstep(
  0.03,
  0.115,
  abs(journeyNaturalDrainageField - 0.47)
);
float journeyNaturalDrainage = journeyNaturalDrainageLine * journeySteepness *
  (1.0 - smoothstep(0.82, 1.0, journeyNaturalAltitude)) *
  smoothstep(0.32, 0.72, journeyNaturalSecondary);
float journeyNaturalRockMask = smoothstep(
  0.30,
  0.61,
  journeySteepness * 0.82 + journeyNaturalAltitude * 0.52 +
    (journeyNaturalSecondary - 0.5) * 0.42 - journeyNaturalMacro * 0.05
);
float journeyNaturalScree = smoothstep(
  0.48,
  0.76,
  journeyNaturalAltitude * 0.52 + journeySteepness * 0.50 +
    (1.0 - abs(journeyNaturalSecondary * 2.0 - 1.0)) * 0.24
) * journeyNaturalRockMask;
float journeyNaturalForestMask = (1.0 - smoothstep(0.58, 0.84, journeyNaturalAltitude)) *
  (1.0 - journeyNaturalRockMask) * smoothstep(0.34, 0.68, journeyNaturalMacro);
vec3 journeyNaturalGrass = mix(
  vec3(0.21, 0.28, 0.14),
  vec3(0.36, 0.39, 0.20),
  journeyNaturalSecondary
);
vec3 journeyNaturalForest = mix(
  vec3(0.055, 0.11, 0.07),
  vec3(0.16, 0.235, 0.115),
  journeyNaturalSecondary * 0.72 + journeySurfaceFacing * 0.28
);
vec3 journeyNaturalRock = mix(
  vec3(0.22, 0.225, 0.215),
  vec3(0.39, 0.365, 0.315),
  journeyNaturalSecondary * 0.48 + journeySurfaceFacing * 0.52
);
vec3 journeyNaturalScreeColor = mix(
  vec3(0.30, 0.295, 0.27),
  vec3(0.47, 0.44, 0.37),
  journeyNaturalMacro
);
vec3 journeyNaturalSurface = mix(journeyNaturalGrass, journeyNaturalForest, journeyNaturalForestMask);
journeyNaturalSurface = mix(journeyNaturalSurface, journeyNaturalRock, journeyNaturalRockMask);
journeyNaturalSurface = mix(journeyNaturalSurface, journeyNaturalScreeColor, journeyNaturalScree * 0.76);
journeyNaturalSurface = mix(
  journeyNaturalSurface,
  vec3(0.075, 0.125, 0.112),
  journeyNaturalDrainage * ${isFarRidge ? '0.018' : '0.08'}
);
${hasAlpineMap ? `float journeyNaturalTextureLuma = dot(journeyTriplanar, vec3(0.24, 0.58, 0.18));
vec3 journeyNaturalTextureHue = clamp(
  journeyTriplanar / max(journeyNaturalTextureLuma, 0.11),
  vec3(0.58),
  vec3(1.42)
);
journeyNaturalSurface *= mix(0.88, 1.10, journeyNaturalTextureLuma);
journeyNaturalSurface = mix(
  journeyNaturalSurface,
  journeyNaturalSurface * journeyNaturalTextureHue,
  0.20
);
vec3 journeyNaturalForestTexture = mix(
  journeyNaturalForest,
  journeyForestTexture * vec3(0.72, 0.82, 0.68),
  0.62
);
journeyNaturalSurface = mix(
  journeyNaturalSurface,
  journeyNaturalForestTexture,
  journeyNaturalForestMask * 0.72
);` : ''}
float journeyNaturalForestBelt =
  (1.0 - smoothstep(38.0, 82.0, vJourneyWorldPosition.y)) *
  (1.0 - journeyNaturalRockMask) *
  smoothstep(0.27, 0.58, journeyNaturalMacro * 0.68 + journeyNaturalSecondary * 0.32);
${hasAlpineMap ? `journeyNaturalSurface = mix(
  journeyNaturalSurface,
  journeyForestTexture * vec3(0.68, 0.82, 0.64),
  journeyNaturalForestBelt * 0.58
);` : ''}
// Preserve a soft daylight key after the procedural biome pass. This is broad
// enough to describe shoulders and saddles without re-etching the fine relief.
journeyNaturalSurface *= mix(
  ${isFarRidge ? '0.97' : '0.91'},
  ${isFarRidge ? '1.035' : '1.10'},
  smoothstep(0.14, 0.9, journeySurfaceFacing)
);
journeyNaturalSurface = mix(
  journeyNaturalSurface,
  journeyAtmosphere,
  journeyDistanceHaze * ${isFarRidge ? '0.48' : '0.12'}
);
float journeyBiomeTextureLuma = dot(journeyBiomeTexture, vec3(0.24, 0.58, 0.18));
vec3 journeyBiomeTextureBalanced = journeyBiomeTexture *
  mix(0.86, 1.08, smoothstep(0.16, 0.78, journeyBiomeTextureLuma));
journeyNaturalSurface = mix(
  journeyNaturalSurface,
  journeyBiomeTextureBalanced,
  ${isFarRidge ? '0.34' : '0.45'}
);
diffuseColor.rgb = mix(diffuseColor.rgb, journeyNaturalSurface, ${isFarRidge ? '0.82' : '0.68'});
float journeyMysticRidge = smoothstep(0.64, 0.97, journeyAltitude) * smoothstep(0.68, 0.96, journeyWash);
vec3 journeyMysticColor = mix(vec3(0.24, 0.58, 0.46), vec3(0.96, 0.54, 0.28), uJourneySunset);
journeyMysticColor = mix(journeyMysticColor, vec3(0.26, 0.45, 0.78), uJourneyNight);
diffuseColor.rgb += journeyMysticColor * journeyMysticRidge * (0.028 + uJourneySunset * 0.095 + uJourneyNight * 0.04);`,
      )
    if (hasAlpineMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec3 journeyBlend = pow(abs(normalize(vJourneyWorldNormal)), vec3(5.0));
journeyBlend /= max(journeyBlend.x + journeyBlend.y + journeyBlend.z, 0.0001);
float journeyTextureScale = 0.041;
vec3 journeyTexX = texture2D(map, vJourneyWorldPosition.zy * journeyTextureScale).rgb;
vec3 journeyTexY = texture2D(map, vJourneyWorldPosition.xz * journeyTextureScale).rgb;
vec3 journeyTexZ = texture2D(map, vJourneyWorldPosition.xy * journeyTextureScale).rgb;
vec3 journeyTriplanar = journeyTexX * journeyBlend.x + journeyTexY * journeyBlend.y + journeyTexZ * journeyBlend.z;
journeyTriplanar = pow(max(journeyTriplanar, vec3(0.04)), vec3(0.91));
vec3 journeyTextureValue = mix(vec3(1.0), journeyTriplanar * 1.06, 0.18);
diffuseColor.rgb *= journeyTextureValue;`,
      )
    }
    if (triplanarNormalMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec3 journeyNormalX = texture2D(uJourneyTriplanarNormal, vJourneyWorldPosition.zy * journeyTextureScale).xyz * 2.0 - 1.0;
vec3 journeyNormalY = texture2D(uJourneyTriplanarNormal, vJourneyWorldPosition.xz * journeyTextureScale).xyz * 2.0 - 1.0;
vec3 journeyNormalZ = texture2D(uJourneyTriplanarNormal, vJourneyWorldPosition.xy * journeyTextureScale).xyz * 2.0 - 1.0;
vec3 journeyWorldDetail =
  vec3(journeyNormalX.z, journeyNormalX.y, journeyNormalX.x) * journeyBlend.x +
  vec3(journeyNormalY.x, journeyNormalY.z, journeyNormalY.y) * journeyBlend.y +
  journeyNormalZ * journeyBlend.z;
float journeyForestNormalMask = journeySurfaceForestMask;
float journeyCanopyNormalX = journeyNoise(vJourneyWorldPosition.xz * vec2(0.62, 0.84) + 19.0) - 0.5;
float journeyCanopyNormalZ = journeyNoise(vJourneyWorldPosition.zx * vec2(0.73, 0.57) - 31.0) - 0.5;
vec3 journeyCanopyNormal = vec3(journeyCanopyNormalX, 0.0, journeyCanopyNormalZ);
vec3 journeyViewDetail = mat3(viewMatrix) * journeyWorldDetail;
vec3 journeyViewCanopy = mat3(viewMatrix) * journeyCanopyNormal;
normal = normalize(
  normal + journeyViewDetail * 0.036 + journeyViewCanopy * journeyForestNormalMask * 0.015
);
float journeyCanopyRelief = max(
  journeyCanopyCells(vec2(
    vJourneyWorldPosition.x + vJourneyWorldPosition.z * 0.21,
    vJourneyWorldPosition.y - vJourneyWorldPosition.z * 0.055
  ) * 0.34, 407.0),
  journeyCanopyCells(vec2(
    vJourneyWorldPosition.x - vJourneyWorldPosition.z * 0.13,
    vJourneyWorldPosition.y + vJourneyWorldPosition.z * 0.035
  ) * 0.66 + vec2(13.0, -9.0), 613.0) * 0.48
);
vec3 journeyReliefPosition = vJourneyWorldPosition +
  normalize(vJourneyWorldNormal) * (journeyCanopyRelief - 0.28) * 0.22;
vec3 journeyReliefNormal = normalize(mat3(viewMatrix) * cross(
  dFdx(journeyReliefPosition),
  dFdy(journeyReliefPosition)
));
journeyReliefNormal *= sign(dot(journeyReliefNormal, normal));
normal = normalize(mix(normal, journeyReliefNormal, journeyForestNormalMask * 0.02));
vec3 journeySurfaceResponsePosition = vJourneyWorldPosition +
  normalize(vJourneyWorldNormal) *
  (journeySurfaceMedium * 0.32 + journeySurfaceFine * 0.1 - 0.2) * journeyForestNormalMask;
vec3 journeySurfaceResponseNormal = normalize(mat3(viewMatrix) * cross(
  dFdx(journeySurfaceResponsePosition),
  dFdy(journeySurfaceResponsePosition)
));
journeySurfaceResponseNormal *= sign(dot(journeySurfaceResponseNormal, normal));
normal = normalize(mix(normal, journeySurfaceResponseNormal, journeyForestNormalMask * 0.018));`,
      )
    }
    if (!triplanarNormalMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec3 journeySurfaceResponsePosition = vJourneyWorldPosition +
  normalize(vJourneyWorldNormal) *
  (journeySurfaceMedium * 0.72 + journeySurfaceFine * 0.2 - 0.46) * journeySurfaceForestMask;
vec3 journeySurfaceResponseNormal = normalize(mat3(viewMatrix) * cross(
  dFdx(journeySurfaceResponsePosition),
  dFdy(journeySurfaceResponsePosition)
));
journeySurfaceResponseNormal *= sign(dot(journeySurfaceResponseNormal, normal));
normal = normalize(mix(normal, journeySurfaceResponseNormal, journeySurfaceForestMask * 0.028));`,
      )
    }
    if (triplanarRoughnessMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float journeyRoughX = texture2D(uJourneyTriplanarRoughness, vJourneyWorldPosition.zy * journeyTextureScale).g;
float journeyRoughY = texture2D(uJourneyTriplanarRoughness, vJourneyWorldPosition.xz * journeyTextureScale).g;
float journeyRoughZ = texture2D(uJourneyTriplanarRoughness, vJourneyWorldPosition.xy * journeyTextureScale).g;
float journeyProjectedRoughness = dot(vec3(journeyRoughX, journeyRoughY, journeyRoughZ), journeyBlend);
float journeyForestRoughnessMask = journeySurfaceForestMask;
float journeyCanopyRoughness = journeyNoise(vJourneyWorldPosition.xz * vec2(0.19, 0.31) + 41.0);
roughnessFactor = mix(roughnessFactor, max(0.52, journeyProjectedRoughness), 0.62);
roughnessFactor = clamp(
  roughnessFactor + (journeyCanopyRoughness - 0.5) * journeyForestRoughnessMask * 0.12,
  0.52,
  0.94
);
roughnessFactor = mix(
  roughnessFactor,
  mix(0.58, 0.72, journeyNaturalSecondary),
  journeyNaturalRockMask * 0.64
);`,
      )
    }
    if (!triplanarRoughnessMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(
  mix(roughnessFactor, 0.88, journeySurfaceForestMask * 0.72) +
    (journeySurfaceFine - 0.5) * journeySurfaceForestMask * 0.18 -
    journeyBrokenRock * 0.16,
  0.52,
  0.94
);
roughnessFactor = mix(
  roughnessFactor,
  mix(0.58, 0.72, journeyNaturalSecondary),
  journeyNaturalRockMask * 0.64
);`,
      )
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance += journeyPaint * uJourneyNight * 0.034;
totalEmissiveRadiance += vec3(0.01, 0.024, 0.055) * uJourneyNight;`,
    )
  }
  material.customProgramCacheKey = () => `journey-alpine-${isFarRidge ? 'far' : 'near'}-v31-macro-biome-texture`
}

function applyAlpineProduction(material, isFarRidge, biomeMacroTexture) {
  if (
    !material.isMeshLambertMaterial &&
    !material.isMeshStandardMaterial &&
    !material.isMeshPhysicalMaterial
  ) return
  const hasAlpineMap = Boolean(material.map)
  material.normalMap = null
  material.roughnessMap = null
  material.metalnessMap = null
  const uniforms = {
    uJourneySunset: { value: 0 },
    uJourneyNight: { value: 0 },
    uJourneyRiverLight: { value: 0 },
    uJourneyDiscovery: { value: 0 },
    uJourneyTime: { value: 0 },
    uJourneyEntranceReveal: { value: 1 },
    uJourneyBiomeMacro: { value: biomeMacroTexture },
  }
  material.userData.journeyAlpineUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyWorldPosition;
varying vec3 vJourneyWorldNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vJourneyWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vJourneyWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyWorldPosition;
varying vec3 vJourneyWorldNormal;
uniform float uJourneySunset;
uniform float uJourneyNight;
uniform float uJourneyRiverLight;
uniform float uJourneyDiscovery;
uniform float uJourneyEntranceReveal;
uniform sampler2D uJourneyBiomeMacro;

float journeyProductionHash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}
float journeyProductionNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = journeyProductionHash(cell);
  float b = journeyProductionHash(cell + vec2(1.0, 0.0));
  float c = journeyProductionHash(cell + vec2(0.0, 1.0));
  float d = journeyProductionHash(cell + vec2(1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}`,
      )
    if (hasAlpineMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec3 journeyProductionAxisWeight = abs(vJourneyWorldNormal);
float journeyProductionTextureScale = 0.041;
vec2 journeyProductionSourceDomain = vJourneyWorldPosition.xy;
float journeyProductionDominantAxis = 2.0;
if (
  journeyProductionAxisWeight.x > journeyProductionAxisWeight.y &&
  journeyProductionAxisWeight.x > journeyProductionAxisWeight.z
) {
  journeyProductionSourceDomain = vJourneyWorldPosition.zy;
  journeyProductionDominantAxis = 0.0;
} else if (journeyProductionAxisWeight.y > journeyProductionAxisWeight.z) {
  journeyProductionSourceDomain = vJourneyWorldPosition.xz;
  journeyProductionDominantAxis = 1.0;
}
vec3 journeyProductionSource = texture2D(
  map,
  journeyProductionSourceDomain * journeyProductionTextureScale
).rgb;
diffuseColor.rgb *= mix(vec3(0.86), journeyProductionSource * 1.08, 0.34);`,
      )
    } else {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `vec3 journeyProductionAxisWeight = abs(vJourneyWorldNormal);
vec2 journeyProductionSourceDomain = vJourneyWorldPosition.xy;
float journeyProductionDominantAxis = 2.0;
if (
  journeyProductionAxisWeight.x > journeyProductionAxisWeight.y &&
  journeyProductionAxisWeight.x > journeyProductionAxisWeight.z
) {
  journeyProductionSourceDomain = vJourneyWorldPosition.zy;
  journeyProductionDominantAxis = 0.0;
} else if (journeyProductionAxisWeight.y > journeyProductionAxisWeight.z) {
  journeyProductionSourceDomain = vJourneyWorldPosition.xz;
  journeyProductionDominantAxis = 1.0;
}
vec3 journeyProductionSource = diffuseColor.rgb;`,
      )
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
vec3 journeyProductionNormal = normalize(vJourneyWorldNormal);
float journeyProductionSteepness = smoothstep(0.2, 0.88, 1.0 - abs(journeyProductionNormal.y));
float journeyProductionAltitude = smoothstep(24.0, 132.0, vJourneyWorldPosition.y);
float journeyProductionMacro = journeyProductionNoise(vec2(
  vJourneyWorldPosition.x * 0.008 + vJourneyWorldPosition.z * 0.002,
  vJourneyWorldPosition.z * 0.006 - vJourneyWorldPosition.y * 0.004
) + vec2(12.7, -31.4));
float journeyProductionMeso = journeyProductionNoise(vec2(
  vJourneyWorldPosition.x * 0.024 - vJourneyWorldPosition.z * 0.008,
  vJourneyWorldPosition.y * 0.018 + vJourneyWorldPosition.z * 0.016
) + vec2(-44.0, 18.0));
vec2 journeyProductionWarp = vec2(
  (journeyProductionMacro - 0.5) * 0.1,
  (journeyProductionMeso - 0.5) * 0.085
);
float journeyProductionBiomeScale = 0.0068;
vec2 journeyProductionBiomeWarp = -journeyProductionWarp;
if (journeyProductionDominantAxis < 0.5) {
  journeyProductionBiomeWarp = journeyProductionWarp;
} else if (journeyProductionDominantAxis < 1.5) {
  journeyProductionBiomeWarp = journeyProductionWarp.yx;
}
vec3 journeyProductionBiome = texture2D(
  uJourneyBiomeMacro,
  journeyProductionSourceDomain * journeyProductionBiomeScale + journeyProductionBiomeWarp
).rgb;
float journeyProductionRock = smoothstep(
  0.32,
  0.7,
  journeyProductionSteepness * 0.78 + journeyProductionAltitude * 0.48 +
    (journeyProductionBiome.r - 0.5) * 0.32
);
float journeyProductionScree = smoothstep(
  0.56,
  0.82,
  journeyProductionRock * 0.62 + journeyProductionAltitude * 0.34 +
    (1.0 - abs(journeyProductionMeso * 2.0 - 1.0)) * 0.2
);
float journeyProductionForest =
  (1.0 - smoothstep(0.56, 0.84, journeyProductionAltitude)) *
  (1.0 - journeyProductionRock) *
  smoothstep(0.31, 0.67, journeyProductionMacro * 0.68 + journeyProductionBiome.g * 0.32);
float journeyProductionDrainageField = journeyProductionNoise(vec2(
  vJourneyWorldPosition.x * 0.032 + vJourneyWorldPosition.z * 0.022,
  vJourneyWorldPosition.y * 0.025 - vJourneyWorldPosition.z * 0.038
) + vec2(53.0, -21.0));
float journeyProductionDrainage =
  (1.0 - smoothstep(0.035, 0.12, abs(journeyProductionDrainageField - 0.47))) *
  journeyProductionSteepness * (1.0 - smoothstep(0.78, 1.0, journeyProductionAltitude));
vec3 journeyProductionGrassColor = mix(
  vec3(0.19, 0.29, 0.135),
  vec3(0.36, 0.42, 0.205),
  journeyProductionMeso
);
float journeyProductionForestVariation = clamp(
  journeyProductionBiome.g * 0.48 + journeyProductionMeso * 0.34 + journeyProductionMacro * 0.18,
  0.0,
  1.0
);
vec3 journeyProductionForestColor = mix(
  vec3(0.046, 0.105, 0.061),
  vec3(0.135, 0.205, 0.105),
  journeyProductionForestVariation * 0.72
);
vec3 journeyProductionRockColor = mix(
  vec3(0.205, 0.225, 0.215),
  vec3(0.45, 0.42, 0.355),
  journeyProductionMeso
);
vec3 journeyProductionSurface = mix(
  journeyProductionGrassColor,
  journeyProductionForestColor,
  journeyProductionForest
);
journeyProductionSurface = mix(
  journeyProductionSurface,
  journeyProductionRockColor,
  journeyProductionRock
);
journeyProductionSurface = mix(
  journeyProductionSurface,
  vec3(0.47, 0.445, 0.39),
  journeyProductionScree * 0.46
);
journeyProductionSurface = mix(
  journeyProductionSurface,
  vec3(0.075, 0.13, 0.112),
  journeyProductionDrainage * ${isFarRidge ? '0.025' : '0.105'}
);
vec3 journeyProductionLightDirection = normalize(vec3(-0.55, 0.80, -0.24));
float journeyProductionFacing = dot(journeyProductionNormal, journeyProductionLightDirection) * 0.5 + 0.5;
journeyProductionSurface *= mix(
  ${isFarRidge ? '0.98' : '0.91'},
  ${isFarRidge ? '1.03' : '1.09'},
  smoothstep(0.12, 0.9, journeyProductionFacing)
);
journeyProductionSurface = mix(
  journeyProductionSurface,
  journeyProductionBiome * vec3(0.82, 0.91, 0.8),
  ${isFarRidge ? '0.28' : '0.32'}
);
${hasAlpineMap ? `journeyProductionSurface = mix(
  journeyProductionSurface,
  journeyProductionSurface * journeyProductionSource * 1.38,
  mix(0.18, 0.42, journeyProductionRock)
);` : ''}
vec3 journeyProductionDayHaze = vec3(0.48, 0.65, 0.66);
vec3 journeyProductionSunsetHaze = vec3(0.72, 0.50, 0.43);
vec3 journeyProductionNightHaze = vec3(0.105, 0.17, 0.31);
vec3 journeyProductionAtmosphere = mix(
  journeyProductionDayHaze,
  journeyProductionSunsetHaze,
  uJourneySunset * 0.72
);
journeyProductionAtmosphere = mix(journeyProductionAtmosphere, journeyProductionNightHaze, uJourneyNight);
float journeyProductionDistance = length(vViewPosition);
float journeyProductionHaze = smoothstep(70.0, 350.0, journeyProductionDistance);
journeyProductionSurface = mix(
  journeyProductionSurface,
  journeyProductionAtmosphere,
  journeyProductionHaze * ${isFarRidge ? '0.56' : '0.14'}
);
float journeyProductionSummit =
  exp(-pow((vJourneyWorldPosition.x - 54.0) / 46.0, 2.0)) *
  smoothstep(42.0, 72.0, vJourneyWorldPosition.y) *
  smoothstep(0.28, 0.82, journeyProductionFacing);
journeyProductionSurface += mix(
  vec3(0.38, 0.48, 0.22),
  vec3(0.72, 0.32, 0.16),
  uJourneySunset
) * journeyProductionSummit * uJourneyDiscovery * 0.1;
journeyProductionSurface += vec3(0.055, 0.16, 0.22) * uJourneyRiverLight *
  (1.0 - smoothstep(20.0, 68.0, vJourneyWorldPosition.y));
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  journeyProductionSurface,
  ${isFarRidge ? '0.84' : '0.72'}
);`,
    )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(0.9, 0.64, journeyProductionRock);
roughnessFactor = mix(roughnessFactor, 0.76, journeyProductionScree * 0.54);
roughnessFactor = mix(roughnessFactor, 0.94, journeyProductionForest * 0.5);
roughnessFactor = clamp(roughnessFactor, 0.58, 0.94);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * uJourneyNight * 0.025;
totalEmissiveRadiance += vec3(0.01, 0.024, 0.055) * uJourneyNight;`,
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
#ifdef USE_FOG
  // Reveal opaque terrain by increasing its contrast out of the exact scene
  // fog colour. This preserves stable depth while avoiding a hard visibility
  // switch or transparent mountain intersections at the cave mouth.
  gl_FragColor.rgb = mix(fogColor, gl_FragColor.rgb, uJourneyEntranceReveal);
#endif`,
      )
  }
  material.customProgramCacheKey = () =>
    `journey-alpine-production-${material.type}-${isFarRidge ? 'far' : 'near'}-v5-entrance-depth-reveal`
  material.needsUpdate = true
}

function applyWetGravelDetail(material, variant = 'bed') {
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return
  const isSubmergedBed = variant === 'submerged-bed'
  const isRiverBar = variant === 'bar-pale' || variant === 'bar-granite'
  const isWetMargin = variant.includes('wet')
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyGravelPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vJourneyGravelPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyGravelPosition;

float journeyGravelHash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float journeyGravelNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(journeyGravelHash(cell), journeyGravelHash(cell + vec2(1.0, 0.0)), local.x),
    mix(journeyGravelHash(cell + vec2(0.0, 1.0)), journeyGravelHash(cell + vec2(1.0)), local.x),
    local.y
  );
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 journeyGravelUv = vJourneyGravelPosition.xz * ${variant === 'bed' ? '0.72' : '0.58'};
vec2 journeyGravelCell = floor(journeyGravelUv);
vec2 journeyGravelLocal = fract(journeyGravelUv) - 0.5;
float journeyGravelSeed = journeyGravelHash(journeyGravelCell);
vec2 journeyGravelOffset = vec2(
  journeyGravelHash(journeyGravelCell + 17.3),
  journeyGravelHash(journeyGravelCell + 41.9)
) - 0.5;
float journeyGravelRadius = mix(0.18, 0.39, journeyGravelSeed);
float journeyGravelStone = 1.0 - smoothstep(
  journeyGravelRadius - 0.055,
  journeyGravelRadius + 0.045,
  length(journeyGravelLocal - journeyGravelOffset * 0.24)
);
float journeyGravelFine = journeyGravelHash(floor(vJourneyGravelPosition.xz * 2.35) + 73.0);
float journeyGravelMacro = journeyGravelNoise(vJourneyGravelPosition.xz * 0.11 + 9.0);
float journeyGravelMeso = journeyGravelNoise(vJourneyGravelPosition.xz * 0.54 - 17.0);
vec3 journeyGravelDark = ${isSubmergedBed ? 'vec3(0.055, 0.18, 0.15)' : isRiverBar ? 'vec3(0.12, 0.145, 0.14)' : isWetMargin ? 'vec3(0.075, 0.105, 0.10)' : 'vec3(0.18, 0.21, 0.20)'};
vec3 journeyGravelLight = ${isSubmergedBed ? 'vec3(0.20, 0.38, 0.31)' : isRiverBar ? 'vec3(0.29, 0.31, 0.29)' : isWetMargin ? 'vec3(0.19, 0.225, 0.205)' : 'vec3(0.36, 0.37, 0.34)'};
vec3 journeyGravelColor = mix(
  journeyGravelDark,
  journeyGravelLight,
  journeyGravelMacro * 0.48 + journeyGravelMeso * 0.34 + journeyGravelFine * 0.18
);
journeyGravelColor *= mix(0.72, ${isRiverBar ? '0.98' : '1.12'}, journeyGravelStone);
float journeyBankGrass = smoothstep(
  0.68,
  0.9,
  journeyGravelNoise(vJourneyGravelPosition.xz * 0.075 + 113.0) + journeyGravelMeso * 0.22
) * ${isRiverBar ? '1.0' : '0.28'};
float journeyWetEdge = smoothstep(0.38, 0.82, journeyGravelNoise(vJourneyGravelPosition.xz * 0.16 - 33.0));
journeyGravelColor = mix(journeyGravelColor, vec3(0.075, 0.19, 0.12), journeyBankGrass * 0.42);
journeyGravelColor = mix(journeyGravelColor, journeyGravelColor * vec3(0.62, 0.72, 0.72), journeyWetEdge * ${isRiverBar ? '0.2' : '0.08'});
diffuseColor.rgb = mix(diffuseColor.rgb, journeyGravelColor, ${isSubmergedBed ? '0.54' : variant === 'bed' ? '0.78' : isRiverBar ? '0.86' : '0.92'});`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = ${isSubmergedBed ? 'mix(0.66, 0.88, journeyGravelStone)' : 'mix(0.78, 0.97, journeyGravelStone)'};`,
      )
  }
  material.customProgramCacheKey = () => `journey-wet-gravel-v5-organic-${variant}`
  material.needsUpdate = true
}

function applyWaterReflection(material) {
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return
  const journeyUniforms = {
    uJourneySunset: { value: 0 },
    uJourneyNight: { value: 0 },
    uJourneyRiverGlow: { value: 0 },
    uJourneySkyConnect: { value: 0 },
    uJourneyTime: { value: 0 },
    uJourneyTravelWind: { value: 0 },
  }
  material.userData.journeyWaterUniforms = journeyUniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, journeyUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aJourneyAcross;
attribute float aJourneyAlong;
varying vec3 vJourneyWaterPosition;
varying vec3 vJourneyWaterNormal;
varying float vJourneyWaterAcross;
varying float vJourneyWaterAlong;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vJourneyWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vJourneyWaterNormal = normalize(mat3(modelMatrix) * objectNormal);
vJourneyWaterAcross = aJourneyAcross;
vJourneyWaterAlong = aJourneyAlong;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyWaterPosition;
varying vec3 vJourneyWaterNormal;
varying float vJourneyWaterAcross;
varying float vJourneyWaterAlong;
uniform float uJourneyNight;
uniform float uJourneySunset;
uniform float uJourneyRiverGlow;
uniform float uJourneySkyConnect;
uniform float uJourneyTime;
uniform float uJourneyTravelWind;

float journeyWaterHash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
}

float journeyWaterNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  return mix(
    mix(journeyWaterHash(cell), journeyWaterHash(cell + vec2(1.0, 0.0)), local.x),
    mix(journeyWaterHash(cell + vec2(0.0, 1.0)), journeyWaterHash(cell + vec2(1.0)), local.x),
    local.y
  );
}

float journeyWaterFlow(vec2 point, float time) {
  vec2 primary = point * vec2(0.09, 0.34) + vec2(time * 0.018, -time * 0.13);
  vec2 crossing = point * vec2(0.24, 0.12) + vec2(-time * 0.045, time * 0.025);
  float broad = journeyWaterNoise(primary) * 0.56;
  float medium = journeyWaterNoise(primary * 2.6 + 13.7) * 0.3;
  float detail = journeyWaterNoise(crossing * 5.8 - 8.4) * 0.14;
  return broad + medium + detail;
}

float journeyRiverCenter(float z) {
  if (z >= 8.0) return 8.3;
  if (z <= -210.0) return -8.3;
  if (z >= -12.0) return mix(8.3, 6.4, (8.0 - z) / 20.0);
  if (z >= -28.0) return mix(6.4, -1.9, (-12.0 - z) / 16.0);
  if (z >= -45.0) return mix(-1.9, -13.7, (-28.0 - z) / 17.0);
  if (z >= -64.0) return mix(-13.7, -4.5, (-45.0 - z) / 19.0);
  if (z >= -80.0) return mix(-4.5, 13.3, (-64.0 - z) / 16.0);
  if (z >= -94.0) return mix(13.3, 18.6, (-80.0 - z) / 14.0);
  if (z >= -110.0) return mix(18.6, 7.0, (-94.0 - z) / 16.0);
  if (z >= -124.0) return mix(7.0, -3.2, (-110.0 - z) / 14.0);
  if (z >= -140.0) return mix(-3.2, -5.1, (-124.0 - z) / 16.0);
  if (z >= -150.0) return mix(-5.1, -3.5, (-140.0 - z) / 10.0);
  if (z >= -166.0) return mix(-3.5, -1.0, (-150.0 - z) / 16.0);
  if (z >= -190.0) return mix(-1.0, -5.0, (-166.0 - z) / 24.0);
  return mix(-5.0, -8.3, (-190.0 - z) / 20.0);
}

float journeyRiverHalfWidth(float z) {
  if (z >= 8.0) return 22.8;
  if (z <= -210.0) return 4.3;
  if (z >= -12.0) return mix(22.8, 20.2, (8.0 - z) / 20.0);
  if (z >= -28.0) return mix(20.2, 17.3, (-12.0 - z) / 16.0);
  if (z >= -45.0) return mix(17.3, 14.8, (-28.0 - z) / 17.0);
  if (z >= -64.0) return mix(14.8, 12.8, (-45.0 - z) / 19.0);
  if (z >= -80.0) return mix(12.8, 11.1, (-64.0 - z) / 16.0);
  if (z >= -94.0) return mix(11.1, 9.6, (-80.0 - z) / 14.0);
  if (z >= -110.0) return mix(9.6, 8.6, (-94.0 - z) / 16.0);
  if (z >= -124.0) return mix(8.6, 7.6, (-110.0 - z) / 14.0);
  if (z >= -140.0) return mix(7.6, 6.7, (-124.0 - z) / 16.0);
  if (z >= -150.0) return mix(6.7, 6.1, (-140.0 - z) / 10.0);
  if (z >= -166.0) return mix(6.1, 5.5, (-150.0 - z) / 16.0);
  if (z >= -190.0) return mix(5.5, 4.9, (-166.0 - z) / 24.0);
  return mix(4.9, 4.3, (-190.0 - z) / 20.0);
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
float journeyWaterTime = uJourneyTime * (0.72 + uJourneyTravelWind * 0.9);
vec2 journeyWaterPlane = vJourneyWaterPosition.xz;
float journeyWaterHeight = journeyWaterFlow(journeyWaterPlane, journeyWaterTime);
float journeyWaterHeightX = journeyWaterFlow(journeyWaterPlane + vec2(0.22, 0.0), journeyWaterTime);
float journeyWaterHeightZ = journeyWaterFlow(journeyWaterPlane + vec2(0.0, 0.22), journeyWaterTime);
float journeyWaterMicro = journeyWaterNoise(journeyWaterPlane * vec2(0.72, 1.36) + vec2(journeyWaterTime * 0.09, -journeyWaterTime * 0.34));
float journeyWaterMicroX = journeyWaterNoise((journeyWaterPlane + vec2(0.055, 0.0)) * vec2(0.72, 1.36) + vec2(journeyWaterTime * 0.09, -journeyWaterTime * 0.34));
float journeyWaterMicroZ = journeyWaterNoise((journeyWaterPlane + vec2(0.0, 0.055)) * vec2(0.72, 1.36) + vec2(journeyWaterTime * 0.09, -journeyWaterTime * 0.34));
vec3 journeyWaterPerturbation = vec3(
  journeyWaterHeight - journeyWaterHeightX + (journeyWaterMicro - journeyWaterMicroX) * 0.32,
  0.0,
  journeyWaterHeight - journeyWaterHeightZ + (journeyWaterMicro - journeyWaterMicroZ) * 0.32
);
normal = normalize(normal + journeyWaterPerturbation * (0.3 + uJourneyTravelWind * 0.24));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float journeyWaterSurface = journeyWaterFlow(vJourneyWaterPosition.xz, uJourneyTime * 0.72);
float journeyDayRoughness = mix(0.085, 0.18, journeyWaterSurface);
float journeyNightRoughness = mix(0.035, 0.095, journeyWaterSurface);
roughnessFactor = mix(journeyDayRoughness, journeyNightRoughness, uJourneyNight);
roughnessFactor += uJourneyTravelWind * 0.035;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float journeyWaterRipple = journeyWaterFlow(vJourneyWaterPosition.xz, uJourneyTime * 0.72);
float journeyWaterCrossRipple = journeyWaterFlow(vJourneyWaterPosition.zx * 1.37 + 27.0, -uJourneyTime * 0.41);
vec3 journeyWaterView = normalize(cameraPosition - vJourneyWaterPosition);
vec3 journeyWaterNormal = normalize(cross(dFdx(vJourneyWaterPosition), dFdy(vJourneyWaterPosition)));
float journeyWaterFresnel = pow(1.0 - clamp(abs(dot(journeyWaterNormal, journeyWaterView)), 0.0, 1.0), 4.8);
float journeyDepthVariation = journeyWaterNoise(vJourneyWaterPosition.xz * vec2(0.025, 0.075) + 4.7);
float journeyChannelDistance = abs(vJourneyWaterAcross);
float journeyBankShallow = smoothstep(0.5, 0.97, journeyChannelDistance);
float journeyCenterDepth = 1.0 - smoothstep(0.06, 0.78, journeyChannelDistance);
float journeyShoalNoise = journeyWaterNoise(
  vJourneyWaterPosition.xz * vec2(0.11, 0.045) + vec2(17.0, -5.0)
);
float journeyShoal = smoothstep(0.67, 0.91, journeyShoalNoise) *
  smoothstep(0.2, 0.92, journeyChannelDistance);
float journeyMidChannelShoal = smoothstep(
  0.74,
  0.92,
  journeyWaterNoise(vJourneyWaterPosition.xz * vec2(0.055, 0.12) + vec2(-31.0, 14.0))
) * (1.0 - smoothstep(0.62, 0.9, journeyChannelDistance));
float journeyOpticalDepth = clamp(
  0.18 + journeyCenterDepth * 0.66 + journeyDepthVariation * 0.18 -
    journeyShoal * 0.32 - journeyMidChannelShoal * 0.27,
  0.0,
  1.0
);
float journeyFineCurrent = 0.5 + 0.5 * sin(
  vJourneyWaterPosition.z * 0.72 - uJourneyTime * 0.92 +
  sin(vJourneyWaterPosition.x * 0.19 + uJourneyTime * 0.08) * 1.7
);
journeyFineCurrent = smoothstep(0.76, 0.96, journeyFineCurrent) *
  smoothstep(0.32, 0.88, journeyWaterRipple);
float journeyWaterSparkSeed = fract(sin(dot(floor(vJourneyWaterPosition.xz * 1.45), vec2(12.9898, 78.233))) * 43758.5453);
float journeyWaterSparkle = pow(journeyWaterSparkSeed, 18.0) * smoothstep(0.66, 0.94, journeyWaterRipple * journeyWaterCrossRipple);
vec2 journeyBedUv = vJourneyWaterPosition.xz * vec2(0.62, 0.82);
vec2 journeyBedCellId = floor(journeyBedUv);
vec2 journeyBedLocal = fract(journeyBedUv) - 0.5;
vec2 journeyBedOffset = vec2(
  journeyWaterHash(journeyBedCellId + 7.3),
  journeyWaterHash(journeyBedCellId + 29.1)
) - 0.5;
float journeyBedRadius = mix(0.17, 0.39, journeyWaterHash(journeyBedCellId + 51.0));
float journeyBedPebble = 1.0 - smoothstep(
  journeyBedRadius - 0.045,
  journeyBedRadius + 0.055,
  length((journeyBedLocal - journeyBedOffset * 0.3) * vec2(0.88, 1.12))
);
float journeyRiverbedCell = journeyWaterHash(journeyBedCellId);
float journeyRiverbedFine = journeyWaterHash(floor(vJourneyWaterPosition.xz * vec2(1.58, 1.92)) + 19.0);
float journeyRiverbedVariation = clamp(journeyRiverbedCell * 0.68 + journeyRiverbedFine * 0.32, 0.0, 1.0);
float journeyRiverPath = clamp(vJourneyWaterAlong, 0.0, 1.0);
float journeyRiverHead = 1.0 - smoothstep(uJourneyRiverGlow - 0.045, uJourneyRiverGlow + 0.035, journeyRiverPath);
float journeyGroundRiver = 1.0 - smoothstep(16.0, 32.0, vJourneyWaterPosition.y);
float journeyRiverMask = journeyRiverHead * smoothstep(0.01, 0.075, uJourneyRiverGlow) * journeyGroundRiver;
float journeyRiverCurrent = 0.58 + journeyWaterRipple * 0.24 + journeyWaterCrossRipple * 0.18;
vec3 journeyDayShallowWater = mix(
  vec3(0.016, 0.34, 0.31),
  vec3(0.10, 0.235, 0.21),
  uJourneySunset * 0.62
);
vec3 journeyDayDeepWater = mix(
  vec3(0.004, 0.095, 0.17),
  vec3(0.04, 0.085, 0.13),
  uJourneySunset * 0.58
);
vec3 journeyNightShallowWater = vec3(0.018, 0.22, 0.34);
vec3 journeyNightDeepWater = vec3(0.004, 0.035, 0.11);
vec3 journeyShallowWater = mix(journeyDayShallowWater, journeyNightShallowWater, uJourneyNight);
vec3 journeyDeepWater = mix(journeyDayDeepWater, journeyNightDeepWater, uJourneyNight);
vec3 journeyClearBody = mix(journeyShallowWater, journeyDeepWater, journeyOpticalDepth);
vec3 journeyWetRiverbed = mix(
  vec3(0.065, 0.14, 0.125),
  vec3(0.48, 0.46, 0.37),
  clamp(journeyRiverbedVariation * 0.58 + journeyBedPebble * 0.56, 0.0, 1.0)
);
float journeyBedVisibility = (1.0 - journeyOpticalDepth) *
  (0.66 + journeyWaterRipple * 0.1) * (0.74 + journeyBankShallow * 0.26);
float journeyShoreBedReveal = journeyBedVisibility * (0.52 + journeyBankShallow * 0.48);
journeyClearBody = mix(journeyClearBody, journeyWetRiverbed, journeyShoreBedReveal * mix(0.48, 0.2, uJourneyNight));
journeyClearBody *= 0.96 + journeyWaterRipple * 0.16;
vec3 journeyDaySkyReflection = mix(
  vec3(0.12, 0.35, 0.48),
  vec3(0.44, 0.27, 0.27),
  uJourneySunset * 0.52
);
vec3 journeySkyReflection = mix(journeyDaySkyReflection, vec3(0.015, 0.055, 0.16), uJourneyNight);
vec3 journeyMountainReflection = mix(vec3(0.055, 0.20, 0.13), vec3(0.022, 0.07, 0.12), uJourneyNight);
float journeyReflectionBand = smoothstep(0.58, 0.92, journeyWaterCrossRipple) *
  smoothstep(0.18, 0.82, journeyWaterFresnel);
float journeyReflectionBreakup = smoothstep(
  0.34,
  0.78,
  journeyWaterNoise(vJourneyWaterPosition.xz * vec2(0.075, 0.19) + vec2(-13.0, 28.0))
);
vec3 journeyLandscapeReflection = mix(
  journeySkyReflection,
  journeyMountainReflection,
  journeyReflectionBreakup * (0.36 + journeyWaterFresnel * 0.42)
);
diffuseColor.rgb = mix(
  journeyClearBody,
  journeyLandscapeReflection,
  0.026 + journeyWaterFresnel * 0.13 + journeyReflectionBand * 0.038
);
float journeyBankContourNoise = journeyWaterNoise(
  vJourneyWaterPosition.xz * vec2(0.09, 0.055) + vec2(43.0, -21.0)
);
float journeyExposedBank = smoothstep(
  0.87 + (journeyBankContourNoise - 0.5) * 0.11,
  1.02 + (journeyBankContourNoise - 0.5) * 0.08,
  journeyChannelDistance
);
vec3 journeyBankGravel = mix(
  vec3(0.20, 0.235, 0.21),
  vec3(0.43, 0.42, 0.35),
  journeyWaterNoise(vJourneyWaterPosition.xz * 0.63 + 61.0)
);
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  journeyBankGravel,
  journeyExposedBank * mix(0.38, 0.4, uJourneyNight)
);
float journeyCausticThread = smoothstep(
  0.76,
  0.96,
  0.5 + 0.5 * sin(
    vJourneyWaterPosition.z * 0.38 - uJourneyTime * 0.58 +
    journeyWaterNoise(vJourneyWaterPosition.xz * 0.19) * 6.4
  )
) * journeyBedVisibility * (1.0 - journeyExposedBank);
diffuseColor.rgb += vec3(0.24, 0.62, 0.52) * journeyCausticThread * (1.0 - uJourneyNight) * 0.11;
float journeyCurrentVein = smoothstep(
  0.72,
  0.95,
  0.5 + 0.5 * sin(
    vJourneyWaterPosition.z * 0.51 - uJourneyTime * 0.86 +
    sin(vJourneyWaterPosition.x * 0.23) * 1.8
  )
) * (0.48 + journeyWaterRipple * 0.52) * (1.0 - journeyExposedBank);
diffuseColor.rgb += mix(vec3(0.13, 0.37, 0.31), vec3(0.18, 0.36, 0.54), uJourneyNight) *
  journeyCurrentVein * (0.035 + journeyWaterFresnel * 0.035);
diffuseColor.rgb += vec3(0.16, 0.4, 0.36) * journeyFineCurrent * (0.018 + journeyWaterFresnel * 0.035);
float journeyShallowThread = smoothstep(0.72, 0.94, journeyFineCurrent) *
  smoothstep(0.46, 0.94, journeyBankShallow + journeyShoal * 0.65);
diffuseColor.rgb += mix(vec3(0.34, 0.72, 0.58), vec3(0.34, 0.54, 0.68), uJourneyNight) *
  journeyShallowThread * (0.1 + journeyWaterFresnel * 0.08);
vec3 journeyNightWater = mix(vec3(0.008, 0.075, 0.16), vec3(0.025, 0.28, 0.38), journeyWaterRipple * 0.72);
diffuseColor.rgb = mix(diffuseColor.rgb, journeyNightWater, uJourneyNight * 0.42);
diffuseColor.rgb += vec3(0.62, 0.82, 0.94) * journeyWaterSparkle * (0.055 + uJourneyNight * 0.34) * (0.18 + journeyWaterFresnel);
float journeyConnectionHead = smoothstep(0.0, 1.0, uJourneySkyConnect);
float journeyConnectionPulse = exp(-pow((journeyRiverPath - journeyConnectionHead) * 7.2, 2.0));
float journeyConnectionWake = 1.0 - smoothstep(journeyConnectionHead - 0.17, journeyConnectionHead + 0.035, journeyRiverPath);
float journeyMysticCurrent = journeyRiverMask * (0.44 + journeyRiverCurrent * 0.34 + journeyFineCurrent * 0.42);
float journeyLuminousThread = journeyRiverMask *
  (0.26 + journeyFineCurrent * 0.74) *
  (0.48 + journeyWaterCrossRipple * 0.52);
vec3 journeyRiverLight = mix(vec3(0.08, 0.58, 0.62), vec3(0.22, 0.52, 1.0), uJourneyNight);
diffuseColor.rgb += journeyRiverLight * journeyMysticCurrent * (0.34 + uJourneyNight * 0.78);
diffuseColor.rgb += vec3(0.08, 0.76, 0.98) * journeyLuminousThread * (0.34 + uJourneyNight * 1.16);
diffuseColor.rgb += vec3(0.42, 0.94, 1.0) * journeyConnectionPulse * uJourneySkyConnect * journeyGroundRiver * 1.85;
diffuseColor.rgb += vec3(0.12, 0.46, 0.72) * journeyConnectionWake * uJourneySkyConnect * journeyGroundRiver * 0.58;
diffuseColor.rgb += vec3(0.08, 0.42, 0.62) * journeyConnectionWake * uJourneySkyConnect * journeyGroundRiver * 0.48;
// The source terrain contains a pale guide ribbon below the water. Keep the
// daytime surface optically deep enough to hide it, while preserving apparent
// clarity through the procedural riverbed detail above.
//
// The original river mesh is intentionally generous so it can carry the
// authored night sequence, but that must not turn the Day Clear view into a
// lake.  The same world-space S-curve that drives depth and gravel now trims
// the physical surface at an irregular, shallow bank.  This preserves the
// existing river/camera relationship while exposing the continuous meadow and
// bank geometry outside the actual channel.
float journeyChannelEdge = 1.0 - smoothstep(
  0.94 + (journeyBankContourNoise - 0.5) * 0.06,
  1.11 + (journeyBankContourNoise - 0.5) * 0.08,
  journeyChannelDistance
);
float journeyDayAlpha = mix(0.97, 1.0, journeyWaterFresnel);
float journeyNightAlpha = mix(0.43, 0.72, journeyWaterFresnel);
diffuseColor.a *= journeyChannelEdge * mix(journeyDayAlpha, journeyNightAlpha, uJourneyNight);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
vec3 journeyEmissiveFlow = mix(vec3(0.04, 0.45, 0.5), vec3(0.18, 0.48, 0.98), uJourneyNight);
totalEmissiveRadiance += journeyEmissiveFlow * journeyMysticCurrent * (0.62 + uJourneyNight * 1.72);
totalEmissiveRadiance += vec3(0.1, 0.72, 1.0) * journeyLuminousThread * (1.1 + uJourneyNight * 3.6);
totalEmissiveRadiance += vec3(0.08, 0.46, 0.72) * journeyConnectionWake * uJourneySkyConnect * journeyGroundRiver * 1.18;
totalEmissiveRadiance += vec3(0.32, 0.82, 1.0) * journeyConnectionPulse * uJourneySkyConnect * journeyGroundRiver * 3.15;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
// Keep the physical highlights, but prevent the low-angle daylight reflection
// from washing the emerald body into a flat white strip.
float journeyPigmentStrength = mix(0.68, 0.32, uJourneyNight);
gl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb, journeyPigmentStrength);
gl_FragColor.rgb += vec3(0.16, 0.72, 0.68) * journeyFineCurrent * (1.0 - uJourneyNight) * 0.045;`,
      )
  }
  material.customProgramCacheKey = () => 'journey-water-reflection-v30-natural-corridor'
}

function createClearRiverMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    name: 'MAT_JOURNEY_CLEAR_RIVER',
    color: '#5f998e',
    emissive: '#102e2d',
    emissiveIntensity: 0.012,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    roughness: 0.18,
    metalness: 0,
    ior: 1.333,
    // Keep the transmission shader/render path stable across the full story;
    // crossing exactly zero would otherwise compile and allocate it at night.
    transmission: 0.001,
    thickness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    attenuationColor: new THREE.Color('#6aa99c'),
    attenuationDistance: 12,
  })
  // The foreground water stays optically clear while distant terrain retains fog.
  // Its own depth tint and Fresnel fade keep it integrated with the valley.
  material.fog = true
  applyWaterReflection(material)
  return material
}

function createRiverGlowMaterial() {
  const uniforms = {
    uJourneyGlow: { value: 0 },
    uJourneySkyConnect: { value: 0 },
    uJourneyTime: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    name: 'MAT_JOURNEY_RIVER_AURORA',
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vJourneyWorldPosition;
      varying vec2 vJourneyUv;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vJourneyWorldPosition = worldPosition.xyz;
        vJourneyUv = uv;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform float uJourneyGlow;
      uniform float uJourneySkyConnect;
      uniform float uJourneyTime;
      varying vec3 vJourneyWorldPosition;
      varying vec2 vJourneyUv;

      float journeyGlowHash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
      }

      void main() {
        vec2 plane = vJourneyWorldPosition.xz;
        float path = clamp((8.0 - plane.y) / 227.0, 0.0, 1.0);
        float reveal = 1.0 - smoothstep(uJourneyGlow - 0.06, uJourneyGlow + 0.025, path);
        float activation = smoothstep(0.015, 0.12, uJourneyGlow);

        float current = 0.5 + 0.5 * sin(
          plane.y * 0.42 - uJourneyTime * 1.36 + sin(plane.x * 0.17) * 1.55
        );
        float fineCurrent = 0.5 + 0.5 * sin(
          plane.y * 0.88 - uJourneyTime * 2.12 + sin(plane.x * 0.26 + uJourneyTime * 0.12)
        );
        float lengthwise = 0.5 + 0.5 * sin(
          plane.x * 0.78 + sin(plane.y * 0.105 - uJourneyTime * 0.22) * 2.4
        );
        float strand = pow(lengthwise, 14.0) * 0.82;
        strand += pow(current, 11.0) * 0.18 + pow(fineCurrent, 16.0) * 0.11;

        float grain = journeyGlowHash(floor(plane * vec2(1.25, 1.7)));
        float sparkle = pow(grain, 22.0) * (0.38 + fineCurrent * 0.62);
        float connectionHead = smoothstep(0.0, 1.0, uJourneySkyConnect);
        float connectionPulse = exp(-pow((path - connectionHead) * 8.4, 2.0));
        float wake = 1.0 - smoothstep(connectionHead - 0.2, connectionHead + 0.03, path);

        float edgeFade = pow(max(0.0, sin(vJourneyUv.x * 3.14159265)), 0.82);
        float alpha = reveal * activation * edgeFade * (0.028 + strand * 0.56 + sparkle * 0.42);
        alpha += connectionPulse * uJourneySkyConnect * edgeFade * 0.78;
        alpha += wake * uJourneySkyConnect * edgeFade * (0.085 + strand * 0.38);
        vec3 cyan = vec3(0.07, 0.72, 0.92);
        vec3 celestial = vec3(0.34, 0.72, 1.0);
        vec3 color = mix(cyan, celestial, uJourneySkyConnect * 0.72 + path * 0.12);
        color *= 0.88 + strand * 2.15 + sparkle * 2.72;
        color += wake * uJourneySkyConnect * vec3(0.06, 0.34, 0.54) * 0.52;
        color += connectionPulse * vec3(0.38, 0.92, 1.0) * 3.2;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
      }
    `,
  })
  material.forceSinglePass = true
  material.userData.journeyRiverGlowUniforms = uniforms
  return material
}

function buildRiverAuroraGeometry() {
  return buildNaturalRiverGeometry({ count: 96, widthScale: 0.72, yOffset: 0.055 })
}

function prepareWorld(source, biomeMacroTexture, caveLookdevSource) {
  const root = source.clone(true)
  root.updateMatrixWorld(true)
  const caveCandidateObjects = []
  caveLookdevSource?.traverse((object) => {
    if (!object.isMesh || !object.name.includes('CAVE_MACRO_')) return
    const candidate = object.clone(true)
    candidate.geometry = object.geometry.clone()
    candidate.material = new THREE.MeshStandardMaterial({
      name: `MAT_${object.name}`,
      color: object.name.includes('FLOOR')
          ? '#343a32'
          : '#3a423b',
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    })
    candidate.position.copy(object.position)
    candidate.quaternion.copy(object.quaternion)
    candidate.scale.copy(object.scale)
    candidate.updateMatrix()
    candidate.updateMatrixWorld(true)
    caveCandidateObjects.push(candidate)
  })
  const groups = {
    cave: [],
    meadow: [],
    transition: [],
    characters: [],
    water: [],
    riverGlow: [],
    pebbles: [],
    foliage: [],
    broadleaf: [],
    canopy: [],
    mountains: [],
  }

  root.traverse((object) => {
    if (!object.isMesh) return
    object.frustumCulled = true
    object.castShadow = false
    object.receiveShadow = true
    object.material = Array.isArray(object.material)
      ? object.material.map(cloneMaterial)
      : cloneMaterial(object.material)

    const identity = `${object.name} ${
      Array.isArray(object.material)
        ? object.material.map((material) => material.name).join(' ')
        : object.material.name
    }`.toUpperCase()

    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material]

    if (identity.includes('FICTIONAL_NAGANO_MASSIF')) {
      object.geometry = reshapeV1MassifGeometry(object)
    }

    materials.forEach((material) => {
      material.dithering = true
      if ('envMapIntensity' in material) material.envMapIntensity = 0.72
    })

    if (identity.includes('CAVE_') || identity.includes('WEB_CAVE')) {
      if (caveCandidateObjects.length) {
        object.visible = false
        object.userData.journeyCaveSourceReplaced = true
        return
      }
      groups.cave.push(object)
      // The cave is behind the final valley camera and cannot contribute to
      // the river surface. Excluding it from the secondary planar pass keeps
      // the authored main view unchanged while avoiding a full duplicate draw
      // of the fading shell during the cave-to-valley handoff.
      object.userData.journeySkipPlanarReflection = true
      object.castShadow = true
      // The shell already provides physical occlusion. Receiving its own
      // broad directional shadow crushed the inner faces to black near the
      // portal, so let ambient/exit bounce describe the rock instead.
      object.receiveShadow = false
      materials.forEach((material) => {
        material.userData.journeyCaveBaseOpacity = material.opacity
        material.transparent = true
        // Exterior depth fog must already exist beyond the opening, but it
        // must not wash the cave shell into the same pale field. Keeping rock
        // out of scene fog preserves a physical, dark frame around the mist.
        material.fog = false
        // The opening camera starts inside the authored shell. Preserve its
        // geometry and lighting, but render the inner faces so the cave is a
        // readable place rather than an all-black loading-like interval.
        material.side = THREE.DoubleSide
        material.color?.lerp(new THREE.Color(CAVE_LOOK.materialTint), 0.88)
        if ('roughness' in material) material.roughness = 0.9
        if ('metalness' in material) material.metalness = 0
        if ('clearcoat' in material) material.clearcoat = 0
        if ('specularIntensity' in material) material.specularIntensity = 0.12
        if ('emissive' in material) {
          const isInteriorShell = identity.includes('CAVE_HQ_INTERIOR_SHELL')
          material.emissive.set(isInteriorShell ? '#101614' : '#0c1110')
          material.emissiveIntensity = isInteriorShell ? 0.11 : 0.045
        }
        applyCaveSurfaceDetail(material)
        material.userData.journeyCaveBaseColor = material.color?.clone()
        material.userData.journeyCaveBaseEmissive = material.emissive?.clone()
        material.userData.journeyCaveBaseEmissiveIntensity = material.emissiveIntensity ?? 0
      })
    }

    if (
      (identity.includes('MEADOW') || identity.includes('SEATED')) &&
      !identity.includes('TRANSITION_FOG')
    ) {
      groups.meadow.push(object)
      object.visible = false
      if (!identity.includes('SEATED')) {
        materials.forEach((material) => {
          material.color?.set('#315342')
          if ('roughness' in material) material.roughness = 0.98
          if ('emissive' in material) {
            material.emissive.set('#10281e')
            material.emissiveIntensity = 0.18
          }
        })
      }
    }

    if (identity.includes('TRANSITION_FOG')) {
      groups.transition.push(object)
      object.visible = false
      materials.forEach((material) => {
        material.transparent = true
        material.opacity = 0
        material.depthWrite = false
        material.color?.set('#8ea5b2')
      })
    }

    if (identity.includes('SEATED')) {
      groups.characters.push(object)
    }

    const isPlacedRiverRock = identity.includes('RIVERBANK_ROCK')
    const isPebble = !isPlacedRiverRock && (identity.includes('PEBBLE') || identity.includes('GRAVEL'))
    const isRiverbank = identity.includes('BAR_V13')
    const isStylizedRipple = identity.includes('RIPPLES')
    if (isStylizedRipple) {
      object.visible = false
      return
    }
    if (isPlacedRiverRock) {
      groups.pebbles.push(object)
      // The source rocks are oversized hero props and break the alpine scale.
      // Fine instanced stones below replace them with a continuous bank grain.
      object.visible = false
    }
    const isWater =
      !isPebble &&
      !isRiverbank &&
      (identity.includes('WATER') ||
        identity.includes('EMERALD_S'))
    const isMainRiver =
      identity.includes('EMERALD_S') ||
      identity.includes('CLEAR_EMERALD_RIVER')

    if (isPebble) {
      groups.pebbles.push(object)
      // The source GLB's riverbed meshes are pale guide geometry rather than a
      // physically modelled bed. They read as a white painted ribbon through
      // transparent water, so the shader now supplies the submerged depth and
      // fine gravel variation instead.
      object.visible = false
      return
    }

    if (isRiverbank) {
      groups.pebbles.push(object)
      // The generated corridor owns the visible wet/dry cross-section. The
      // two source BAR meshes duplicate it as pale parallel curbs (14k tris).
      object.visible = false
      materials.forEach((material) => {
        material.transparent = false
        material.opacity = 1
        material.depthWrite = true
        const isPaleBank = identity.includes('PALE')
        material.color?.set(isPaleBank ? '#777568' : '#59665d')
        if ('roughness' in material) material.roughness = 0.96
        if ('metalness' in material) material.metalness = 0
        if ('emissive' in material) {
          material.emissive.set('#414b47')
          material.emissiveIntensity = 0.17
        }
        applyWetGravelDetail(material, isPaleBank ? 'bar-pale' : 'bar-granite')
      })
    }

    if (isWater) {
      groups.water.push(object)
      object.receiveShadow = false
      if (isMainRiver) {
        object.geometry = buildNaturalRiverGeometry({ count: 104 })
        object.position.set(0, 0, 0)
        object.rotation.set(0, 0, 0)
        object.scale.set(1, 1, 1)
        object.updateMatrix()
        object.updateMatrixWorld(true)
        object.userData.journeyMainRiver = true
        materials.forEach((material) => material.dispose())
        object.material = createClearRiverMaterial()
        object.renderOrder = 3
      } else materials.forEach((material) => {
        if ('roughness' in material) material.roughness = 0.1
        if ('metalness' in material) material.metalness = 0
        material.transparent = true
        material.opacity = 0.42
        material.depthWrite = false
        material.depthTest = true
        material.map = null
        material.alphaMap = null
        material.color?.set('#78b9af')
        if ('emissive' in material) {
          material.emissiveMap = null
          material.emissive.set('#1b6e68')
          material.emissiveIntensity = 0.2
        }
        if (material.isMeshPhysicalMaterial) {
          material.ior = 1.333
          material.transmission = 0
          material.thickness = 0.045
          material.clearcoat = 0.82
          material.clearcoatRoughness = 0.08
          material.attenuationColor?.set('#7fc1b6')
          material.attenuationDistance = 12
        }
        applyWaterReflection(material)
      })
    }

    if (identity.includes('FOLIAGE')) {
      groups.foliage.push(object)
      if (identity.includes('BROADLEAF')) groups.broadleaf.push(object)
      object.visible = false
      object.castShadow = false
      materials.forEach((material) => {
        material.side = THREE.DoubleSide
        material.alphaTest = Math.max(0.16, material.alphaTest ?? 0)
        material.transparent = false
        material.color?.lerp(new THREE.Color('#9bbf83'), 0.18)
      })
    }

    if (
      identity.includes('MTN_') ||
      identity.includes('MASSIF') ||
      identity.includes('RIDGE')
    ) {
      const alpineMaterials = materials.map(createAlpineLambertMaterial)
      object.material = Array.isArray(object.material)
        ? alpineMaterials
        : alpineMaterials[0]
      groups.mountains.push(object)
      object.castShadow = false
      alpineMaterials.forEach((material) => {
        const isFarRidge = identity.includes('FAR') || identity.includes('RIDGE')
        material.transparent = false
        material.opacity = 1
        material.depthWrite = true
        material.depthTest = true
        // The reshaped massif was audited for winding inversions, so its
        // physically correct front faces are safer than double-sided shading.
        material.side = identity.includes('FICTIONAL_NAGANO_MASSIF')
          ? THREE.FrontSide
          : THREE.DoubleSide
        if (material.map) {
          material.map.wrapS = THREE.RepeatWrapping
          material.map.wrapT = THREE.RepeatWrapping
        }
        material.color?.set(isFarRidge ? '#839493' : '#6e9362')
        if ('roughness' in material) material.roughness = 0.93
        if ('emissive' in material) {
          material.emissiveMap = null
          material.emissive.set(isFarRidge ? '#33474c' : '#2c4b2c')
          // Keep the daylight fill subordinate to the physical key light so
          // broad shoulders retain form instead of collapsing into one green.
          material.emissiveIntensity = 0.026
        }
        applyAlpineProduction(material, isFarRidge, biomeMacroTexture)
      })
      materials.forEach((material, index) => {
        if (material !== alpineMaterials[index]) material.dispose()
      })
    }

    materials.forEach((material) => {
      material.needsUpdate = true
    })
  })

  caveCandidateObjects.forEach((object) => {
    root.add(object)
    groups.cave.push(object)
    // The camera begins inside this shell. Some mobile GPUs incorrectly cull
    // the enclosing mesh at a narrow portrait aspect, leaving only the green
    // scene background. Two resident cave meshes are cheap enough to keep.
    object.frustumCulled = false
    object.castShadow = true
    object.receiveShadow = false
    object.userData.journeySkipPlanarReflection = true
    object.userData.journeyCaveLookdevVersion = 'v003-fractured-meso'
    const material = object.material
    material.dithering = true
    material.transparent = true
    material.fog = false
    material.side = THREE.DoubleSide
    material.depthWrite = true
    material.envMapIntensity = 0.16
    material.color.lerp(new THREE.Color(CAVE_LOOK.materialTint), 0.42)
    material.emissive.set(object.name.includes('FLOOR') ? '#0a0e0b' : '#101612')
    material.emissiveIntensity = object.name.includes('FLOOR') ? 0.045 : 0.075
    applyCaveSurfaceDetail(material)
    material.userData.journeyCaveBaseOpacity = material.opacity
    material.userData.journeyCaveBaseColor = material.color.clone()
    material.userData.journeyCaveMobileColor = new THREE.Color(
      object.name.includes('FLOOR') ? '#373127' : '#443d34',
    )
    material.userData.journeyCaveBaseEmissive = material.emissive.clone()
    material.userData.journeyCaveBaseEmissiveIntensity = material.emissiveIntensity
  })

  root.updateMatrixWorld(true)

  const riverGlow = new THREE.Mesh(buildRiverAuroraGeometry(), createRiverGlowMaterial())
  riverGlow.name = 'JOURNEY_RIVER_AURORA_OVERLAY'
  riverGlow.renderOrder = 6
  riverGlow.frustumCulled = false
  riverGlow.castShadow = false
  riverGlow.receiveShadow = false
  root.add(riverGlow)
  groups.riverGlow.push(riverGlow)

  return { root, groups }
}

function preparePhase2Environment(source, biomeMacroTexture) {
  const root = source.clone(true)
  const cloudTexture = createCloudTexture(240809)
  const groups = {
    ridges: [],
    forest: [],
    shore: [],
    clouds: [],
  }

  root.traverse((object) => {
    if (!object.isMesh) return
    const identity = object.name.toUpperCase()
    object.frustumCulled = true
    object.castShadow = false
    object.receiveShadow = true

    if (identity.includes('P2_CLOUD_')) {
      object.material = new THREE.MeshBasicMaterial({
        map: cloudTexture,
        color: '#e8ede7',
        alphaTest: 0.015,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide,
        toneMapped: false,
        fog: true,
      })
      object.material.forceSinglePass = true
      object.renderOrder = 1
      object.userData.journeyBasePosition = object.position.clone()
      groups.clouds.push(object)
      return
    }

    let material = cloneMaterial(object.material)
    material.dithering = true
    material.transparent = true
    material.opacity = 0
    material.depthWrite = true
    material.depthTest = true
    material.side = THREE.DoubleSide
    material.forceSinglePass = true
    object.material = material

    if (identity.includes('P2_RIDGE_')) {
      const far = identity.includes('_FAR')
      const sourceMaterial = material
      material = createAlpineLambertMaterial(sourceMaterial)
      object.material = material
      if (material !== sourceMaterial) sourceMaterial.dispose()
      material.side = THREE.FrontSide
      material.color?.set(far ? '#829a9b' : '#617c74')
      material.roughness = 0.98
      if ('emissive' in material) {
        material.emissive.set(far ? '#31494c' : '#243d39')
        material.emissiveIntensity = 0.04
      }
      // Both authored phase-2 ridge sheets sit behind the massif. Treat them
      // as distant terrain so their intersections haze away instead of
      // cutting dark, near-material seams across the V1 mountain surface.
      applyAlpineProduction(material, true, biomeMacroTexture)
      object.renderOrder = -1
      groups.ridges.push(object)
      return
    }

    if (identity.includes('P2_FOREST_')) {
      object.visible = false
      material.color?.set(identity.includes('VALLEY_EDGE') ? '#315f35' : '#4a7542')
      material.roughness = 1
      if ('emissive' in material) {
        material.emissive.set('#173a20')
        material.emissiveIntensity = 0.045
      }
      // The legacy canopy shell is permanently hidden; compiling the full
      // mountain shader for it wastes startup and GPU program memory.
      object.renderOrder = 1
      groups.forest.push(object)
      return
    }

    if (identity.includes('P2_SHORE_')) {
      object.visible = false
      const wet = identity.includes('_WET_')
      const stone = identity.includes('STONE')
      material.color?.set(wet ? '#374946' : stone ? '#666b64' : '#747268')
      material.roughness = wet ? 0.86 : 0.98
      if ('emissive' in material) {
        material.emissive.set(wet ? '#1f3533' : '#393d37')
        material.emissiveIntensity = wet ? 0.035 : 0.018
      }
      applyWetGravelDetail(material, wet ? 'phase2-wet' : 'phase2-dry')
      object.userData.journeyPhase2Kind = stone ? 'stone' : wet ? 'wet' : 'dry'
      object.renderOrder = wet ? 2 : 1
      groups.shore.push(object)
    }
  })

  return { root, groups }
}

function StarField({ materialRef, pointsRef, milkyWay = false, qualityScale = 1 }) {
  const geometry = useMemo(
    () => buildStarField(
      Math.round((milkyWay ? 3800 : 1900) * qualityScale),
      milkyWay ? 430 : 470,
      milkyWay,
    ),
    [milkyWay, qualityScale],
  )
  const material = useMemo(() => createStarFieldMaterial(milkyWay), [milkyWay])

  useEffect(() => {
    materialRef.current = material
  }, [material, materialRef])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      renderOrder={-2}
      frustumCulled={false}
    />
  )
}

function SkyBridge({ meshRef }) {
  const geometry = useMemo(() => buildSkyBridgeGeometry(), [])
  const material = useMemo(() => createSkyBridgeMaterial(), [])

  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return (
    <points
      ref={meshRef}
      geometry={geometry}
      material={material}
      renderOrder={-3}
      frustumCulled={false}
    />
  )
}

function DriftingClouds({ groupRef, materialRefs }) {
  const cloudTexture = useTexture('/journey/textures/phase3/alpine-cloud-additive.webp')
  cloudTexture.colorSpace = THREE.SRGBColorSpace

  const clouds = useMemo(() => {
    const clusters = [
      // High cloud groups sit behind the massif and frame the upper-right opening.
      { position: [-104, 204, -248], scale: [142, 42], opacity: 0.26, speed: 1.22, tone: 0.02, depthTest: false },
      { position: [100, 218, -338], scale: [164, 48], opacity: 0.24, speed: 0.86, tone: 0, depthTest: false },
      { position: [12, 188, -454], scale: [176, 48], opacity: 0.15, speed: 0.64, tone: 0.06, depthTest: false },
      // Mountain-attached cloud has a shorter parallax baseline and more contrast.
      { position: [-74, 66, -238], scale: [72, 21], opacity: 0.16, speed: 1.36, tone: 0.14, depthTest: true },
      { position: [78, 75, -304], scale: [86, 24], opacity: 0.14, speed: 1.02, tone: 0.12, depthTest: true },
    ]
    // The source texture already contains a soft multi-lobe cloud. One broad
    // card per cluster preserves that shape without submitting fifteen
    // overlapping transparent meshes every frame.
    const lobeOffsets = [
      { x: 0.04, y: 0.01, z: 0, scale: 1, yaw: -0.018, opacity: 0.72 },
    ]
    return clusters.flatMap((cluster, clusterIndex) => lobeOffsets.map((lobe, lobeIndex) => ({
      position: [
        cluster.position[0] + cluster.scale[0] * lobe.x,
        cluster.position[1] + cluster.scale[1] * lobe.y,
        cluster.position[2] + lobe.z,
      ],
      scale: [cluster.scale[0] * lobe.scale, cluster.scale[1] * lobe.scale, 1],
      opacity: cluster.opacity * lobe.opacity,
      speed: cluster.speed * (0.88 + lobeIndex * 0.09),
      tone: cluster.tone + lobeIndex * 0.025,
      depthTest: cluster.depthTest,
      yaw: lobe.yaw + clusterIndex * 0.012,
    })))
  }, [])

  return (
    <group ref={groupRef}>
      {clouds.map((cloud, index) => (
        <mesh
          key={`${cloud.position.join('-')}-${index}`}
          position={cloud.position}
          rotation={[0, cloud.yaw, 0]}
          scale={cloud.scale}
          renderOrder={2}
          frustumCulled={false}
          userData={{
            baseX: cloud.position[0],
            baseY: cloud.position[1],
            opacity: cloud.opacity,
            speed: cloud.speed,
            tone: cloud.tone,
          }}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={(material) => {
              materialRefs.current[index] = material
            }}
            map={cloudTexture}
            alphaMap={cloudTexture}
            color="#f4f5ef"
            transparent
            opacity={0}
            alphaTest={0.018}
            depthWrite={false}
            depthTest={cloud.depthTest}
            blending={THREE.NormalBlending}
            side={THREE.FrontSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

// eslint-disable-next-line no-unused-vars -- retained only as a rollback reference; no tree object is mounted.
function HeroForestScaleCues({ groupRef, materialRefs }) {
  const coniferRef = useRef(null)
  const broadleafRef = useRef(null)
  const treeGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  const [coniferTexture, broadleafTexture] = useTexture([
    '/journey/textures/phase3/alpine-conifer.webp',
    '/journey/textures/phase3/riverside-broadleaf.webp',
  ])
  coniferTexture.colorSpace = THREE.SRGBColorSpace
  broadleafTexture.colorSpace = THREE.SRGBColorSpace
  const placements = useMemo(() => {
    const result = []
    const seedValue = (index, salt = 0) => {
      const value = Math.sin(index * 91.731 + salt * 47.117) * 43758.5453
      return value - Math.floor(value)
    }
    const placeTree = (index, x, y, z, minHeight, maxHeight) => {
      result.push({
        position: new THREE.Vector3(x, y, z),
        height: THREE.MathUtils.lerp(minHeight, maxHeight, seedValue(index, 4)),
        width: THREE.MathUtils.lerp(0.72, 1.08, seedValue(index, 5)),
        tone: seedValue(index, 7),
      })
    }

    // Layer 1: a restrained set of near-bank trees gives the camera a clear
    // foreground reference without turning the valley into a corridor.
  for (let index = 0; index < 260; index += 1) {
      const depth = seedValue(index, 1)
      const z = THREE.MathUtils.lerp(-15, -112, depth)
      const side = seedValue(index, 2) < 0.5 ? -1 : 1
      const centre = Math.sin(-z * 0.052) * 6.5 + Math.sin(-z * 0.017) * 2.1
      const riverWidth = Math.max(4, 18 - (-z) * 0.065)
      const bankDepth = THREE.MathUtils.lerp(1.2, 16, Math.pow(seedValue(index, 3), 0.72))
      placeTree(
        index,
        centre + side * (riverWidth + bankDepth),
        0.13 + bankDepth * 0.052,
        z,
        4.4,
        9.8,
      )
    }

    // Layer 2: clustered trees describe the river's recession and preserve
    // readable gaps between forest masses.
    for (let index = 260; index < 880; index += 1) {
      const depth = seedValue(index, 1)
      const z = THREE.MathUtils.lerp(-48, -206, depth)
      const side = seedValue(index, 2) < 0.5 ? -1 : 1
      const centre = Math.sin(-z * 0.052) * 6.5 + Math.sin(-z * 0.017) * 2.1
      const riverWidth = Math.max(3.2, 18 - (-z) * 0.065)
      const bankDepth = THREE.MathUtils.lerp(1.5, 20, Math.pow(seedValue(index, 3), 0.7))
      const perspectiveScale = THREE.MathUtils.lerp(0.98, 0.56, depth)
      placeTree(
        index,
        centre + side * (riverWidth + bankDepth),
        0.14 + bankDepth * 0.07,
        z,
        3.8 * perspectiveScale,
        8.4 * perspectiveScale,
      )
    }

    // Layer 3: trees distributed over forest-bearing slopes make the massif
    // read as thousands of canopies rather than a green surface texture.
    for (let index = 880; index < 9880; index += 1) {
      const depth = seedValue(index, 11)
      const z = THREE.MathUtils.lerp(-76, -246, depth)
      const side = seedValue(index, 12) < 0.5 ? -1 : 1
      const centre = Math.sin(-z * 0.031) * 9
      const shelf = THREE.MathUtils.lerp(7, 100, Math.pow(seedValue(index, 13), 0.88))
      const x = centre + side * shelf
      const perspectiveScale = THREE.MathUtils.lerp(0.92, 0.44, depth)
      const slopeHeight = THREE.MathUtils.clamp(
        0.8 +
          Math.pow(shelf / 100, 1.04) * 54 +
          Math.sin(x * 0.13 + z * 0.067) * 3.4 +
          (seedValue(index, 17) - 0.5) * 15,
        0.3,
        58,
      )
      placeTree(
        index,
        x,
        slopeHeight,
        z,
        1.25 * perspectiveScale,
        4.15 * perspectiveScale,
      )
    }
    return result
  }, [])

  useEffect(() => {
    const conifers = coniferRef.current
    const broadleaves = broadleafRef.current
    if (!conifers || !broadleaves) return undefined
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    let coniferIndex = 0
    let broadleafIndex = 0
    placements.forEach((placement) => {
      quaternion.identity()
      position.copy(placement.position)
      const broadleaf = placement.tone < 0.44
      const height = placement.height * (broadleaf ? 0.76 : 1)
      position.y += height * 0.5
      scale.set(
        height * placement.width * (broadleaf ? 0.82 : 0.48),
        height,
        1,
      )
      matrix.compose(position, quaternion, scale)
      if (broadleaf) {
        broadleaves.setMatrixAt(broadleafIndex, matrix)
        broadleafIndex += 1
      } else {
        conifers.setMatrixAt(coniferIndex, matrix)
        coniferIndex += 1
      }
    })
    conifers.count = coniferIndex
    broadleaves.count = broadleafIndex
    conifers.instanceMatrix.needsUpdate = true
    broadleaves.instanceMatrix.needsUpdate = true
    return undefined
  }, [placements])

  useEffect(() => () => {
    treeGeometry.dispose()
  }, [treeGeometry])

  return (
    <group ref={groupRef}>
      <instancedMesh ref={coniferRef} args={[treeGeometry, null, Math.max(placements.length, 1)]}>
        <meshBasicMaterial
          ref={(material) => { materialRefs.current[0] = material }}
          color="#ffffff"
          map={coniferTexture}
          alphaTest={0.055}
          transparent
          opacity={0}
          fog
          depthWrite
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh ref={broadleafRef} args={[treeGeometry, null, Math.max(placements.length, 1)]}>
        <meshBasicMaterial
          ref={(material) => { materialRefs.current[1] = material }}
          color="#ffffff"
          map={broadleafTexture}
          alphaTest={0.045}
          transparent
          opacity={0}
          fog
          depthWrite
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </group>
  )
}

// eslint-disable-next-line no-unused-vars -- retained only as a rollback reference; no canopy object is mounted.
function HeroCanopyMasses({ groupRef, materialRef }) {
  const meshRef = useRef(null)
  const geometry = useMemo(() => new THREE.DodecahedronGeometry(1, 0), [])
  const clusters = useMemo(() => {
    const result = []
    for (let index = 0; index < 4600; index += 1) {
      const depth = seededRandom(index + 21000)
      const z = THREE.MathUtils.lerp(-72, -246, depth)
      const side = seededRandom(index + 21200) < 0.5 ? -1 : 1
      const centre = Math.sin(-z * 0.031) * 9
      const shelf = THREE.MathUtils.lerp(20, 98, Math.pow(seededRandom(index + 21400), 0.82))
      const x = centre + side * shelf + (seededRandom(index + 21500) - 0.5) * 7
      const y = THREE.MathUtils.clamp(
        1.1 +
          Math.pow((shelf - 20) / 78, 1.14) * 51 +
          Math.sin(x * 0.13 + z * 0.067) * 3.4 +
          (seededRandom(index + 21600) - 0.5) * 18,
        0.2,
        61,
      )
      const perspective = THREE.MathUtils.lerp(1, 0.48, depth)
      const radius = THREE.MathUtils.lerp(0.12, 0.46, seededRandom(index + 21800)) * perspective
      result.push({
        position: [x, y + radius * 0.42, z],
        rotation: [0, seededRandom(index + 22000) * Math.PI, 0],
        scale: [radius * 1.06, radius * (0.62 + seededRandom(index + 22200) * 0.32), radius],
        tone: seededRandom(index + 22400),
      })
    }
    return result
  }, [])

  useEffect(() => {
    if (!meshRef.current) return undefined
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const color = new THREE.Color()
    clusters.forEach((cluster, index) => {
      position.set(...cluster.position)
      quaternion.setFromEuler(new THREE.Euler(...cluster.rotation))
      scale.set(...cluster.scale)
      matrix.compose(position, quaternion, scale)
      meshRef.current.setMatrixAt(index, matrix)
      color
        .set('#8eab79')
        .lerp(new THREE.Color('#bfd098'), cluster.tone * 0.72)
        .lerp(new THREE.Color('#6f9274'), cluster.tone < 0.18 ? 0.3 : 0)
      meshRef.current.setColorAt(index, color)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true
    meshRef.current.material.needsUpdate = true
    return undefined
  }, [clusters])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometry, null, clusters.length]}>
        <meshBasicMaterial
          ref={materialRef}
          color="#ffffff"
          transparent
          opacity={0}
          depthWrite
          fog
        />
      </instancedMesh>
    </group>
  )
}

function createHeroGravelTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  context.fillStyle = '#666d68'
  context.fillRect(0, 0, 256, 256)
  for (let index = 0; index < 680; index += 1) {
    const seed = seededRandom(index + 7800)
    const x = seededRandom(index + 8200) * 256
    const y = seededRandom(index + 9100) * 256
    const radius = 0.7 + seed * 3.1
    const light = 54 + Math.round(seededRandom(index + 9500) * 56)
    context.fillStyle = `rgb(${light + 7}, ${light + 8}, ${light + 5})`
    context.beginPath()
    context.ellipse(x, y, radius * 1.28, radius * 0.72, seed * Math.PI, 0, Math.PI * 2)
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  // The bank UV already repeats along the full S-curve. A second 7x repeat
  // exposed square texture cells as a curb; keep only a restrained grain scale.
  texture.repeat.set(2, 2)
  texture.needsUpdate = true
  return texture
}

function buildNaturalRiverBankGeometry(side, kind) {
  const stations = getNaturalRiverStations(92)
  const positions = []
  const uvs = []
  const indices = []
  stations.forEach((station, index) => {
    const bendBar = Math.exp(-Math.pow((station.t - (side < 0 ? 0.42 : 0.68)) / 0.13, 2))
    const secondaryBar = Math.exp(-Math.pow((station.t - (side < 0 ? 0.79 : 0.27)) / 0.09, 2))
    const edgeNoise = Math.sin(station.t * Math.PI * 17 + side * 1.7) * 0.28 +
      Math.sin(station.t * Math.PI * 39 - side * 0.8) * 0.11
    const innerOffset = kind === 'wet'
      ? -0.12 + edgeNoise * 0.12
      : 0.34 - bendBar * 0.16 - secondaryBar * 0.08 + edgeNoise * 0.26
    const outerOffset = kind === 'wet'
      ? 0.58 + (1 - bendBar) * 0.22 + edgeNoise * 0.2
      : 1.05 + bendBar * (side < 0 ? 4.4 : 5.6) +
        secondaryBar * (side < 0 ? 2.7 : 2.1) + edgeNoise * 0.62
    const inner = station.point.clone().addScaledVector(
      station.normal,
      side * (station.halfWidth + innerOffset),
    )
    const outer = station.point.clone().addScaledVector(
      station.normal,
      side * (station.halfWidth + outerOffset),
    )
    inner.y = sampleValleyMeadowHeight(inner.z, side, Math.max(0, innerOffset)) + (kind === 'wet' ? -0.045 : 0.015)
    outer.y = sampleValleyMeadowHeight(outer.z, side, outerOffset) + (kind === 'wet' ? -0.015 : 0.025)
    positions.push(inner.x, inner.y, inner.z, outer.x, outer.y, outer.z)
    uvs.push(0, station.t * 7.5, 1, station.t * 7.5)
    if (index < stations.length - 1) {
      const start = index * 2
      if (side < 0) {
        indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3)
      } else {
        // The opposite bank reverses its across direction. Reverse each
        // triangle so both banks face the valley camera instead of culling
        // the entire right-hand strip.
        indices.push(start, start + 1, start + 2, start + 1, start + 3, start + 2)
      }
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function applyNaturalRiverBankEdge(material, wet) {
  if (wet) return
  const applyGravel = material.onBeforeCompile
  material.onBeforeCompile = (shader) => {
    applyGravel(shader)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vJourneyNaturalBankUv;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvJourneyNaturalBankUv = uv;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vJourneyNaturalBankUv;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
float journeyNaturalBankBreak = journeyGravelNoise(vJourneyGravelPosition.xz * 0.052 + 281.0);
float journeyNaturalBankMottle = journeyGravelNoise(vJourneyGravelPosition.xz * 0.19 - 73.0);
float journeyNaturalBankReach = 0.72 + journeyNaturalBankBreak * 0.18 + journeyNaturalBankMottle * 0.06;
float journeyNaturalBankOuter = 1.0 - smoothstep(
  journeyNaturalBankReach,
  journeyNaturalBankReach + 0.16,
  vJourneyNaturalBankUv.x
);
diffuseColor.a *= journeyNaturalBankOuter;`,
      )
  }
  material.alphaTest = 0.015
  material.customProgramCacheKey = () => 'journey-natural-bank-edge-v1-organic-breaks'
  material.needsUpdate = true
}

function createNaturalRiverReflectionMaterial(reflectionTexture) {
  const uniforms = {
    uJourneyReflection: { value: reflectionTexture },
    uJourneyReflectionMatrix: { value: new THREE.Matrix4() },
    uJourneyTime: { value: 0 },
    uJourneyOpacity: { value: 0 },
    uJourneyNight: { value: 0 },
    uJourneyReflectionReady: { value: 0 },
  }
  const material = new THREE.ShaderMaterial({
    name: 'MAT_JOURNEY_V1_PLANAR_RIVER_REFLECTION',
    uniforms,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    fog: false,
    toneMapped: false,
    vertexShader: `
      attribute float aJourneyAcross;
      attribute float aJourneyAlong;
      uniform mat4 uJourneyReflectionMatrix;
      varying vec4 vJourneyReflectionUv;
      varying vec3 vJourneyReflectionWorld;
      varying float vJourneyReflectionAcross;
      varying float vJourneyReflectionAlong;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vJourneyReflectionWorld = worldPosition.xyz;
        vJourneyReflectionAcross = aJourneyAcross;
        vJourneyReflectionAlong = aJourneyAlong;
        vJourneyReflectionUv = uJourneyReflectionMatrix * worldPosition;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uJourneyReflection;
      uniform float uJourneyTime;
      uniform float uJourneyOpacity;
      uniform float uJourneyNight;
      uniform float uJourneyReflectionReady;
      varying vec4 vJourneyReflectionUv;
      varying vec3 vJourneyReflectionWorld;
      varying float vJourneyReflectionAcross;
      varying float vJourneyReflectionAlong;

      float journeyReflectHash(vec2 point) {
        return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float journeyReflectNoise(vec2 point) {
        vec2 cell = floor(point);
        vec2 local = fract(point);
        local = local * local * (3.0 - 2.0 * local);
        float a = journeyReflectHash(cell);
        float b = journeyReflectHash(cell + vec2(1.0, 0.0));
        float c = journeyReflectHash(cell + vec2(0.0, 1.0));
        float d = journeyReflectHash(cell + vec2(1.0));
        return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
      }
      void main() {
        vec2 projected = vJourneyReflectionUv.xy / max(vJourneyReflectionUv.w, 0.0001);
        float broadFlow = journeyReflectNoise(
          vec2(vJourneyReflectionAlong * 24.0 - uJourneyTime * 0.16, vJourneyReflectionAcross * 3.4)
        );
        float fineFlow = journeyReflectNoise(
          vJourneyReflectionWorld.xz * vec2(0.18, 0.42) + vec2(uJourneyTime * 0.035, -uJourneyTime * 0.12)
        );
        vec2 distortion = vec2(
          (broadFlow - 0.5) * 0.011 + (fineFlow - 0.5) * 0.004,
          (fineFlow - 0.5) * 0.007
        );
        vec2 directUv = clamp(projected + distortion, vec2(0.003), vec2(0.997));
        vec3 directReflection = vec3(0.0);

        // The physically projected mountain band occupies only a few pixels at
        // this low valley camera angle. Sample a compressed copy of the real
        // planar target as well, then ease back to the direct projection toward
        // the upstream horizon. This keeps the reflection recognisably tied to
        // the rendered massif without turning the whole river into a mirror.
        float reflectedBandY = mix(
          0.055,
          0.19,
          pow(clamp(vJourneyReflectionAlong, 0.0, 1.0), 0.72)
        );
        vec2 expandedUv = vec2(
          directUv.x,
          clamp(mix(reflectedBandY, directUv.y, 0.12), 0.003, 0.997)
        );
        vec3 expandedReflection = vec3(0.0);
        if (uJourneyReflectionReady > 0.5) {
          directReflection = texture2D(uJourneyReflection, directUv).rgb;
          expandedReflection = 0.5 * (
            texture2D(
              uJourneyReflection,
              clamp(expandedUv + vec2(0.006 + fineFlow * 0.002, 0.0), vec2(0.003), vec2(0.997))
            ).rgb +
            texture2D(
              uJourneyReflection,
              clamp(expandedUv - vec2(0.005 + broadFlow * 0.002, 0.0), vec2(0.003), vec2(0.997))
            ).rgb
          );
        }
        float projectionRemap = mix(
          0.62,
          0.25,
          smoothstep(0.48, 0.96, vJourneyReflectionAlong)
        );
        projectionRemap *= 1.0 - smoothstep(0.82, 1.0, abs(vJourneyReflectionAcross)) * 0.28;
        vec3 reflected = mix(directReflection, expandedReflection, projectionRemap);
        vec3 fallbackSky = mix(vec3(0.32, 0.53, 0.58), vec3(0.05, 0.1, 0.22), uJourneyNight);
        vec3 fallbackMountain = mix(vec3(0.105, 0.235, 0.17), vec3(0.025, 0.07, 0.14), uJourneyNight);
        float fallbackRelief = smoothstep(0.38, 0.7, broadFlow) * (1.0 - smoothstep(0.78, 0.98, broadFlow));
        vec3 fallbackReflection = mix(fallbackSky, fallbackMountain, 0.3 + fallbackRelief * 0.48);
        reflected = mix(fallbackReflection, reflected, uJourneyReflectionReady);
        float across = abs(vJourneyReflectionAcross);
        float shallow = smoothstep(0.48, 0.98, across);
        float depthGrain = journeyReflectNoise(vJourneyReflectionWorld.xz * vec2(0.055, 0.1) + 17.0);
        vec3 deepBody = mix(vec3(0.04, 0.39, 0.46), vec3(0.025, 0.075, 0.16), uJourneyNight);
        vec3 shallowBody = mix(vec3(0.18, 0.49, 0.44), vec3(0.06, 0.16, 0.24), uJourneyNight);
        vec3 body = mix(deepBody, shallowBody, shallow * (0.62 + depthGrain * 0.18));
        float viewFresnel = smoothstep(0.08, 0.92, vJourneyReflectionAlong);
        float reflectionWeight = mix(0.50, 0.68, viewFresnel) * (1.0 - shallow * 0.22);
        vec3 color = mix(body, reflected, reflectionWeight);
        // Two reflected massif shoulders stay attached to the upstream
        // waterline. A high central front preserves the valley saddle; the
        // taller right shoulder reaches farther toward the viewer.
        float leftShoulderCoordinate = (vJourneyReflectionAcross + 0.47) / 0.30;
        float rightShoulderCoordinate = (vJourneyReflectionAcross - 0.45) / 0.34;
        float saddleCoordinate = vJourneyReflectionAcross / 0.22;
        float leftShoulder = exp(-leftShoulderCoordinate * leftShoulderCoordinate);
        float rightShoulder = exp(-rightShoulderCoordinate * rightShoulderCoordinate);
        float centralSaddle = exp(-saddleCoordinate * saddleCoordinate);
        float reflectedShoulderFront = clamp(
          0.58 - leftShoulder * 0.36 - rightShoulder * 0.42 +
            centralSaddle * 0.04 + (broadFlow - 0.5) * 0.026,
          0.12,
          0.62
        );
        float reflectedShoulders = smoothstep(
          reflectedShoulderFront - 0.035,
          reflectedShoulderFront + 0.06,
          vJourneyReflectionAlong
        );
        reflectedShoulders *= 1.0 - smoothstep(0.72, 0.98, across);
        float reflectedShoulderPresence = clamp(
          leftShoulder * 0.82 + rightShoulder,
          0.0,
          1.0
        );
        reflectedShoulders *= smoothstep(0.08, 0.46, reflectedShoulderPresence);
        reflectedShoulders *= mix(0.78, 1.0, fineFlow);
        vec3 leftShoulderTint = mix(
          vec3(0.052, 0.135, 0.105),
          vec3(0.024, 0.06, 0.115),
          uJourneyNight
        );
        vec3 rightShoulderTint = mix(
          vec3(0.082, 0.175, 0.13),
          vec3(0.032, 0.075, 0.13),
          uJourneyNight
        );
        vec3 reflectedShoulderTint = mix(
          leftShoulderTint,
          rightShoulderTint,
          smoothstep(-0.18, 0.54, vJourneyReflectionAcross)
        );
        vec3 reflectedShoulderColor = mix(reflected, reflectedShoulderTint, 0.93);
        color = mix(
          color,
          reflectedShoulderColor,
          reflectedShoulders * (0.76 + broadFlow * 0.08)
        );
        float nearMirrorReach = clamp(
          0.16 + leftShoulder * 0.28 + rightShoulder * 0.38 -
            centralSaddle * 0.055 + (broadFlow - 0.5) * 0.045,
          0.09,
          0.56
        );
        float nearMirror = smoothstep(0.012, 0.045, vJourneyReflectionAlong) *
          (1.0 - smoothstep(
            nearMirrorReach - 0.035,
            nearMirrorReach + 0.07,
            vJourneyReflectionAlong
          ));
        nearMirror *= (1.0 - smoothstep(0.78, 0.98, across)) *
          mix(0.74, 1.0, fineFlow) *
          smoothstep(0.06, 0.42, reflectedShoulderPresence);
        color = mix(
          color,
          reflectedShoulderColor,
          nearMirror * (0.68 + broadFlow * 0.08)
        );
        float currentRibbon = pow(
          0.5 + 0.5 * sin(
            vJourneyReflectionAlong * 176.0 +
            vJourneyReflectionAcross * 8.5 -
            uJourneyTime * 0.72 +
            broadFlow * 2.4
          ),
          14.0
        );
        color += vec3(0.2, 0.38, 0.31) * currentRibbon * (1.0 - shallow * 0.62) * 0.11;
        color += vec3(0.22, 0.42, 0.34) * smoothstep(0.76, 0.96, fineFlow) * 0.086;
        float edge = 1.0 - smoothstep(0.92, 1.0, across);
        gl_FragColor = vec4(color, uJourneyOpacity * edge);
        #include <colorspace_fragment>
      }
    `,
  })
  material.forceSinglePass = true
  material.userData.journeyReflectionUniforms = uniforms
  return material
}

function NaturalRiverCorridor({ progress, qualityScale = 1, reflectionDisabled = false }) {
  const corridorRef = useRef(null)
  const reflectionMeshRef = useRef(null)
  const bedMaterialRef = useRef(null)
  const bankMaterialRefs = useRef([])
  const reflectionStateRef = useRef({
    initialized: false,
    time: -Infinity,
    progress: -Infinity,
    fov: 0,
    aspect: 0,
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    mainRiver: null,
    exclusions: [],
    motionUniforms: [],
  })
  const { gl, scene, camera } = useThree()
  const qaCaptureEnabled = useMemo(
    () => new URLSearchParams(window.location.search).get('capture') === '1',
    [],
  )
  const planarReflectionEnabled = qualityScale >= 0.9 && !reflectionDisabled
  const reflectionResolution = planarReflectionEnabled ? 320 : 2
  const bedGeometry = useMemo(
    () => buildNaturalRiverGeometry({ count: 100, widthScale: 1.025, yOffset: -0.24 }),
    [],
  )
  const reflectionGeometry = useMemo(
    () => buildNaturalRiverGeometry({ count: 100, widthScale: 0.985, yOffset: 0.035 }),
    [],
  )
  const reflectionTarget = useMemo(() => new THREE.WebGLRenderTarget(
    reflectionResolution,
    planarReflectionEnabled ? 200 : 2,
    {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    },
  ), [planarReflectionEnabled, reflectionResolution])
  const reflectionMaterial = useMemo(
    () => createNaturalRiverReflectionMaterial(reflectionTarget.texture),
    [reflectionTarget],
  )
  const reflectionCamera = useMemo(() => new THREE.PerspectiveCamera(), [])
  const reflectionMatrix = useMemo(() => new THREE.Matrix4(), [])
  const reflectionBias = useMemo(() => new THREE.Matrix4().set(
    0.5, 0, 0, 0.5,
    0, 0.5, 0, 0.5,
    0, 0, 0.5, 0.5,
    0, 0, 0, 1,
  ), [])
  const reflectionForward = useMemo(() => new THREE.Vector3(), [])
  const reflectionTargetPoint = useMemo(() => new THREE.Vector3(), [])
  const reflectionPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.14), [])
  const reflectionClipPlane = useMemo(() => new THREE.Plane(), [])
  const reflectionClipVector = useMemo(() => new THREE.Vector4(), [])
  const reflectionProjectionQ = useMemo(() => new THREE.Vector4(), [])
  const bankGeometries = useMemo(
    () => [
      buildNaturalRiverBankGeometry(-1, 'wet'),
      buildNaturalRiverBankGeometry(1, 'wet'),
      buildNaturalRiverBankGeometry(-1, 'dry'),
      buildNaturalRiverBankGeometry(1, 'dry'),
    ],
    [],
  )
  const gravelTexture = useMemo(() => createHeroGravelTexture(), [])
  const gravelBumpTexture = useMemo(() => {
    const texture = gravelTexture.clone()
    texture.colorSpace = THREE.NoColorSpace
    texture.needsUpdate = true
    return texture
  }, [gravelTexture])

  const hideReflectionExclusions = useCallback(() => {
    const reflectionState = reflectionStateRef.current
    // Cache the small exclusion set after the procedural React siblings have
    // mounted. Rebuild only if the cached objects were removed from the scene.
    if (
      reflectionState.exclusions.length === 0 ||
      reflectionState.exclusions.some((object) => !object.parent)
    ) {
      const candidates = []
      scene.traverse((object) => {
        if (object.userData?.journeySkipPlanarReflection) candidates.push(object)
      })
      reflectionState.exclusions = candidates.filter((object) => {
        let parent = object.parent
        while (parent) {
          if (parent.userData?.journeySkipPlanarReflection) return false
          parent = parent.parent
        }
        return true
      })
    }
    const visibility = reflectionState.exclusions.map((object) => object.visible)
    reflectionState.exclusions.forEach((object) => {
      object.visible = false
    })
    return () => {
      reflectionState.exclusions.forEach((object, index) => {
        object.visible = visibility[index]
      })
    }
  }, [scene])

  const setReflectionMotionMode = useCallback((value) => {
    const reflectionState = reflectionStateRef.current
    if (
      reflectionState.motionUniforms.length === 0 ||
      reflectionState.motionUniforms.some(({ object }) => !object.parent)
    ) {
      const uniforms = new Map()
      scene.traverse((object) => {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material]
        materials.filter(Boolean).forEach((material) => {
          const reflectionUniform = material.userData
            ?.journeyMeadowUniforms
            ?.uJourneyReflectionPass
          if (reflectionUniform) uniforms.set(reflectionUniform, object)
        })
      })
      reflectionState.motionUniforms = Array.from(
        uniforms,
        ([uniform, object]) => ({ object, uniform }),
      )
    }
    const previousValues = reflectionState.motionUniforms.map(
      ({ uniform }) => uniform.value,
    )
    reflectionState.motionUniforms.forEach(({ uniform }) => {
      uniform.value = value
    })
    return () => {
      reflectionState.motionUniforms.forEach(({ uniform }, index) => {
        uniform.value = previousValues[index]
      })
    }
  }, [scene])

  useLayoutEffect(() => {
    gl.initRenderTarget(reflectionTarget)
    let cancelled = false
    let warmFrame = null
    const setupFrame = window.requestAnimationFrame(() => {
      warmFrame = window.requestAnimationFrame(() => {
      if (cancelled) return
      const previousTarget = gl.getRenderTarget()
      const previousXr = gl.xr.enabled
      const previousShadowUpdate = gl.shadowMap.autoUpdate
      const hiddenObjects = []
      const restoreReflectionExclusions = hideReflectionExclusions()
      const restoreReflectionMotion = setReflectionMotionMode(1)
      scene.traverse((object) => {
        if (!object.visible && !object.userData?.journeySkipPlanarReflection) {
          hiddenObjects.push(object)
          object.visible = true
        }
      })
      const reflectorVisible = reflectionMeshRef.current?.visible
      if (reflectionMeshRef.current) reflectionMeshRef.current.visible = false
      reflectionCamera.copy(camera, false)
      reflectionCamera.updateMatrixWorld()
      gl.xr.enabled = false
      gl.shadowMap.autoUpdate = false
      try {
        gl.setRenderTarget(reflectionTarget)
        gl.clear()
        // Compile/upload the exact 2D reflection-target variants while the DOM
        // loader is opaque. Merely allocating the target left 34 programs to
        // compile when the river first appeared in the live story.
        gl.render(scene, reflectionCamera)
      } finally {
        gl.setRenderTarget(previousTarget)
        gl.xr.enabled = previousXr
        gl.shadowMap.autoUpdate = previousShadowUpdate
        hiddenObjects.forEach((object) => {
          object.visible = false
        })
        restoreReflectionMotion()
        restoreReflectionExclusions()
        if (reflectionMeshRef.current) reflectionMeshRef.current.visible = reflectorVisible
      }
      })
    })
    return () => {
      cancelled = true
      window.cancelAnimationFrame(setupFrame)
      if (warmFrame != null) window.cancelAnimationFrame(warmFrame)
    }
  }, [
    camera,
    gl,
    hideReflectionExclusions,
    reflectionCamera,
    reflectionTarget,
    scene,
    setReflectionMotionMode,
  ])

  useEffect(() => {
    const state = reflectionStateRef.current
    state.initialized = false
    state.time = -Infinity
    state.progress = -Infinity
    reflectionMaterial.userData.journeyReflectionUniforms.uJourneyReflectionReady.value = 0
  }, [reflectionMaterial, reflectionTarget])

  useEffect(() => () => {
    bedGeometry.dispose()
    reflectionGeometry.dispose()
    bankGeometries.forEach((geometry) => geometry.dispose())
    gravelTexture.dispose()
    gravelBumpTexture.dispose()
  }, [bankGeometries, bedGeometry, gravelBumpTexture, gravelTexture, reflectionGeometry])

  useEffect(() => () => {
    reflectionMaterial.dispose()
    reflectionTarget.dispose()
  }, [reflectionMaterial, reflectionTarget])

  useFrame((state) => {
    const reveal = getJourneyValleyRiverPresence(progress)
    const { nightWeight: night } = getJourneyTimeOfDay(progress)
    if (corridorRef.current) corridorRef.current.visible = reveal > 0.01
    if (reflectionMeshRef.current) reflectionMeshRef.current.visible = reveal > 0.01
    const reflectionUniforms = reflectionMaterial.userData.journeyReflectionUniforms
    reflectionUniforms.uJourneyOpacity.value = reveal * THREE.MathUtils.lerp(0.84, 0.52, night)
    reflectionUniforms.uJourneyNight.value = night
    reflectionUniforms.uJourneyTime.value = state.clock.elapsedTime

    const reflectionState = reflectionStateRef.current
    // Refresh on every perceptible camera/story movement. The previous coarse
    // thresholds let the frozen render target lag for several scroll frames,
    // then snap to a new reflection even though the live camera was continuous.
    const cameraChanged = !reflectionState.initialized ||
      reflectionState.position.distanceToSquared(camera.position) > 0.000001 ||
      1 - Math.abs(reflectionState.quaternion.dot(camera.quaternion)) > 0.00000001 ||
      Math.abs(reflectionState.fov - camera.fov) > 0.001 ||
      Math.abs(reflectionState.aspect - camera.aspect) > 0.00001
    const storyChanged = Math.abs(reflectionState.progress - progress) > 0.0001
    const movingRefreshDue = state.clock.elapsedTime - reflectionState.time >= 1 / 30
    const idleRefreshDue = state.clock.elapsedTime - reflectionState.time > 0.38
    if (
      planarReflectionEnabled &&
      reveal > 0.01 &&
      (((cameraChanged || storyChanged) && movingRefreshDue) || idleRefreshDue)
    ) {
      const planeY = 0.14
      camera.getWorldDirection(reflectionForward)
      reflectionTargetPoint.copy(camera.position).add(reflectionForward)
      reflectionCamera.copy(camera, false)
      reflectionCamera.position.copy(camera.position)
      reflectionCamera.position.y = planeY * 2 - camera.position.y
      reflectionTargetPoint.y = planeY * 2 - reflectionTargetPoint.y
      reflectionCamera.up.copy(camera.up)
      reflectionCamera.up.y *= -1
      reflectionCamera.lookAt(reflectionTargetPoint)
      reflectionCamera.projectionMatrix.copy(camera.projectionMatrix)
      reflectionCamera.updateMatrixWorld()
      reflectionClipPlane.copy(reflectionPlane).applyMatrix4(reflectionCamera.matrixWorldInverse)
      reflectionClipVector.set(
        reflectionClipPlane.normal.x,
        reflectionClipPlane.normal.y,
        reflectionClipPlane.normal.z,
        reflectionClipPlane.constant,
      )
      const projection = reflectionCamera.projectionMatrix.elements
      reflectionProjectionQ.set(
        (Math.sign(reflectionClipVector.x) + projection[8]) / projection[0],
        (Math.sign(reflectionClipVector.y) + projection[9]) / projection[5],
        -1,
        (1 + projection[10]) / projection[14],
      )
      reflectionClipVector.multiplyScalar(2 / reflectionClipVector.dot(reflectionProjectionQ))
      projection[2] = reflectionClipVector.x
      projection[6] = reflectionClipVector.y
      projection[10] = reflectionClipVector.z + 0.9995
      projection[14] = reflectionClipVector.w
      reflectionCamera.projectionMatrixInverse.copy(reflectionCamera.projectionMatrix).invert()
      reflectionMatrix
        .copy(reflectionBias)
        .multiply(reflectionCamera.projectionMatrix)
        .multiply(reflectionCamera.matrixWorldInverse)
      reflectionUniforms.uJourneyReflectionMatrix.value.copy(reflectionMatrix)

      // GLTFLoader sanitizes reserved punctuation from node names, so an exact
      // source-name lookup is brittle (the source `.001` suffix loses its
      // period). Use the semantic marker assigned in prepareWorld instead.
      let mainRiver = reflectionState.mainRiver
      if (!mainRiver?.parent) {
        mainRiver = null
        scene.traverse((object) => {
          if (!mainRiver && object.userData?.journeyMainRiver) mainRiver = object
        })
        reflectionState.mainRiver = mainRiver
      }
      const mainRiverVisible = mainRiver?.visible
      const reflectorVisible = reflectionMeshRef.current?.visible
      const corridorVisible = corridorRef.current?.visible
      if (corridorRef.current) corridorRef.current.visible = false
      if (mainRiver) mainRiver.visible = false
      const restoreReflectionExclusions = hideReflectionExclusions()
      const restoreReflectionMotion = setReflectionMotionMode(1)
      const previousTarget = gl.getRenderTarget()
      const previousXr = gl.xr.enabled
      const previousShadowUpdate = gl.shadowMap.autoUpdate
      const reflectionRenderStartedAt = qaCaptureEnabled ? performance.now() : 0
      try {
        gl.xr.enabled = false
        gl.shadowMap.autoUpdate = false
        gl.setRenderTarget(reflectionTarget)
        gl.clear()
        gl.render(scene, reflectionCamera)
        if (qaCaptureEnabled) {
          const captureDataset = document.documentElement.dataset
          captureDataset.journeyReflectionCalls = String(gl.info.render.calls)
          captureDataset.journeyReflectionTriangles = String(gl.info.render.triangles)
          captureDataset.journeyReflectionExcludedRoots = String(
            reflectionState.exclusions.length,
          )
          captureDataset.journeyReflectionLastMs = (
            performance.now() - reflectionRenderStartedAt
          ).toFixed(3)
        }
      } finally {
        gl.setRenderTarget(previousTarget)
        gl.xr.enabled = previousXr
        gl.shadowMap.autoUpdate = previousShadowUpdate
        if (mainRiver) mainRiver.visible = mainRiverVisible
        if (corridorRef.current) corridorRef.current.visible = corridorVisible
        restoreReflectionMotion()
        restoreReflectionExclusions()
        if (reflectionMeshRef.current) reflectionMeshRef.current.visible = reflectorVisible
      }
      reflectionUniforms.uJourneyReflectionReady.value = 1
      reflectionState.initialized = true
      reflectionState.time = state.clock.elapsedTime
      reflectionState.progress = progress
      reflectionState.fov = camera.fov
      reflectionState.aspect = camera.aspect
      reflectionState.position.copy(camera.position)
      reflectionState.quaternion.copy(camera.quaternion)
    }
    if (bedMaterialRef.current) {
      bedMaterialRef.current.depthWrite = false
      bedMaterialRef.current.opacity = reveal * THREE.MathUtils.lerp(0.76, 0.34, night)
      bedMaterialRef.current.color
        .set('#777b72')
        .lerp(new THREE.Color('#38505a'), night)
    }
    bankMaterialRefs.current.forEach((material, index) => {
      if (!material) return
      const wet = index < 2
      material.depthWrite = false
      material.opacity = reveal * THREE.MathUtils.lerp(wet ? 0.62 : 0.4, wet ? 0.34 : 0.28, night)
      material.color
        .set(wet ? '#46544f' : '#4c544f')
        .lerp(new THREE.Color(wet ? '#354b50' : '#4b5960'), night)
    })
  })

  useEffect(() => () => {
    if (!qaCaptureEnabled) return
    const captureDataset = document.documentElement.dataset
    delete captureDataset.journeyReflectionCalls
    delete captureDataset.journeyReflectionTriangles
    delete captureDataset.journeyReflectionExcludedRoots
    delete captureDataset.journeyReflectionLastMs
  }, [qaCaptureEnabled])

  return (
    <group ref={corridorRef} name="JOURNEY_V1_NATURAL_RIVER_CORRIDOR">
      <mesh geometry={bedGeometry} renderOrder={1} frustumCulled={false}>
        <meshStandardMaterial
          ref={bedMaterialRef}
          map={gravelTexture}
          bumpMap={gravelBumpTexture}
          bumpScale={0.045}
          color="#777b72"
          roughness={0.92}
          metalness={0}
          transparent
          opacity={0}
          depthWrite={false}
          fog
        />
      </mesh>
      {bankGeometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} renderOrder={2} frustumCulled={false} receiveShadow>
          <meshStandardMaterial
            ref={(material) => {
              bankMaterialRefs.current[index] = material
              if (material && !material.userData.journeyBankDetailApplied) {
                applyWetGravelDetail(material, index < 2 ? 'phase2-wet' : 'bar-granite')
                applyNaturalRiverBankEdge(material, index < 2)
                material.userData.journeyBankDetailApplied = true
              }
            }}
            map={gravelTexture}
            bumpMap={gravelBumpTexture}
            bumpScale={index < 2 ? 0.035 : 0.085}
            color={index < 2 ? '#46544f' : '#4c544f'}
            roughness={index < 2 ? 0.82 : 0.96}
            metalness={0}
            transparent
            opacity={0}
            depthWrite={false}
            fog
            polygonOffset
            polygonOffsetFactor={-1}
          />
        </mesh>
      ))}
      <mesh
        ref={reflectionMeshRef}
        geometry={reflectionGeometry}
        renderOrder={4}
        frustumCulled={false}
      >
        <primitive object={reflectionMaterial} attach="material" />
      </mesh>
    </group>
  )
}

function buildDistantRidgeVolume({ frontZ, backZ, baseY, width, heights, hueOffset, far }) {
  // This is a real low-poly volume, not a vertical profile card. Its shallow
  // front/back slopes give the connected skyline enough spatial parallax to
  // belong to the V1 terrain while remaining inexpensive (one draw per range).
  const segments = Math.max((heights.length - 1) * 5, 84)
  const rows = 15
  const positions = []
  const colors = []
  const indices = []
  const color = new THREE.Color()
  for (let xIndex = 0; xIndex <= segments; xIndex += 1) {
    const x = THREE.MathUtils.lerp(-width, width, xIndex / segments)
    const profile = (xIndex / segments) * (heights.length - 1)
    const profileIndex = Math.floor(profile)
    const profileMix = profile - profileIndex
    const peak = THREE.MathUtils.lerp(
      heights[profileIndex],
      heights[Math.min(profileIndex + 1, heights.length - 1)],
      profileMix,
    ) + Math.sin(x * 0.076 + hueOffset * 2.7) * 4.2 +
      Math.sin(x * 0.207 - hueOffset) * 1.8
    for (let zIndex = 0; zIndex <= rows; zIndex += 1) {
      const t = zIndex / rows
      const z = THREE.MathUtils.lerp(frontZ, backZ, t)
      const ridgeCrossSection = Math.pow(Math.sin(t * Math.PI), 0.72)
      const edgeFalloff = 0.82 + Math.cos((x / width) * Math.PI * 0.5) * 0.18
      const shoulderNoise =
        Math.sin(x * 0.042 + z * 0.078 + hueOffset * 1.9) * 2.4 * ridgeCrossSection +
        Math.sin(x * 0.139 - z * 0.051) * 1.1 * ridgeCrossSection
      const y = baseY + (peak - baseY) * ridgeCrossSection * edgeFalloff + shoulderNoise
      positions.push(x, y, z)
      const altitude = THREE.MathUtils.clamp((y - baseY) / Math.max(peak - baseY, 1), 0, 1)
      const lightFacing = 0.46 + Math.sin(x * 0.025 - z * 0.012 + hueOffset) * 0.15
      color
        .set(far ? '#708b89' : '#3f604e')
        .lerp(new THREE.Color(far ? '#a8bdb7' : '#77856e'), altitude * 0.72)
        .lerp(new THREE.Color(far ? '#c5d4ce' : '#9c9f87'), Math.max(0, altitude - 0.55) * (0.3 + lightFacing * 0.25))
      colors.push(color.r, color.g, color.b)
    }
  }
  const rowStride = rows + 1
  for (let xIndex = 0; xIndex < segments; xIndex += 1) {
    for (let zIndex = 0; zIndex < rows; zIndex += 1) {
      const a = xIndex * rowStride + zIndex
      const b = (xIndex + 1) * rowStride + zIndex
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function FarRidgeCrown({ progress, biomeMacroTexture }) {
  const geometry = useMemo(() => buildDistantRidgeVolume({
    frontZ: -426,
    backZ: -510,
    baseY: 70,
    width: 302,
    hueOffset: 4.7,
    far: true,
    // Repeated shoulders and saddles support the existing left/right massif;
    // none of these values creates a single dominant central pyramid.
    heights: [184, 198, 191, 207, 195, 212, 202, 218, 188, 205, 194, 214, 199, 210, 193, 202, 184],
  }), [])
  const material = useMemo(() => {
    const result = new THREE.MeshLambertMaterial({
      color: '#d6e4dd',
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true,
      side: THREE.FrontSide,
      fog: false,
      emissive: '#263d35',
      emissiveIntensity: 0.015,
    })
    applyAlpineProduction(result, true, biomeMacroTexture)
    return result
  }, [biomeMacroTexture])
  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])
  useFrame(() => {
    const reveal = getJourneyValleyFarPresence(progress)
    const { sunsetWeight: sunset, nightWeight: night } = getJourneyTimeOfDay(progress)
    material.opacity = reveal * THREE.MathUtils.lerp(0.44, 0.26, night)
    material.color
      .set('#d6e4dd')
      .lerp(new THREE.Color('#c5a293'), sunset * 0.34)
      .lerp(new THREE.Color('#48647a'), night * 0.78)
    const uniforms = material.userData.journeyAlpineUniforms
    if (uniforms) {
      uniforms.uJourneySunset.value = sunset
      uniforms.uJourneyNight.value = night
      uniforms.uJourneyDiscovery.value = 0
      uniforms.uJourneyTime.value = 0
      uniforms.uJourneyEntranceReveal.value = reveal
    }
  })
  return (
    <mesh geometry={geometry} renderOrder={-3} frustumCulled={false}>
      <primitive object={material} attach="material" />
    </mesh>
  )
}

function createMeadowBladeGeometry(kind) {
  const positions = []
  const uvs = []
  const triangle = (a, b, c, uvA, uvB, uvC) => {
    positions.push(...a, ...b, ...c)
    if (uvA) uvs.push(...uvA, ...uvB, ...uvC)
  }
  if (kind === 'grass') {
    const rotateY = ([x, y, z], angle) => [
      x * Math.cos(angle) + z * Math.sin(angle),
      y,
      -x * Math.sin(angle) + z * Math.cos(angle),
    ]
    // A small asymmetric fan replaces the former repeated card/stake profile.
    // Four real tapered blades remain very cheap, but the varied lean, height
    // and depth make each instance read as a soft grass clump at valley scale.
    ;[
      { x: -0.44, z: 0.1, width: 0.2, height: 0.98, bend: -0.38, angle: -0.82 },
      { x: -0.16, z: -0.1, width: 0.18, height: 1.35, bend: -0.09, angle: -0.22 },
      { x: 0.2, z: 0.06, width: 0.24, height: 1.12, bend: 0.18, angle: 0.38 },
      { x: 0.45, z: -0.04, width: 0.2, height: 0.84, bend: 0.3, angle: 0.82 },
      { x: -0.08, z: -0.18, width: 0.17, height: 0.75, bend: 0.02, angle: 1.2 },
    ].forEach((blade) => {
      triangle(
        rotateY([blade.x - blade.width * 0.5, 0, blade.z], blade.angle),
        rotateY([blade.x + blade.width * 0.5, 0, blade.z], blade.angle),
        rotateY([blade.x + blade.bend, blade.height, blade.z], blade.angle),
      )
    })
  } else {
    const rotateY = ([x, y, z], angle) => [
      x * Math.cos(angle) + z * Math.sin(angle),
      y,
      -x * Math.sin(angle) + z * Math.cos(angle),
    ]
    ;[0, Math.PI / 2].forEach((angle) => {
      const flowerTriangle = (a, b, c) => triangle(rotateY(a, angle), rotateY(b, angle), rotateY(c, angle))
      // Keep the stem subordinate to the separate petal sprite. At valley
      // scale a broad cross-card collapses into a black fence post.
      flowerTriangle([-0.018, 0, 0], [0.018, 0, 0], [0, 0.57, 0.006])
      const centre = [0, 0.59, 0.01]
      ;[
        [[-0.16, 0.59, 0.01], [-0.04, 0.74, 0.01]],
        [[0.16, 0.59, 0.01], [0.04, 0.74, 0.01]],
        [[0, 0.45, 0.01], [-0.1, 0.61, 0.01]],
        [[0, 0.77, 0.01], [0.1, 0.61, 0.01]],
      ].forEach(([edge, tip]) => flowerTriangle(centre, edge, tip))
    })
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  if (uvs.length > 0) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createMeadowGroundTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  context.fillStyle = '#687b50'
  context.fillRect(0, 0, canvas.width, canvas.height)

  // A low-contrast botanical layer prevents the flat source meadow from
  // reading as one uninterrupted green material. It deliberately stays below
  // flower-patch intensity: this is meadow ecology, not a garden pattern.
  for (let index = 0; index < 3600; index += 1) {
    const seed = seededRandom(index + 61201)
    const x = seededRandom(index + 61237) * canvas.width
    const y = seededRandom(index + 61271) * canvas.height
    const radius = 0.45 + seededRandom(index + 61307) * 2.1
    const tone = seed < 0.18
      ? `rgba(58, 84, 50, ${0.11 + seededRandom(index + 61343) * 0.13})`
      : seed > 0.82
        ? `rgba(190, 174, 112, ${0.065 + seededRandom(index + 61379) * 0.1})`
        : `rgba(142, 156, 91, ${0.08 + seededRandom(index + 61417) * 0.12})`
    context.fillStyle = tone
    context.beginPath()
    context.ellipse(x, y, radius * (1.2 + seed), radius, seed * Math.PI, 0, Math.PI * 2)
    context.fill()
  }
  for (let index = 0; index < 190; index += 1) {
    const x = seededRandom(index + 61453) * canvas.width
    const y = seededRandom(index + 61489) * canvas.height
    const radius = 4 + seededRandom(index + 61523) * 15
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, `rgba(202, 193, 126, ${0.06 + seededRandom(index + 61561) * 0.06})`)
    gradient.addColorStop(1, 'rgba(202, 193, 126, 0)')
    context.fillStyle = gradient
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.needsUpdate = true
  return texture
}

function buildMeadowGroundGeometry() {
  const rows = 58
  const bankOffsets = [6.5, 9.5, 13, 17.5, 23, 30, 38, 47, 57]
  const columns = bankOffsets.length - 1
  const positions = []
  const uvs = []
  const indices = []
  // Broad, irregular alpine terraces replace the former two 3.6m bank ribbons.
  // The same centreline and exclusion distance feed water, gravel and ecology.
  for (let sideIndex = 0; sideIndex < 2; sideIndex += 1) {
    const side = sideIndex === 0 ? -1 : 1
    const baseIndex = positions.length / 3
    for (let zIndex = 0; zIndex <= rows; zIndex += 1) {
      const depth = zIndex / rows
      const z = THREE.MathUtils.lerp(-4, -118, depth)
      const station = sampleNaturalRiverAtZ(z)
      for (let offsetIndex = 0; offsetIndex <= columns; offsetIndex += 1) {
        const bankOffset = bankOffsets[offsetIndex] +
          Math.sin(z * 0.071 + side * 1.9 + offsetIndex * 1.37) * (0.32 + offsetIndex * 0.06)
        const point = station.point.clone().addScaledVector(
          station.normal,
          side * (station.halfWidth + bankOffset),
        )
        const undulation = Math.sin(point.x * 0.095 + z * 0.058) * 0.085 +
          Math.sin(point.x * 0.036 - z * 0.091) * 0.052
        positions.push(point.x, sampleValleyMeadowHeight(point.z, side, bankOffset) + 0.035 + undulation, point.z)
        uvs.push(offsetIndex / columns * 5.2, depth * 5.8)
      }
    }
    const stride = columns + 1
    for (let zIndex = 0; zIndex < rows; zIndex += 1) {
      for (let offsetIndex = 0; offsetIndex < columns; offsetIndex += 1) {
        const a = baseIndex + zIndex * stride + offsetIndex
        const b = a + stride
        indices.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createMeadowGroundMaterial(map) {
  const uniforms = {
    uJourneyReveal: { value: 0 },
    uJourneySunset: { value: 0 },
    uJourneyNight: { value: 0 },
  }
  const material = new THREE.MeshStandardMaterial({
    map,
    color: '#91a66b',
    transparent: true,
    opacity: 0.82,
    roughness: 0.96,
    metalness: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: true,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uJourneyReveal;',
          'uniform float uJourneySunset;',
          'uniform float uJourneyNight;',
          'varying vec3 vJourneyMeadowGroundPosition;',
          'varying vec2 vJourneyMeadowGroundUv;',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          'float journeyGroundPath = clamp((-4.0 - vJourneyMeadowGroundPosition.z) / 114.0, 0.0, 1.0);',
          'float journeyGroundPatch = fract(sin(dot(floor(vJourneyMeadowGroundPosition.xz * 1.3), vec2(37.7, 91.3))) * 43758.5453);',
          'float journeyGroundBroad = clamp(0.5 +',
          '  sin(vJourneyMeadowGroundPosition.x * 0.071 + vJourneyMeadowGroundPosition.z * 0.043) * 0.27 +',
          '  sin(vJourneyMeadowGroundPosition.x * 0.029 - vJourneyMeadowGroundPosition.z * 0.081 + 1.7) * 0.23,',
          '  0.0, 1.0);',
          'float journeyGroundDepthFade = 1.0 - smoothstep(0.9, 1.0, journeyGroundPath);',
          'float journeyGroundCrossFade = smoothstep(0.0, 0.48, vJourneyMeadowGroundUv.x) *',
          '  (1.0 - smoothstep(4.5, 5.2, vJourneyMeadowGroundUv.x));',
          'diffuseColor.a *= journeyGroundDepthFade * journeyGroundCrossFade * uJourneyReveal * (1.0 - uJourneyNight * 0.6);',
          'diffuseColor.rgb *= mix(0.87, 1.07, journeyGroundPatch);',
          'diffuseColor.rgb = mix(',
          '  diffuseColor.rgb * vec3(0.8, 0.94, 0.8),',
          '  diffuseColor.rgb * vec3(1.1, 1.045, 0.81),',
          '  journeyGroundBroad',
          ');',
          'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.98, 0.82, 0.68), uJourneySunset * 0.24);',
        ].join('\n'),
      )
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vJourneyMeadowGroundPosition;\nvarying vec2 vJourneyMeadowGroundUv;',
      )
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvJourneyMeadowGroundPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvJourneyMeadowGroundUv = uv;',
      )
  }
  material.forceSinglePass = true
  material.customProgramCacheKey = () => 'journey-meadow-ground-v1'
  material.userData.journeyMeadowGroundUniforms = uniforms
  return material
}

function createMeadowMaterial(kind, alphaMap = null) {
  const uniforms = {
    uJourneyReveal: { value: 0 },
    uJourneySunset: { value: 0 },
    uJourneyNight: { value: 0 },
    uJourneyTime: { value: 0 },
    uJourneyAmbientWind: { value: 0 },
    uJourneyMotionScale: { value: 1 },
    uJourneyBladeHeightScale: { value: 1 },
    // The 320x200 planar pass keeps every blade and its ambient motion, but
    // pointer-gust micro-deformation is below its pixel footprint. Bypassing
    // that 30-slot loop there preserves the reflected meadow while removing
    // the cave-exit spike from duplicate vertex work.
    uJourneyReflectionPass: { value: 0 },
    uJourneyActiveImpulseCount: { value: 0 },
    uJourneyWindImpulse: {
      value: Array.from({ length: MEADOW_WIND_IMPULSE_COUNT }, () => new THREE.Vector4()),
    },
    uJourneyWindDirection: {
      value: Array.from({ length: MEADOW_WIND_IMPULSE_COUNT }, () => new THREE.Vector4()),
    },
  }
  const material = new THREE.MeshBasicMaterial({
    // Grass hue variation is derived from the phase attribute in the shader;
    // flowers keep authored per-instance colours.
    color: '#ffffff',
    vertexColors: kind === 'flower',
    alphaMap: kind === 'grass' ? alphaMap : null,
    transparent: true,
    opacity: kind === 'flower' ? 0.74 : 0.68,
    alphaTest: kind === 'flower' ? 0.022 : 0.085,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,
  })
  material.forceSinglePass = true
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    const bladeTip = kind === 'flower'
      ? 'clamp(transformed.y / 0.77, 0.0, 1.0)'
      : 'clamp(transformed.y, 0.0, 1.0)'
    const pointerScale = kind === 'flower' ? '0.82' : '1.48'
    const propagationDelay = kind === 'flower' ? '0.12' : '0.0'
    const nightFade = kind === 'flower' ? '0.72' : '0.58'
    const alphaMask = kind === 'flower'
      ? 'smoothstep(0.02, 0.2, vJourneyMeadowTip)'
      : 'smoothstep(0.0, 0.11, vJourneyMeadowTip)'
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute float aJourneyMeadowPhase;',
          'attribute float aJourneyMeadowStiffness;',
          'attribute float aJourneyMeadowResponseDelay;',
          'attribute float aJourneyMeadowRecovery;',
          'attribute float aJourneyMeadowMaxBend;',
          'uniform float uJourneyTime;',
          'uniform float uJourneyAmbientWind;',
          'uniform float uJourneyMotionScale;',
          'uniform float uJourneyBladeHeightScale;',
          'uniform float uJourneyReflectionPass;',
          'uniform float uJourneyActiveImpulseCount;',
          'uniform vec4 uJourneyWindImpulse[' + MEADOW_WIND_IMPULSE_COUNT + '];',
          'uniform vec4 uJourneyWindDirection[' + MEADOW_WIND_IMPULSE_COUNT + '];',
          'varying float vJourneyMeadowTip;',
          'varying float vJourneyMeadowHue;',
        ].join('\n'),
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'transformed.y *= uJourneyBladeHeightScale;',
          'float journeyBladeTip = ' + bladeTip + ';',
          'vec4 journeyBladeBase = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
          'float journeyAmbientField =',
          '  sin(uJourneyTime * 0.61 + aJourneyMeadowPhase * 7.0 + journeyBladeBase.z * 0.105) * 0.46 +',
          '  sin(uJourneyTime * 0.29 - aJourneyMeadowPhase * 13.0 + journeyBladeBase.x * 0.086 - journeyBladeBase.z * 0.031) * 0.31 +',
          '  sin(uJourneyTime * 0.87 + aJourneyMeadowPhase * 3.0 + journeyBladeBase.x * 0.025) * 0.17;',
          'vec2 journeyRawInstanceX = vec2(instanceMatrix[0].x, instanceMatrix[0].z);',
          'vec2 journeyRawInstanceZ = vec2(instanceMatrix[2].x, instanceMatrix[2].z);',
          'float journeyInstanceScaleX = max(length(journeyRawInstanceX), 0.001);',
          'float journeyInstanceScaleZ = max(length(journeyRawInstanceZ), 0.001);',
          'vec2 journeyInstanceX = journeyRawInstanceX / journeyInstanceScaleX;',
          'vec2 journeyInstanceZ = journeyRawInstanceZ / journeyInstanceScaleZ;',
          // Derive the tiny directional drift from the already-computed
          // spatial field. This keeps the meadow asynchronous without adding
          // another per-vertex trigonometric evaluation.
          'float journeyAmbientTurn = journeyAmbientField * 0.22;',
          'vec2 journeyWorldAmbient = normalize(vec2(',
          '  0.82 - journeyAmbientTurn * 0.42,',
          '  0.42 + journeyAmbientTurn * 0.82',
          '));',
          'vec2 journeyLocalAmbient = vec2(',
          '  dot(journeyWorldAmbient, journeyInstanceX),',
          '  dot(journeyWorldAmbient, journeyInstanceZ)',
          ');',
          'float journeyBroadWind = sin(',
          '  uJourneyTime * 0.48 + journeyBladeBase.z * 0.06 - journeyBladeBase.x * 0.018',
          ');',
          'float journeyAmbientPulse = 0.88 +',
          '  sin(uJourneyTime * 0.21 + journeyBladeBase.z * 0.043 - journeyBladeBase.x * 0.019 + aJourneyMeadowPhase * 1.3) * 0.12;',
          'float journeyAmbientStrength = (0.065 + uJourneyAmbientWind * 0.34 +',
          '  journeyAmbientField * 0.055 + journeyBroadWind * 0.085) * journeyAmbientPulse;',
          'vec2 journeySway = journeyLocalAmbient * max(0.016, journeyAmbientStrength) * uJourneyMotionScale;',
          'if (uJourneyReflectionPass < 0.5) {',
          'for (int journeyImpulseIndex = 0; journeyImpulseIndex < ' + MEADOW_WIND_IMPULSE_COUNT + '; journeyImpulseIndex++) {',
          '  if (float(journeyImpulseIndex) >= uJourneyActiveImpulseCount) break;',
          '  vec4 journeyImpulse = uJourneyWindImpulse[journeyImpulseIndex];',
          '  vec4 journeyDirectionAge = uJourneyWindDirection[journeyImpulseIndex];',
          '  if (journeyImpulse.w <= 0.001) continue;',
          '  vec2 journeyImpulseOffset = journeyBladeBase.xz - journeyImpulse.xy;',
          '  float journeyImpulseDistanceSquared = dot(journeyImpulseOffset, journeyImpulseOffset);',
          '  if (journeyImpulseDistanceSquared >= journeyImpulse.z * journeyImpulse.z) continue;',
          '  float journeyImpulseDistance = sqrt(journeyImpulseDistanceSquared);',
          '  float journeyPropagation = smoothstep(',
          '    journeyImpulseDistance * 0.035 + ' + propagationDelay + ',',
          '    journeyImpulseDistance * 0.035 + 0.2 + ' + propagationDelay + ',',
          '    journeyDirectionAge.z',
          '  );',
          '  float journeyFalloff = 1.0 - smoothstep(max(1.4, journeyImpulse.z * 0.32), journeyImpulse.z, journeyImpulseDistance);',
          '  vec2 journeyWorldDirection = journeyDirectionAge.xy;',
          '  vec2 journeyLocalDirection = vec2(',
          '    dot(journeyWorldDirection, journeyInstanceX),',
          '    dot(journeyWorldDirection, journeyInstanceZ)',
          '  );',
          '  float journeyImpulseActive = step(aJourneyMeadowResponseDelay, journeyDirectionAge.z);',
          '  float journeyImpulseLife = max(0.0, journeyDirectionAge.z - aJourneyMeadowResponseDelay);',
          '  float journeyImpulseAttack = smoothstep(0.0, 0.14, journeyImpulseLife);',
          '  float journeyImpulseRelease = 1.0 - smoothstep(0.55, 2.5, journeyImpulseLife);',
          '  float journeyImpulseEnvelope = journeyImpulseActive * journeyImpulseAttack * journeyImpulseRelease;',
          '  float journeyReturnLife = max(0.0, journeyImpulseLife - 0.34);',
          '  float journeyReturnGate = smoothstep(0.3, 0.48, journeyImpulseLife) *',
          '    (1.0 - smoothstep(1.9, 2.55, journeyImpulseLife));',
          '  float journeyImpulseReturn = sin(',
          '    journeyReturnLife * 4.15 + aJourneyMeadowPhase * 1.35',
          '  ) * exp(-journeyReturnLife * (1.2 + aJourneyMeadowRecovery * 0.58)) * 0.13 * journeyReturnGate;',
          '  float journeyImpulsePulse = journeyImpulse.w * (journeyImpulseEnvelope + journeyImpulseReturn);',
          '  journeySway += journeyLocalDirection * journeyFalloff * journeyPropagation * journeyImpulsePulse * ' + pointerScale + ' * uJourneyMotionScale;',
          '}',
          '}',
          'float journeyFlex = mix(1.14, 0.6, aJourneyMeadowStiffness) *',
          '  mix(0.68, 1.15, aJourneyMeadowMaxBend);',
          'journeySway *= journeyFlex;',
          'float journeyRestLean = aJourneyMeadowPhase * 6.2831853;',
          'transformed.x += sin(journeyRestLean) * journeyBladeTip * journeyBladeTip * 0.045;',
          'transformed.z += cos(journeyRestLean) * journeyBladeTip * journeyBladeTip * 0.025;',
          'transformed.x += journeySway.x * journeyBladeTip * journeyBladeTip * journeyBladeTip;',
          'transformed.z += journeySway.y * journeyBladeTip * journeyBladeTip * 0.42;',
          'vJourneyMeadowTip = journeyBladeTip;',
          'vJourneyMeadowHue = fract(aJourneyMeadowPhase * 17.31);',
        ].join('\n'),
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float uJourneyReveal;',
          'uniform float uJourneySunset;',
          'uniform float uJourneyNight;',
          'varying float vJourneyMeadowTip;',
          'varying float vJourneyMeadowHue;',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          kind === 'flower'
            ? 'diffuseColor.rgb = mix(vec3(0.84, 0.86, 0.57), diffuseColor.rgb, smoothstep(0.7, 0.84, vJourneyMeadowTip));'
            : [
                'vec3 journeyMeadowCool = vec3(0.13, 0.255, 0.075);',
                'vec3 journeyMeadowFresh = vec3(0.215, 0.355, 0.105);',
                'vec3 journeyMeadowSunlit = vec3(0.305, 0.425, 0.13);',
                'vec3 journeyMeadowHue = mix(journeyMeadowCool, journeyMeadowFresh, smoothstep(0.08, 0.72, vJourneyMeadowHue));',
                'journeyMeadowHue = mix(journeyMeadowHue, journeyMeadowSunlit, smoothstep(0.76, 0.98, vJourneyMeadowHue) * 0.46);',
                'diffuseColor.rgb = mix(journeyMeadowHue * vec3(0.9, 0.95, 0.8), journeyMeadowHue * vec3(1.2, 1.16, 0.93), vJourneyMeadowTip);',
              ].join('\n'),
          'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.82, 0.62), uJourneySunset * 0.34);',
          'diffuseColor.a *= uJourneyReveal * (1.0 - uJourneyNight * ' + nightFade + ') * ' + alphaMask + ';',
        ].join('\n'),
      )
  }
  material.customProgramCacheKey = () => 'journey-meadow-' + kind + '-v13-mobile-presence'
  material.userData.journeyMeadowUniforms = uniforms
  return material
}

function createMeadowPetalTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = 'rgba(255, 250, 226, 1)'
  for (let index = 0; index < 5; index += 1) {
    const angle = index * (Math.PI * 2 / 5)
    context.beginPath()
    context.ellipse(
      32 + Math.cos(angle) * 9,
      32 + Math.sin(angle) * 9,
      8,
      5,
      angle,
      0,
      Math.PI * 2,
    )
    context.fill()
  }
  context.fillStyle = '#d6b75e'
  context.beginPath()
  context.arc(32, 32, 4, 0, Math.PI * 2)
  context.fill()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

function createMeadowPetalMaterial(texture, windUniforms) {
  const material = new THREE.PointsMaterial({
    map: texture,
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    alphaTest: 0.055,
    size: 0.75,
    sizeAttenuation: true,
    depthWrite: false,
    depthTest: true,
    fog: true,
    toneMapped: false,
  })
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, windUniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
	attribute float aJourneyMeadowPhase;
	attribute float aJourneyMeadowStiffness;
	attribute float aJourneyMeadowResponseDelay;
	attribute float aJourneyMeadowRecovery;
	attribute float aJourneyMeadowMaxBend;
	attribute float aJourneyMeadowScale;
	uniform float uJourneyTime;
	uniform float uJourneyAmbientWind;
uniform float uJourneyMotionScale;
uniform float uJourneyReflectionPass;
uniform float uJourneyActiveImpulseCount;
uniform vec4 uJourneyWindImpulse[${MEADOW_WIND_IMPULSE_COUNT}];
uniform vec4 uJourneyWindDirection[${MEADOW_WIND_IMPULSE_COUNT}];`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 journeyPetalBase = modelMatrix * vec4(position, 1.0);
float journeyPetalField =
  sin(uJourneyTime * 0.61 + aJourneyMeadowPhase * 7.0 + journeyPetalBase.z * 0.105) * 0.46 +
  sin(uJourneyTime * 0.29 - aJourneyMeadowPhase * 13.0 + journeyPetalBase.x * 0.086 - journeyPetalBase.z * 0.031) * 0.31 +
  sin(uJourneyTime * 0.87 + aJourneyMeadowPhase * 3.0 + journeyPetalBase.x * 0.025) * 0.17;
float journeyPetalTurn = journeyPetalField * 0.22;
vec2 journeyPetalAmbientDirection = normalize(vec2(
  0.82 - journeyPetalTurn * 0.42,
  0.42 + journeyPetalTurn * 0.82
));
float journeyPetalBroadWind = sin(
  uJourneyTime * 0.48 + journeyPetalBase.z * 0.06 - journeyPetalBase.x * 0.018
);
float journeyPetalAmbientPulse = 0.88 +
  sin(uJourneyTime * 0.21 + journeyPetalBase.z * 0.043 - journeyPetalBase.x * 0.019 + aJourneyMeadowPhase * 1.3) * 0.12;
float journeyPetalAmbientStrength = (0.065 + uJourneyAmbientWind * 0.34 +
  journeyPetalField * 0.055 + journeyPetalBroadWind * 0.085) * journeyPetalAmbientPulse;
	vec2 journeyPetalSway = journeyPetalAmbientDirection *
	  max(0.016, journeyPetalAmbientStrength) * uJourneyMotionScale;
	if (uJourneyReflectionPass < 0.5) {
	for (int journeyImpulseIndex = 0; journeyImpulseIndex < ${MEADOW_WIND_IMPULSE_COUNT}; journeyImpulseIndex++) {
	  if (float(journeyImpulseIndex) >= uJourneyActiveImpulseCount) break;
	  vec4 journeyImpulse = uJourneyWindImpulse[journeyImpulseIndex];
  vec4 journeyDirectionAge = uJourneyWindDirection[journeyImpulseIndex];
  if (journeyImpulse.w <= 0.001) continue;
  vec2 journeyPetalOffset = journeyPetalBase.xz - journeyImpulse.xy;
  float journeyPetalDistanceSquared = dot(journeyPetalOffset, journeyPetalOffset);
  if (journeyPetalDistanceSquared >= journeyImpulse.z * journeyImpulse.z) continue;
  float journeyPetalDistance = sqrt(journeyPetalDistanceSquared);
  float journeyPropagation = smoothstep(
    journeyPetalDistance * 0.035 + 0.12,
    journeyPetalDistance * 0.035 + 0.32,
    journeyDirectionAge.z
  );
  float journeyFalloff = 1.0 - smoothstep(
    max(1.4, journeyImpulse.z * 0.32),
	    journeyImpulse.z,
	    journeyPetalDistance
	  );
	  float journeyImpulseActive = step(aJourneyMeadowResponseDelay, journeyDirectionAge.z);
	  float journeyImpulseLife = max(0.0, journeyDirectionAge.z - aJourneyMeadowResponseDelay);
	  float journeyImpulseAttack = smoothstep(0.0, 0.14, journeyImpulseLife);
	  float journeyImpulseRelease = 1.0 - smoothstep(0.55, 2.5, journeyImpulseLife);
	  float journeyImpulseEnvelope = journeyImpulseActive * journeyImpulseAttack * journeyImpulseRelease;
	  float journeyReturnLife = max(0.0, journeyImpulseLife - 0.34);
	  float journeyReturnGate = smoothstep(0.3, 0.48, journeyImpulseLife) *
	    (1.0 - smoothstep(1.9, 2.55, journeyImpulseLife));
	  float journeyImpulseReturn = sin(
	    journeyReturnLife * 4.15 + aJourneyMeadowPhase * 1.35
	  ) * exp(-journeyReturnLife * (1.2 + aJourneyMeadowRecovery * 0.58)) * 0.13 * journeyReturnGate;
	  float journeyImpulsePulse = journeyImpulse.w * (journeyImpulseEnvelope + journeyImpulseReturn);
	  journeyPetalSway += journeyDirectionAge.xy * journeyFalloff * journeyPropagation * journeyImpulsePulse * 0.6 * uJourneyMotionScale;
	}
	}
	float journeyPetalFlex = mix(1.14, 0.6, aJourneyMeadowStiffness) *
	  mix(0.68, 1.15, aJourneyMeadowMaxBend);
	journeyPetalSway *= journeyPetalFlex * aJourneyMeadowScale;
	transformed.x += journeyPetalSway.x;
	transformed.z += journeyPetalSway.y * 0.42;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uJourneyReveal;
uniform float uJourneySunset;
uniform float uJourneyNight;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 0.82, 0.62), uJourneySunset * 0.34);
diffuseColor.a *= uJourneyReveal * (1.0 - uJourneyNight * 0.72);`,
      )
  }
	material.customProgramCacheKey = () => 'journey-meadow-petals-v8-broad-idle-wind'
  return material
}

function attachMeadowResponseAttributes(geometry, items, { instanced = true, includeScale = false } = {}) {
  const Attribute = instanced ? THREE.InstancedBufferAttribute : THREE.BufferAttribute
  const setAttribute = (name, property, fallback) => {
    geometry.setAttribute(
      name,
      new Attribute(
        new Float32Array(items.map((item) => item[property] ?? fallback)),
        1,
      ),
    )
  }
  setAttribute('aJourneyMeadowPhase', 'phase', 0)
  setAttribute('aJourneyMeadowStiffness', 'stiffness', 0.5)
  setAttribute('aJourneyMeadowResponseDelay', 'responseDelay', 0)
  setAttribute('aJourneyMeadowRecovery', 'recovery', 0.5)
  setAttribute('aJourneyMeadowMaxBend', 'maxBend', 0.5)
  if (includeScale) setAttribute('aJourneyMeadowScale', 'scale', 1)
  return geometry
}

function buildMeadowSeeds() {
  const grassPalette = [
    new THREE.Color('#8eae62'),
    new THREE.Color('#b1c879'),
    new THREE.Color('#d0ce83'),
  ]
  const buildGrassBand = ({ count, nearZ, farZ, seed, height, width }) => {
    const items = []
    for (let attempt = 0; items.length < count && attempt < count * 8; attempt += 1) {
      const depth = Math.pow(seededRandom(attempt + seed), 1.1)
      const z = THREE.MathUtils.lerp(nearZ, farZ, depth)
      const side = seededRandom(attempt + seed + 37) < 0.5 ? -1 : 1
      const sceneDepth = clamp01((-z - 2) / 114)
      const maximumBank = THREE.MathUtils.lerp(62, 44, sceneDepth)
      const bank = THREE.MathUtils.lerp(
        5.2,
        maximumBank,
        Math.pow(seededRandom(attempt + seed + 71), 0.82),
      )
      const macroPatch = clamp01(
        0.48 +
        Math.sin(z * 0.105 + bank * 0.081 + side * 1.7) * 0.27 +
        Math.sin(z * 0.038 - bank * 0.194 - side * 0.9) * 0.24,
      )
      const moisture = 1 - smoothstep(9, 34, bank)
      const bareGap = Math.max(
        Math.exp(-Math.pow((z + 20 + side * 4) / 7.5, 2)) *
          Math.exp(-Math.pow((bank - 40) / 8.5, 2)),
        Math.exp(-Math.pow((z + 53 - side * 5) / 9.5, 2)) *
          Math.exp(-Math.pow((bank - 22) / 7.5, 2)),
      )
      const density = clamp01(0.2 + macroPatch * 0.58 + moisture * 0.16 - bareGap * 0.76)
      if (seededRandom(attempt + seed + 109) > density) continue
      const station = sampleNaturalRiverAtZ(z)
      const point = station.point.clone().addScaledVector(
        station.normal,
        side * (station.halfWidth + bank),
      )
      const tone = seededRandom(attempt + seed + 149)
      items.push({
        position: [point.x, sampleValleyMeadowHeight(point.z, side, bank) + 0.035, point.z],
        width: THREE.MathUtils.lerp(width[0], width[1], seededRandom(attempt + seed + 181)),
        height: THREE.MathUtils.lerp(height[0], height[1], seededRandom(attempt + seed + 211)) *
          THREE.MathUtils.lerp(1.08, 0.88, depth),
        phase: seededRandom(attempt + seed + 251),
        stiffness: THREE.MathUtils.lerp(0.12, 0.94, seededRandom(attempt + seed + 283)),
        responseDelay: THREE.MathUtils.lerp(0, 0.18, seededRandom(attempt + seed + 313)),
        recovery: THREE.MathUtils.lerp(0.18, 1.12, seededRandom(attempt + seed + 345)),
        maxBend: THREE.MathUtils.lerp(0.16, 1, seededRandom(attempt + seed + 377)),
        color: grassPalette[0].clone()
          .lerp(grassPalette[1], smoothstep(0.06, 0.72, tone))
          .lerp(grassPalette[2], Math.max(0, tone - 0.72) * 0.5 + moisture * 0.06),
      })
    }
    return items
  }
  const nearGrass = buildGrassBand({
    count: 13200,
    nearZ: -2,
    farZ: -43,
    seed: 47001,
    height: [0.78, 1.45],
    width: [0.22, 0.64],
  })
  const midGrass = buildGrassBand({
    count: 6200,
    nearZ: -38,
    farZ: -88,
    seed: 61001,
    height: [0.52, 1.02],
    width: [0.16, 0.38],
  })
  const foregroundGrass = buildGrassBand({
    count: 5200,
    nearZ: -2,
    farZ: -23,
    seed: 73001,
    height: [1.05, 1.66],
    width: [0.23, 0.66],
  })

  const flowerPalette = [
    '#f3eedb', '#e9dda6', '#b7cae4', '#a99bc9', '#d8aeb5',
  ].map((color) => new THREE.Color(color))
  const clusters = [
    { z: -10, side: -1, bank: 15, radiusZ: 10, radiusBank: 9, count: 68 },
    { z: -12, side: 1, bank: 18, radiusZ: 11, radiusBank: 10, count: 54 },
    { z: -29, side: -1, bank: 18, radiusZ: 14, radiusBank: 12, count: 38 },
    { z: -47, side: -1, bank: 17, radiusZ: 17, radiusBank: 10, count: 56 },
    { z: -72, side: -1, bank: 18, radiusZ: 15, radiusBank: 10, count: 40 },
    { z: -18, side: -1, bank: 28, radiusZ: 18, radiusBank: 20, count: 68 },
    { z: -18, side: 1, bank: 30, radiusZ: 18, radiusBank: 22, count: 56 },
    { z: -48, side: -1, bank: 38, radiusZ: 20, radiusBank: 19, count: 48 },
    { z: -45, side: 1, bank: 32, radiusZ: 18, radiusBank: 18, count: 50 },
    { z: -75, side: 1, bank: 27, radiusZ: 16, radiusBank: 15, count: 34 },
    { z: -88, side: -1, bank: 24, radiusZ: 14, radiusBank: 13, count: 24 },
  ]
  const flowers = []
  let flowerIndex = 0
  clusters.forEach((cluster, clusterIndex) => {
    for (let index = 0; index < cluster.count; index += 1) {
      const radial = Math.pow(seededRandom(flowerIndex + 52101), 0.58)
      const angle = seededRandom(flowerIndex + 52139) * Math.PI * 2
      const z = THREE.MathUtils.clamp(
        cluster.z + Math.sin(angle) * cluster.radiusZ * radial,
        -112,
        -3,
      )
      const bank = Math.max(8, cluster.bank + Math.cos(angle) * cluster.radiusBank * radial)
      const station = sampleNaturalRiverAtZ(z)
      const point = station.point.clone().addScaledVector(
        station.normal,
        cluster.side * (station.halfWidth + bank),
      )
      const paletteSeed = seededRandom(flowerIndex + 52211)
      const paletteIndex = paletteSeed < 0.39 ? 0 : paletteSeed < 0.67 ? 1 : paletteSeed < 0.82 ? 2 : paletteSeed < 0.96 ? 3 : 4
      const depth = clamp01((-z - 2) / 114)
      flowers.push({
        position: [point.x, sampleValleyMeadowHeight(point.z, cluster.side, bank) + 0.055, point.z],
        scale: THREE.MathUtils.lerp(0.76, 1.14, seededRandom(flowerIndex + 52247)) * THREE.MathUtils.lerp(1, 0.68, depth),
        phase: seededRandom(flowerIndex + 52283) + clusterIndex * 0.07,
        stiffness: THREE.MathUtils.lerp(0.28, 0.88, seededRandom(flowerIndex + 52297)),
        responseDelay: THREE.MathUtils.lerp(0, 0.12, seededRandom(flowerIndex + 52325)),
        recovery: THREE.MathUtils.lerp(0.22, 0.78, seededRandom(flowerIndex + 52357)),
        maxBend: THREE.MathUtils.lerp(0.08, 0.42, seededRandom(flowerIndex + 52389)),
        color: flowerPalette[paletteIndex].clone(),
        order: seededRandom(flowerIndex + 52307),
      })
      flowerIndex += 1
    }
  })
  flowers.sort((left, right) => left.order - right.order)
  return { nearGrass, midGrass, foregroundGrass, flowers }
}

function ValleyMeadow({
  diagnostics = {},
  portraitFactor = 0,
  progress,
  travelWindRef,
  qualityScale = 1,
}) {
  const groundRef = useRef(null)
  const nearGrassRef = useRef(null)
  const midGrassRef = useRef(null)
  const foregroundGrassRef = useRef(null)
  const flowerRef = useRef(null)
  const flowerPointsRef = useRef(null)
  const seeds = useMemo(() => buildMeadowSeeds(), [])
  const groundGeometry = useMemo(() => buildMeadowGroundGeometry(), [])
  const groundTexture = useMemo(() => createMeadowGroundTexture(), [])
  const groundMaterial = useMemo(() => createMeadowGroundMaterial(groundTexture), [groundTexture])
  const nearGrassCount = Math.max(1, Math.floor(seeds.nearGrass.length * qualityScale))
  const midGrassCount = Math.max(1, Math.floor(seeds.midGrass.length * qualityScale))
  const foregroundGrassCount = Math.max(1, Math.floor(seeds.foregroundGrass.length * qualityScale))
  const flowerCount = Math.max(1, Math.floor(Math.min(seeds.flowers.length, 240) * qualityScale))
  const flowerStemCount = Math.max(1, Math.floor(flowerCount * 0.18))
  const nearGrassGeometry = useMemo(
    () => attachMeadowResponseAttributes(createMeadowBladeGeometry('grass'), seeds.nearGrass),
    [seeds],
  )
  const midGrassGeometry = useMemo(
    () => attachMeadowResponseAttributes(createMeadowBladeGeometry('grass'), seeds.midGrass),
    [seeds],
  )
  const foregroundGrassGeometry = useMemo(
    () => attachMeadowResponseAttributes(createMeadowBladeGeometry('grass'), seeds.foregroundGrass),
    [seeds],
  )
  const grassMaterial = useMemo(
    () => createMeadowMaterial('grass'),
    [],
  )
  const flowerGeometry = useMemo(
    () => attachMeadowResponseAttributes(createMeadowBladeGeometry('flower'), seeds.flowers),
    [seeds],
  )
  const flowerMaterial = useMemo(() => createMeadowMaterial('flower'), [])
  const flowerPointTexture = useMemo(() => createMeadowPetalTexture(), [])
  const flowerPointGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    const positions = new Float32Array(seeds.flowers.length * 3)
    const colors = new Float32Array(seeds.flowers.length * 3)
    seeds.flowers.forEach((item, index) => {
      positions.set([
        item.position[0],
        item.position[1] + item.scale * 0.72,
        item.position[2],
      ], index * 3)
      colors.set([item.color.r, item.color.g, item.color.b], index * 3)
    })
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    attachMeadowResponseAttributes(geometry, seeds.flowers, {
      instanced: false,
      includeScale: true,
    })
    geometry.computeBoundingSphere()
    return geometry
  }, [seeds])
  const flowerPointMaterial = useMemo(
    () => createMeadowPetalMaterial(
      flowerPointTexture,
      flowerMaterial.userData.journeyMeadowUniforms,
    ),
    [flowerMaterial, flowerPointTexture],
  )
  const pointerPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.32), [])
  const meadowRaycaster = useMemo(() => new THREE.Raycaster(), [])
  const gustSequenceRef = useRef(0)
  const impulseScratch = useMemo(() => ({
    ndc: new THREE.Vector2(),
    hit: new THREE.Vector3(),
    previousScreen: new THREE.Vector2(),
    screenVelocity: new THREE.Vector2(),
    right: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    direction: new THREE.Vector2(),
    acceptedDirection: new THREE.Vector2(1, 0),
    reversalDirection: new THREE.Vector2(1, 0),
    acceptedDirectionInitialized: false,
    initialized: false,
    time: 0,
    lastEmissionTime: -Infinity,
    reversalStartedAt: -Infinity,
    pointerEvents: 0,
    lastPointerStage: 'idle',
    lastPointerSpeed: 0,
    lastPointerHit: new THREE.Vector3(),
  }), [])
  const windImpulses = useMemo(
    () => Array.from({ length: MEADOW_WIND_IMPULSE_COUNT }, () => ({
      id: 0,
      origin: new THREE.Vector2(0, -80),
      direction: new THREE.Vector2(1, 0),
      strength: 0,
      radius: 1,
      age: 99,
      travelled: 0,
    })),
    [],
  )
  const reduceMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const windDebugEnabled = useMemo(
    () => new URLSearchParams(window.location.search).get('windDebug') === '1',
    [],
  )
  const windRuntimeRef = useRef({
    ambient: 0,
    activeGusts: 0,
    strongestGust: 0,
  })
  const { camera, gl } = useThree()

  useEffect(() => {
    const activeGustRemains = () => windImpulses.some(
      (impulse) => impulse.strength > 0 && impulse.age < MEADOW_WIND_MAX_AGE,
    )
    const resetPointerSample = () => {
      impulseScratch.initialized = false
      // Losing a velocity sample must not erase the physical wind that is
      // still crossing the meadow. Keep its accepted heading until all gusts
      // have decayed, so pause-then-reverse cannot bypass hysteresis.
      if (!activeGustRemains()) impulseScratch.acceptedDirectionInitialized = false
      impulseScratch.reversalStartedAt = -Infinity
    }
    const onPointerMove = (event) => {
      impulseScratch.pointerEvents += 1
      if (reduceMotion || event.pointerType === 'touch') {
        impulseScratch.lastPointerStage = reduceMotion ? 'reduced-motion' : 'touch'
        return
      }
      const bounds = gl.domElement.getBoundingClientRect()
      if (
        event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom
      ) {
        impulseScratch.lastPointerStage = 'outside-canvas'
        return
      }
      const scratch = impulseScratch
      const now = event.timeStamp * 0.001
      if (!scratch.initialized || now - scratch.time > MEADOW_WIND_POINTER_PAUSE_RESET) {
        scratch.previousScreen.set(event.clientX, event.clientY)
        scratch.time = now
        scratch.initialized = true
        if (!activeGustRemains()) scratch.acceptedDirectionInitialized = false
        scratch.reversalStartedAt = -Infinity
        scratch.lastPointerStage = 'sample-reset'
        return
      }
      const elapsed = Math.max(1 / 180, Math.min(0.12, now - scratch.time))
      scratch.screenVelocity.set(
        (event.clientX - scratch.previousScreen.x) / Math.max(bounds.width, 1),
        (event.clientY - scratch.previousScreen.y) / Math.max(bounds.height, 1),
      ).multiplyScalar(1 / elapsed)
      scratch.previousScreen.set(event.clientX, event.clientY)
      scratch.time = now
      const speed = scratch.screenVelocity.length()
      scratch.lastPointerSpeed = speed
      if (speed < 0.11) {
        scratch.lastPointerStage = 'below-speed'
        return
      }
      scratch.ndc.set(
        ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1,
        -((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2 + 1,
      )
      meadowRaycaster.setFromCamera(scratch.ndc, camera)
      if (!meadowRaycaster.ray.intersectPlane(pointerPlane, scratch.hit)) {
        scratch.lastPointerStage = 'ray-miss'
        return
      }
      scratch.lastPointerHit.copy(scratch.hit)
      if (scratch.hit.z > 12 || scratch.hit.z < -126 || Math.abs(scratch.hit.x) > 105) {
        scratch.lastPointerStage = 'outside-meadow'
        return
      }
      scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion).setY(0).normalize()
      scratch.forward.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0).normalize()
      scratch.direction.set(
        scratch.right.x * scratch.screenVelocity.x - scratch.forward.x * scratch.screenVelocity.y,
        scratch.right.z * scratch.screenVelocity.x - scratch.forward.z * scratch.screenVelocity.y,
      )
      if (scratch.direction.lengthSq() < 0.0001) {
        scratch.lastPointerStage = 'direction-zero'
        return
      }
      scratch.direction.normalize()

      if (!scratch.acceptedDirectionInitialized) {
        scratch.acceptedDirection.copy(scratch.direction)
        scratch.acceptedDirectionInitialized = true
      } else {
        const directionAgreement = scratch.acceptedDirection.dot(scratch.direction)
        if (directionAgreement < -0.25) {
          const reversalChanged = scratch.reversalStartedAt === -Infinity ||
            scratch.reversalDirection.dot(scratch.direction) < 0.45
          if (reversalChanged) {
            scratch.reversalDirection.copy(scratch.direction)
            scratch.reversalStartedAt = now
          } else {
            scratch.reversalDirection.lerp(scratch.direction, 0.22).normalize()
          }
          if (now - scratch.reversalStartedAt < MEADOW_WIND_REVERSAL_HOLD) {
            scratch.lastPointerStage = 'reversal-hold'
            return
          }
          scratch.acceptedDirection.copy(scratch.reversalDirection).normalize()
          scratch.reversalStartedAt = -Infinity
        } else {
          scratch.reversalStartedAt = -Infinity
          scratch.acceptedDirection
            .lerp(scratch.direction, directionAgreement > 0.72 ? 0.28 : 0.14)
            .normalize()
        }
      }
      if (now - scratch.lastEmissionTime < MEADOW_WIND_EMIT_INTERVAL) {
        scratch.lastPointerStage = 'emission-cadence'
        return
      }

      const slot = windImpulses.find((impulse) => impulse.strength <= 0) ??
        windImpulses.reduce((oldest, impulse) => impulse.age > oldest.age ? impulse : oldest)
      gustSequenceRef.current += 1
      slot.id = gustSequenceRef.current
      slot.origin.set(scratch.hit.x, scratch.hit.z)
      // Direction is immutable for this gust. Later pointer events can only
      // create a new gust after cadence/hysteresis; they never turn this one.
      slot.direction.copy(scratch.acceptedDirection)
      slot.strength = THREE.MathUtils.clamp(speed * 3.6, 0.28, 1.3)
      slot.radius = 5.4
      slot.age = 0
      slot.travelled = 0
      scratch.lastEmissionTime = now
      scratch.lastPointerStage = 'emitted'
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('blur', resetPointerSample)
    gl.domElement.addEventListener('pointerleave', resetPointerSample)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('blur', resetPointerSample)
      gl.domElement.removeEventListener('pointerleave', resetPointerSample)
    }
  }, [camera, gl, impulseScratch, meadowRaycaster, pointerPlane, reduceMotion, windImpulses])

  useEffect(() => {
    if (!windDebugEnabled) return undefined
    const debugState = {
      constants: {
        emitInterval: MEADOW_WIND_EMIT_INTERVAL,
        reversalHold: MEADOW_WIND_REVERSAL_HOLD,
        pauseReset: MEADOW_WIND_POINTER_PAUSE_RESET,
        maxAge: MEADOW_WIND_MAX_AGE,
      },
      getSnapshot: () => ({
        ambient: windRuntimeRef.current.ambient,
        activeGusts: windRuntimeRef.current.activeGusts,
        strongestGust: windRuntimeRef.current.strongestGust,
        pointerEvents: impulseScratch.pointerEvents,
        lastPointerStage: impulseScratch.lastPointerStage,
        lastPointerSpeed: impulseScratch.lastPointerSpeed,
        lastPointerHit: impulseScratch.lastPointerHit.toArray(),
        acceptedDirection: impulseScratch.acceptedDirection.toArray(),
        acceptedDirectionInitialized: impulseScratch.acceptedDirectionInitialized,
        reversalElapsed: impulseScratch.reversalStartedAt === -Infinity
          ? 0
          : Math.max(0, impulseScratch.time - impulseScratch.reversalStartedAt),
        gusts: windImpulses
          .filter((impulse) => impulse.strength > 0)
          .map((impulse) => ({
            id: impulse.id,
            age: impulse.age,
            direction: impulse.direction.toArray(),
            origin: impulse.origin.toArray(),
            radius: impulse.radius,
            strength: impulse.strength,
            travelled: impulse.travelled,
          })),
      }),
    }
    window.__JOURNEY_V1_WIND__ = debugState
    document.documentElement.dataset.journeyWindConstants = JSON.stringify(debugState.constants)
    return () => {
      if (window.__JOURNEY_V1_WIND__ === debugState) delete window.__JOURNEY_V1_WIND__
      delete document.documentElement.dataset.journeyWindConstants
      delete document.documentElement.dataset.journeyWindSnapshot
      delete document.documentElement.dataset.journeyAmbientWind
      delete document.documentElement.dataset.journeyActiveGusts
      delete document.documentElement.dataset.journeyStrongestGust
    }
  }, [impulseScratch, windDebugEnabled, windImpulses])

  useLayoutEffect(() => {
    const writeInstances = (mesh, items, count, flower = false) => {
      if (!mesh) return
      const matrix = new THREE.Matrix4()
      const position = new THREE.Vector3()
      const scale = new THREE.Vector3()
      const color = new THREE.Color()
      const rotation = new THREE.Quaternion()
      items.slice(0, Math.min(mesh.count, count)).forEach((item, index) => {
        position.set(...item.position)
        if (flower) scale.setScalar(item.scale)
        else scale.set(item.width, item.height, 1)
        // A three-blade tuft needs a broad visual orientation; avoid
        // edge-on cards that collapse into dark stakes at the riverbank.
        rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), item.phase * Math.PI * 2)
        matrix.compose(position, rotation, scale)
        mesh.setMatrixAt(index, matrix)
        if (flower) {
          color.copy(item.color)
          mesh.setColorAt(index, color)
        }
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.material.needsUpdate = true
    }
    writeInstances(nearGrassRef.current, seeds.nearGrass, nearGrassCount)
    writeInstances(midGrassRef.current, seeds.midGrass, midGrassCount)
    writeInstances(foregroundGrassRef.current, seeds.foregroundGrass, foregroundGrassCount)
    writeInstances(flowerRef.current, seeds.flowers, flowerStemCount, true)
    flowerPointGeometry.setDrawRange(0, flowerCount)
  }, [flowerCount, flowerPointGeometry, flowerStemCount, foregroundGrassCount, midGrassCount, nearGrassCount, seeds])

  useEffect(() => () => {
    groundGeometry.dispose()
    groundTexture.dispose()
    groundMaterial.dispose()
    nearGrassGeometry.dispose()
    midGrassGeometry.dispose()
    foregroundGrassGeometry.dispose()
    grassMaterial.dispose()
    flowerGeometry.dispose()
    flowerMaterial.dispose()
    flowerPointGeometry.dispose()
    flowerPointMaterial.dispose()
    flowerPointTexture.dispose()
  }, [flowerGeometry, flowerMaterial, flowerPointGeometry, flowerPointMaterial, flowerPointTexture, foregroundGrassGeometry, grassMaterial, groundGeometry, groundMaterial, groundTexture, midGrassGeometry, nearGrassGeometry])

  useFrame((state, delta) => {
    const reveal = getJourneyValleyDetailPresence(progress)
    const groundReveal = getJourneyValleyGroundPresence(progress)
    const {
      dayWeight,
      sunsetWeight: sunset,
      nightWeight: night,
    } = getJourneyTimeOfDay(progress)
    const windDelta = Math.min(delta, 0.05)
    windImpulses.forEach((impulse) => {
      if (impulse.strength <= 0) return
      impulse.age += windDelta
      const advection = windDelta * (6.4 + impulse.strength * 3.2)
      impulse.origin.addScaledVector(impulse.direction, advection)
      impulse.travelled += advection
      impulse.radius = Math.min(20, impulse.radius + windDelta * 9.6)
      impulse.strength *= Math.exp(-windDelta * 0.72)
      if (impulse.age >= MEADOW_WIND_MAX_AGE || impulse.strength < 0.006) impulse.strength = 0
    })
    if (windDebugEnabled) {
      document.documentElement.dataset.journeyWindSnapshot = JSON.stringify({
        pointerEvents: impulseScratch.pointerEvents,
        lastPointerStage: impulseScratch.lastPointerStage,
        lastPointerSpeed: impulseScratch.lastPointerSpeed,
        lastPointerHit: impulseScratch.lastPointerHit.toArray(),
        acceptedDirection: impulseScratch.acceptedDirection.toArray(),
        acceptedDirectionInitialized: impulseScratch.acceptedDirectionInitialized,
        reversalElapsed: impulseScratch.reversalStartedAt === -Infinity
          ? 0
          : Math.max(0, impulseScratch.time - impulseScratch.reversalStartedAt),
        gusts: windImpulses
          .filter((impulse) => impulse.strength > 0)
          .map((impulse) => ({
            id: impulse.id,
            age: impulse.age,
            direction: impulse.direction.toArray(),
            origin: impulse.origin.toArray(),
            radius: impulse.radius,
            strength: impulse.strength,
            travelled: impulse.travelled,
          })),
      })
    }
    let frameAmbientWind = 0
    let frameActiveGusts = 0
    let frameStrongestGust = 0
    ;[grassMaterial, flowerMaterial].forEach((material, materialIndex) => {
      const uniforms = material.userData.journeyMeadowUniforms
      uniforms.uJourneyReveal.value = reveal
      uniforms.uJourneySunset.value = sunset
      uniforms.uJourneyNight.value = night
      uniforms.uJourneyTime.value = state.clock.elapsedTime
      const timeOfDayWind =
        dayWeight * 0.36 +
        sunset * (0.4 + Math.sin(state.clock.elapsedTime * 0.17) * 0.022) +
        night * 0.25
      uniforms.uJourneyAmbientWind.value = reduceMotion
        ? 0
        : travelWindRef.current * 0.6 + timeOfDayWind
      if (materialIndex === 0) frameAmbientWind = uniforms.uJourneyAmbientWind.value
      uniforms.uJourneyMotionScale.value = reduceMotion || diagnostics.wind ? 0 : 1
      uniforms.uJourneyBladeHeightScale.value = materialIndex === 0
        ? THREE.MathUtils.lerp(1, MOBILE_JOURNEY_COMPOSITION.grassHeightScale, portraitFactor)
        : 1
      let activeImpulseCount = 0
      windImpulses.forEach((impulse) => {
        if (impulse.strength <= 0.001) return
        if (materialIndex === 0) {
          frameActiveGusts += 1
          frameStrongestGust = Math.max(frameStrongestGust, impulse.strength)
        }
        uniforms.uJourneyWindImpulse.value[activeImpulseCount].set(
          impulse.origin.x,
          impulse.origin.y,
          impulse.radius,
          impulse.strength,
        )
        uniforms.uJourneyWindDirection.value[activeImpulseCount].set(
          impulse.direction.x,
          impulse.direction.y,
          impulse.age,
          0,
        )
        activeImpulseCount += 1
      })
      uniforms.uJourneyActiveImpulseCount.value = activeImpulseCount
      for (let index = activeImpulseCount; index < MEADOW_WIND_IMPULSE_COUNT; index += 1) {
        uniforms.uJourneyWindImpulse.value[index].w = 0
      }
    })
    windRuntimeRef.current.ambient = frameAmbientWind
    windRuntimeRef.current.activeGusts = frameActiveGusts
    windRuntimeRef.current.strongestGust = frameStrongestGust
    if (windDebugEnabled) {
      document.documentElement.dataset.journeyAmbientWind = frameAmbientWind.toFixed(6)
      document.documentElement.dataset.journeyActiveGusts = String(frameActiveGusts)
      document.documentElement.dataset.journeyStrongestGust = frameStrongestGust.toFixed(6)
    }
    const groundUniforms = groundMaterial.userData.journeyMeadowGroundUniforms
    groundUniforms.uJourneyReveal.value = groundReveal
    groundUniforms.uJourneyNight.value = night
    groundUniforms.uJourneySunset.value = sunset
    if (groundRef.current) groundRef.current.visible = groundReveal > 0.01
    if (nearGrassRef.current) nearGrassRef.current.visible = reveal > 0.01 && !diagnostics.grass
    if (midGrassRef.current) midGrassRef.current.visible = reveal > 0.01 && !diagnostics.grass
    if (foregroundGrassRef.current) {
      foregroundGrassRef.current.visible = reveal > 0.01 && !diagnostics.grass
    }
    if (flowerRef.current) flowerRef.current.visible = reveal > 0.01 && !diagnostics.flowers
    if (flowerPointsRef.current) {
      flowerPointsRef.current.visible = reveal > 0.01 && !diagnostics.flowers
    }
  })

  return (
    <group name="JOURNEY_V1_VALLEY_MEADOW" renderOrder={3}>
      <mesh ref={groundRef} geometry={groundGeometry} material={groundMaterial} renderOrder={2} frustumCulled={false} />
      <instancedMesh ref={nearGrassRef} args={[nearGrassGeometry, grassMaterial, nearGrassCount]} renderOrder={7} frustumCulled={false} />
      <instancedMesh ref={midGrassRef} args={[midGrassGeometry, grassMaterial, midGrassCount]} renderOrder={7} frustumCulled={false} />
      <instancedMesh ref={foregroundGrassRef} args={[foregroundGrassGeometry, grassMaterial, foregroundGrassCount]} renderOrder={7} frustumCulled={false} />
      <instancedMesh ref={flowerRef} args={[flowerGeometry, flowerMaterial, flowerStemCount]} renderOrder={8} frustumCulled={false} />
      <points
        ref={flowerPointsRef}
        geometry={flowerPointGeometry}
        material={flowerPointMaterial}
        renderOrder={9}
        frustumCulled={false}
      />
    </group>
  )
}

const VALLEY_FOREST_EDGE_CAPACITY = 360

function createValleyForestEdgeGeometry() {
  const lobes = [
    { radius: 0.31, position: [-0.15, 0.42, 0.02], scale: [1.08, 0.9, 0.94] },
    { radius: 0.34, position: [0.13, 0.48, -0.06], scale: [0.96, 1.08, 1.04] },
    { radius: 0.28, position: [-0.02, 0.7, 0.05], scale: [0.92, 1.13, 0.9] },
    { radius: 0.23, position: [0.12, 0.84, 0], scale: [0.82, 1.05, 0.88] },
  ].map(({ radius, position, scale }, index) => {
    const lobe = new THREE.DodecahedronGeometry(radius, 0)
    lobe.rotateY(index * 0.63)
    lobe.scale(...scale)
    lobe.translate(...position)
    return lobe
  })
  const indexedTrunk = new THREE.CylinderGeometry(0.036, 0.052, 0.58, 5)
  indexedTrunk.translate(0, 0.29, 0)
  const trunk = indexedTrunk.toNonIndexed()
  indexedTrunk.dispose()
  const pieces = [...lobes, trunk]
  const geometry = mergeGeometries(pieces, false)
  pieces.forEach((piece) => piece.dispose())
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function buildValleyForestEdgePlacements() {
  const placements = []
  for (
    let attempt = 0;
    placements.length < VALLEY_FOREST_EDGE_CAPACITY && attempt < VALLEY_FOREST_EDGE_CAPACITY * 12;
    attempt += 1
  ) {
    const depth = Math.pow(seededRandom(attempt + 63101), 0.92)
    const z = THREE.MathUtils.lerp(-18, -116, depth)
    const side = placements.length % 2 === 0 ? -1 : 1
    const broadCluster = Math.sin(-z * 0.086 + side * 1.75) * 0.5 + 0.5
    const fineCluster = Math.sin(-z * 0.191 - side * 0.84) * 0.5 + 0.5
    // Favor copses with visible gaps over a uniformly populated tree row.
    const density = clamp01(0.08 + Math.pow(broadCluster, 1.65) * 0.58 + fineCluster * 0.08)
    if (seededRandom(attempt + 63137) > density) continue

    const bankOffset = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(
        31,
        69,
        Math.pow(seededRandom(attempt + 63173), 0.78),
      ) + (broadCluster - 0.5) * 8,
      29,
      73,
    )
    const station = sampleNaturalRiverAtZ(z)
    const point = station.point.clone().addScaledVector(
      station.normal,
      side * (station.halfWidth + bankOffset),
    )
    const height = THREE.MathUtils.lerp(
      0.48,
      1.82,
      Math.pow(seededRandom(attempt + 63209), 1.28),
    ) * THREE.MathUtils.lerp(1, 0.86, depth) * THREE.MathUtils.lerp(0.9, 1.08, broadCluster)
    placements.push({
      position: [
        point.x,
        sampleValleyMeadowHeight(point.z, side, bankOffset) - 0.1,
        point.z,
      ],
      scale: [
        height * THREE.MathUtils.lerp(0.92, 1.42, seededRandom(attempt + 63243)),
        height,
        height * THREE.MathUtils.lerp(0.92, 1.42, seededRandom(attempt + 63281)),
      ],
      yaw: seededRandom(attempt + 63317) * Math.PI * 2,
      leanX: (seededRandom(attempt + 63353) - 0.5) * 0.035,
      leanZ: (seededRandom(attempt + 63391) - 0.5) * 0.035,
      tone: seededRandom(attempt + 63427),
    })
  }
  return placements
}

function ValleyForestEdge({ progress, qualityScale = 1 }) {
  const meshRef = useRef(null)
  const placements = useMemo(buildValleyForestEdgePlacements, [])
  const geometry = useMemo(createValleyForestEdgeGeometry, [])
  const material = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#31543b',
    vertexColors: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    fog: true,
    toneMapped: false,
  }), [])
  const palette = useMemo(() => ({
    day: new THREE.Color('#f0f3e5'),
    sunset: new THREE.Color('#d1ad92'),
    night: new THREE.Color('#71879a'),
  }), [])
  const activeCount = Math.max(
    1,
    Math.min(placements.length, Math.floor(VALLEY_FOREST_EDGE_CAPACITY * qualityScale)),
  )

  useLayoutEffect(() => {
    const mesh = meshRef.current
    if (!mesh) return
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    placements.forEach((placement, index) => {
      position.set(...placement.position)
      scale.set(...placement.scale)
      euler.set(placement.leanX, placement.yaw, placement.leanZ, 'YXZ')
      quaternion.setFromEuler(euler)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
    })
    mesh.count = activeCount
    mesh.instanceMatrix.needsUpdate = true
    material.needsUpdate = true
  }, [activeCount, material, palette, placements])

  useFrame(() => {
    const reveal = getJourneyValleyDetailPresence(progress)
    const { sunsetWeight: sunset, nightWeight: night } = getJourneyTimeOfDay(progress)
    if (meshRef.current) meshRef.current.visible = reveal > 0.002
    material.opacity = reveal * THREE.MathUtils.lerp(0.38, 0.3, night)
    material.color
      .set('#31543b')
      .lerp(palette.sunset, sunset * 0.3)
      .lerp(palette.night, night * 0.76)
  })

  useEffect(() => () => {
    geometry.dispose()
    material.dispose()
  }, [geometry, material])

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, VALLEY_FOREST_EDGE_CAPACITY]}
      renderOrder={4}
      castShadow={false}
      receiveShadow={false}
      frustumCulled={false}
    />
  )
}

function CloudbreakLight({ spriteRef, materialRef }) {
  const texture = useMemo(() => createCloudbreakTexture(), [])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <sprite
      ref={spriteRef}
      position={[56, 62, -292]}
      scale={[78, 192, 1]}
      renderOrder={5}
      frustumCulled={false}
    >
      <spriteMaterial
        ref={materialRef}
        map={texture}
        color="#fff4c7"
        transparent
        opacity={0}
        depthWrite={false}
        depthTest={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
        rotation={-0.16}
      />
    </sprite>
  )
}

function CaveExitGlow({ spriteRef, materialRef }) {
  const texture = useMemo(() => createCloudTexture(53091), [])
  useEffect(() => () => texture.dispose(), [texture])

  return (
    <sprite
      ref={spriteRef}
      position={[0, 4.4, -5.85]}
      scale={[9.6, 7.4, 1]}
      renderOrder={-3}
      frustumCulled={false}
    >
      <spriteMaterial
        ref={materialRef}
        map={texture}
        color="#a8b9ae"
        transparent
        opacity={0}
        depthWrite={false}
        depthTest
        toneMapped
      />
    </sprite>
  )
}

function ValleyFogBanks({ groupRef, materialRefs, layers = 7, mobile = false }) {
  const textures = useMemo(
    () => [createGroundFogTexture(18400), createGroundFogTexture(22100), createGroundFogTexture(26700)],
    [],
  )
  useEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures])

  const banks = useMemo(() => {
    const presets = [
      { position: [-18, 3.8, -35], scale: [96, 18, 1], opacity: 0.24, speed: 0.31, tilt: -0.018 },
      { position: [25, 6.7, -62], scale: [134, 23, 1], opacity: 0.34, speed: 0.24, tilt: 0.014 },
      { position: [-42, 10.1, -92], scale: [164, 28, 1], opacity: 0.38, speed: 0.19, tilt: -0.011 },
      { position: [48, 13.5, -122], scale: [192, 32, 1], opacity: 0.34, speed: 0.16, tilt: 0.009 },
      { position: [-31, 17.2, -158], scale: [216, 37, 1], opacity: 0.29, speed: 0.13, tilt: -0.007 },
      { position: [35, 21.3, -198], scale: [236, 41, 1], opacity: 0.25, speed: 0.11, tilt: 0.006 },
      { position: [-10, 25.8, -244], scale: [258, 46, 1], opacity: 0.22, speed: 0.09, tilt: -0.004 },
    ]
    const activeBanks = presets.slice(0, Math.max(3, Math.min(layers, presets.length)))
    if (!mobile) return activeBanks
    return activeBanks.slice(0, 4).map((bank, index) => ({
      ...bank,
      position: [bank.position[0] * 0.42, bank.position[1] - 2.5 - index * 0.55, bank.position[2]],
      scale: [bank.scale[0] * 1.38, bank.scale[1] * 0.64, 1],
      opacity: bank.opacity * 0.66,
      speed: bank.speed * 0.72,
    }))
  }, [layers, mobile])

  return (
    <group ref={groupRef}>
      {banks.map((bank, index) => (
        <sprite
          key={`${bank.position.join('-')}-${index}`}
          position={bank.position}
          scale={bank.scale}
          rotation-z={bank.tilt}
          renderOrder={index - 2}
          frustumCulled={false}
          userData={{
            baseX: bank.position[0],
            baseY: bank.position[1],
            opacity: bank.opacity,
            speed: bank.speed,
          }}
        >
          <spriteMaterial
            ref={(material) => {
              materialRefs.current[index] = material
            }}
            map={textures[index % textures.length]}
            color="#dce8df"
            transparent
            opacity={0}
            alphaTest={mobile ? 0 : 0.006}
            depthWrite={false}
            depthTest
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  )
}

function OpenValleyAtmosphere({ groupRef, materialRefs }) {
  const textures = useMemo(
    () => [createCloudTexture(31900), createCloudTexture(34700), createCloudTexture(38200)],
    [],
  )
  useEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures])
  const layers = [
    { position: [-24, 13, -82], scale: [126, 25, 1], opacity: 0.15 },
    { position: [31, 20, -132], scale: [176, 34, 1], opacity: 0.115 },
    { position: [-8, 29, -198], scale: [228, 43, 1], opacity: 0.082 },
  ]

  return (
    <group ref={groupRef}>
      {layers.map((layer, index) => (
        <sprite
          key={layer.position.join('-')}
          position={layer.position}
          scale={layer.scale}
          renderOrder={2 + index}
          frustumCulled={false}
          userData={{ opacity: layer.opacity, baseX: layer.position[0] }}
        >
          <spriteMaterial
            ref={(material) => {
              materialRefs.current[index] = material
            }}
            map={textures[index]}
            color="#c8d8ce"
            transparent
            opacity={0}
            alphaTest={0.004}
            depthWrite={false}
            depthTest
            toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  )
}

function MysticMotes({ groupRef, materialRef, qualityScale = 1 }) {
  const geometry = useMemo(
    () => buildMysticMotes(Math.round(420 * qualityScale)),
    [qualityScale],
  )
  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <points ref={groupRef} geometry={geometry} renderOrder={1}>
      <pointsMaterial
        ref={materialRef}
        color="#d7ffd1"
        size={1.15}
        sizeAttenuation={false}
        transparent
        opacity={0}
        depthWrite={false}
        depthTest
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function RiverRipple({ groupRef, materialRefs }) {
  return (
    <group ref={groupRef} visible={false} rotation-x={-Math.PI / 2}>
      {[0, 1, 2].map((index) => (
        <mesh key={index} renderOrder={7}>
          <ringGeometry args={[2.25, 2.48, 72]} />
          <meshBasicMaterial
            ref={(material) => {
              materialRefs.current[index] = material
            }}
            color="#9aeaff"
            transparent
            opacity={0}
            depthWrite={false}
            depthTest
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  )
}

export default function JourneyScene({
  progress,
  skyConnectionProgress = 0,
  activeGate = null,
  holdProgress = 0,
  fogClearProgress = 0,
  fogCompleted = false,
  presentationMode = false,
  onListenerPose,
  quality = { name: 'high', particles: 1, shadows: true, fogLayers: 7 },
  diagnostics = {},
}) {
  const renderer = useThree((state) => state.gl)
  const ktx2Loader = useMemo(
    () => new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer),
    [renderer],
  )
  useEffect(() => () => ktx2Loader.dispose(), [ktx2Loader])
  const configureLoader = useCallback(
    (loader) => loader.setKTX2Loader(ktx2Loader),
    [ktx2Loader],
  )
  const gltf = useGLTF(MODEL_URL, true, true, configureLoader)
  const caveLookdevGltf = useGLTF(CAVE_LOOKDEV_URL)
  const phase2Gltf = useGLTF(PHASE2_ENVIRONMENT_URL)
  const loadedBiomeMacroTexture = useTexture(ALPINE_BIOME_MACRO_URL)
  const biomeMacroTexture = useMemo(() => {
    loadedBiomeMacroTexture.colorSpace = THREE.SRGBColorSpace
    loadedBiomeMacroTexture.wrapS = THREE.RepeatWrapping
    loadedBiomeMacroTexture.wrapT = THREE.RepeatWrapping
    loadedBiomeMacroTexture.minFilter = THREE.LinearMipmapLinearFilter
    loadedBiomeMacroTexture.magFilter = THREE.LinearFilter
    loadedBiomeMacroTexture.anisotropy = 8
    loadedBiomeMacroTexture.needsUpdate = true
    return loadedBiomeMacroTexture
  }, [loadedBiomeMacroTexture])
  const { root, groups } = useMemo(
    () => prepareWorld(gltf.scene, biomeMacroTexture, caveLookdevGltf.scene),
    [biomeMacroTexture, caveLookdevGltf.scene, gltf.scene],
  )
  const { root: phase2Root, groups: phase2Groups } = useMemo(
    () => preparePhase2Environment(phase2Gltf.scene, biomeMacroTexture),
    [biomeMacroTexture, phase2Gltf.scene],
  )
  const camera = useMemo(
    () => root.getObjectByName('CAM_V13_MASTER_ANIMATED'),
    [root],
  )
  const mixer = useMemo(() => new THREE.AnimationMixer(root), [root])
  const clip = gltf.animations[0]
  const cameraSampler = useMemo(() => {
    if (!clip || !camera) return null
    const cameraTracks = clip.tracks.filter(
      (track) =>
        track.name.includes(camera.name) ||
        track.name.includes('CAM_V13_MASTER_ANIMATED'),
    )
    const positionTrack = cameraTracks.find((track) => track.name.endsWith('.position'))
    const quaternionTrack = cameraTracks.find(
      (track) => track.name.endsWith('.quaternion') || track.getValueSize() === 4,
    )
    return {
      position: positionTrack?.createInterpolant(
        new Float32Array(positionTrack.getValueSize()),
      ),
      quaternion: quaternionTrack?.createInterpolant(
        new Float32Array(quaternionTrack.getValueSize()),
      ),
    }
  }, [camera, clip])
  const cameraScratch = useMemo(
    () => ({
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      target: new THREE.Vector3(),
      correction: new THREE.Vector3(),
      futureCorrection: new THREE.Vector3(),
      futurePosition: new THREE.Vector3(),
      previousCorrection: new THREE.Vector3(),
      previousPosition: new THREE.Vector3(),
      centerlineForward: new THREE.Vector3(),
      previousAuthoredForward: new THREE.Vector3(),
      nextAuthoredForward: new THREE.Vector3(),
      authoredForward: new THREE.Vector3(),
      introForward: new THREE.Vector3(),
      authoredPosition: new THREE.Vector3(),
      continuationPosition: new THREE.Vector3(),
      authoredQuaternion: new THREE.Quaternion(),
      sampledQuaternion: new THREE.Quaternion(),
      holdPosition: new THREE.Vector3(),
      holdQuaternion: new THREE.Quaternion(),
      holdFov: 0,
      holdPoseCaptured: false,
      introStartZ: null,
      introFogZ: null,
      introQuaternion: new THREE.Quaternion(),
      introPoseCaptured: false,
      euler: new THREE.Euler(0, 0, 0, 'YXZ'),
    }),
    [],
  )
  const frameColors = useMemo(
    () => ({
      daySky: new THREE.Color('#65adc0'),
      sunsetSky: new THREE.Color('#d66e5f'),
      nightSky: new THREE.Color('#17385f'),
      sky: new THREE.Color(),
      caveBackground: new THREE.Color('#07100f'),
      daySkyTop: new THREE.Color('#4d9fba'),
      daySkyHorizon: new THREE.Color('#afcbc4'),
      skyTopSunset: new THREE.Color('#6f7796'),
      skyTopNight: new THREE.Color('#08172f'),
      skyHorizonSunset: new THREE.Color('#e6a07f'),
      skyHorizonNight: new THREE.Color('#263b5d'),
      skySunDay: new THREE.Color('#fff3c9'),
      skySunSunset: new THREE.Color('#ffb077'),
      skySunNight: new THREE.Color('#7896c8'),
      cloudBase: new THREE.Color('#f4f5ef'),
      cloudSunset: new THREE.Color('#ffd0ba'),
      cloudTone: new THREE.Color('#879da3'),
      cloud: new THREE.Color(),
      valleyFogBase: new THREE.Color('#cddbd3'),
      valleyFogSunset: new THREE.Color('#e7b3a2'),
      valleyFogNight: new THREE.Color('#7189ad'),
      valleyFog: new THREE.Color(),
      atmosphereBase: new THREE.Color('#c6d8cf'),
      atmosphereSunset: new THREE.Color('#d5ad9f'),
      atmosphereNight: new THREE.Color('#6e829d'),
      atmosphere: new THREE.Color(),
      openAirFog: new THREE.Color(),
      sunSunset: new THREE.Color('#ffad78'),
      sunNight: new THREE.Color('#8ca9d8'),
      skyLightSunset: new THREE.Color('#e5a49a'),
      skyLightNight: new THREE.Color('#7894c1'),
      skyGroundSunset: new THREE.Color('#75584e'),
      skyGroundNight: new THREE.Color('#111b2a'),
      ambientSunset: new THREE.Color('#b9877e'),
      ambientNight: new THREE.Color('#7185aa'),
      caveMobileGuide: new THREE.Color('#c8c1ae'),
      caveMobileWarm: new THREE.Color('#d1ad80'),
      caveMobileCool: new THREE.Color('#819cac'),
      caveExitTint: new THREE.Color('#718078'),
      caveExitEmissive: new THREE.Color('#567067'),
      ridgeNearSunset: new THREE.Color('#826d63'),
      ridgeFarSunset: new THREE.Color('#aa9188'),
      ridgeNearNight: new THREE.Color('#29475e'),
      ridgeFarNight: new THREE.Color('#3d5b70'),
      phaseCloudSunset: new THREE.Color('#efb7a0'),
      phaseCloudNight: new THREE.Color('#8195a8'),
      cloudbreakSunset: new THREE.Color('#ffb06c'),
      motesSunset: new THREE.Color('#ffd49a'),
      motesNight: new THREE.Color('#8ab8ff'),
      mysticSunset: new THREE.Color('#ffb178'),
      mysticNight: new THREE.Color('#7aa5e8'),
      clearRiverSunset: new THREE.Color('#829489'),
      clearRiverNight: new THREE.Color('#163f65'),
      riverSunset: new THREE.Color('#748a80'),
      riverNight: new THREE.Color('#153f65'),
      clearRiverAttenuationSunset: new THREE.Color('#879b89'),
      clearRiverAttenuationNight: new THREE.Color('#1b5477'),
    }),
    [],
  )
  const discoveryPreview = useMemo(
    () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('look') === 'light',
    [],
  )
  const qaCaptureEnabled = useMemo(
    () => new URLSearchParams(window.location.search).get('capture') === '1',
    [],
  )
  const previousProgressRef = useRef(progress)
  const shadowProgressRef = useRef(-Infinity)
  const travelWindRef = useRef(0)
  const sunRef = useRef(null)
  const skyLightRef = useRef(null)
  const ambientRef = useRef(null)
  const caveGuideLightRef = useRef(null)
  const caveLeftGrazingLightRef = useRef(null)
  const caveRightGrazingLightRef = useRef(null)
  const caveExitLightRef = useRef(null)
  const caveExitGlowRef = useRef(null)
  const caveExitGlowMaterialRef = useRef(null)
  const mysticLightRef = useRef(null)
  const riverMysticLightRef = useRef(null)
  const starMaterialRef = useRef(null)
  const starPointsRef = useRef(null)
  const milkyMaterialRef = useRef(null)
  const milkyPointsRef = useRef(null)
  const skyBridgeRef = useRef(null)
  const seatedFigureRef = useRef(null)
  const seatedFigureMaterialRef = useRef(null)
  const seatedFigureSilhouetteMaterialRef = useRef(null)
  const cloudGroupRef = useRef(null)
  const cloudMaterialRefs = useRef([])
  const cloudbreakRef = useRef(null)
  const cloudbreakMaterialRef = useRef(null)
  const skyAtmosphereRef = useRef(null)
  const skyAtmosphereMaterialRef = useRef(null)
  const valleyFogGroupRef = useRef(null)
  const valleyFogMaterialRefs = useRef([])
  const openValleyAtmosphereRef = useRef(null)
  const openValleyAtmosphereMaterialRefs = useRef([])
  const skyRigRef = useRef(null)
  const motesRef = useRef(null)
  const motesMaterialRef = useRef(null)
  const distantBirdsRef = useRef(null)
  const distantBirdsMaterialRef = useRef(null)
  const riverRippleRef = useRef(null)
  const riverRippleMaterialRefs = useRef([])
  const riverReactionRef = useRef({ age: 0, fading: false })
  const interactionRef = useRef({ capturedGate: null })
  const cavePresenceRef = useRef(Number.NaN)
  const caveExitBounceRef = useRef(Number.NaN)
  const cavePortalCameraZRef = useRef(23)
  const cameraMotionSamplesRef = useRef([])
  const cameraMotionAuditRef = useRef({ previous: null, samples: [] })
  const { set, size, scene } = useThree()
  const sceneViewportAspect = size.width / Math.max(size.height, 1)
  const scenePortraitFactor = 1 - smoothstep(0.62, 0.95, sceneViewportAspect)
  const mobileMeadowQualityScale = quality.name === 'medium'
    ? THREE.MathUtils.lerp(
      quality.particles,
      Math.max(quality.particles, 0.9),
      scenePortraitFactor,
    )
    : quality.particles

  // Keep Three's authored-clip evaluation active even though the two camera
  // tracks are also sampled below for deterministic composition offsets. The
  // mixer preserves the GLTF camera object's complete animated transform
  // contract at the Night/Final checkpoints.
  useEffect(() => {
    if (!clip) return undefined
    const action = mixer.clipAction(clip, root)
    action.play()
    action.paused = true
    return () => {
      action.stop()
      mixer.uncacheRoot(root)
    }
  }, [clip, mixer, root])

  useEffect(() => {
    if (!camera?.isCamera) return undefined
    scene.userData.previousJourneyCamera = camera
    camera.aspect = size.width / size.height
    camera.far = Math.max(camera.far, 2400)
    camera.userData.journeyBaseFov ??= camera.fov
    camera.updateProjectionMatrix()
    set({ camera })
    return () => {
      if (scene.userData.previousJourneyCamera === camera) {
        delete scene.userData.previousJourneyCamera
      }
    }
  }, [camera, scene, set, size.height, size.width])

  useLayoutEffect(() => {
    scene.fog = new THREE.FogExp2('#85989b', 0.013)
    return () => {
      scene.fog = null
    }
  }, [scene])

  useFrame((state, delta) => {
    const timeOfDay = getJourneyTimeOfDay(progress)
    const {
      sunsetWeight: sunset,
      nightWeight: night,
      starWeight,
    } = timeOfDay
    const eveningProgress = sunset + night
    // HOLD owns the only river-to-sky illumination. Reverse travel may fade
    // that completed world state back into ordinary night, but it does not
    // re-arm a second HOLD or a separate progress-driven river flash.
    const riverConnectionProgress = skyConnectionProgress * smoothstep(
      JOURNEY_NIGHT_SEQUENCE.connectionReverseFadeStart,
      JOURNEY_NIGHT_SEQUENCE.riverGate,
      progress,
    )
    if (
      quality.shadows &&
      Math.abs(progress - shadowProgressRef.current) >= 0.18
    ) {
      state.gl.shadowMap.needsUpdate = true
      shadowProgressRef.current = progress
    }
    const progressVelocity = Math.abs(progress - previousProgressRef.current) /
      Math.max(delta, 0.001)
    const travelWindTarget = THREE.MathUtils.clamp(progressVelocity * 0.085, 0, 1)
    travelWindRef.current = THREE.MathUtils.damp(
      travelWindRef.current,
      travelWindTarget,
      travelWindTarget > travelWindRef.current ? 8.5 : 2.15,
      delta,
    )
    previousProgressRef.current = progress

    if (holdProgress <= 0.001) {
      interactionRef.current.capturedGate = null
    } else if (activeGate && interactionRef.current.capturedGate !== activeGate) {
      const targets = activeGate === 'river'
        ? [...groups.water, ...groups.pebbles]
        : [...groups.mountains, ...groups.pebbles, ...groups.cave]
      const interactionPointer = activeGate === 'river'
        ? new THREE.Vector2(0, -0.68)
        : state.pointer
      state.raycaster.setFromCamera(interactionPointer, camera)
      const hits = state.raycaster.intersectObjects(targets, true)
      const hit = activeGate === 'river'
        ? hits.find((candidate) => candidate.point.y < 7)
        : hits[0]
      const fallbackDirection = new THREE.Vector3()
      camera.getWorldDirection(fallbackDirection)
      const point = hit?.point?.clone() ?? (
        activeGate === 'river'
          ? new THREE.Vector3(0, 0.18, -12)
          : camera.position.clone().addScaledVector(fallbackDirection, 26)
      )
      interactionRef.current.capturedGate = activeGate
      if (activeGate === 'river' && riverRippleRef.current) {
        riverRippleRef.current.position.set(point.x, Math.min(point.y, 6.8) + 0.08, point.z)
        riverRippleRef.current.visible = true
        riverReactionRef.current = { age: 0, fading: false }
      }
    }

    if (riverRippleRef.current?.visible) {
      const isRiverHolding = activeGate === 'river' && holdProgress > 0
      if (!isRiverHolding) {
        riverReactionRef.current.fading = true
        riverReactionRef.current.age += delta
      }
      const fade = riverReactionRef.current.fading
        ? 1 - smoothstep(0, 1.8, riverReactionRef.current.age)
        : 1
      riverRippleRef.current.children.forEach((ring, index) => {
        const phase = Math.max(0, holdProgress * 1.35 - index * 0.22)
        const afterglow = riverReactionRef.current.fading
          ? riverReactionRef.current.age * (0.7 + index * 0.2)
          : 0
        const scale = 0.45 + phase * (2.4 + index * 0.75) + afterglow
        ring.scale.setScalar(scale)
        const material = riverRippleMaterialRefs.current[index]
        if (material) {
          material.opacity = fade * Math.max(0, 0.5 - index * 0.09) * smoothstep(0, 0.18, phase)
        }
      })
      if (fade <= 0.002) riverRippleRef.current.visible = false
    }

    const cameraProgress = progress
    const clipTime = clip
      ? clip.duration * storyProgressToClipProgress(cameraProgress)
      : 0
    if (clip) mixer.setTime(clipTime)
    const portraitFactor = scenePortraitFactor
    const portraitComposition = portraitFactor * smoothstep(
      JOURNEY_CAVE_SEQUENCE.fogGate,
      20,
      cameraProgress,
    )
    const portraitCaveComposition = portraitFactor * (
      1 - smoothstep(JOURNEY_CAVE_SEQUENCE.fogGate, 20, cameraProgress)
    )
    if (camera?.isCamera) {
      const sampledPosition = cameraSampler?.position?.evaluate(clipTime)
      const sampledQuaternion = cameraSampler?.quaternion?.evaluate(clipTime)
      if (sampledPosition) camera.position.fromArray(sampledPosition)
      if (sampledQuaternion) camera.quaternion.fromArray(sampledQuaternion).normalize()
      cameraScratch.authoredPosition.copy(camera.position)
      cameraScratch.authoredQuaternion.copy(camera.quaternion)
      cameraScratch.correction.set(0, 0, 0)

      if (!cameraScratch.introPoseCaptured && cameraSampler?.position) {
        const introStart = Array.from(cameraSampler.position.evaluate(
          clip.duration * storyProgressToClipProgress(0),
        ) ?? camera.position.toArray())
        const introFog = Array.from(cameraSampler.position.evaluate(
          clip.duration * storyProgressToClipProgress(JOURNEY_CAVE_SEQUENCE.portalCrossing),
        ) ?? camera.position.toArray())
        cameraScratch.introStartZ = introStart?.[2] ?? camera.position.z
        cameraScratch.introFogZ = introFog?.[2] ?? camera.position.z
        cameraScratch.introForward.set(0, 0.035, -1).normalize()
        cameraScratch.target
          .set(CAVE_CAMERA.x, CAVE_CAMERA.y, cameraScratch.introStartZ)
          .add(cameraScratch.introForward)
        camera.position.set(CAVE_CAMERA.x, CAVE_CAMERA.y, cameraScratch.introStartZ)
        camera.up.set(0, 1, 0)
        camera.lookAt(cameraScratch.target)
        cameraScratch.introQuaternion.copy(camera.quaternion)
        cameraScratch.introPoseCaptured = true
      }

      // From the cave entrance through Fog/HOLD the viewer keeps one stable
      // human eye-line. Only forward travel along the corridor is allowed;
      // no lift, yaw performance, pull-back or FOV change can begin while the
      // cave/portal handoff is still visible.
      const introLocked = progress <= JOURNEY_CAVE_SEQUENCE.fogGate + 0.001
      const introReleaseActive =
        !introLocked && progress < CAVE_CAMERA_RELEASE_END && cameraScratch.introPoseCaptured
      const introAuthoredTransition = introLocked || introReleaseActive
      let introRelease = 0
      if (introLocked && cameraScratch.introPoseCaptured) {
        // Solve one continuous cubic against the authored portal sample. The
        // former curve aimed at a point 2.15 units beyond that sample, so the
        // camera had already crossed the portal before the story reached the
        // declared crossing. Anchoring the cubic to the real sample keeps one
        // walking velocity while making story progress and geometry agree.
        const caveTravelT = clamp01(progress / JOURNEY_CAVE_SEQUENCE.fogGate)
        const caveTravelEndZ = cameraScratch.introFogZ - CAVE_CAMERA_CONTINUATION_DISTANCE
        const totalTravel = Math.max(
          Math.abs(caveTravelEndZ - cameraScratch.introStartZ),
          Number.EPSILON,
        )
        const portalTravel = clamp01(
          Math.abs(cameraScratch.introFogZ - cameraScratch.introStartZ) /
            totalTravel,
        )
        const portalTime = JOURNEY_CAVE_SEQUENCE.portalCrossing /
          JOURNEY_CAVE_SEQUENCE.fogGate
        const initialSlope = 0.45
        const portalTime2 = portalTime * portalTime
        const portalTime3 = portalTime2 * portalTime
        const cubicA = (
          portalTravel - initialSlope * portalTime -
          (1 - initialSlope) * portalTime2
        ) / Math.min(portalTime3 - portalTime2, -Number.EPSILON)
        const cubicB = 1 - initialSlope - cubicA
        const caveTravel = clamp01(
          cubicA * caveTravelT * caveTravelT * caveTravelT +
          cubicB * caveTravelT * caveTravelT +
          initialSlope * caveTravelT,
        )
        camera.position.set(
          CAVE_CAMERA.x,
          CAVE_CAMERA.y,
          THREE.MathUtils.lerp(
            cameraScratch.introStartZ,
            caveTravelEndZ,
            caveTravel,
          ),
        )
        camera.quaternion.copy(cameraScratch.introQuaternion)
      } else if (introReleaseActive) {
        introRelease = smoothstep(
          JOURNEY_CAVE_SEQUENCE.fogGate,
          CAVE_CAMERA_RELEASE_END,
          progress,
        )
        cameraScratch.continuationPosition.set(
          CAVE_CAMERA.x,
          CAVE_CAMERA.y,
          cameraScratch.introFogZ - CAVE_CAMERA_CONTINUATION_DISTANCE,
        )
        camera.position
          .copy(cameraScratch.continuationPosition)
          .lerp(cameraScratch.authoredPosition, introRelease)
        camera.quaternion
          .copy(cameraScratch.introQuaternion)
          .slerp(cameraScratch.authoredQuaternion, introRelease)
      }

      const openVista = smoothstep(
        JOURNEY_CAVE_SEQUENCE.fogGate,
        CAVE_CAMERA_RELEASE_END,
        cameraProgress,
      )
      const vistaComposition = smoothstep(
        LOOKDEV_V2_COMPOSITION.vistaStart,
        LOOKDEV_V2_COMPOSITION.vistaFull,
        cameraProgress,
      ) * (1 - smoothstep(
        LOOKDEV_V2_COMPOSITION.vistaFadeStart,
        LOOKDEV_V2_COMPOSITION.vistaFadeEnd,
        cameraProgress,
      ))
      const portraitVista = smoothstep(12, 25, cameraProgress)
      const endingLift = smoothstep(
        ENDING_CAMERA.liftStart,
        ENDING_CAMERA.liftEnd,
        cameraProgress,
      )
      const endingWide = smoothstep(
        ENDING_CAMERA.wideStart,
        ENDING_CAMERA.wideEnd,
        cameraProgress,
      )
      cameraScratch.forward
        .set(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .normalize()
      if (
        !introAuthoredTransition &&
        cameraSampler?.quaternion &&
        clip &&
        progress < JOURNEY_CAVE_SEQUENCE.fogGate + 2.5
      ) {
        const previousProgress = Math.max(0, progress - 0.48)
        const nextProgress = Math.min(JOURNEY_CAVE_SEQUENCE.fogGate, progress + 0.48)
        const previousQuaternionSample = cameraSampler.quaternion.evaluate(
          clip.duration * storyProgressToClipProgress(previousProgress),
        )
        cameraScratch.sampledQuaternion.fromArray(previousQuaternionSample).normalize()
        cameraScratch.previousAuthoredForward
          .set(0, 0, -1)
          .applyQuaternion(cameraScratch.sampledQuaternion)
        const nextQuaternionSample = cameraSampler.quaternion.evaluate(
          clip.duration * storyProgressToClipProgress(nextProgress),
        )
        cameraScratch.sampledQuaternion.fromArray(nextQuaternionSample).normalize()
        cameraScratch.nextAuthoredForward
          .set(0, 0, -1)
          .applyQuaternion(cameraScratch.sampledQuaternion)
        cameraScratch.authoredForward
          .copy(cameraScratch.previousAuthoredForward)
          .addScaledVector(cameraScratch.forward, 2)
          .add(cameraScratch.nextAuthoredForward)
          .normalize()
        cameraScratch.forward.copy(cameraScratch.authoredForward)
      }
      if (
        !introAuthoredTransition &&
        cameraSampler?.position &&
        clip &&
        progress > 1.5 &&
        progress < JOURNEY_CAVE_SEQUENCE.fogGate + 2.5
      ) {
        const previousProgress = Math.max(
          0,
          progress - 1.15,
        )
        const futureProgress = Math.min(
          JOURNEY_CAVE_SEQUENCE.fogGate + 4.8,
          progress + 2.6,
        )
        const previousClipTime = clip.duration * storyProgressToClipProgress(previousProgress)
        const futureClipTime = clip.duration * storyProgressToClipProgress(futureProgress)
        const previousSample = cameraSampler.position.evaluate(previousClipTime)
        if (previousSample) cameraScratch.previousPosition.fromArray(previousSample)
        const futureSample = cameraSampler.position.evaluate(futureClipTime)
        if (previousSample && futureSample) {
          cameraScratch.previousCorrection.set(0, 0, 0)
          cameraScratch.futurePosition.fromArray(futureSample)
          cameraScratch.futureCorrection.set(0, 0, 0)
          cameraScratch.centerlineForward
            .copy(cameraScratch.futurePosition)
            .sub(cameraScratch.previousPosition)
          if (cameraScratch.centerlineForward.lengthSq() > 0.000001) {
            cameraScratch.centerlineForward.normalize()
            // Preserve the deliberately smoothed authored eye-line while the
            // horizontal component follows the cave's continuous center path.
            const authoredPitch = cameraScratch.forward.y
            cameraScratch.centerlineForward.y = THREE.MathUtils.lerp(
              cameraScratch.centerlineForward.y,
              authoredPitch,
              0.72,
            )
            cameraScratch.centerlineForward.normalize()
            const centerlineLook =
              smoothstep(0.8, 2.4, progress) *
              (1 - smoothstep(12.35, JOURNEY_CAVE_SEQUENCE.fogGate, progress)) *
              0.88
            cameraScratch.forward
              .lerp(cameraScratch.centerlineForward, centerlineLook)
              .normalize()
          }
        }
      }
      // Use the authored corridor's settled heading as the intro eye-line.
      // This removes the residual yaw/pitch performance from the camera clip
      // while keeping the authored position and eye height intact. Ease back
      // to the authored exit direction over a long interval so the portal,
      // Fog and HOLD pose share one continuous orientation.
      const introHeading = !introAuthoredTransition ? 1 - smoothstep(
        10.8,
        JOURNEY_CAVE_SEQUENCE.fogGate,
        progress,
      ) : 0
      if (introHeading > 0.0001) {
        cameraScratch.introForward
          // The corridor is centered on X=0 and travels toward -Z. A slight
          // fixed upward eye-line keeps the portal ahead readable without
          // reintroducing authored yaw, roll or look-target drift.
          .set(0, 0.035, -1)
          .normalize()
        cameraScratch.forward
          .lerp(cameraScratch.introForward, introHeading * 0.94)
          .normalize()
      }
      cameraScratch.right
        .set(1, 0, 0)
        .crossVectors(cameraScratch.forward, cameraScratch.up)
        .normalize()
      const revealCompositionStrength = introLocked
        ? 0
        : smoothstep(
          JOURNEY_CAVE_SEQUENCE.fogGate,
          CAVE_CAMERA_RELEASE_END,
          progress,
        )
      if (!introLocked) {
        camera.position.addScaledVector(
          cameraScratch.forward,
          (presentationMode ? -1.8 : 0) -
            vistaComposition * LOOKDEV_V2_COMPOSITION.pullBack * revealCompositionStrength -
            endingWide * ENDING_CAMERA.pullBack +
            portraitComposition * THREE.MathUtils.lerp(
              MOBILE_JOURNEY_COMPOSITION.valleyPullBackNear,
              MOBILE_JOURNEY_COMPOSITION.valleyPullBackFar,
              portraitVista,
            ),
        )
        camera.position.addScaledVector(
          cameraScratch.right,
          portraitComposition * THREE.MathUtils.lerp(
            MOBILE_JOURNEY_COMPOSITION.valleyLateralNear,
            MOBILE_JOURNEY_COMPOSITION.valleyLateralFar,
            portraitVista,
          ),
        )
        camera.position.y +=
          vistaComposition * LOOKDEV_V2_COMPOSITION.cameraLift * revealCompositionStrength +
          endingLift * ENDING_CAMERA.cameraLift +
          portraitComposition * THREE.MathUtils.lerp(
            MOBILE_JOURNEY_COMPOSITION.valleyCameraLiftNear,
            MOBILE_JOURNEY_COMPOSITION.valleyCameraLiftFar,
            portraitVista,
          )
        cameraScratch.target.copy(camera.position).add(cameraScratch.forward)
        cameraScratch.target.y +=
          (presentationMode ? 0.12 : 0) +
          vistaComposition * LOOKDEV_V2_COMPOSITION.targetLift * revealCompositionStrength +
          endingLift * ENDING_CAMERA.lift +
          portraitComposition * (1 - endingLift) * THREE.MathUtils.lerp(
            MOBILE_JOURNEY_COMPOSITION.valleyTargetLiftNear,
            MOBILE_JOURNEY_COMPOSITION.valleyTargetLiftFar,
            portraitVista,
          )
        cameraScratch.target.addScaledVector(
          cameraScratch.right,
          portraitComposition * THREE.MathUtils.lerp(
            MOBILE_JOURNEY_COMPOSITION.valleyTargetRightNear,
            MOBILE_JOURNEY_COMPOSITION.valleyTargetRightFar,
            portraitVista,
          ),
        )
        camera.up.set(0, 1, 0)
        camera.lookAt(cameraScratch.target)
      }
      cavePortalCameraZRef.current = camera.position.z
      const authoredDesiredFov = camera.userData.journeyBaseFov +
        openVista * 4.5 +
        vistaComposition * LOOKDEV_V2_COMPOSITION.fov +
        endingWide * ENDING_CAMERA.fov +
        (presentationMode ? 15 : 0) +
        portraitCaveComposition * (MOBILE_JOURNEY_COMPOSITION.caveFov - CAVE_CAMERA.fov) +
        portraitComposition * MOBILE_JOURNEY_COMPOSITION.valleyFov
      const mobileIntroFov = THREE.MathUtils.lerp(
        CAVE_CAMERA.fov,
        MOBILE_JOURNEY_COMPOSITION.caveFov,
        portraitFactor,
      )
      const desiredFov = introLocked
        ? mobileIntroFov
        : introReleaseActive
          ? THREE.MathUtils.lerp(
            mobileIntroFov,
            authoredDesiredFov,
            introRelease,
          )
          : authoredDesiredFov
      if (Math.abs(camera.fov - desiredFov) > 0.001) {
        camera.fov = desiredFov
        camera.updateProjectionMatrix()
      }
      const fogPoseLocked = activeGate === 'fog'
      if (
        fogPoseLocked &&
        !cameraScratch.holdPoseCaptured &&
        cameraScratch.introPoseCaptured
      ) {
        cameraScratch.holdPosition.copy(camera.position)
        cameraScratch.holdQuaternion.copy(camera.quaternion)
        cameraScratch.holdFov = camera.fov
        cameraScratch.holdPoseCaptured = true
      } else if (!fogPoseLocked) {
        cameraScratch.holdPoseCaptured = false
      }
      if (fogPoseLocked && cameraScratch.holdPoseCaptured) {
        camera.position.copy(cameraScratch.holdPosition)
        camera.quaternion.copy(cameraScratch.holdQuaternion)
        if (Math.abs(camera.fov - cameraScratch.holdFov) > 0.000001) {
          camera.fov = cameraScratch.holdFov
          camera.updateProjectionMatrix()
        }
      }
      camera.updateMatrixWorld()
      onListenerPose?.(camera)
      if (qaCaptureEnabled) {
        const captureDataset = document.documentElement.dataset
        captureDataset.journeyProgress = progress.toFixed(4)
        captureDataset.journeyDayWeight = timeOfDay.dayWeight.toFixed(6)
        captureDataset.journeySunsetWeight = sunset.toFixed(6)
        captureDataset.journeyNightWeight = night.toFixed(6)
        captureDataset.journeyStarWeight = starWeight.toFixed(6)
        captureDataset.journeyQualityTier = quality.name
        captureDataset.journeyCameraProgress = cameraProgress.toFixed(4)
        captureDataset.journeyFogClearProgress = fogClearProgress.toFixed(6)
        captureDataset.journeyActiveGate = activeGate ?? 'none'
        captureDataset.journeyHoldProgress = holdProgress.toFixed(6)
        captureDataset.journeyFogCompleted = String(fogCompleted)
        captureDataset.journeySkyConnectionProgress =
          riverConnectionProgress.toFixed(6)
        captureDataset.journeySkyConnectionState =
          skyConnectionProgress.toFixed(6)
        captureDataset.journeyCameraPosition = JSON.stringify(
          camera.position.toArray().map((value) => Number(value.toFixed(6))),
        )
        captureDataset.journeyCameraQuaternion = JSON.stringify(
          camera.quaternion.toArray().map((value) => Number(value.toFixed(7))),
        )
        captureDataset.journeyCameraFov = camera.fov.toFixed(6)
        captureDataset.journeyPortraitFactor = portraitFactor.toFixed(6)
        captureDataset.journeyPortraitComposition = portraitComposition.toFixed(6)
        captureDataset.journeyCaveCameraCorrection = JSON.stringify(
          cameraScratch.correction.toArray().slice(0, 2)
            .map((value) => Number(value.toFixed(5))),
        )
        captureDataset.journeyPortalCameraZ = camera.position.z.toFixed(6)
        cameraScratch.euler.setFromQuaternion(camera.quaternion, 'YXZ')
        const motionSamples = cameraMotionSamplesRef.current
        motionSamples.push({
          time: state.clock.elapsedTime,
          delta,
          progress,
          position: camera.position.toArray(),
          yaw: cameraScratch.euler.y,
          pitch: cameraScratch.euler.x,
        })
        if (motionSamples.length > 2400) motionSamples.splice(0, motionSamples.length - 2400)
        const motionAudit = cameraMotionAuditRef.current
        const previousMotion = motionAudit.previous
        if (
          previousMotion &&
          progress <= JOURNEY_CAVE_SEQUENCE.fogGate + 0.001 &&
          Math.abs(progress - previousMotion.progress) > 0.000001
        ) {
          const wrapAngle = (value) => THREE.MathUtils.euclideanModulo(
            value + Math.PI,
            Math.PI * 2,
          ) - Math.PI
          const sample = {
            progress,
            frameDelta: delta,
            progressDelta: progress - previousMotion.progress,
            xDelta: camera.position.x - previousMotion.position[0],
            yDelta: camera.position.y - previousMotion.position[1],
            zDelta: camera.position.z - previousMotion.position[2],
            yawDelta: wrapAngle(cameraScratch.euler.y - previousMotion.yaw),
            pitchDelta: wrapAngle(cameraScratch.euler.x - previousMotion.pitch),
          }
          sample.positionDelta = Math.hypot(sample.xDelta, sample.yDelta, sample.zDelta)
          motionAudit.samples.push(sample)
          if (motionAudit.samples.length > 1800) motionAudit.samples.shift()
          if (motionAudit.samples.length % 20 === 0) {
            const largest = (key) => motionAudit.samples.reduce(
              (best, candidate) => (
                Math.abs(candidate[key]) > Math.abs(best?.[key] ?? 0) ? candidate : best
              ),
              null,
            )
            captureDataset.journeyCameraMotionAudit = JSON.stringify({
              frames: motionAudit.samples.length,
              position: largest('positionDelta'),
              x: largest('xDelta'),
              y: largest('yDelta'),
              z: largest('zDelta'),
              yaw: largest('yawDelta'),
              pitch: largest('pitchDelta'),
            })
          }
        }
        motionAudit.previous = {
          progress,
          position: camera.position.toArray(),
          yaw: cameraScratch.euler.y,
          pitch: cameraScratch.euler.x,
        }
        window.__JOURNEY_V1_CAPTURE__ = {
          progress,
          cameraProgress,
          activeGate,
          holdProgress,
          fogClearProgress,
          fogCompleted,
          caveCameraCorrection: cameraScratch.correction.toArray(),
          camera: {
            position: camera.position.toArray(),
            quaternion: camera.quaternion.toArray(),
            fov: camera.fov,
          },
          motionSamples,
          project: (x, y, z) => {
            const point = new THREE.Vector3(x, y, z).project(camera)
            return {
              x: (point.x * 0.5 + 0.5) * size.width,
              y: (-point.y * 0.5 + 0.5) * size.height,
              z: point.z,
            }
          },
        }
      }
    }

    if (camera?.isCamera && skyRigRef.current) {
      camera.getWorldPosition(skyRigRef.current.position)
      camera.getWorldQuaternion(skyRigRef.current.quaternion)
    }
    if (camera?.isCamera && skyAtmosphereRef.current) {
      camera.getWorldPosition(skyAtmosphereRef.current.position)
    }

    const sunsetColorMix = smoothstep(0, 0.72, sunset)
    const caveRelease = getJourneyOutdoorPresence(progress)
    // Exterior illumination arrives through the opening before the viewer is
    // fully outdoors. This is deliberately separate from world visibility and
    // Fog/HOLD timing: it reveals the route without advancing the story.
    const exitAirMix = smoothstep(5.6, 13.7, progress)
    const caveDaylight = Math.max(
      caveRelease,
      exitAirMix * 0.45,
    )
    const mobileCaveClarity = portraitFactor * (1 - smoothstep(8.5, 14.2, progress))
    const caveExitBounce = smoothstep(4.5, 11.8, progress) *
      (1 - smoothstep(13.15, 15.2, progress))
    const skyColor = blendTimeOfDayColor(
      frameColors.sky,
      frameColors.daySky,
      frameColors.sunsetSky,
      frameColors.nightSky,
      timeOfDay,
    )
    // Reveal daylight through the physical opening before any valley geometry
    // is exposed. The cave remains dark around the viewer, while the portal
    // itself grows from deep teal into the real daytime sky.
    const caveBackgroundReveal = smoothstep(5.8, 12.18, progress)
    state.scene.background = frameColors.caveBackground
      .set('#07100f')
      .lerp(skyColor, caveBackgroundReveal)

    const portalSkyMix = getJourneyValleyFarPresence(progress)
    if (skyAtmosphereMaterialRef.current) {
      const uniforms = skyAtmosphereMaterialRef.current.uniforms
      uniforms.uJourneyTopColor.value
        .set('#183637')
        .lerp(frameColors.daySkyTop, portalSkyMix)
        .lerp(frameColors.skyTopSunset, sunsetColorMix)
        .lerp(frameColors.skyTopNight, night)
      uniforms.uJourneyHorizonColor.value
        .set('#38524d')
        .lerp(frameColors.daySkyHorizon, portalSkyMix)
        .lerp(frameColors.skyHorizonSunset, sunsetColorMix)
        .lerp(frameColors.skyHorizonNight, night)
      uniforms.uJourneySunColor.value
        .set('#253732')
        .lerp(frameColors.skySunDay, portalSkyMix)
        .lerp(frameColors.skySunSunset, sunset)
        .lerp(frameColors.skySunNight, night)
      uniforms.uJourneySunDirection.value
        .set(
          THREE.MathUtils.lerp(-0.48, 0.42, eveningProgress),
          THREE.MathUtils.lerp(0.46, 0.08, eveningProgress),
          -0.74,
        )
        .normalize()
      uniforms.uJourneyNight.value = night
    }
    if (skyAtmosphereRef.current) {
      // Keep a dark, fog-coloured gradient resident behind the portal, then
      // bring it into daytime only over the final approach. This supplies
      // atmospheric depth without exposing valley geometry inside the cave or
      // turning the opening into a flat bright wall.
      skyAtmosphereRef.current.visible = true
    }

    if (cloudGroupRef.current) {
      const openSky = getJourneyValleyFarPresence(progress)
      const cloudNightFade = 1 - smoothstep(0.12, 0.92, night)
      const cloudsVisible = openSky * cloudNightFade > 0.002
      cloudGroupRef.current.visible = cloudsVisible
      if (cloudsVisible) {
        const cloudColor = frameColors.cloud
          .copy(frameColors.cloudBase)
          .lerp(frameColors.cloudSunset, sunset * 0.74)
        cloudGroupRef.current.children.forEach((cloud, index) => {
          const material = cloudMaterialRefs.current[index]
          if (material) {
            material.opacity =
              openSky * cloudNightFade * (cloud.userData.opacity ?? 0.5) * 0.78
            material.color.copy(cloudColor).lerp(
              frameColors.cloudTone,
              cloud.userData.tone ?? 0,
            )
          }
          cloud.position.x =
            cloud.userData.baseX +
            Math.sin(state.clock.elapsedTime * 0.055 + index * 1.9) *
              cloud.userData.speed *
              (4.2 + travelWindRef.current * 12)
          cloud.position.y =
            cloud.userData.baseY +
            Math.sin(state.clock.elapsedTime * 0.12 + index) *
              travelWindRef.current *
              0.34
        })
      }
    }

    const valleyFogArrival = getJourneyFogArrival(progress)
    const holdFogRemaining = 1 - clamp01(fogClearProgress)
    const holdClear = clamp01(fogClearProgress)
    const valleyMist = valleyFogArrival * holdFogRemaining
    if (valleyFogGroupRef.current) {
      const valleyFogVisible = USE_VIEW_FACING_FOG_CARDS &&
        valleyMist > 0.002 && !diagnostics.fog
      valleyFogGroupRef.current.visible = valleyFogVisible
      if (valleyFogVisible) {
        const fogColor = frameColors.valleyFog
          .copy(frameColors.valleyFogBase)
          .lerp(frameColors.valleyFogSunset, sunset * 0.52)
          .lerp(frameColors.valleyFogNight, night * 0.72)
        valleyFogGroupRef.current.children.forEach((bank, index) => {
          const material = valleyFogMaterialRefs.current[index]
          const breathing = 0.86 + Math.sin(state.clock.elapsedTime * 0.13 + index * 1.31) * 0.14
          if (material) {
            material.opacity =
              valleyMist * (portraitFactor > 0.5 ? 1.45 : 1.95) *
              (bank.userData.opacity ?? 0.2) *
              breathing *
              (1 - night * 0.46)
            material.color.copy(fogColor)
          }
          bank.position.x =
            bank.userData.baseX +
            Math.sin(state.clock.elapsedTime * bank.userData.speed * 0.14 + index * 0.8) *
              (5.5 + index * 1.7)
          bank.position.y =
            bank.userData.baseY +
            Math.sin(state.clock.elapsedTime * 0.075 + index * 1.4) * (0.7 + index * 0.17)
        })
      }
    }
    if (openValleyAtmosphereRef.current) {
      const atmospherePresence = getJourneyValleyPresence(progress)
      const atmosphereVisible = USE_VIEW_FACING_FOG_CARDS &&
        atmospherePresence > 0.002 && !diagnostics.fog
      openValleyAtmosphereRef.current.visible = atmosphereVisible
      if (atmosphereVisible) {
        const atmosphereColor = frameColors.atmosphere
          .copy(frameColors.atmosphereBase)
          .lerp(frameColors.atmosphereSunset, sunset * 0.48)
          .lerp(frameColors.atmosphereNight, night * 0.68)
        openValleyAtmosphereRef.current.children.forEach((layer, index) => {
          const material = openValleyAtmosphereMaterialRefs.current[index]
          if (material) {
            material.opacity =
              atmospherePresence * (layer.userData.opacity ?? 0.1) *
              THREE.MathUtils.lerp(1, 0.42, night)
            material.color.copy(atmosphereColor)
          }
          layer.position.x = layer.userData.baseX +
            Math.sin(state.clock.elapsedTime * (0.025 + index * 0.006) + index) * (3.2 + index)
        })
      }
    }

    const daylightExposure = THREE.MathUtils.lerp(
      CAVE_LOOK.exposure,
      THREE.MathUtils.lerp(1.34, 1.42, holdClear),
      exitAirMix,
    )
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(
      daylightExposure,
      0.98,
      night,
    )

    const openAirFogDensity = THREE.MathUtils.lerp(0.00098, 0.00076, night)
    // Fog and valley geometry are already prepared behind the opening. At the
    // portal the mist is dense enough to read immediately, but not so dense
    // that every landscape silhouette disappears into a uniform white field.
    // It gathers to the full HOLD density as the camera reaches its settled
    // outdoor pose, preserving the intended discovery without a blank frame.
    const caveAirFog = THREE.MathUtils.lerp(0.00105, 0.00155, exitAirMix)
    const exitFogSettle = smoothstep(10.25, JOURNEY_CAVE_SEQUENCE.fogGate, progress)
    const exteriorFogDensity = THREE.MathUtils.lerp(0.0057, 0.0088, exitFogSettle)
    const preHoldFog = THREE.MathUtils.lerp(
      caveAirFog,
      exteriorFogDensity,
      valleyFogArrival,
    )
    const entranceFog = THREE.MathUtils.lerp(
      preHoldFog,
      openAirFogDensity,
      holdClear,
    )
    if (state.scene.fog) {
      const openAirFog = frameColors.openAirFog
        .copy(skyColor)
        .multiplyScalar(THREE.MathUtils.lerp(0.91, 0.82, night))
        .multiplyScalar(THREE.MathUtils.lerp(0.74, 1, exitFogSettle))
      const exteriorFogColorMix = smoothstep(7.8, JOURNEY_CAVE_SEQUENCE.fogGate, progress)
      state.scene.fog.color
        .set('#101817')
        .lerp(openAirFog, exteriorFogColorMix)
      state.scene.fog.density = diagnostics.fog
        ? 0
        : Math.max(
          openAirFogDensity,
          entranceFog * (1 - travelWindRef.current * 0.08),
        )
      if (qaCaptureEnabled) {
        document.documentElement.dataset.journeyFogDensity =
          state.scene.fog.density.toFixed(7)
        document.documentElement.dataset.journeyFogArrival =
          valleyFogArrival.toFixed(7)
        document.documentElement.dataset.journeyCaveRelease =
          caveRelease.toFixed(7)
        document.documentElement.dataset.journeyExitAirMix =
          exitAirMix.toFixed(7)
      }
    }

    if (sunRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.sunIntensity,
        THREE.MathUtils.lerp(1.55, 1.62, holdClear),
        caveDaylight,
      )
      sunRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 0.52, night)
      sunRef.current.color
        .set('#fff0cf')
        .lerp(frameColors.sunSunset, sunset * 0.86)
        .lerp(frameColors.sunNight, night)
      sunRef.current.position.x = THREE.MathUtils.lerp(-90, 40, eveningProgress)
      sunRef.current.position.y = THREE.MathUtils.lerp(130, 30, eveningProgress)
    }
    if (skyLightRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.skyIntensity,
        THREE.MathUtils.lerp(1.5, 1.62, holdClear),
        caveDaylight,
      )
      skyLightRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 1.08, night)
      skyLightRef.current.color
        .set('#d9eff4')
        .lerp(frameColors.skyLightSunset, sunset * 0.72)
        .lerp(frameColors.skyLightNight, night)
      skyLightRef.current.groundColor
        .set('#7d8072')
        .lerp(frameColors.skyGroundSunset, sunset * 0.62)
        .lerp(frameColors.skyGroundNight, night)
    }
    if (ambientRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.ambientIntensity,
        THREE.MathUtils.lerp(0.35, 0.43, holdClear),
        caveDaylight,
      )
      ambientRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 0.23, night)
      ambientRef.current.color
        .set('#a7b8b4')
        .lerp(frameColors.ambientSunset, sunset * 0.58)
        .lerp(frameColors.ambientNight, night)
    }

    if (caveGuideLightRef.current && camera?.isCamera) {
      caveGuideLightRef.current.position.copy(camera.position)
      caveGuideLightRef.current.intensity =
        (1 - smoothstep(8, 16, progress)) *
        CAVE_LOOK.guideLightIntensity *
        THREE.MathUtils.lerp(1, MOBILE_JOURNEY_COMPOSITION.caveLightScale, portraitFactor)
      caveGuideLightRef.current.color
        .set('#87928d')
        .lerp(frameColors.caveMobileGuide, mobileCaveClarity)
    }
    const caveGrazingPresence = 1 - smoothstep(10.5, 14.1, progress)
    const caveMobileLightScale = THREE.MathUtils.lerp(
      1,
      MOBILE_JOURNEY_COMPOSITION.caveLightScale,
      portraitFactor,
    )
    if (caveLeftGrazingLightRef.current) {
      caveLeftGrazingLightRef.current.intensity = caveGrazingPresence * 14 * caveMobileLightScale
      caveLeftGrazingLightRef.current.color
        .set('#918c78')
        .lerp(frameColors.caveMobileWarm, mobileCaveClarity)
    }
    if (caveRightGrazingLightRef.current) {
      caveRightGrazingLightRef.current.intensity = caveGrazingPresence * 10 * caveMobileLightScale
      caveRightGrazingLightRef.current.color
        .set('#6f8d86')
        .lerp(frameColors.caveMobileCool, mobileCaveClarity)
    }
    if (caveExitLightRef.current) {
      // A stable source just beyond the opening lets exterior daylight wrap
      // onto the portal wall/floor. It rises gradually as the viewer
      // approaches, instead of lifting the whole cave or flashing at a story
      // threshold.
      caveExitLightRef.current.intensity = CAVE_LOOK.exitLightIntensity * caveExitBounce
    }
    if (caveExitGlowMaterialRef.current) {
      const approachGlow = smoothstep(3.2, 10.8, progress) *
        (1 - smoothstep(12.7, JOURNEY_CAVE_SEQUENCE.fogGate, progress))
      caveExitGlowMaterialRef.current.opacity = approachGlow * 0.11
      if (caveExitGlowRef.current) caveExitGlowRef.current.visible = approachGlow > 0.002
    }
    if (qaCaptureEnabled) {
      document.documentElement.dataset.journeyExposure =
        state.gl.toneMappingExposure.toFixed(6)
      document.documentElement.dataset.journeySunIntensity =
        (sunRef.current?.intensity ?? 0).toFixed(6)
      document.documentElement.dataset.journeySkyIntensity =
        (skyLightRef.current?.intensity ?? 0).toFixed(6)
      document.documentElement.dataset.journeyAmbientIntensity =
        (ambientRef.current?.intensity ?? 0).toFixed(6)
      document.documentElement.dataset.journeyCaveLookdev =
        groups.cave.some((object) => object.userData.journeyCaveLookdevVersion)
          ? 'v004-natural-floor-meshopt'
          : 'production'
    }

    const starOpacity = starWeight
    if (starMaterialRef.current) {
      starMaterialRef.current.uniforms.uJourneyOpacity.value = starOpacity
      starMaterialRef.current.uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    if (starPointsRef.current) {
      starPointsRef.current.visible = starOpacity > 0.002 && !diagnostics.stars
    }
    if (qaCaptureEnabled) {
      document.documentElement.dataset.journeyStarsVisible = String(starOpacity > 0.002)
    }
    const bridgeReveal = smoothstep(0, 0.72, riverConnectionProgress)
    const milkyWayReveal = smoothstep(0.28, 1, riverConnectionProgress)
    const bridgeFade = 1 - smoothstep(0.7, 1, riverConnectionProgress) * 0.94
    if (skyBridgeRef.current) {
      const uniforms = skyBridgeRef.current.material.uniforms
      uniforms.uJourneyReveal.value = bridgeReveal
      uniforms.uJourneyOpacity.value =
        smoothstep(0, 0.08, riverConnectionProgress) * bridgeFade
      uniforms.uJourneyTime.value = state.clock.elapsedTime
      skyBridgeRef.current.visible = bridgeReveal > 0.002 && !diagnostics.stars
    }
    if (milkyMaterialRef.current) {
      milkyMaterialRef.current.uniforms.uJourneyOpacity.value = milkyWayReveal * 0.68
      milkyMaterialRef.current.uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    if (milkyPointsRef.current) {
      milkyPointsRef.current.visible = milkyWayReveal > 0.002 && !diagnostics.stars
      milkyPointsRef.current.geometry.setDrawRange(
        0,
        Math.floor(milkyPointsRef.current.geometry.attributes.position.count * milkyWayReveal),
      )
    }

    const figureGather = smoothstep(
      JOURNEY_NIGHT_SEQUENCE.figureGatherStart,
      JOURNEY_NIGHT_SEQUENCE.figureGatherEnd,
      progress,
    )
    const figureRelease = smoothstep(
      JOURNEY_NIGHT_SEQUENCE.figureReleaseStart,
      JOURNEY_NIGHT_SEQUENCE.figureReleaseEnd,
      progress,
    )
    const figurePresence = figureGather * (1 - figureRelease)
    if (seatedFigureMaterialRef.current) {
      seatedFigureMaterialRef.current.uniforms.uJourneyMorph.value = figurePresence
      seatedFigureMaterialRef.current.uniforms.uJourneyOpacity.value =
        figureGather * (1 - figureRelease) * 0.96
      seatedFigureMaterialRef.current.uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    if (seatedFigureSilhouetteMaterialRef.current) {
      const silhouetteReveal = smoothstep(
        JOURNEY_NIGHT_SEQUENCE.figureSilhouetteStart,
        JOURNEY_NIGHT_SEQUENCE.figureSilhouetteEnd,
        progress,
      )
      seatedFigureSilhouetteMaterialRef.current.opacity =
        silhouetteReveal * (1 - figureRelease) * 0.82
    }
    if (seatedFigureRef.current) {
      seatedFigureRef.current.scale.setScalar(0.74)
      seatedFigureRef.current.position.y = 0.24
      const groundShadow = seatedFigureRef.current.getObjectByName('JOURNEY_FIGURE_GROUND_SHADOW')
      if (groundShadow?.material) {
        groundShadow.material.opacity = figurePresence * (1 - night * 0.35) * 0.22
      }
      seatedFigureRef.current.visible = figurePresence > 0.002
    }

    const openValley = getJourneyValleyPresence(progress)
    phase2Groups.ridges.forEach((mesh) => {
      const material = mesh.material
      const isFar = mesh.name.toUpperCase().includes('_FAR')
      // These are low valley-support sheets rather than the hero skyline.
      // Revealing them with the far silhouette exposed their long lower edges
      // as horizontal bands inside the fog, so they arrive with the ground.
      const ridgeReveal = getJourneyValleyGroundPresence(progress)
      mesh.visible = ridgeReveal > 0.01
      material.opacity = Math.pow(ridgeReveal, 1.45) * (isFar ? 0.72 : 0.95)
      material.color
        .set(isFar ? '#a9bbb5' : '#6f887b')
        .lerp(isFar ? frameColors.ridgeFarSunset : frameColors.ridgeNearSunset, sunset * 0.48)
        .lerp(isFar ? frameColors.ridgeFarNight : frameColors.ridgeNearNight, night * 0.84)
      if ('emissiveIntensity' in material) {
        material.emissiveIntensity = THREE.MathUtils.lerp(0.035, 0.016, night)
      }
      const uniforms = material.userData.journeyAlpineUniforms
      if (uniforms) {
        uniforms.uJourneySunset.value = sunset
        uniforms.uJourneyNight.value = night
        uniforms.uJourneyRiverLight.value = night * riverConnectionProgress * 0.16
        uniforms.uJourneyDiscovery.value = 0
        uniforms.uJourneyTime.value = state.clock.elapsedTime
        uniforms.uJourneyEntranceReveal.value = ridgeReveal
      }
    })
    phase2Groups.clouds.forEach((cloud, index) => {
      // The legacy Phase-2 cloud sheets are rectangular guide planes. Their
      // CanvasTexture transparency is not reliable enough to place against a
      // clear sky, so the authored drifting cloud layer owns the sky instead.
      cloud.visible = false
      const material = cloud.material
      material.opacity = 0
      material.color
        .set('#e9eee7')
        .lerp(frameColors.phaseCloudSunset, sunset * 0.58)
        .lerp(frameColors.phaseCloudNight, night * 0.82)
      const base = cloud.userData.journeyBasePosition
      cloud.position.x = base.x + Math.sin(state.clock.elapsedTime * (0.018 + index * 0.004) + index) * (1.2 + index * 0.35)
      cloud.position.y = base.y + Math.sin(state.clock.elapsedTime * 0.011 + index * 1.7) * 0.5
    })
    const cloudbreakDiscovery = discoveryPreview
      ? 1
      : smoothstep(20, 27, progress) * (1 - smoothstep(52, 64, progress))
    if (cloudbreakMaterialRef.current) {
      cloudbreakMaterialRef.current.opacity =
        openValley * (1 - night) * (0.006 + cloudbreakDiscovery * 0.19)
      cloudbreakMaterialRef.current.color
        .set('#fff4c7')
        .lerp(frameColors.cloudbreakSunset, sunset * 0.72)
    }
    if (cloudbreakRef.current) {
      cloudbreakRef.current.position.x =
        56 + Math.sin(state.clock.elapsedTime * 0.035) * 4.5
    }
    if (motesMaterialRef.current) {
      motesMaterialRef.current.opacity =
        openValley * (1 - night * 0.72) * (0.015 + travelWindRef.current * 0.09)
      motesMaterialRef.current.color
        .set('#b9f4c5')
        .lerp(frameColors.motesSunset, sunset)
        .lerp(frameColors.motesNight, night)
    }
    if (motesRef.current) {
      motesRef.current.rotation.y =
        Math.sin(state.clock.elapsedTime * 0.065) * 0.035 +
        travelWindRef.current * 0.12
      motesRef.current.position.x = travelWindRef.current * 1.8
      motesRef.current.position.y =
        Math.sin(state.clock.elapsedTime * 0.19) * 0.7 +
        travelWindRef.current * 0.44
    }
    if (mysticLightRef.current) {
      mysticLightRef.current.intensity = openValley * (0.34 + sunset * 0.78 + night * 0.22)
      mysticLightRef.current.color
        .set('#a9e5c0')
        .lerp(frameColors.mysticSunset, sunset)
        .lerp(frameColors.mysticNight, night)
    }
    if (distantBirdsRef.current && distantBirdsMaterialRef.current) {
      const discovery = smoothstep(24, 32, progress) * (1 - smoothstep(52, 64, progress))
      distantBirdsMaterialRef.current.opacity =
        openValley * (1 - night) * discovery * 0.38
      distantBirdsRef.current.position.x =
        24 + Math.sin(state.clock.elapsedTime * 0.17) * 4.2
      distantBirdsRef.current.position.y =
        42 + Math.sin(state.clock.elapsedTime * 0.23) * 1.1
    }

    // `uJourneyRiverGlow` was the second, progress-driven illumination that
    // fired after the HOLD. Keep it at zero; the preferred first light is the
    // moving connection pulse driven by `uJourneySkyConnect` below.
    const riverGlow = 0
    if (riverMysticLightRef.current) {
      riverMysticLightRef.current.intensity =
        night * riverConnectionProgress * 1.8
    }
    // The exterior has physical depth before the Fog/HOLD gate. Showing its
    // mountains through the portal prevents a full-screen sky color from
    // reading as a white wall, while Fog itself still begins only after the
    // authored portal crossing.
    // Keep the geometry resident and reveal only its contrast from the fog;
    // a raw opaque visibility switch reads as a full-screen black slab.
    groups.mountains.forEach((mesh) => {
      // All source mountain masses are distant from this portal viewpoint.
      // Let their silhouette lead the lower valley layers irrespective of the
      // source asset's near/far material naming.
      const mountainReveal = getJourneyValleyFarPresence(progress)
      mesh.visible = mountainReveal > 0.0002
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        if ('emissiveIntensity' in material) {
          material.emissiveIntensity = THREE.MathUtils.lerp(0.026, 0.055, night)
        }
        const uniforms = material.userData.journeyAlpineUniforms
        if (uniforms) {
          uniforms.uJourneySunset.value = sunset
          uniforms.uJourneyNight.value = night
          uniforms.uJourneyRiverLight.value =
            night * riverConnectionProgress * 0.72
          uniforms.uJourneyDiscovery.value =
            openValley * (1 - night) * (0.045 + cloudbreakDiscovery * 0.955)
          uniforms.uJourneyTime.value = state.clock.elapsedTime
          uniforms.uJourneyEntranceReveal.value = mountainReveal
        }
      })
    })
    groups.canopy.forEach((canopy) => {
      canopy.visible = false
      canopy.material.opacity = 0
    })
    groups.water.forEach((mesh, index) => {
      const valleyRiverReveal = getJourneyValleyRiverPresence(progress)
      mesh.visible = valleyRiverReveal > 0.01
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        const isClearRiver = material.name === 'MAT_JOURNEY_CLEAR_RIVER'
        if ('color' in material) {
          material.color
            .set(isClearRiver ? '#5f998e' : '#4f8c85')
            .lerp(
              isClearRiver ? frameColors.clearRiverSunset : frameColors.riverSunset,
              sunset * 0.22,
            )
            .lerp(isClearRiver ? frameColors.clearRiverNight : frameColors.riverNight, night)
        }
        if ('opacity' in material) {
          material.opacity = valleyRiverReveal * THREE.MathUtils.lerp(
            isClearRiver ? 0.18 : 0.76,
            isClearRiver ? 0.32 : 0.38,
            night,
          )
        }
        if ('roughness' in material) {
          material.roughness = THREE.MathUtils.lerp(
            isClearRiver ? 0.18 : 0.14,
            isClearRiver ? 0.04 : 0.05,
            night,
          )
        }
        if (isClearRiver && 'transmission' in material) {
          material.transmission = THREE.MathUtils.lerp(0.001, 0.54, night)
          material.clearcoatRoughness = THREE.MathUtils.lerp(0.14, 0.04, night)
          material.attenuationColor
            .set('#6aa99c')
            .lerp(frameColors.clearRiverAttenuationSunset, sunset * 0.2)
            .lerp(frameColors.clearRiverAttenuationNight, night)
        }
        if ('emissive' in material) {
          material.emissive.set(isClearRiver ? '#102e2d' : '#155b59')
          material.emissiveIntensity = isClearRiver
            ? THREE.MathUtils.lerp(0.012, 0.055, night)
            : THREE.MathUtils.lerp(0.13, 0.055, night)
        }
        const uniforms = material.userData.journeyWaterUniforms
        if (uniforms) {
          uniforms.uJourneySunset.value = sunset
          uniforms.uJourneyNight.value = night
          uniforms.uJourneyRiverGlow.value = riverGlow
          uniforms.uJourneySkyConnect.value = riverConnectionProgress
          uniforms.uJourneyTime.value = state.clock.elapsedTime
          uniforms.uJourneyTravelWind.value = travelWindRef.current
        }
        if (material.map) {
          material.map.wrapS = THREE.RepeatWrapping
          material.map.wrapT = THREE.RepeatWrapping
          material.map.offset.y = (material.map.offset.y - delta * (0.018 + index * 0.002)) % 1
        }
      })
    })
    groups.riverGlow.forEach((mesh) => {
      const uniforms = mesh.material.userData.journeyRiverGlowUniforms
      if (!uniforms) return
      uniforms.uJourneyGlow.value = riverGlow
      uniforms.uJourneySkyConnect.value = riverConnectionProgress
      uniforms.uJourneyTime.value = state.clock.elapsedTime
      mesh.visible = night > 0.06 && riverConnectionProgress > 0.002
    })
    // Portal culling follows the actual camera crossing, not a story-progress
    // threshold. The rock frame remains solid through the portal plane, then
    // fades only while it travels behind/outside the screen. Reverse traversal
    // evaluates the same signed distance in the opposite direction.
    const portalDistancePresence = smoothstep(
      CAVE_PORTAL_FADE_END_Z,
      CAVE_PORTAL_FADE_START_Z,
      cavePortalCameraZRef.current,
    )
    const portalTimelinePresence = 1 - smoothstep(
      JOURNEY_CAVE_SEQUENCE.portalCrossing,
      JOURNEY_CAVE_SEQUENCE.caveFadeEnd,
      progress,
    )
    const cavePresence = Math.min(portalDistancePresence, portalTimelinePresence)
    if (qaCaptureEnabled) {
      document.documentElement.dataset.journeyCaveGeometryPresence = cavePresence.toFixed(7)
    }
    if (
      cavePresence !== cavePresenceRef.current ||
      Math.abs(caveExitBounce - caveExitBounceRef.current) > 0.0001
    ) {
      const caveVisible = cavePresence > 0.004
      groups.cave.forEach((object) => {
        object.visible = caveVisible && !diagnostics.cave
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => {
          const baseOpacity = material.userData.journeyCaveBaseOpacity ?? 1
          material.opacity = baseOpacity * cavePresence
          const baseColor = material.userData.journeyCaveBaseColor
          if (baseColor && material.color) {
            material.color.copy(baseColor)
            const mobileColor = material.userData.journeyCaveMobileColor
            if (mobileColor) material.color.lerp(mobileColor, mobileCaveClarity * 0.82)
            material.color.lerp(frameColors.caveExitTint, caveExitBounce * 0.28)
          }
          const caveSurfaceUniforms = material.userData.journeyCaveSurfaceUniforms
          if (caveSurfaceUniforms) {
            caveSurfaceUniforms.uJourneyCaveMobileClarity.value = mobileCaveClarity
          }
          const baseEmissive = material.userData.journeyCaveBaseEmissive
          if (baseEmissive && material.emissive) {
            material.emissive.copy(baseEmissive).lerp(
              frameColors.caveExitEmissive,
              caveExitBounce * 0.68,
            )
            material.emissiveIntensity =
              (material.userData.journeyCaveBaseEmissiveIntensity ?? 0) +
              caveExitBounce * 0.22
          }
          // Keep the occlusion policy stable while opacity fades. The old
          // 0.18 cutoff made the cave abruptly stop writing depth mid-scroll.
          material.depthWrite = true
        })
      })
      cavePresenceRef.current = cavePresence
      caveExitBounceRef.current = caveExitBounce
    }
  })

  useEffect(() => () => {
    if (qaCaptureEnabled) delete window.__JOURNEY_V1_CAPTURE__
  }, [qaCaptureEnabled])

  return (
    <>
      <primitive object={root} />
      <primitive object={phase2Root} />
      <FarRidgeCrown progress={progress} biomeMacroTexture={biomeMacroTexture} />
      <NaturalRiverCorridor
        progress={progress}
        qualityScale={quality.particles}
        reflectionDisabled={diagnostics.reflection}
      />
      <ValleyMeadow
        diagnostics={diagnostics}
        portraitFactor={scenePortraitFactor}
        progress={progress}
        travelWindRef={travelWindRef}
        qualityScale={mobileMeadowQualityScale}
      />
      <ValleyForestEdge
        progress={progress}
        qualityScale={quality.particles}
      />
      <SkyAtmosphere
        meshRef={skyAtmosphereRef}
        materialRef={skyAtmosphereMaterialRef}
      />
      <RiverRipple
        groupRef={riverRippleRef}
        materialRefs={riverRippleMaterialRefs}
      />
      <hemisphereLight ref={skyLightRef} intensity={1.65} />
      <directionalLight
        ref={sunRef}
        position={[-90, 130, -40]}
        intensity={3.2}
        castShadow={quality.shadows && !diagnostics.shadows}
        shadow-mapSize-width={quality.name === 'high' ? 1536 : 1024}
        shadow-mapSize-height={quality.name === 'high' ? 1536 : 1024}
        shadow-camera-near={0.5}
        shadow-camera-far={420}
        shadow-camera-left={-150}
        shadow-camera-right={150}
        shadow-camera-top={150}
        shadow-camera-bottom={-150}
        shadow-bias={-0.00008}
      />
      <ambientLight ref={ambientRef} intensity={0.22} color="#d6e2dc" />
      <pointLight
        ref={caveGuideLightRef}
        intensity={CAVE_LOOK.guideLightIntensity}
        distance={34}
        decay={1.82}
        color="#87928d"
      />
      <pointLight
        ref={caveLeftGrazingLightRef}
        position={[-2.7, 3.4, 8.4]}
        intensity={0.68}
        distance={24}
        decay={1.62}
        color="#918c78"
      />
      <pointLight
        ref={caveRightGrazingLightRef}
        position={[2.5, 4.7, 1.8]}
        intensity={0.46}
        distance={22}
        decay={1.68}
        color="#6f8d86"
      />
      <pointLight
        ref={caveExitLightRef}
        position={[0, 6.2, -5.4]}
        intensity={0}
        distance={34}
        decay={1.82}
        color="#91aaa1"
      />
      <CaveExitGlow
        spriteRef={caveExitGlowRef}
        materialRef={caveExitGlowMaterialRef}
      />
      <pointLight
        ref={mysticLightRef}
        position={[0, 28, -72]}
        intensity={0}
        distance={230}
        decay={2}
        color="#a9e5c0"
      />
      <pointLight
        ref={riverMysticLightRef}
        position={[0, 4.2, -32]}
        intensity={0}
        distance={105}
        decay={2}
        color="#61dff0"
      />
      <MysticMotes
        groupRef={motesRef}
        materialRef={motesMaterialRef}
        qualityScale={quality.particles}
      />
      <DistantBirds
        groupRef={distantBirdsRef}
        materialRef={distantBirdsMaterialRef}
      />
      <ValleyFogBanks
        groupRef={valleyFogGroupRef}
        materialRefs={valleyFogMaterialRefs}
        layers={quality.fogLayers}
        mobile={size.width / Math.max(size.height, 1) < 0.82}
      />
      <OpenValleyAtmosphere
        groupRef={openValleyAtmosphereRef}
        materialRefs={openValleyAtmosphereMaterialRefs}
      />
      <SeatedStarFigure
        groupRef={seatedFigureRef}
        materialRef={seatedFigureMaterialRef}
        silhouetteMaterialRef={seatedFigureSilhouetteMaterialRef}
        qualityScale={quality.particles}
      />
      <DriftingClouds
        groupRef={cloudGroupRef}
        materialRefs={cloudMaterialRefs}
      />
      <group ref={skyRigRef}>
        <CloudbreakLight
          spriteRef={cloudbreakRef}
          materialRef={cloudbreakMaterialRef}
        />
        <StarField
          materialRef={starMaterialRef}
          pointsRef={starPointsRef}
          qualityScale={quality.particles}
        />
        <SkyBridge meshRef={skyBridgeRef} />
        <StarField
          materialRef={milkyMaterialRef}
          pointsRef={milkyPointsRef}
          milkyWay
          qualityScale={quality.particles}
        />
      </group>
    </>
  )
}
