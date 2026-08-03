import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// Versioned query prevents a previously cached GLB from reviving removed assets.
const MODEL_URL = '/journey/models/journey-v16-pbr-ktx2.glb?v=1-memory-pbr'

// Creator controls: visual transition timing and cave brightness.
const VISUAL_TIMING = {
  sunsetStart: 35,
  sunsetEnd: 45,
  nightStart: 45,
  nightEnd: 55,
  endingLiftStart: 72,
  endingLiftEnd: 88,
  endingWideStart: 82,
  endingWideEnd: 100,
}

const CAVE_LOOK = {
  exposure: 2.6,
  sunIntensity: 0.74,
  skyIntensity: 0.62,
  ambientIntensity: 0.22,
  guideLightIntensity: 1.16,
  materialTint: '#46504b',
}

const clamp01 = (value) => Math.min(1, Math.max(0, value))

const smoothstep = (edge0, edge1, value) => {
  const x = clamp01((value - edge0) / (edge1 - edge0))
  return x * x * (3 - 2 * x)
}

const storyProgressToClipProgress = (progress) => {
  if (progress <= 15) {
    return THREE.MathUtils.lerp(0, 0.395, smoothstep(0, 15, progress))
  }
  if (progress <= 20) {
    return THREE.MathUtils.lerp(0.395, 0.447, smoothstep(15, 20, progress))
  }
  if (progress <= 80) {
    return THREE.MathUtils.lerp(0.447, 0.8, (progress - 20) / 60)
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
  const stars = []

  for (let index = 0; index < count; index += 1) {
    const pathProgress = milkyWay ? seededRandom(index + 4100) : 0
    const pathCenter =
      -12 +
      Math.sin(pathProgress * 2.35 - 0.42) * 20 +
      pathProgress * 10
    const pathWidth = 6 + Math.pow(pathProgress, 1.75) * 145
    const horizontal = milkyWay
      ? pathCenter + (seededRandom(index + 1) - 0.5) * pathWidth
      : (seededRandom(index + 1) - 0.5) * radius * 1.28
    const vertical = milkyWay
      ? -42 + pathProgress * 338 + (seededRandom(index + 2500) - 0.5) * 9
      : -34 + seededRandom(index + 800) * 315
    stars.push({
      horizontal,
      vertical,
      depth: -radius - seededRandom(index + 1700) * (milkyWay ? 95 : 190),
      size: 0.7 + seededRandom(index + 3600) * 1.8,
      pathProgress,
    })
  }

  if (milkyWay) stars.sort((a, b) => a.pathProgress - b.pathProgress)
  stars.forEach((star, index) => {
    positions[index * 3] = star.horizontal
    positions[index * 3 + 1] = star.vertical
    positions[index * 3 + 2] = star.depth
    sizes[index] = star.size
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
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
      uJourneySize: { value: milkyWay ? 1.25 : 0.92 },
    },
    vertexShader: `
      attribute float aSize;
      uniform float uJourneySize;
      varying float vJourneyStarSeed;
      void main() {
        vJourneyStarSeed = aSize;
        gl_PointSize = uJourneySize * (0.72 + aSize * 0.68);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uJourneyOpacity;
      uniform float uJourneyTime;
      uniform vec3 uJourneyColor;
      varying float vJourneyStarSeed;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float softStar = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
        float core = 1.0 - smoothstep(0.0, 0.16, distanceFromCenter);
        float twinkle = 0.88 + 0.12 * sin(uJourneyTime * 0.72 + vJourneyStarSeed * 8.7);
        float alpha = (softStar * 0.68 + core * 0.42) * uJourneyOpacity * twinkle;
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

function createCloudTexture(seed) {
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 288
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.save()
  context.filter = 'blur(18px)'

  for (let index = 0; index < 15; index += 1) {
    const centerX = 105 + seededRandom(seed + index * 17) * 558
    const centerY = 106 + seededRandom(seed + index * 29) * 68
    const radiusX = 46 + seededRandom(seed + index * 41) * 72
    const radiusY = 20 + seededRandom(seed + index * 53) * 26
    const alpha = 0.12 + seededRandom(seed + index * 67) * 0.16
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

function cloneMaterial(material) {
  const clone = material.clone()
  if ('roughness' in clone) clone.roughness = Math.max(0.72, clone.roughness ?? 0.8)
  if ('metalness' in clone) clone.metalness = 0
  return clone
}

function applyAlpineIllustration(material, isFarRidge) {
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
    uJourneyTime: { value: 0 },
    uJourneyWatercolor: { value: getAlpineWatercolorTexture() },
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
uniform float uJourneyTime;
uniform sampler2D uJourneyWatercolor;
uniform sampler2D uJourneyTriplanarNormal;
uniform sampler2D uJourneyTriplanarRoughness;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float journeyAltitude = smoothstep(18.0, 51.0, vJourneyWorldPosition.y);
float journeySteepness = smoothstep(0.18, 0.88, 1.0 - abs(vJourneyWorldNormal.y));
float journeyMacro = 0.5 + 0.5 * sin(
  vJourneyWorldPosition.x * 0.071 +
  sin(vJourneyWorldPosition.z * 0.052) * 1.9 +
  sin((vJourneyWorldPosition.x + vJourneyWorldPosition.z) * 0.021) * 1.2
);
float journeyFine = 0.5 + 0.5 * sin(
  vJourneyWorldPosition.x * 0.43 -
  vJourneyWorldPosition.z * 0.31 +
  sin(vJourneyWorldPosition.y * 0.29) * 1.6
);
float journeyWash = mix(journeyMacro, journeyFine, 0.22);
vec3 journeyForest = vec3(0.072, 0.19, 0.125);
vec3 journeySummer = vec3(0.19, 0.355, 0.205);
vec3 journeyRock = vec3(0.245, 0.285, 0.275);
vec3 journeySnow = vec3(0.62, 0.66, 0.63);
float journeyRockMask = smoothstep(0.48, 0.94, journeySteepness + journeyAltitude * 0.24 + journeyMacro * 0.045);
float journeySnowMask = smoothstep(0.955, 1.0, journeyAltitude) * smoothstep(0.66, 0.94, 1.0 - journeySteepness) * smoothstep(0.82, 0.98, journeyFine);
vec3 journeyPaint = mix(journeyForest, journeySummer, smoothstep(0.08, 0.58, journeyAltitude));
journeyPaint = mix(journeyPaint, journeyRock, journeyRockMask * 0.67);
journeyPaint = mix(journeyPaint, journeySnow, journeySnowMask * 0.24);
${isFarRidge ? 'journeyPaint = mix(journeyPaint, vec3(0.32, 0.42, 0.43), 0.36);' : ''}
float journeyLowerValley = 1.0 - smoothstep(7.0, 30.0, vJourneyWorldPosition.y);
float journeyValleyPigment = mix(0.79, 1.07, journeyMacro * 0.72 + journeyFine * 0.28);
journeyPaint *= mix(1.0, journeyValleyPigment, journeyLowerValley * 0.58);
vec3 journeyLightDirection = normalize(vec3(-0.46, 0.72, 0.38));
float journeyFacing = dot(normalize(vJourneyWorldNormal), journeyLightDirection) * 0.5 + 0.5;
float journeyRidgeLight = smoothstep(0.40, 0.86, journeyFacing);
float journeyValleyShade = smoothstep(0.62, 0.12, journeyFacing) * (0.46 + journeySteepness * 0.54);
float journeyContour = 0.5 + 0.5 * sin(
  vJourneyWorldPosition.y * 0.41 +
  vJourneyWorldPosition.x * 0.038 +
  journeyMacro * 1.4
);
journeyContour = smoothstep(0.79, 0.96, journeyContour) * journeySteepness;
float journeyStrata = 0.5 + 0.5 * sin(
  vJourneyWorldPosition.y * 1.84 +
  vJourneyWorldPosition.x * 0.21 +
  sin(vJourneyWorldPosition.z * 0.17) * 2.6
);
float journeyFracture = 0.5 + 0.5 * sin(
  vJourneyWorldPosition.x * 0.63 -
  vJourneyWorldPosition.z * 0.37 +
  sin(vJourneyWorldPosition.y * 0.44) * 1.7
);
float journeyRockDetail = smoothstep(0.74, 0.96, journeyStrata * 0.58 + journeyFracture * 0.42);
journeyRockDetail *= journeyRockMask * (0.38 + journeySteepness * 0.62);
vec3 journeyShadow = mix(vec3(0.055, 0.13, 0.14), vec3(0.10, 0.16, 0.25), uJourneyNight);
journeyPaint = mix(journeyPaint, journeyShadow, journeyValleyShade * 0.46);
journeyPaint += vec3(0.10, 0.125, 0.095) * journeyRidgeLight * (0.052 + uJourneySunset * 0.065);
journeyPaint -= vec3(0.032, 0.046, 0.041) * journeyContour * 0.46;
journeyPaint -= vec3(0.034, 0.049, 0.052) * journeyRockDetail * (0.66 + uJourneyNight * 0.24);
vec2 journeyWatercolorUv = vec2(
  vJourneyWorldPosition.x * 0.0038 + vJourneyWorldPosition.z * 0.0009,
  vJourneyWorldPosition.y * 0.0062 - vJourneyWorldPosition.z * 0.0011
);
vec3 journeyWatercolor = texture2D(uJourneyWatercolor, fract(journeyWatercolorUv)).rgb;
float journeyPigment = dot(journeyWatercolor, vec3(0.28, 0.52, 0.20));
journeyPaint *= mix(0.94, 1.07, journeyPigment);
journeyPaint = mix(journeyPaint, journeyPaint * journeyWatercolor * 1.16, 0.10);
diffuseColor.rgb = journeyPaint * mix(0.955, 1.035, journeyWash);
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
vec3 journeyTextureValue = mix(vec3(1.0), journeyTriplanar * 1.06, 0.14);
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
normal = normalize(normal + journeyWorldDetail * 0.17);`,
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
roughnessFactor = mix(roughnessFactor, max(0.68, journeyProjectedRoughness), 0.48);`,
      )
    }
  }
  material.customProgramCacheKey = () => `journey-alpine-${isFarRidge ? 'far' : 'near'}-v5`
}

function applyWaterReflection(material) {
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return
  const journeyUniforms = {
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
varying vec3 vJourneyWaterPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vJourneyWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyWaterPosition;
uniform float uJourneyNight;
uniform float uJourneyRiverGlow;
uniform float uJourneySkyConnect;
uniform float uJourneyTime;
uniform float uJourneyTravelWind;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float journeyWaterRipple = 0.5 + 0.5 * sin(vJourneyWaterPosition.x * 0.72 + vJourneyWaterPosition.z * 0.31 - uJourneyTime * 1.25);
float journeyWaterCrossRipple = 0.5 + 0.5 * sin(vJourneyWaterPosition.x * 0.19 - vJourneyWaterPosition.z * 0.84 + uJourneyTime * 0.72);
float journeyWindRipple = 0.5 + 0.5 * sin(
  vJourneyWaterPosition.x * 1.46 +
  vJourneyWaterPosition.z * 0.57 -
  uJourneyTime * (2.1 + uJourneyTravelWind * 3.4)
);
journeyWaterRipple = mix(journeyWaterRipple, journeyWindRipple, uJourneyTravelWind * 0.32);
float journeyWaterSparkSeed = fract(sin(dot(floor(vJourneyWaterPosition.xz * 1.45), vec2(12.9898, 78.233))) * 43758.5453);
float journeyWaterSparkle = pow(journeyWaterSparkSeed, 11.0) * smoothstep(0.64, 0.96, journeyWaterRipple * journeyWaterCrossRipple);
vec2 journeyReflectionScale = vec2(0.72, 0.38);
vec2 journeyReflectionGrid = floor(vJourneyWaterPosition.xz * journeyReflectionScale);
vec2 journeyReflectionCell = fract(vJourneyWaterPosition.xz * journeyReflectionScale) - 0.5;
float journeyReflectionSeed = fract(sin(dot(journeyReflectionGrid, vec2(39.3468, 11.1351))) * 19642.349);
vec2 journeyReflectionOffset = vec2(
  fract(journeyReflectionSeed * 17.13),
  fract(journeyReflectionSeed * 41.73)
) - 0.5;
float journeyReflectedStar = 1.0 - smoothstep(
  0.018,
  0.105,
  length(journeyReflectionCell - journeyReflectionOffset * 0.62)
);
journeyReflectedStar *= smoothstep(0.91, 0.994, journeyReflectionSeed);
journeyReflectedStar *= 0.78 + 0.22 * sin(uJourneyTime * 1.1 + journeyReflectionSeed * 31.0);
float journeyMilkyAxis = vJourneyWaterPosition.x * 0.065 +
  sin(vJourneyWaterPosition.z * 0.045 - uJourneyTime * 0.035) * 0.52;
float journeyMilkyReflection = 1.0 - smoothstep(0.32, 1.52, abs(journeyMilkyAxis));
journeyMilkyReflection *= 0.18 + journeyWaterRipple * 0.22 + journeyWaterCrossRipple * 0.11;
float journeyRiverPath = clamp((8.0 - vJourneyWaterPosition.z) / 227.0, 0.0, 1.0);
float journeyReflectedRidge = 0.72 +
  sin(vJourneyWaterPosition.x * 0.074 + 0.5) * 0.065 +
  sin(vJourneyWaterPosition.x * 0.173 + 2.1) * 0.035;
float journeyMountainReflection = 1.0 - smoothstep(
  0.025,
  0.145,
  abs(journeyRiverPath - journeyReflectedRidge)
);
journeyMountainReflection *= 0.64 + journeyWaterRipple * 0.24 + journeyWaterCrossRipple * 0.12;
float journeyRiverHead = 1.0 - smoothstep(uJourneyRiverGlow - 0.045, uJourneyRiverGlow + 0.035, journeyRiverPath);
float journeyGroundRiver = 1.0 - smoothstep(1.35, 3.8, vJourneyWaterPosition.y);
float journeyRiverMask = journeyRiverHead * smoothstep(0.01, 0.075, uJourneyRiverGlow) * journeyGroundRiver;
float journeyRiverCurrent = 0.72 + journeyWaterRipple * 0.28;
float journeyConnectionPulse = sin(clamp(uJourneySkyConnect, 0.0, 1.0) * 3.14159265);
float journeyReflectionReveal = uJourneyNight * max(
  smoothstep(0.18, 0.92, uJourneyRiverGlow) * 0.82,
  smoothstep(0.03, 0.84, uJourneySkyConnect)
);
vec3 journeyNightMirror = mix(vec3(0.025, 0.085, 0.12), vec3(0.075, 0.22, 0.31), journeyWaterRipple * 0.54 + journeyWaterCrossRipple * 0.15);
diffuseColor.rgb = mix(diffuseColor.rgb, journeyNightMirror, uJourneyNight * 0.72);
diffuseColor.rgb += vec3(0.42, 0.68, 0.88) * journeyWaterSparkle * uJourneyNight * 0.72;
diffuseColor.rgb = mix(
  diffuseColor.rgb,
  vec3(0.012, 0.038, 0.074),
  journeyMountainReflection * journeyReflectionReveal * 0.24
);
diffuseColor.rgb += vec3(0.18, 0.34, 0.50) * journeyMountainReflection * journeyWaterCrossRipple * journeyReflectionReveal * 0.22;
diffuseColor.rgb += vec3(0.70, 0.84, 0.94) * journeyReflectedStar * journeyReflectionReveal * 1.15;
diffuseColor.rgb += vec3(0.28, 0.46, 0.72) * journeyMilkyReflection * journeyReflectionReveal * smoothstep(0.12, 1.0, uJourneySkyConnect) * 0.38;
diffuseColor.rgb += vec3(0.16, 0.44, 0.58) * journeyRiverMask * journeyRiverCurrent * 0.54;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.10, 0.34, 0.48) * journeyRiverMask * journeyRiverCurrent * (0.92 + journeyConnectionPulse * 0.22);`,
      )
  }
  material.customProgramCacheKey = () => 'journey-water-reflection-v7'
}

function createRiverHaloMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uJourneyRiverGlow: { value: 0 },
      uJourneySkyConnect: { value: 0 },
      uJourneyTime: { value: 0 },
    },
    vertexShader: `
      varying vec3 vJourneyHaloWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vJourneyHaloWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform float uJourneyRiverGlow;
      uniform float uJourneySkyConnect;
      uniform float uJourneyTime;
      varying vec3 vJourneyHaloWorldPosition;
      void main() {
        float path = clamp((8.0 - vJourneyHaloWorldPosition.z) / 227.0, 0.0, 1.0);
        float head = 1.0 - smoothstep(uJourneyRiverGlow - 0.055, uJourneyRiverGlow + 0.045, path);
        float groundRiver = 1.0 - smoothstep(1.35, 3.8, vJourneyHaloWorldPosition.y);
        float reveal = head * smoothstep(0.01, 0.075, uJourneyRiverGlow) * groundRiver;
        float connectionPulse = sin(clamp(uJourneySkyConnect, 0.0, 1.0) * 3.14159265);
        float current = 0.68 + 0.32 * sin(
          vJourneyHaloWorldPosition.x * 0.44 +
          vJourneyHaloWorldPosition.z * 0.2 -
          uJourneyTime * 1.45
        );
        vec3 color = mix(vec3(0.06, 0.28, 0.62), vec3(0.34, 0.72, 0.84), current);
        gl_FragColor = vec4(
          color * (0.72 + current * 0.46 + connectionPulse * 0.2),
          reveal * (0.045 + current * 0.072 + connectionPulse * 0.022)
        );
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function prepareWorld(source) {
  const root = source.clone(true)
  const groups = {
    cave: [],
    meadow: [],
    transition: [],
    characters: [],
    water: [],
    waterHalos: [],
    pebbles: [],
    foliage: [],
    broadleaf: [],
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

    materials.forEach((material) => {
      material.dithering = true
      if ('envMapIntensity' in material) material.envMapIntensity = 0.72
    })

    if (identity.includes('CAVE_') || identity.includes('WEB_CAVE')) {
      groups.cave.push(object)
      object.castShadow = true
      materials.forEach((material) => {
        material.userData.journeyCaveBaseOpacity = material.opacity
        material.transparent = true
        material.color?.lerp(new THREE.Color(CAVE_LOOK.materialTint), 0.7)
        if ('roughness' in material) material.roughness = 0.96
        if ('metalness' in material) material.metalness = 0
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

    const isPebble =
      identity.includes('PEBBLE') ||
      identity.includes('GRAVEL') ||
      identity.includes('BAR_V13')
    const isWater =
      !isPebble &&
      (identity.includes('WATER') ||
        identity.includes('EMERALD_S') ||
        identity.includes('RIPPLES'))

    if (isPebble) {
      groups.pebbles.push(object)
      materials.forEach((material) => {
        material.transparent = false
        material.opacity = 1
        material.depthWrite = true
        material.color?.lerp(new THREE.Color('#89958a'), 0.72)
        if ('roughness' in material) material.roughness = 0.94
        if ('metalness' in material) material.metalness = 0
      })
    }

    if (isWater) {
      groups.water.push(object)
      object.receiveShadow = false
      materials.forEach((material) => {
        if ('roughness' in material) material.roughness = 0.1
        if ('metalness' in material) material.metalness = 0.02
        material.transparent = true
        material.opacity = 0.88
        material.depthWrite = false
        material.color?.set('#3ba8a2')
        if ('emissive' in material) {
          material.emissive.set('#174f50')
          material.emissiveIntensity = 0.09
        }
        if (material.isMeshPhysicalMaterial) {
          material.ior = 1.333
          material.transmission = Math.max(material.transmission ?? 0, 0.12)
          material.thickness = 0.18
          material.clearcoat = 0.42
          material.clearcoatRoughness = 0.18
        }
        if (material.map) {
          material.map = material.map.clone()
          material.map.wrapS = THREE.RepeatWrapping
          material.map.wrapT = THREE.RepeatWrapping
          material.map.needsUpdate = true
        }
        applyWaterReflection(material)
      })
    }

    if (identity.includes('FOLIAGE')) {
      groups.foliage.push(object)
      if (identity.includes('BROADLEAF')) groups.broadleaf.push(object)
      object.castShadow = true
      object.userData.journeyBaseRotationZ = object.rotation.z
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
      groups.mountains.push(object)
      object.castShadow = false
      materials.forEach((material) => {
        const isFarRidge = identity.includes('FAR') || identity.includes('RIDGE')
        material.transparent = false
        material.opacity = 1
        material.depthWrite = true
        material.depthTest = true
        material.normalMap = null
        material.roughnessMap = null
        if (material.map) {
          material.map = material.map.clone()
          material.map.wrapS = THREE.RepeatWrapping
          material.map.wrapT = THREE.RepeatWrapping
          material.map.needsUpdate = true
        }
        material.color?.set(isFarRidge ? '#839493' : '#6e9362')
        if ('roughness' in material) material.roughness = 0.93
        if ('emissive' in material) {
          material.emissiveMap = null
          material.emissive.set(isFarRidge ? '#33474c' : '#2c4b2c')
          material.emissiveIntensity = 0.06
        }
        applyAlpineIllustration(material, isFarRidge)
      })
    }

    materials.forEach((material) => {
      material.needsUpdate = true
    })
  })

  groups.water.forEach((source, index) => {
    const halo = new THREE.Mesh(source.geometry, createRiverHaloMaterial())
    halo.name = `JOURNEY_RIVER_HALO_${index}`
    halo.position.y = 0.035
    halo.scale.set(1.018, 1.0, 1.018)
    halo.renderOrder = 3
    halo.frustumCulled = true
    source.add(halo)
    groups.waterHalos.push(halo)
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
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material, materialRef])

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
  const textures = useMemo(
    () => [createCloudTexture(9100), createCloudTexture(12200), createCloudTexture(15100)],
    [],
  )

  useEffect(
    () => () => {
      textures.forEach((texture) => texture.dispose())
    },
    [textures],
  )

  const clouds = [
    { position: [-108, 104, -360], scale: [176, 48, 1], opacity: 0.34, speed: 2.7 },
    { position: [92, 124, -410], scale: [220, 56, 1], opacity: 0.28, speed: 2.1 },
    { position: [8, 76, -330], scale: [130, 34, 1], opacity: 0.22, speed: 3.2 },
  ]

  return (
    <group ref={groupRef}>
      {clouds.map((cloud, index) => (
        <sprite
          key={cloud.position.join('-')}
          position={cloud.position}
          scale={cloud.scale}
          renderOrder={-1}
          frustumCulled={false}
          userData={{
            baseX: cloud.position[0],
            baseY: cloud.position[1],
            opacity: cloud.opacity,
            speed: cloud.speed,
          }}
        >
          <spriteMaterial
            ref={(material) => {
              materialRefs.current[index] = material
            }}
            map={textures[index]}
            color="#f4f5ef"
            transparent
            opacity={0}
            alphaTest={0.018}
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
  presentationMode = false,
  outroMode = false,
  quality = { name: 'high', particles: 1, shadows: true, fogLayers: 7 },
}) {
  const renderer = useThree((state) => state.gl)
  const ktx2Loader = useMemo(
    () => new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer),
    [renderer],
  )
  const configureLoader = useCallback(
    (loader) => loader.setKTX2Loader(ktx2Loader),
    [ktx2Loader],
  )
  const gltf = useGLTF(MODEL_URL, true, true, configureLoader)
  const { root, groups } = useMemo(() => prepareWorld(gltf.scene), [gltf.scene])
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
    }),
    [],
  )
  const pointerLookRef = useRef(new THREE.Vector2())
  const previousProgressRef = useRef(progress)
  const travelWindRef = useRef(0)
  const outroFramingRef = useRef(0)
  const gateCueRef = useRef({ type: null, elapsed: 0 })
  const sunRef = useRef(null)
  const skyLightRef = useRef(null)
  const ambientRef = useRef(null)
  const caveGuideLightRef = useRef(null)
  const mysticLightRef = useRef(null)
  const starMaterialRef = useRef(null)
  const milkyMaterialRef = useRef(null)
  const milkyPointsRef = useRef(null)
  const skyBridgeRef = useRef(null)
  const cloudGroupRef = useRef(null)
  const cloudMaterialRefs = useRef([])
  const skyRigRef = useRef(null)
  const motesRef = useRef(null)
  const motesMaterialRef = useRef(null)
  const riverRippleRef = useRef(null)
  const riverRippleMaterialRefs = useRef([])
  const riverReactionRef = useRef({ age: 0, fading: false })
  const interactionRef = useRef({ capturedGate: null })
  const { set, size, scene } = useThree()

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

  useEffect(() => {
    scene.fog = new THREE.FogExp2('#85989b', 0.013)
    return () => {
      scene.fog = null
    }
  }, [scene])

  useFrame((state, delta) => {
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

    if (gateCueRef.current.type !== activeGate) {
      gateCueRef.current.type = activeGate
      gateCueRef.current.elapsed = 0
    } else if (activeGate) {
      gateCueRef.current.elapsed += delta
    }
    const gateCueElapsed = gateCueRef.current.elapsed
    const gateArrivalPulse = activeGate ? Math.exp(-gateCueElapsed * 1.55) : 0
    const gateBreath = activeGate
      ? 0.5 + 0.5 * Math.sin(gateCueElapsed * 1.7)
      : 0

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

    outroFramingRef.current = presentationMode
      ? 0
      : THREE.MathUtils.damp(
          outroFramingRef.current,
          outroMode ? 1 : 0,
          2.4,
          delta,
        )
    const cameraProgress = THREE.MathUtils.lerp(
      progress,
      74,
      outroFramingRef.current,
    )
    const clipTime = clip
      ? clip.duration * storyProgressToClipProgress(cameraProgress)
      : 0
    if (clip) {
      mixer.setTime(clipTime)
    }

    if (camera?.isCamera) {
      const sampledPosition = cameraSampler?.position?.evaluate(clipTime)
      const sampledQuaternion = cameraSampler?.quaternion?.evaluate(clipTime)
      if (sampledPosition) camera.position.fromArray(sampledPosition)
      if (sampledQuaternion) camera.quaternion.fromArray(sampledQuaternion).normalize()

      const walkStrength = 1 - smoothstep(12.5, 15, progress)
      const pointerStrength =
        smoothstep(19, 24, progress) *
        (1 - smoothstep(79, 86, cameraProgress)) *
        (presentationMode ? 0.42 : 1)
      const endingLift = smoothstep(
        VISUAL_TIMING.endingLiftStart,
        VISUAL_TIMING.endingLiftEnd,
        cameraProgress,
      )
      const endingWide = smoothstep(
        VISUAL_TIMING.endingWideStart,
        VISUAL_TIMING.endingWideEnd,
        cameraProgress,
      )
      const openVista = smoothstep(18, 25, cameraProgress) *
        (1 - smoothstep(82, 90, cameraProgress))
      pointerLookRef.current.x = THREE.MathUtils.damp(
        pointerLookRef.current.x,
        state.pointer.x * pointerStrength,
        5.2,
        delta,
      )
      pointerLookRef.current.y = THREE.MathUtils.damp(
        pointerLookRef.current.y,
        state.pointer.y * pointerStrength,
        5.2,
        delta,
      )
      const stride = progress * Math.PI * 1.16
      const horizontalBob = Math.sin(stride * 0.5) * 0.012 * walkStrength
      const verticalBob = Math.abs(Math.sin(stride)) * 0.011 * walkStrength
      cameraScratch.forward
        .set(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .normalize()
      cameraScratch.right
        .set(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .normalize()
      camera.position.addScaledVector(cameraScratch.forward, -endingWide * 3.8)
      camera.position.addScaledVector(
        cameraScratch.forward,
        presentationMode ? -1.8 : 0,
      )
      camera.position.addScaledVector(cameraScratch.right, horizontalBob)
      camera.position.addScaledVector(
        cameraScratch.right,
        pointerLookRef.current.x * 0.038,
      )
      camera.position.y += verticalBob + pointerLookRef.current.y * 0.022
      cameraScratch.target.copy(camera.position).add(cameraScratch.forward)
      cameraScratch.target.addScaledVector(
        cameraScratch.right,
        pointerLookRef.current.x * 0.16,
      )
      cameraScratch.target.y +=
        endingLift * 0.14 +
        (presentationMode ? 0.12 : 0) +
        pointerLookRef.current.y * 0.095
      camera.up.set(0, 1, 0)
      camera.lookAt(cameraScratch.target)
      const desiredFov =
        camera.userData.journeyBaseFov +
        openVista * 4.5 +
        endingWide * 14 +
        (presentationMode ? 15 : 0)
      if (Math.abs(camera.fov - desiredFov) > 0.001) {
        camera.fov = desiredFov
        camera.updateProjectionMatrix()
      }
    }

    if (camera?.isCamera && skyRigRef.current) {
      camera.getWorldPosition(skyRigRef.current.position)
      camera.getWorldQuaternion(skyRigRef.current.quaternion)
    }

    const sunset = smoothstep(
      VISUAL_TIMING.sunsetStart,
      VISUAL_TIMING.sunsetEnd,
      progress,
    )
    const sunsetColorMix = smoothstep(0, 0.72, sunset)
    const night = smoothstep(
      VISUAL_TIMING.nightStart,
      VISUAL_TIMING.nightEnd,
      progress,
    )
    const caveRelease = smoothstep(7, 20, progress)
    const daySky = new THREE.Color('#78bdc8')
    const sunsetSky = new THREE.Color('#d66e5f')
    const nightSky = new THREE.Color('#10264c')
    const skyColor = daySky
      .clone()
      .lerp(sunsetSky, sunsetColorMix)
      .lerp(nightSky, night)
    state.scene.background = skyColor

    if (cloudGroupRef.current) {
      const openSky = smoothstep(17.5, 24, progress)
      const cloudNightFade = 1 - smoothstep(0.12, 0.92, night)
      const cloudColor = new THREE.Color('#f4f5ef').lerp(
        new THREE.Color('#ffd0ba'),
        sunset * 0.74,
      )
      cloudGroupRef.current.children.forEach((cloud, index) => {
        const material = cloudMaterialRefs.current[index]
        if (material) {
          material.opacity =
            openSky * cloudNightFade * (cloud.userData.opacity ?? 0.5)
          material.color.copy(cloudColor)
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

    const daylightExposure = THREE.MathUtils.lerp(
      CAVE_LOOK.exposure,
      1.02,
      caveRelease,
    )
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(
      daylightExposure,
      1.14,
      night,
    ) + outroFramingRef.current * 0.16

    const entranceFog =
      progress < 15
        ? THREE.MathUtils.lerp(0.0105, 0.00105, smoothstep(10, 15, progress))
        : 0.0007 * (1 - smoothstep(15, 20, progress)) + 0.00035
    if (state.scene.fog) {
      const openAirFog = skyColor.clone().multiplyScalar(night > 0.5 ? 0.7 : 0.88)
      state.scene.fog.color
        .set('#050909')
        .lerp(openAirFog, caveRelease)
      state.scene.fog.density = Math.max(
        0.00035,
        entranceFog * (1 - travelWindRef.current * 0.11),
      )
    }

    if (sunRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.sunIntensity,
        2.65,
        caveRelease,
      )
      sunRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 0.52, night)
      sunRef.current.color
        .set('#fff0ce')
        .lerp(new THREE.Color('#ffad78'), sunset * 0.86)
        .lerp(new THREE.Color('#8ca9d8'), night)
      sunRef.current.position.x = THREE.MathUtils.lerp(-90, 40, sunset)
      sunRef.current.position.y = THREE.MathUtils.lerp(130, 30, sunset)
    }
    if (skyLightRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.skyIntensity,
        1.2,
        caveRelease,
      )
      skyLightRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 0.78, night)
        + outroFramingRef.current * 0.16
      skyLightRef.current.color
        .set('#d9eff4')
        .lerp(new THREE.Color('#e5a49a'), sunset * 0.72)
        .lerp(new THREE.Color('#7894c1'), night)
      skyLightRef.current.groundColor
        .set('#6f806a')
        .lerp(new THREE.Color('#75584e'), sunset * 0.62)
        .lerp(new THREE.Color('#111b2a'), night)
    }
    if (ambientRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.ambientIntensity,
        0.18,
        caveRelease,
      )
      ambientRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 0.18, night)
        + outroFramingRef.current * 0.07
      ambientRef.current.color
        .set('#a7b8b4')
        .lerp(new THREE.Color('#b9877e'), sunset * 0.58)
        .lerp(new THREE.Color('#7185aa'), night)
    }

    if (caveGuideLightRef.current && camera?.isCamera) {
      caveGuideLightRef.current.position.copy(camera.position)
      caveGuideLightRef.current.intensity =
        (1 - smoothstep(8, 16, progress)) * CAVE_LOOK.guideLightIntensity
    }

    const starOpacity = smoothstep(
      VISUAL_TIMING.nightStart,
      VISUAL_TIMING.nightEnd,
      progress,
    )
    if (starMaterialRef.current) {
      starMaterialRef.current.uniforms.uJourneyOpacity.value = starOpacity
      starMaterialRef.current.uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    const bridgeReveal = smoothstep(0, 0.72, skyConnectionProgress)
    const milkyWayReveal = smoothstep(0.28, 1, skyConnectionProgress)
    const bridgeFade = 1 - smoothstep(0.7, 1, skyConnectionProgress) * 0.72
    if (skyBridgeRef.current) {
      const uniforms = skyBridgeRef.current.material.uniforms
      uniforms.uJourneyReveal.value = bridgeReveal
      uniforms.uJourneyOpacity.value =
        smoothstep(0, 0.08, skyConnectionProgress) * bridgeFade
      uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    if (milkyMaterialRef.current) {
      milkyMaterialRef.current.uniforms.uJourneyOpacity.value = milkyWayReveal * 0.94
      milkyMaterialRef.current.uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    if (milkyPointsRef.current) {
      milkyPointsRef.current.geometry.setDrawRange(
        0,
        Math.floor(milkyPointsRef.current.geometry.attributes.position.count * milkyWayReveal),
      )
    }

    const openValley = smoothstep(18, 24, progress)
    if (motesMaterialRef.current) {
      motesMaterialRef.current.opacity =
        openValley * (1 - night * 0.72) * (0.015 + travelWindRef.current * 0.09)
      motesMaterialRef.current.color
        .set('#b9f4c5')
        .lerp(new THREE.Color('#ffd49a'), sunset)
        .lerp(new THREE.Color('#8ab8ff'), night)
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
        .lerp(new THREE.Color('#ffb178'), sunset)
        .lerp(new THREE.Color('#7aa5e8'), night)
    }

    const riverPromptGlow = activeGate === 'river'
      ? 0.018 + gateArrivalPulse * 0.027 + gateBreath * 0.006
      : 0
    const riverGlow = Math.max(smoothstep(55, 61, progress), riverPromptGlow)
    groups.mountains.forEach((mesh) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        if ('emissiveIntensity' in material) {
          material.emissiveIntensity = THREE.MathUtils.lerp(0.06, 0.045, night)
        }
        const uniforms = material.userData.journeyAlpineUniforms
        if (uniforms) {
          uniforms.uJourneySunset.value = sunset
          uniforms.uJourneyNight.value = night
          uniforms.uJourneyRiverLight.value =
            night * Math.max(riverGlow * 0.92, skyConnectionProgress * 0.72)
          uniforms.uJourneyTime.value = state.clock.elapsedTime
        }
      })
    })
    groups.water.forEach((mesh, index) => {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        if ('emissive' in material) {
          material.emissive.set('#3aaec2')
          material.emissiveIntensity = 0.025 + night * 0.06
        }
        const uniforms = material.userData.journeyWaterUniforms
        if (uniforms) {
          uniforms.uJourneyNight.value = night
          uniforms.uJourneyRiverGlow.value = riverGlow
          uniforms.uJourneySkyConnect.value = skyConnectionProgress
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
    groups.waterHalos.forEach((halo) => {
      halo.material.uniforms.uJourneyRiverGlow.value = riverGlow
      halo.material.uniforms.uJourneySkyConnect.value = skyConnectionProgress
      halo.material.uniforms.uJourneyTime.value = state.clock.elapsedTime
    })

    groups.foliage.forEach((mesh, index) => {
      const baseRotation = mesh.userData.journeyBaseRotationZ ?? 0
      mesh.rotation.z =
        baseRotation + Math.sin(state.clock.elapsedTime * 0.45 + index * 1.7) * 0.0022
    })

    const cavePresence = 1 - smoothstep(16.4, 22.6, progress)
    groups.cave.forEach((object) => {
      object.visible = cavePresence > 0.004
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        const baseOpacity = material.userData.journeyCaveBaseOpacity ?? 1
        material.opacity = baseOpacity * cavePresence
        material.depthWrite = cavePresence > 0.18
      })
    })
    groups.foliage.forEach((object) => {
      object.visible = false
    })
    groups.transition.forEach((object) => {
      object.visible = false
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((material) => {
        material.opacity = 0
      })
    })
    groups.meadow.forEach((object) => {
      object.visible = false
    })
    groups.characters.forEach((object) => {
      object.visible = false
    })
  })

  return (
    <>
      <primitive object={root} />
      <RiverRipple
        groupRef={riverRippleRef}
        materialRefs={riverRippleMaterialRefs}
      />
      <hemisphereLight ref={skyLightRef} intensity={1.65} />
      <directionalLight
        ref={sunRef}
        position={[-90, 130, -40]}
        intensity={3.2}
        castShadow={quality.shadows}
        shadow-mapSize-width={quality.name === 'high' ? 2048 : 1024}
        shadow-mapSize-height={quality.name === 'high' ? 2048 : 1024}
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
        distance={58}
        decay={1.7}
        color="#c7ccd0"
      />
      <pointLight
        ref={mysticLightRef}
        position={[0, 28, -72]}
        intensity={0}
        distance={230}
        decay={2}
        color="#a9e5c0"
      />
      <MysticMotes
        groupRef={motesRef}
        materialRef={motesMaterialRef}
        qualityScale={quality.particles}
      />
      <group ref={skyRigRef}>
        <DriftingClouds
          groupRef={cloudGroupRef}
          materialRefs={cloudMaterialRefs}
        />
        <StarField materialRef={starMaterialRef} qualityScale={quality.particles} />
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
