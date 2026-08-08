import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// Versioned query prevents a previously cached GLB from reviving removed assets.
const MODEL_URL = '/journey/models/journey-v16-pbr-ktx2.glb?v=1-memory-pbr'

// Creator controls: visual transition timing and cave brightness.
const VISUAL_TIMING = {
  sunsetStart: 30,
  sunsetEnd: 54,
  nightStart: 50,
  nightEnd: 70,
}

const ENDING_CAMERA = {
  liftStart: 78,
  liftEnd: 90,
  wideStart: 86,
  wideEnd: 100,
  pullBack: 6.8,
  cameraLift: 0.16,
  lift: 0.08,
  fov: 18,
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
    if (region < 0.16) {
      placeEllipse(index, 0.55, 3.65, 0.92, 1.02, seed)
    } else if (region < 0.45) {
      placeEllipse(index, 0.12, 1.42, 1.22, 2.02, seed)
    } else if (region < 0.68) {
      placeSegment(index, -0.28, 0.12, -3.28, -0.18, 1.25, seed)
    } else if (region < 0.84) {
      placeSegment(index, -3.28, -0.18, -0.9, -2.42, 0.78, seed)
    } else {
      placeSegment(index, 0.42, 2.42, -2.74, 0.12, 0.5, seed)
    }

    const scatterAngle = seededRandom(index + 25000) * Math.PI * 2
    const scatterRadius = 7 + seededRandom(index + 27000) * 15
    positions[index * 3] = Math.cos(scatterAngle) * scatterRadius
    positions[index * 3 + 1] = Math.sin(scatterAngle) * scatterRadius * 0.72 + 0.7
    positions[index * 3 + 2] = (seededRandom(index + 29000) - 0.5) * 8
    targets[index * 3 + 2] = (seededRandom(index + 31000) - 0.5) * 0.7
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
        gl_PointSize = 1.35 + uJourneyMorph * 0.9;
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
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

function SeatedStarFigure({ groupRef, materialRef, qualityScale = 1 }) {
  const geometry = useMemo(
    () => buildSeatedFigureGeometry(Math.round(760 * qualityScale)),
    [qualityScale],
  )
  const material = useMemo(() => createSeatedFigureMaterial(), [])

  useEffect(() => {
    materialRef.current = material
    return () => {
      geometry.dispose()
      material.dispose()
    }
  }, [geometry, material, materialRef])

  return (
    <group ref={groupRef} position={[0, -6.5, -58]}>
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={4} />
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

function createSkyAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uJourneyTopColor: { value: new THREE.Color('#3e9ec5') },
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
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
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
  (1.0 - smoothstep(0.38, 0.82, journeyRockMask));
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
  mix(vec3(0.88, 0.91, 0.86), vec3(1.045, 1.07, 1.015), journeyCanopyGrain),
  journeyForestSurface * 0.48
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
journeyPaint = mix(journeyPaint, journeySnow, journeySnowMask * (0.54 + uJourneyNight * 0.12));
journeyPaint = mix(journeyPaint, vec3(0.038, 0.095, 0.082), journeyWetGully * 0.48);
float journeyLowerValley = 1.0 - smoothstep(7.0, 30.0, vJourneyWorldPosition.y);
float journeyValleyPigment = mix(0.79, 1.07, journeyMacro * 0.72 + journeyFine * 0.28);
journeyPaint *= mix(1.0, journeyValleyPigment, journeyLowerValley * 0.58);
vec3 journeyLightDirection = normalize(vec3(-0.46, 0.72, 0.38));
float journeyFacing = dot(normalize(vJourneyWorldNormal), journeyLightDirection) * 0.5 + 0.5;
float journeyRidgeLight = smoothstep(0.40, 0.86, journeyFacing);
float journeyValleyShade = smoothstep(0.62, 0.12, journeyFacing) * (0.46 + journeySteepness * 0.54);
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
vec3 journeyShadow = mix(vec3(0.055, 0.13, 0.14), vec3(0.10, 0.16, 0.25), uJourneyNight);
journeyPaint = mix(journeyPaint, journeyShadow, journeyValleyShade * 0.46);
journeyPaint += vec3(0.10, 0.125, 0.095) * journeyRidgeLight * (0.052 + uJourneySunset * 0.065);
journeyPaint -= vec3(0.032, 0.046, 0.041) * journeyContour * 0.22;
journeyPaint -= vec3(0.034, 0.049, 0.052) * journeyRockDetail * (0.66 + uJourneyNight * 0.24);
vec3 journeyDayHaze = vec3(0.48, 0.65, 0.66);
vec3 journeySunsetHaze = vec3(0.72, 0.50, 0.43);
vec3 journeyNightHaze = vec3(0.18, 0.27, 0.41);
vec3 journeyAtmosphere = mix(journeyDayHaze, journeySunsetHaze, uJourneySunset * 0.72);
journeyAtmosphere = mix(journeyAtmosphere, journeyNightHaze, uJourneyNight);
float journeyDistanceHaze = smoothstep(88.0, 390.0, length(vViewPosition));
journeyPaint = mix(
  journeyPaint,
  journeyAtmosphere,
  journeyDistanceHaze * ${isFarRidge ? '0.48' : '0.23'}
);
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
vec3 journeyTextureValue = mix(vec3(1.0), journeyTriplanar * 1.08, 0.30);
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
normal = normalize(normal + journeyWorldDetail * 0.27);`,
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
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance += journeyPaint * uJourneyNight * 0.055;
totalEmissiveRadiance += vec3(0.018, 0.038, 0.072) * uJourneyNight;`,
    )
  }
  material.customProgramCacheKey = () => `journey-alpine-${isFarRidge ? 'far' : 'near'}-v9-forest-grain`
}

function applyWetGravelDetail(material, variant = 'bed') {
  if (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial) return
  const isSubmergedBed = variant === 'submerged-bed'
  const isRiverBar = variant === 'bar-pale' || variant === 'bar-granite'
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
vec3 journeyGravelDark = ${isSubmergedBed ? 'vec3(0.055, 0.18, 0.15)' : isRiverBar ? 'vec3(0.045, 0.17, 0.145)' : 'vec3(0.31, 0.34, 0.31)'};
vec3 journeyGravelLight = ${isSubmergedBed ? 'vec3(0.20, 0.38, 0.31)' : isRiverBar ? 'vec3(0.19, 0.34, 0.27)' : 'vec3(0.62, 0.59, 0.50)'};
vec3 journeyGravelColor = mix(journeyGravelDark, journeyGravelLight, journeyGravelSeed * 0.7 + journeyGravelFine * 0.3);
journeyGravelColor *= mix(0.72, ${isRiverBar ? '0.98' : '1.12'}, journeyGravelStone);
diffuseColor.rgb = mix(diffuseColor.rgb, journeyGravelColor, ${isSubmergedBed ? '0.54' : variant === 'bed' ? '0.78' : isRiverBar ? '0.86' : '0.92'});`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = ${isSubmergedBed ? 'mix(0.66, 0.88, journeyGravelStone)' : 'mix(0.78, 0.97, journeyGravelStone)'};`,
      )
  }
  material.customProgramCacheKey = () => `journey-wet-gravel-v4-${variant}`
  material.needsUpdate = true
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
varying vec3 vJourneyWaterPosition;
varying vec3 vJourneyWaterNormal;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vJourneyWaterPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vJourneyWaterNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vJourneyWaterPosition;
varying vec3 vJourneyWaterNormal;
uniform float uJourneyNight;
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
vec3 journeyWaterPerturbation = vec3(
  journeyWaterHeight - journeyWaterHeightX,
  0.0,
  journeyWaterHeight - journeyWaterHeightZ
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
float journeyFineCurrent = 0.5 + 0.5 * sin(
  vJourneyWaterPosition.z * 0.72 - uJourneyTime * 0.92 +
  sin(vJourneyWaterPosition.x * 0.19 + uJourneyTime * 0.08) * 1.7
);
journeyFineCurrent = smoothstep(0.76, 0.96, journeyFineCurrent) *
  smoothstep(0.32, 0.88, journeyWaterRipple);
float journeyWaterSparkSeed = fract(sin(dot(floor(vJourneyWaterPosition.xz * 1.45), vec2(12.9898, 78.233))) * 43758.5453);
float journeyWaterSparkle = pow(journeyWaterSparkSeed, 18.0) * smoothstep(0.66, 0.94, journeyWaterRipple * journeyWaterCrossRipple);
float journeyRiverbedCell = journeyWaterHash(floor(vJourneyWaterPosition.xz * vec2(0.54, 0.78)));
float journeyRiverbedFine = journeyWaterHash(floor(vJourneyWaterPosition.xz * vec2(1.36, 1.72)) + 19.0);
float journeyRiverbedVariation = clamp(journeyRiverbedCell * 0.68 + journeyRiverbedFine * 0.32, 0.0, 1.0);
float journeyRiverPath = clamp((8.0 - vJourneyWaterPosition.z) / 227.0, 0.0, 1.0);
float journeyRiverHead = 1.0 - smoothstep(uJourneyRiverGlow - 0.045, uJourneyRiverGlow + 0.035, journeyRiverPath);
float journeyGroundRiver = 1.0 - smoothstep(1.35, 3.8, vJourneyWaterPosition.y);
float journeyRiverMask = journeyRiverHead * smoothstep(0.01, 0.075, uJourneyRiverGlow) * journeyGroundRiver;
float journeyRiverCurrent = 0.58 + journeyWaterRipple * 0.24 + journeyWaterCrossRipple * 0.18;
vec3 journeyDayShallowWater = vec3(0.018, 0.58, 0.43);
vec3 journeyDayDeepWater = vec3(0.004, 0.22, 0.19);
vec3 journeyNightShallowWater = vec3(0.018, 0.22, 0.34);
vec3 journeyNightDeepWater = vec3(0.004, 0.035, 0.11);
vec3 journeyShallowWater = mix(journeyDayShallowWater, journeyNightShallowWater, uJourneyNight);
vec3 journeyDeepWater = mix(journeyDayDeepWater, journeyNightDeepWater, uJourneyNight);
vec3 journeyClearBody = mix(journeyShallowWater, journeyDeepWater, 0.1 + journeyDepthVariation * 0.46);
vec3 journeyWetRiverbed = mix(vec3(0.08, 0.18, 0.15), vec3(0.30, 0.34, 0.27), journeyRiverbedVariation);
float journeyBedVisibility = (1.0 - journeyDepthVariation) * (0.64 + journeyWaterRipple * 0.08);
journeyClearBody = mix(journeyClearBody, journeyWetRiverbed, journeyBedVisibility * mix(0.12, 0.1, uJourneyNight));
journeyClearBody *= 0.96 + journeyWaterRipple * 0.16;
vec3 journeySkyReflection = mix(vec3(0.05, 0.48, 0.67), vec3(0.015, 0.055, 0.16), uJourneyNight);
diffuseColor.rgb = mix(journeyClearBody, journeySkyReflection, 0.06 + journeyWaterFresnel * 0.26);
diffuseColor.rgb += vec3(0.16, 0.4, 0.36) * journeyFineCurrent * (0.018 + journeyWaterFresnel * 0.035);
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
// The source terrain contains a pale guide ribbon below the water. Keep the
// daytime surface optically deep enough to hide it, while preserving apparent
// clarity through the procedural riverbed detail above.
float journeyDayAlpha = mix(0.97, 1.0, journeyWaterFresnel);
float journeyNightAlpha = mix(0.43, 0.72, journeyWaterFresnel);
diffuseColor.a *= mix(journeyDayAlpha, journeyNightAlpha, uJourneyNight);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
vec3 journeyEmissiveFlow = mix(vec3(0.04, 0.45, 0.5), vec3(0.18, 0.48, 0.98), uJourneyNight);
totalEmissiveRadiance += journeyEmissiveFlow * journeyMysticCurrent * (0.62 + uJourneyNight * 1.72);
totalEmissiveRadiance += vec3(0.1, 0.72, 1.0) * journeyLuminousThread * (1.1 + uJourneyNight * 3.6);
totalEmissiveRadiance += vec3(0.32, 0.82, 1.0) * journeyConnectionPulse * uJourneySkyConnect * journeyGroundRiver * 3.15;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
// Keep the physical highlights, but prevent the low-angle daylight reflection
// from washing the emerald body into a flat white strip.
float journeyPigmentStrength = mix(0.78, 0.32, uJourneyNight);
gl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb, journeyPigmentStrength);
gl_FragColor.rgb += vec3(0.16, 0.72, 0.68) * journeyFineCurrent * (1.0 - uJourneyNight) * 0.045;`,
      )
  }
  material.customProgramCacheKey = () => 'journey-water-reflection-v18-opaque-day-emerald'
}

function createClearRiverMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    name: 'MAT_JOURNEY_CLEAR_RIVER',
    color: '#38b9a4',
    emissive: '#082f32',
    emissiveIntensity: 0.025,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    roughness: 0.085,
    metalness: 0,
    ior: 1.333,
    transmission: 0,
    thickness: 0.34,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    attenuationColor: new THREE.Color('#42bda7'),
    attenuationDistance: 12,
  })
  // The foreground water stays optically clear while distant terrain retains fog.
  // Its own depth tint and Fresnel fade keep it integrated with the valley.
  material.fog = false
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
        alpha += wake * uJourneySkyConnect * strand * edgeFade * 0.24;
        vec3 cyan = vec3(0.07, 0.72, 0.92);
        vec3 celestial = vec3(0.34, 0.72, 1.0);
        vec3 color = mix(cyan, celestial, uJourneySkyConnect * 0.72 + path * 0.12);
        color *= 0.88 + strand * 2.15 + sparkle * 2.72;
        color += connectionPulse * vec3(0.38, 0.92, 1.0) * 3.2;
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
      }
    `,
  })
  material.userData.journeyRiverGlowUniforms = uniforms
  return material
}

function buildRiverAuroraGeometry() {
  const course = [
    { x: -2, z: 12, width: 10.5 },
    { x: 10, z: -12, width: 9 },
    { x: -9, z: -37, width: 7.2 },
    { x: 8, z: -64, width: 5.8 },
    { x: -5, z: -94, width: 4.4 },
    { x: 5, z: -128, width: 3.2 },
    { x: -2, z: -166, width: 2.2 },
    { x: 1, z: -210, width: 1.25 },
  ]
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  course.forEach((point, index) => {
    positions.push(
      point.x - point.width, 0.24, point.z,
      point.x + point.width, 0.24, point.z,
    )
    normals.push(0, 1, 0, 0, 1, 0)
    const v = index / (course.length - 1)
    uvs.push(0, v, 1, v)
    if (index < course.length - 1) {
      const start = index * 2
      indices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3)
    }
  })
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function prepareWorld(source) {
  const root = source.clone(true)
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

    const isPebble = identity.includes('PEBBLE') || identity.includes('GRAVEL')
    const isRiverbank = identity.includes('BAR_V13')
    const isStylizedRipple = identity.includes('RIPPLES')
    if (isStylizedRipple) {
      object.visible = false
      return
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

function ValleyFogBanks({ groupRef, materialRefs, layers = 7 }) {
  const textures = useMemo(
    () => [createCloudTexture(18400), createCloudTexture(22100), createCloudTexture(26700)],
    [],
  )
  useEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures])

  const banks = useMemo(() => {
    const presets = [
      { position: [-22, 7, -35], scale: [78, 24, 1], opacity: 0.42, speed: 0.42 },
      { position: [32, 12, -62], scale: [116, 30, 1], opacity: 0.36, speed: 0.31 },
      { position: [-58, 17, -92], scale: [146, 35, 1], opacity: 0.31, speed: 0.25 },
      { position: [64, 21, -122], scale: [172, 40, 1], opacity: 0.28, speed: 0.2 },
      { position: [-36, 27, -158], scale: [188, 45, 1], opacity: 0.24, speed: 0.17 },
      { position: [40, 34, -198], scale: [210, 51, 1], opacity: 0.2, speed: 0.14 },
      { position: [-12, 42, -244], scale: [232, 58, 1], opacity: 0.17, speed: 0.11 },
    ]
    return presets.slice(0, Math.max(3, Math.min(layers, presets.length)))
  }, [layers])

  return (
    <group ref={groupRef}>
      {banks.map((bank, index) => (
        <sprite
          key={`${bank.position.join('-')}-${index}`}
          position={bank.position}
          scale={bank.scale}
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
            alphaTest={0.006}
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
  fogCompleted = false,
  presentationMode = false,
  outroMode = false,
  mobileLook = { x: 0, y: 0 },
  onListenerPose,
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
  const riverMysticLightRef = useRef(null)
  const starMaterialRef = useRef(null)
  const milkyMaterialRef = useRef(null)
  const milkyPointsRef = useRef(null)
  const skyBridgeRef = useRef(null)
  const seatedFigureRef = useRef(null)
  const seatedFigureMaterialRef = useRef(null)
  const cloudGroupRef = useRef(null)
  const cloudMaterialRefs = useRef([])
  const skyAtmosphereRef = useRef(null)
  const skyAtmosphereMaterialRef = useRef(null)
  const valleyFogGroupRef = useRef(null)
  const valleyFogMaterialRefs = useRef([])
  const skyRigRef = useRef(null)
  const motesRef = useRef(null)
  const motesMaterialRef = useRef(null)
  const distantBirdsRef = useRef(null)
  const distantBirdsMaterialRef = useRef(null)
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
      94,
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

      const walkStrength = 1 - smoothstep(11.3, 13.5, progress)
      const pointerStrength =
        smoothstep(19, 24, progress) *
        (1 - smoothstep(79, 86, cameraProgress)) *
        (presentationMode ? 0.42 : 1)
      const openVista = smoothstep(18, 25, cameraProgress)
      const viewportAspect = size.width / Math.max(size.height, 1)
      const portraitFactor = 1 - smoothstep(0.62, 0.95, viewportAspect)
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
      pointerLookRef.current.x = THREE.MathUtils.damp(
        pointerLookRef.current.x,
        (state.pointer.x + mobileLook.x) * pointerStrength,
        5.2,
        delta,
      )
      pointerLookRef.current.y = THREE.MathUtils.damp(
        pointerLookRef.current.y,
        (state.pointer.y + mobileLook.y) * pointerStrength,
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
      camera.position.addScaledVector(
        cameraScratch.forward,
        (presentationMode ? -1.8 : 0) -
          endingWide * ENDING_CAMERA.pullBack +
          portraitFactor * THREE.MathUtils.lerp(0.38, 1.05, portraitVista),
      )
      camera.position.addScaledVector(cameraScratch.right, horizontalBob)
      camera.position.addScaledVector(
        cameraScratch.right,
        pointerLookRef.current.x * 0.038,
      )
      camera.position.y +=
        verticalBob +
        endingLift * ENDING_CAMERA.cameraLift +
        pointerLookRef.current.y * 0.022 +
        portraitFactor * THREE.MathUtils.lerp(-0.08, 0.18, portraitVista)
      cameraScratch.target.copy(camera.position).add(cameraScratch.forward)
      cameraScratch.target.addScaledVector(
        cameraScratch.right,
        pointerLookRef.current.x * 0.16,
      )
      cameraScratch.target.y +=
        (presentationMode ? 0.12 : 0) +
        endingLift * ENDING_CAMERA.lift +
        pointerLookRef.current.y * 0.095 -
        portraitFactor * (1 - endingLift) * 0.08
      camera.up.set(0, 1, 0)
      camera.lookAt(cameraScratch.target)
      const desiredFov =
        camera.userData.journeyBaseFov +
        openVista * 4.5 +
        endingWide * ENDING_CAMERA.fov +
        (presentationMode ? 15 : 0) +
        portraitFactor * THREE.MathUtils.lerp(7.5, 4.5, portraitVista)
      if (Math.abs(camera.fov - desiredFov) > 0.001) {
        camera.fov = desiredFov
        camera.updateProjectionMatrix()
      }
      camera.updateMatrixWorld()
      onListenerPose?.(camera)
    }

    if (camera?.isCamera && skyRigRef.current) {
      camera.getWorldPosition(skyRigRef.current.position)
      camera.getWorldQuaternion(skyRigRef.current.quaternion)
    }
    if (camera?.isCamera && skyAtmosphereRef.current) {
      camera.getWorldPosition(skyAtmosphereRef.current.position)
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
    const daySky = new THREE.Color('#55b8cf')
    const sunsetSky = new THREE.Color('#d66e5f')
    const nightSky = new THREE.Color('#17385f')
    const skyColor = daySky
      .clone()
      .lerp(sunsetSky, sunsetColorMix)
      .lerp(nightSky, night)
    state.scene.background = skyColor

    if (skyAtmosphereMaterialRef.current) {
      const uniforms = skyAtmosphereMaterialRef.current.uniforms
      uniforms.uJourneyTopColor.value
        .set('#3e9ec5')
        .lerp(new THREE.Color('#6f7796'), sunsetColorMix)
        .lerp(new THREE.Color('#08172f'), night)
      uniforms.uJourneyHorizonColor.value
        .set('#d8e7df')
        .lerp(new THREE.Color('#e6a07f'), sunsetColorMix)
        .lerp(new THREE.Color('#263b5d'), night)
      uniforms.uJourneySunColor.value
        .set('#fff3c9')
        .lerp(new THREE.Color('#ffb077'), sunset)
        .lerp(new THREE.Color('#7896c8'), night)
      uniforms.uJourneySunDirection.value
        .set(
          THREE.MathUtils.lerp(-0.48, 0.42, sunset),
          THREE.MathUtils.lerp(0.46, 0.08, sunset),
          -0.74,
        )
        .normalize()
      uniforms.uJourneyNight.value = night
    }

    if (cloudGroupRef.current) {
      const openSky = smoothstep(15, 21, progress)
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

    const valleyFogArrival = smoothstep(9.3, 13.2, progress)
    const holdFogRemaining = activeGate === 'fog' ? 1 - clamp01(holdProgress) : 1
    const valleyMist = fogCompleted ? 0 : valleyFogArrival * holdFogRemaining
    const valleyNight = smoothstep(
      VISUAL_TIMING.nightStart,
      VISUAL_TIMING.nightEnd,
      progress,
    )
    if (valleyFogGroupRef.current) {
      const fogColor = new THREE.Color('#dbe5dc')
        .lerp(new THREE.Color('#e7b3a2'), sunset * 0.52)
        .lerp(new THREE.Color('#7189ad'), night * 0.72)
      valleyFogGroupRef.current.children.forEach((bank, index) => {
        const material = valleyFogMaterialRefs.current[index]
        const breathing = 0.86 + Math.sin(state.clock.elapsedTime * 0.13 + index * 1.31) * 0.14
        if (material) {
          material.opacity =
            valleyMist * 1.78 *
            (bank.userData.opacity ?? 0.2) *
            breathing *
            (1 - valleyNight * 0.46)
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

    const daylightExposure = THREE.MathUtils.lerp(
      CAVE_LOOK.exposure,
      1.08,
      caveRelease,
    )
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(
      daylightExposure,
      0.98,
      night,
    ) + outroFramingRef.current * 0.3

    const openAirFogDensity = THREE.MathUtils.lerp(0.00062, 0.00072, night)
    const preHoldFog = progress < 9.3
      ? 0.018
      : THREE.MathUtils.lerp(0.018, 0.012, smoothstep(9.3, 13.5, progress))
    const holdClear = activeGate === 'fog' ? clamp01(holdProgress) : 0
    const entranceFog = fogCompleted
      ? openAirFogDensity
      : THREE.MathUtils.lerp(preHoldFog, openAirFogDensity, holdClear)
    if (state.scene.fog) {
      const openAirFog = skyColor.clone().multiplyScalar(night > 0.5 ? 0.82 : 0.91)
      state.scene.fog.color
        .set('#050909')
        .lerp(openAirFog, caveRelease)
      state.scene.fog.density = Math.max(
        openAirFogDensity,
        entranceFog * (1 - travelWindRef.current * 0.08),
      )
    }

    if (sunRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.sunIntensity,
        3,
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
        1.32,
        caveRelease,
      )
      skyLightRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 1.08, night)
        + outroFramingRef.current * 0.28
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
        0.15,
        caveRelease,
      )
      ambientRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 0.23, night)
        + outroFramingRef.current * 0.14
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

    const figureGather = smoothstep(80, 80.85, progress)
    const figureRelease = smoothstep(96, 100, progress)
    const figurePresence = figureGather * (1 - figureRelease)
    if (seatedFigureMaterialRef.current) {
      seatedFigureMaterialRef.current.uniforms.uJourneyMorph.value = figurePresence
      seatedFigureMaterialRef.current.uniforms.uJourneyOpacity.value =
        smoothstep(79.5, 81, progress) * (1 - smoothstep(97, 100, progress)) * 0.94
      seatedFigureMaterialRef.current.uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    if (seatedFigureRef.current) {
      const landscapeScale = THREE.MathUtils.lerp(
        1,
        0.24,
        smoothstep(86, 97, progress),
      )
      seatedFigureRef.current.scale.setScalar(landscapeScale)
      seatedFigureRef.current.position.y = THREE.MathUtils.lerp(
        -6.5,
        -13.5,
        smoothstep(86, 97, progress),
      )
      seatedFigureRef.current.visible = figurePresence > 0.002
    }

    const openValley = smoothstep(16.5, 22, progress)
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
    if (distantBirdsRef.current && distantBirdsMaterialRef.current) {
      const discovery = smoothstep(0.18, 0.62, Math.abs(pointerLookRef.current.x))
      distantBirdsMaterialRef.current.opacity =
        openValley * (1 - night) * discovery * 0.38
      distantBirdsRef.current.position.x =
        24 + Math.sin(state.clock.elapsedTime * 0.17) * 4.2
      distantBirdsRef.current.position.y =
        42 + Math.sin(state.clock.elapsedTime * 0.23) * 1.1
    }

    const riverPromptGlow = activeGate === 'river'
      ? 0.018 + gateArrivalPulse * 0.027 + gateBreath * 0.006
      : 0
    const riverGlow = Math.max(smoothstep(70, 76, progress), riverPromptGlow)
    if (riverMysticLightRef.current) {
      riverMysticLightRef.current.intensity =
        night * (riverGlow * 1.35 + skyConnectionProgress * 1.8)
    }
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
        const isClearRiver = material.name === 'MAT_JOURNEY_CLEAR_RIVER'
        if ('color' in material) {
          material.color
            .set(isClearRiver ? '#38b9a4' : '#45ae9c')
            .lerp(new THREE.Color(isClearRiver ? '#163f65' : '#153f65'), night)
        }
        if ('opacity' in material) {
          material.opacity = THREE.MathUtils.lerp(
            isClearRiver ? 0.98 : 0.9,
            isClearRiver ? 0.46 : 0.43,
            night,
          )
        }
        if ('roughness' in material) {
          material.roughness = THREE.MathUtils.lerp(
            isClearRiver ? 0.085 : 0.1,
            isClearRiver ? 0.04 : 0.05,
            night,
          )
        }
        if (isClearRiver && 'transmission' in material) {
          material.transmission = THREE.MathUtils.lerp(0, 0.54, night)
          material.clearcoatRoughness = THREE.MathUtils.lerp(0.09, 0.04, night)
          material.attenuationColor
            .set('#42bda7')
            .lerp(new THREE.Color('#1b5477'), night)
        }
        if ('emissive' in material) {
          material.emissive.set(isClearRiver ? '#0b3639' : '#155b59')
          material.emissiveIntensity = isClearRiver
            ? THREE.MathUtils.lerp(0.025, 0.055, night)
            : THREE.MathUtils.lerp(0.13, 0.055, night)
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
    groups.riverGlow.forEach((mesh) => {
      const uniforms = mesh.material.userData.journeyRiverGlowUniforms
      if (!uniforms) return
      uniforms.uJourneyGlow.value = riverGlow
      uniforms.uJourneySkyConnect.value = skyConnectionProgress
      uniforms.uJourneyTime.value = state.clock.elapsedTime
      mesh.visible = night > 0.06 && riverGlow > 0.01
    })
    groups.foliage.forEach((mesh, index) => {
      const baseRotation = mesh.userData.journeyBaseRotationZ ?? 0
      mesh.rotation.z =
        baseRotation + Math.sin(state.clock.elapsedTime * 0.45 + index * 1.7) * 0.0022
    })

    const cavePresence = 1 - smoothstep(13.5, 20.2, progress)
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
        <SeatedStarFigure
          groupRef={seatedFigureRef}
          materialRef={seatedFigureMaterialRef}
          qualityScale={quality.particles}
        />
      </group>
    </>
  )
}
