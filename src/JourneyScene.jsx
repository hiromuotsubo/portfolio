import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

// Versioned query prevents a previously cached GLB from reviving removed assets.
const MODEL_URL = '/journey/models/journey-v16-pbr-ktx2.glb?v=1-memory-pbr'
const PHASE2_ENVIRONMENT_URL = '/journey/models/journey-phase2-environment.glb?v=5-distance-forest'

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
  pullBack: 13.5,
  cameraLift: 0.16,
  lift: 0.08,
  fov: 26,
}

// V1 framing is preserved on backup/journey-lookdev-v1-e5ec4a3.
// These offsets leave the authored animation path intact and only widen the
// open-valley composition so sky, water and distant ridges can share the frame.
const LOOKDEV_V2_COMPOSITION = {
  vistaStart: 19,
  vistaFull: 28,
  vistaFadeStart: 56,
  vistaFadeEnd: 68,
  pullBack: 5.8,
  cameraLift: 0.46,
  targetLift: 0.06,
  fov: 13.6,
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

  useEffect(() => {
    materialRef.current = material
    return () => {
      geometry.dispose()
      material.dispose()
      silhouetteTexture.dispose()
    }
  }, [geometry, material, materialRef, silhouetteTexture])

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

let alpineForestSurfaceTexture = null
const getAlpineForestSurfaceTexture = () => {
  if (alpineForestSurfaceTexture) return alpineForestSurfaceTexture
  alpineForestSurfaceTexture = new THREE.TextureLoader().load(
    '/journey/textures/surface/alpine-forest-canopy-v1.jpg',
  )
  alpineForestSurfaceTexture.colorSpace = THREE.SRGBColorSpace
  alpineForestSurfaceTexture.wrapS = THREE.RepeatWrapping
  alpineForestSurfaceTexture.wrapT = THREE.RepeatWrapping
  alpineForestSurfaceTexture.minFilter = THREE.LinearMipmapLinearFilter
  alpineForestSurfaceTexture.magFilter = THREE.LinearFilter
  alpineForestSurfaceTexture.needsUpdate = true
  return alpineForestSurfaceTexture
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
    uJourneyDiscovery: { value: 0 },
    uJourneyTime: { value: 0 },
    uJourneyWatercolor: { value: getAlpineWatercolorTexture() },
    uJourneyForestSurface: { value: getAlpineForestSurfaceTexture() },
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
journeyPaint = mix(journeyPaint, journeyCrownColor, journeyCrownPresence * 0.67);
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
journeyPaint = mix(journeyPaint, journeyCrownLit, journeyCrownOcclusion * 0.22);
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
  journeyForestSurface * (0.34 + journeyVegetationDensity * 0.42) *
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
  journeyLowerForestBelt * (0.43 + journeyVegetationDensity * 0.31) *
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
  normalize(vec3(-0.46, 0.72, 0.38))
) * 0.5 + 0.5;
float journeySurfaceValleyShade = smoothstep(0.62, 0.12, journeySurfaceFacing) *
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
  vec3(0.07, 0.19, 0.055),
  vec3(0.31, 0.43, 0.085),
  journeyCanopyResponse
);
vec3 journeySurfaceForest = mix(
  journeyShadowForest,
  journeySunForest,
  clamp(journeyCanopyResponse * 0.72 + journeySurfaceFacing * 0.38, 0.0, 1.0)
);
journeySurfaceForest *= mix(0.48, 1.38, smoothstep(0.16, 0.86, journeySurfaceMedium));
journeySurfaceForest *= mix(0.8, 1.2, journeySurfaceFine);
journeySurfaceForest = mix(
  journeySurfaceForest,
  journeyShadowForest * 0.72,
  journeyWetGully * 0.58 + journeySurfaceValleyShade * 0.18
);
journeySurfaceForest *= mix(0.76, 1.18, journeySurfaceLarge);
journeyPaint = mix(journeyPaint, journeySurfaceForest, journeySurfaceForestMask * 0.96);
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
  journeySurfaceForest * mix(0.54, 1.38, journeyForestTextureRelief),
  journeyForestTexture * vec3(0.72, 0.93, 0.62),
  0.72
);
float journeyForestTextureMix = journeySurfaceForestMask *
  mix(0.7, 0.94, journeyForestBiome) * (1.0 - journeyRockMask * 0.72);
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
float journeyDrainage = 1.0 - smoothstep(
  0.035,
  0.16,
  abs(sin(
    vJourneyWorldPosition.x * 0.082 +
    vJourneyWorldPosition.z * 0.019 +
    journeyNoise(vec2(vJourneyWorldPosition.y * 0.035, vJourneyWorldPosition.z * 0.014)) * 5.2
  ))
);
journeyDrainage *= journeySteepness * (1.0 - smoothstep(0.78, 1.0, journeyAltitude));
vec3 journeyShadow = mix(vec3(0.055, 0.13, 0.14), vec3(0.10, 0.16, 0.25), uJourneyNight);
journeyPaint = mix(journeyPaint, journeyShadow, journeyValleyShade * 0.46);
journeyPaint += vec3(0.10, 0.125, 0.095) * journeyRidgeLight * (0.052 + uJourneySunset * 0.065);
journeyPaint -= vec3(0.032, 0.046, 0.041) * journeyContour * 0.22;
journeyPaint -= vec3(0.034, 0.049, 0.052) * journeyRockDetail * (0.66 + uJourneyNight * 0.24);
journeyPaint = mix(journeyPaint, vec3(0.032, 0.075, 0.067), journeyDrainage * 0.36);
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
float journeyForestNormalMask = journeySurfaceForestMask;
float journeyCanopyNormalX = journeyNoise(vJourneyWorldPosition.xz * vec2(0.62, 0.84) + 19.0) - 0.5;
float journeyCanopyNormalZ = journeyNoise(vJourneyWorldPosition.zx * vec2(0.73, 0.57) - 31.0) - 0.5;
vec3 journeyCanopyNormal = vec3(journeyCanopyNormalX, 0.0, journeyCanopyNormalZ);
normal = normalize(
  normal + journeyWorldDetail * 0.27 + journeyCanopyNormal * journeyForestNormalMask * 0.19
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
vec3 journeyReliefNormal = normalize(cross(
  dFdx(journeyReliefPosition),
  dFdy(journeyReliefPosition)
));
journeyReliefNormal *= sign(dot(journeyReliefNormal, normal));
normal = normalize(mix(normal, journeyReliefNormal, journeyForestNormalMask * 0.25));
vec3 journeySurfaceResponsePosition = vJourneyWorldPosition +
  normalize(vJourneyWorldNormal) *
  (journeySurfaceMedium * 0.32 + journeySurfaceFine * 0.1 - 0.2) * journeyForestNormalMask;
vec3 journeySurfaceResponseNormal = normalize(cross(
  dFdx(journeySurfaceResponsePosition),
  dFdy(journeySurfaceResponsePosition)
));
journeySurfaceResponseNormal *= sign(dot(journeySurfaceResponseNormal, normal));
normal = normalize(mix(normal, journeySurfaceResponseNormal, journeyForestNormalMask * 0.2));`,
      )
    }
    if (!triplanarNormalMap) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec3 journeySurfaceResponsePosition = vJourneyWorldPosition +
  normalize(vJourneyWorldNormal) *
  (journeySurfaceMedium * 0.72 + journeySurfaceFine * 0.2 - 0.46) * journeySurfaceForestMask;
vec3 journeySurfaceResponseNormal = normalize(cross(
  dFdx(journeySurfaceResponsePosition),
  dFdy(journeySurfaceResponsePosition)
));
journeySurfaceResponseNormal *= sign(dot(journeySurfaceResponseNormal, normal));
normal = normalize(mix(normal, journeySurfaceResponseNormal, journeySurfaceForestMask * 0.3));`,
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
roughnessFactor = mix(roughnessFactor, max(0.68, journeyProjectedRoughness), 0.48);
roughnessFactor = clamp(
  roughnessFactor + (journeyCanopyRoughness - 0.5) * journeyForestRoughnessMask * 0.18,
  0.66,
  1.0
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
  0.58,
  1.0
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
  material.customProgramCacheKey = () => `journey-alpine-${isFarRidge ? 'far' : 'near'}-v25-surface-forest`
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
vec3 journeyGravelDark = ${isSubmergedBed ? 'vec3(0.055, 0.18, 0.15)' : isRiverBar ? 'vec3(0.19, 0.215, 0.20)' : 'vec3(0.31, 0.34, 0.31)'};
vec3 journeyGravelLight = ${isSubmergedBed ? 'vec3(0.20, 0.38, 0.31)' : isRiverBar ? 'vec3(0.56, 0.535, 0.46)' : 'vec3(0.62, 0.59, 0.50)'};
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
  float travel = clamp((12.0 - z) / 222.0, 0.0, 1.0);
  return -sin(z * 0.13) * mix(9.2, 1.7, travel);
}

float journeyRiverHalfWidth(float z) {
  float travel = clamp((12.0 - z) / 222.0, 0.0, 1.0);
  return mix(10.7, 1.35, travel);
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
float journeyChannelDistance = abs(
  vJourneyWaterPosition.x - journeyRiverCenter(vJourneyWaterPosition.z)
) / max(journeyRiverHalfWidth(vJourneyWaterPosition.z), 0.1);
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
float journeyRiverPath = clamp((8.0 - vJourneyWaterPosition.z) / 227.0, 0.0, 1.0);
float journeyRiverHead = 1.0 - smoothstep(uJourneyRiverGlow - 0.045, uJourneyRiverGlow + 0.035, journeyRiverPath);
float journeyGroundRiver = 1.0 - smoothstep(1.35, 3.8, vJourneyWaterPosition.y);
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
float journeyPigmentStrength = mix(0.975, 0.32, uJourneyNight);
gl_FragColor.rgb = mix(gl_FragColor.rgb, diffuseColor.rgb, journeyPigmentStrength);
gl_FragColor.rgb += vec3(0.16, 0.72, 0.68) * journeyFineCurrent * (1.0 - uJourneyNight) * 0.045;`,
      )
  }
  material.customProgramCacheKey = () => 'journey-water-reflection-v24-clear-bed'
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

function preparePhase2Environment(source) {
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
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: true,
      })
      object.renderOrder = 1
      object.userData.journeyBasePosition = object.position.clone()
      groups.clouds.push(object)
      return
    }

    const material = cloneMaterial(object.material)
    material.dithering = true
    material.transparent = true
    material.opacity = 0
    material.depthWrite = true
    material.depthTest = true
    material.side = THREE.DoubleSide
    object.material = material

    if (identity.includes('P2_RIDGE_')) {
      const far = identity.includes('_FAR')
      material.color?.set(far ? '#829a9b' : '#617c74')
      material.roughness = 0.98
      if ('emissive' in material) {
        material.emissive.set(far ? '#31494c' : '#243d39')
        material.emissiveIntensity = 0.04
      }
      applyAlpineIllustration(material, true)
      object.renderOrder = -1
      groups.ridges.push(object)
      return
    }

    if (identity.includes('P2_FOREST_')) {
      const isCanopyShell = identity.includes('MID_CANOPY')
      material.color?.set(identity.includes('VALLEY_EDGE') ? '#315f35' : '#4a7542')
      material.roughness = 1
      if ('emissive' in material) {
        material.emissive.set('#173a20')
        material.emissiveIntensity = 0.045
      }
      if (isCanopyShell) applyAlpineIllustration(material, false)
      object.renderOrder = 1
      groups.forest.push(object)
      return
    }

    if (identity.includes('P2_SHORE_')) {
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
    const lobeOffsets = [
      { x: -0.15, y: 0.04, z: 0, scale: 0.82, yaw: 0.04, opacity: 0.55 },
      { x: 0.08, y: -0.02, z: -13, scale: 1, yaw: -0.055, opacity: 0.72 },
      { x: 0.24, y: 0.08, z: 11, scale: 0.68, yaw: 0.09, opacity: 0.46 },
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
            color="#f4f5ef"
            transparent
            opacity={0}
            alphaTest={0}
            depthWrite={false}
            depthTest={cloud.depthTest}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
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
  context.fillStyle = '#c4c5bd'
  context.fillRect(0, 0, 256, 256)
  for (let index = 0; index < 680; index += 1) {
    const seed = seededRandom(index + 7800)
    const x = seededRandom(index + 8200) * 256
    const y = seededRandom(index + 9100) * 256
    const radius = 0.7 + seed * 3.1
    const light = 104 + Math.round(seededRandom(index + 9500) * 104)
    context.fillStyle = `rgb(${light + 10}, ${light + 9}, ${light + 5})`
    context.beginPath()
    context.ellipse(x, y, radius * 1.28, radius * 0.72, seed * Math.PI, 0, Math.PI * 2)
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(4, 4)
  texture.needsUpdate = true
  return texture
}

function HeroRiverbankPatches({ groupRef, materialRef }) {
  const meshRef = useRef(null)
  const texture = useMemo(() => createHeroGravelTexture(), [])
  const geometry = useMemo(() => {
    const result = new THREE.CircleGeometry(1, 38)
    const position = result.attributes.position
    for (let index = 1; index < position.count; index += 1) {
      const angle = Math.atan2(position.getY(index), position.getX(index))
      const irregular = 0.8 + Math.sin(angle * 5.0 + 1.2) * 0.09 + Math.sin(angle * 11.0 - 0.8) * 0.06
      position.setX(index, position.getX(index) * irregular)
      position.setY(index, position.getY(index) * irregular)
    }
    position.needsUpdate = true
    result.computeVertexNormals()
    return result
  }, [])
  const patches = useMemo(() => [
    { position: [18.5, 0.35, -27], scale: [7.2, 18, 1], rotation: -0.16 },
    { position: [-9.5, 0.34, -55], scale: [7.5, 20, 1], rotation: 0.21 },
    { position: [8.5, 0.33, -92], scale: [6, 17, 1], rotation: -0.12 },
    { position: [-4.2, 0.32, -132], scale: [4.2, 12, 1], rotation: 0.18 },
  ], [])
  useEffect(() => {
    if (!meshRef.current) return undefined
    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    patches.forEach((patch, index) => {
      position.set(...patch.position)
      quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, patch.rotation))
      scale.set(...patch.scale)
      matrix.compose(position, quaternion, scale)
      meshRef.current.setMatrixAt(index, matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    return undefined
  }, [patches])
  useEffect(() => () => {
    geometry.dispose()
    texture.dispose()
  }, [geometry, texture])
  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometry, null, patches.length]} receiveShadow>
        <meshStandardMaterial
          ref={materialRef}
          map={texture}
          color="#ffffff"
          roughness={0.98}
          metalness={0}
          transparent
          opacity={0}
          depthWrite
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </instancedMesh>
    </group>
  )
}

function HeroRiverbankStones({ groupRef, materialRef }) {
  const meshRef = useRef(null)
  const geometry = useMemo(() => new THREE.DodecahedronGeometry(1, 0), [])
  const stones = useMemo(() => {
    const result = []
    for (let index = 0; index < 156; index += 1) {
      const depth = seededRandom(index + 15000)
      const z = THREE.MathUtils.lerp(-17, -154, Math.pow(depth, 0.83))
      const side = seededRandom(index + 15200) < 0.5 ? -1 : 1
      const centre = Math.sin(-z * 0.052) * 6.5 + Math.sin(-z * 0.017) * 2.1
      const riverWidth = Math.max(3.8, 25 - (-z) * 0.105)
      const bankOffset = THREE.MathUtils.lerp(0.7, 8.2, seededRandom(index + 15400))
      const perspective = THREE.MathUtils.lerp(1, 0.42, depth)
      const radius = THREE.MathUtils.lerp(0.09, 0.48, seededRandom(index + 15600)) * perspective
      result.push({
        position: [centre + side * (riverWidth + bankOffset), 0.22 + radius * 0.24, z],
        rotation: [
          seededRandom(index + 15800) * 0.6,
          seededRandom(index + 16000) * Math.PI,
          seededRandom(index + 16200) * 0.42,
        ],
        scale: [radius * (1.1 + seededRandom(index + 16400) * 0.72), radius * 0.52, radius],
        tone: seededRandom(index + 16600),
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
    stones.forEach((stone, index) => {
      position.set(...stone.position)
      quaternion.setFromEuler(new THREE.Euler(...stone.rotation))
      scale.set(...stone.scale)
      matrix.compose(position, quaternion, scale)
      meshRef.current.setMatrixAt(index, matrix)
    })
    meshRef.current.instanceMatrix.needsUpdate = true
    return undefined
  }, [stones])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[geometry, null, stones.length]}>
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
            depthTest={false}
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
  const phase2Gltf = useGLTF(PHASE2_ENVIRONMENT_URL)
  const { root, groups } = useMemo(() => prepareWorld(gltf.scene), [gltf.scene])
  const { root: phase2Root, groups: phase2Groups } = useMemo(
    () => preparePhase2Environment(phase2Gltf.scene),
    [phase2Gltf.scene],
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
    }),
    [],
  )
  const pointerLookRef = useRef(new THREE.Vector2())
  const coarsePointer = useMemo(
    () => window.matchMedia('(pointer: coarse)').matches,
    [],
  )
  const discoveryPreview = useMemo(
    () => import.meta.env.DEV && new URLSearchParams(window.location.search).get('look') === 'light',
    [],
  )
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
  const heroRiverbankRef = useRef(null)
  const heroRiverbankMaterialRef = useRef(null)
  const heroRiverbankStonesRef = useRef(null)
  const heroRiverbankStonesMaterialRef = useRef(null)
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
      const vistaTransitionLock = 1 - smoothstep(28.2, 30.2, cameraProgress)
      const nightLookUpLock =
        smoothstep(66.8, 68.4, cameraProgress) *
        (1 - smoothstep(70.2, 72.2, cameraProgress))
      const endingTransitionLock = smoothstep(77.5, 79.2, cameraProgress)
      const motionTransitionLock = smoothstep(0.45, 2.4, progressVelocity)
      const cursorLookWeight = 1 - Math.max(
        vistaTransitionLock,
        nightLookUpLock,
        endingTransitionLock,
        motionTransitionLock,
      )
      const pointerStrength =
        smoothstep(19, 24, progress) *
        (1 - smoothstep(79, 86, cameraProgress)) *
        (presentationMode ? 0.42 : 1) *
        cursorLookWeight
      const openVista = smoothstep(18, 25, cameraProgress)
      const vistaComposition = smoothstep(
        LOOKDEV_V2_COMPOSITION.vistaStart,
        LOOKDEV_V2_COMPOSITION.vistaFull,
        cameraProgress,
      ) * (1 - smoothstep(
        LOOKDEV_V2_COMPOSITION.vistaFadeStart,
        LOOKDEV_V2_COMPOSITION.vistaFadeEnd,
        cameraProgress,
      ))
      const viewportAspect = size.width / Math.max(size.height, 1)
      const mobilePointer = coarsePointer || size.width <= 720
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
        (mobilePointer ? mobileLook.x : state.pointer.x) * pointerStrength,
        5.2,
        delta,
      )
      pointerLookRef.current.y = THREE.MathUtils.damp(
        pointerLookRef.current.y,
        (mobilePointer ? mobileLook.y : state.pointer.y) * pointerStrength,
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
          vistaComposition * LOOKDEV_V2_COMPOSITION.pullBack -
          endingWide * ENDING_CAMERA.pullBack +
          portraitFactor * THREE.MathUtils.lerp(0.38, 1.05, portraitVista),
      )
      camera.position.addScaledVector(cameraScratch.right, horizontalBob)
      camera.position.addScaledVector(
        cameraScratch.right,
        pointerLookRef.current.x * 0.56,
      )
      camera.position.y +=
        verticalBob +
        vistaComposition * LOOKDEV_V2_COMPOSITION.cameraLift +
        endingLift * ENDING_CAMERA.cameraLift +
        pointerLookRef.current.y * 0.34 +
        portraitFactor * THREE.MathUtils.lerp(-0.08, 0.18, portraitVista)
      cameraScratch.target.copy(camera.position).add(cameraScratch.forward)
      cameraScratch.target.addScaledVector(
        cameraScratch.right,
        pointerLookRef.current.x * 0.25,
      )
      cameraScratch.target.y +=
        (presentationMode ? 0.12 : 0) +
        vistaComposition * LOOKDEV_V2_COMPOSITION.targetLift +
        endingLift * ENDING_CAMERA.lift +
        pointerLookRef.current.y * 0.2 -
        portraitFactor * (1 - endingLift) * 0.08
      camera.up.set(0, 1, 0)
      camera.lookAt(cameraScratch.target)
      const desiredFov =
        camera.userData.journeyBaseFov +
        openVista * 4.5 +
        vistaComposition * LOOKDEV_V2_COMPOSITION.fov +
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
            openSky * cloudNightFade * (cloud.userData.opacity ?? 0.5) * 0.78
          material.color.copy(cloudColor).lerp(
            new THREE.Color('#879da3'),
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
    if (openValleyAtmosphereRef.current) {
      const atmospherePresence = smoothstep(18, 26, progress)
      const atmosphereColor = new THREE.Color('#c6d8cf')
        .lerp(new THREE.Color('#d5ad9f'), sunset * 0.48)
        .lerp(new THREE.Color('#6e829d'), night * 0.68)
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

    const openAirFogDensity = THREE.MathUtils.lerp(0.0005, 0.00072, night)
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
        3.72,
        caveRelease,
      )
      sunRef.current.intensity = THREE.MathUtils.lerp(dayIntensity, 0.52, night)
      sunRef.current.color
        .set('#fff2bd')
        .lerp(new THREE.Color('#ffad78'), sunset * 0.86)
        .lerp(new THREE.Color('#8ca9d8'), night)
      sunRef.current.position.x = THREE.MathUtils.lerp(-90, 40, sunset)
      sunRef.current.position.y = THREE.MathUtils.lerp(130, 30, sunset)
    }
    if (skyLightRef.current) {
      const dayIntensity = THREE.MathUtils.lerp(
        CAVE_LOOK.skyIntensity,
        0.62,
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
        0.05,
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

    const figureGather = smoothstep(80, 83, progress)
    const figureRelease = smoothstep(96, 100, progress)
    const figurePresence = figureGather * (1 - figureRelease)
    if (seatedFigureMaterialRef.current) {
      seatedFigureMaterialRef.current.uniforms.uJourneyMorph.value = figurePresence
      seatedFigureMaterialRef.current.uniforms.uJourneyOpacity.value =
        smoothstep(80, 82.8, progress) * (1 - smoothstep(97, 100, progress)) * 0.96
      seatedFigureMaterialRef.current.uniforms.uJourneyTime.value = state.clock.elapsedTime
    }
    if (seatedFigureSilhouetteMaterialRef.current) {
      const silhouetteReveal = smoothstep(81.15, 82.65, progress)
      seatedFigureSilhouetteMaterialRef.current.opacity =
        silhouetteReveal * (1 - smoothstep(97, 100, progress)) * 0.82
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

    const openValley = smoothstep(16.5, 22, progress)
    if (heroRiverbankRef.current && heroRiverbankMaterialRef.current) {
      heroRiverbankRef.current.visible = openValley > 0.02
      heroRiverbankMaterialRef.current.opacity = openValley * THREE.MathUtils.lerp(0.5, 0.26, night)
      heroRiverbankMaterialRef.current.color
        .set('#d2d0c4')
        .lerp(new THREE.Color('#9c7768'), sunset * 0.34)
        .lerp(new THREE.Color('#445667'), night * 0.72)
    }
    if (heroRiverbankStonesRef.current && heroRiverbankStonesMaterialRef.current) {
      heroRiverbankStonesRef.current.visible = openValley > 0.02
      heroRiverbankStonesMaterialRef.current.opacity = openValley * THREE.MathUtils.lerp(0.74, 0.38, night)
      heroRiverbankStonesMaterialRef.current.color
        .set('#8c918b')
        .lerp(new THREE.Color('#876f65'), sunset * 0.3)
        .lerp(new THREE.Color('#455866'), night * 0.7)
    }
    phase2Groups.ridges.forEach((mesh, index) => {
      mesh.visible = openValley > 0.01
      const material = mesh.material
      material.opacity = openValley
      material.color
        .set(index === 0 ? '#617c74' : '#829a9b')
        .lerp(new THREE.Color(index === 0 ? '#8b6f65' : '#a48b82'), sunset * 0.48)
        .lerp(new THREE.Color(index === 0 ? '#223f58' : '#34516a'), night * 0.84)
      if ('emissiveIntensity' in material) {
        material.emissiveIntensity = THREE.MathUtils.lerp(0.035, 0.016, night)
      }
      const uniforms = material.userData.journeyAlpineUniforms
      if (uniforms) {
        uniforms.uJourneySunset.value = sunset
        uniforms.uJourneyNight.value = night
        uniforms.uJourneyRiverLight.value = night * skyConnectionProgress * 0.16
        uniforms.uJourneyDiscovery.value = 0
        uniforms.uJourneyTime.value = state.clock.elapsedTime
      }
    })
    phase2Groups.forest.forEach((mesh) => {
      mesh.visible = false
    })
    phase2Groups.shore.forEach((mesh) => {
      const kind = mesh.userData.journeyPhase2Kind
      mesh.visible = openValley > 0.02 && kind !== 'stone'
      const baseOpacity = kind === 'wet' ? 0.48 : kind === 'stone' ? 0.82 : 0.62
      mesh.material.opacity = openValley * baseOpacity * THREE.MathUtils.lerp(1, 0.54, night)
    })
    phase2Groups.clouds.forEach((cloud, index) => {
      const isFarCloudSlab = cloud.name.toUpperCase().includes('_FAR')
      cloud.visible = isFarCloudSlab && openValley > 0.02 && night < 0.98
      const material = cloud.material
      material.opacity = isFarCloudSlab ? openValley * (1 - night) * 0.09 : 0
      material.color
        .set('#e9eee7')
        .lerp(new THREE.Color('#efb7a0'), sunset * 0.58)
        .lerp(new THREE.Color('#8195a8'), night * 0.82)
      const base = cloud.userData.journeyBasePosition
      cloud.position.x = base.x + Math.sin(state.clock.elapsedTime * (0.018 + index * 0.004) + index) * (1.2 + index * 0.35)
      cloud.position.y = base.y + Math.sin(state.clock.elapsedTime * 0.011 + index * 1.7) * 0.5
    })
    const discoverySignal = Math.max(
      pointerLookRef.current.x,
      pointerLookRef.current.y * 0.88,
    )
    const cloudbreakDiscovery = discoveryPreview
      ? 1
      : smoothstep(0.08, 0.5, discoverySignal)
    if (cloudbreakMaterialRef.current) {
      cloudbreakMaterialRef.current.opacity =
        openValley * (1 - night) * (0.012 + cloudbreakDiscovery * 0.3)
      cloudbreakMaterialRef.current.color
        .set('#fff4c7')
        .lerp(new THREE.Color('#ffb06c'), sunset * 0.72)
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
          uniforms.uJourneyDiscovery.value =
            openValley * (1 - night) * (0.045 + cloudbreakDiscovery * 0.955)
          uniforms.uJourneyTime.value = state.clock.elapsedTime
        }
      })
    })
    groups.canopy.forEach((canopy) => {
      canopy.visible = false
      canopy.material.opacity = 0
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
          uniforms.uJourneySunset.value = sunset
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
      <primitive object={phase2Root} />
      <HeroRiverbankPatches
        groupRef={heroRiverbankRef}
        materialRef={heroRiverbankMaterialRef}
      />
      <HeroRiverbankStones
        groupRef={heroRiverbankStonesRef}
        materialRef={heroRiverbankStonesMaterialRef}
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
