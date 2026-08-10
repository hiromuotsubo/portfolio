import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { JOURNEY_V3_ASSETS, smoothstep } from './journeyV3Config.js'

const seededRandom = (seed) => {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return value - Math.floor(value)
}

const createFogTexture = (seed) => {
  const canvas = document.createElement('canvas')
  canvas.width = 640
  canvas.height = 320
  const context = canvas.getContext('2d')
  context.clearRect(0, 0, canvas.width, canvas.height)
  for (let index = 0; index < 28; index += 1) {
    const x = seededRandom(seed + index * 3) * canvas.width
    const y = (0.28 + seededRandom(seed + index * 5) * 0.55) * canvas.height
    const radius = (0.13 + seededRandom(seed + index * 7) * 0.24) * canvas.width
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, `rgba(236,244,238,${0.1 + seededRandom(seed + index * 11) * 0.18})`)
    gradient.addColorStop(0.55, 'rgba(220,235,228,0.1)')
    gradient.addColorStop(1, 'rgba(210,228,222,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function HeroValley({ reveal, progress }) {
  const texture = useTexture(JOURNEY_V3_ASSETS.valley)
  const materialRef = useRef(null)
  const uniforms = useMemo(() => ({
    uMap: { value: texture },
    uReveal: { value: 0 },
    uCave: { value: 1 },
    uTime: { value: 0 },
  }), [texture])

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.anisotropy = 8
  }, [texture])

  useFrame(({ clock }) => {
    if (!materialRef.current) return
    materialRef.current.uniforms.uReveal.value = reveal
    materialRef.current.uniforms.uCave.value = 1 - smoothstep(22, 72, progress)
    materialRef.current.uniforms.uTime.value = clock.elapsedTime
  })

  return (
    <mesh position={[0, 0.25, -31]} renderOrder={-10}>
      <planeGeometry args={[54, 36]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        depthWrite={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform sampler2D uMap;
          uniform float uReveal;
          uniform float uCave;
          uniform float uTime;
          varying vec2 vUv;

          vec3 saturateScene(vec3 color, float amount) {
            float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
            return mix(vec3(luminance), color, amount);
          }

          void main() {
            vec2 uv = vec2(0.07) + vUv * 0.86;
            uv += vec2(0.13, 0.17) * uCave;
            uv = clamp(uv, vec2(0.001), vec2(0.999));
            float breathing = sin(uTime * 0.12) * 0.00025;
            uv.x += breathing * smoothstep(0.1, 0.9, uv.y);
            vec3 color = texture2D(uMap, uv).rgb;
            color = saturateScene(color, 1.04);
            color *= vec3(0.97, 1.01, 1.02);
            float valleyLight = smoothstep(0.38, 0.82, vUv.y) * uReveal;
            color += vec3(0.035, 0.055, 0.04) * valleyLight;
            float aerial = (1.0 - uReveal) * (0.34 + vUv.y * 0.16);
            color = mix(color, vec3(0.67, 0.76, 0.74), aerial);
            color *= mix(1.0, 0.54, uCave);
            float edge = smoothstep(0.8, 0.15, distance(vUv, vec2(0.5, 0.48)));
            color *= mix(0.87, 1.0, edge);
            gl_FragColor = vec4(color, 1.0);
          }
        `}
      />
    </mesh>
  )
}

const buildCaveRingGeometry = (ring) => {
  const geometry = new THREE.BufferGeometry()
  const segments = 72
  const positions = []
  const uvs = []
  const indices = []
  for (let index = 0; index < segments; index += 1) {
    const angle = Math.PI * 2 * index / segments
    const contour = 1 +
      Math.sin(angle * 5 + ring.seed) * 0.045 +
      Math.sin(angle * 11 + ring.seed * 0.7) * 0.025 +
      (seededRandom(ring.seed + index * 17) - 0.5) * 0.07
    const topCompression = Math.sin(angle) > 0 ? 0.92 : 1.08
    const innerX = Math.cos(angle) * ring.innerX * contour
    const innerY = Math.sin(angle) * ring.innerY * contour * topCompression + 1.1
    const outerX = Math.cos(angle) * ring.outerX
    const outerY = Math.sin(angle) * ring.outerY + 1.1
    const depth = (seededRandom(ring.seed + index * 23) - 0.5) * 0.16
    positions.push(innerX, innerY, depth, outerX, outerY, depth - 0.45)
    uvs.push(0, index / segments, 1, index / segments)
    const next = (index + 1) % segments
    const offset = index * 2
    const nextOffset = next * 2
    indices.push(offset, offset + 1, nextOffset, offset + 1, nextOffset + 1, nextOffset)
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function CaveThreshold({ progress, reveal }) {
  const materialRefs = useRef([])
  const rings = useMemo(() => [
    { z: 5.2, innerX: 1.42, innerY: 0.74, outerX: 5.8, outerY: 3.7, seed: 80, color: '#101b14' },
    { z: 1.45, innerX: 3.05, innerY: 1.62, outerX: 10.2, outerY: 6.4, seed: 180, color: '#18271e' },
    { z: -3.1, innerX: 5.2, innerY: 2.72, outerX: 15.4, outerY: 9.3, seed: 280, color: '#27392e' },
  ], [])
  const geometries = useMemo(() => rings.map(buildCaveRingGeometry), [rings])

  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries])

  useFrame(() => {
    // The rocky threshold belongs to the cave, not the fog valley. Let it pass
    // behind the camera before the HOLD moment so the mist reads as open air.
    const caveRelease = Math.max(smoothstep(18, 45, progress), reveal)
    materialRefs.current.forEach((material, index) => {
      if (!material) return
      material.opacity = (1 - smoothstep(0.02, 0.24, caveRelease)) * (0.98 - index * 0.08)
      material.depthWrite = caveRelease < 0.72
    })
  })

  return rings.map((ring, ringIndex) => (
    <mesh
      key={ring.z}
      geometry={geometries[ringIndex]}
      position={[0, 0, ring.z]}
      frustumCulled={false}
    >
      <meshStandardMaterial
        ref={(material) => { materialRefs.current[ringIndex] = material }}
        color={ring.color}
        roughness={0.96}
        metalness={0}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  ))
}

function FogBanks({ progress, reveal, reducedMotion }) {
  const groupRef = useRef(null)
  const materialRefs = useRef([])
  const textures = useMemo(() => [createFogTexture(510), createFogTexture(910)], [])
  const layers = useMemo(() => Array.from({ length: 7 }, (_, index) => ({
    x: (seededRandom(700 + index) - 0.5) * 7,
    y: -0.4 + seededRandom(800 + index) * 2.5,
    z: -3.5 - index * 3.2,
    width: 16 + index * 2.7,
    height: 7.5 + index * 0.9,
    opacity: 0.43 + index * 0.045,
  })), [])

  useEffect(() => () => textures.forEach((texture) => texture.dispose()), [textures])

  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const arrival = smoothstep(27, 45.5, progress)
    groupRef.current.children.forEach((mesh, index) => {
      const material = materialRefs.current[index]
      if (!material) return
      const releaseStart = index < 2 ? 0.64 : index < 5 ? 0.28 : 0.08
      const localRelease = smoothstep(releaseStart, Math.min(releaseStart + 0.42, 1), reveal)
      material.opacity = layers[index].opacity * arrival * (1 - localRelease)
      const drift = reducedMotion ? 0 : Math.sin(clock.elapsedTime * (0.035 + index * 0.006) + index) * 0.5
      mesh.position.x = layers[index].x + drift + reveal * (index % 2 === 0 ? -1 : 1) * 4.2
    })
  })

  return (
    <group ref={groupRef}>
      {layers.map((layer, index) => (
        <mesh key={layer.z} position={[layer.x, layer.y, layer.z]} renderOrder={8 + index}>
          <planeGeometry args={[layer.width, layer.height]} />
          <meshBasicMaterial
            ref={(material) => { materialRefs.current[index] = material }}
            map={textures[index % textures.length]}
            color={index < 3 ? '#dce8e1' : '#c8dad4'}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.NormalBlending}
          />
        </mesh>
      ))}
    </group>
  )
}

const buildRiverGeometry = () => {
  const geometry = new THREE.BufferGeometry()
  const points = [
    { x: 0.2, z: -7, width: 4.2 },
    { x: 1.0, z: -11, width: 3.15 },
    { x: -0.15, z: -15, width: 2.1 },
    { x: 0.7, z: -19, width: 1.2 },
    { x: 0.25, z: -23, width: 0.58 },
  ]
  const positions = []
  const uvs = []
  const indices = []
  points.forEach((point, index) => {
    positions.push(point.x - point.width, -4.72, point.z, point.x + point.width, -4.72, point.z)
    uvs.push(0, index / (points.length - 1), 1, index / (points.length - 1))
    if (index < points.length - 1) {
      const offset = index * 2
      indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2)
    }
  })
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function RiverLight({ reveal, reducedMotion }) {
  const materialRef = useRef(null)
  const geometry = useMemo(buildRiverGeometry, [])
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uReveal: { value: 0 },
  }), [])

  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(({ clock }) => {
    if (!materialRef.current) return
    materialRef.current.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime
    materialRef.current.uniforms.uReveal.value = smoothstep(0.3, 0.72, reveal)
  })

  return (
    <mesh geometry={geometry} renderOrder={2}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uTime;
          uniform float uReveal;
          varying vec2 vUv;
          void main() {
            float edge = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
            float flowA = sin(vUv.y * 92.0 - uTime * 1.8 + sin(vUv.x * 18.0)) * 0.5 + 0.5;
            float flowB = sin(vUv.y * 173.0 - uTime * 2.7 + vUv.x * 31.0) * 0.5 + 0.5;
            float current = smoothstep(0.74, 0.98, flowA * 0.72 + flowB * 0.28);
            vec3 color = mix(vec3(0.02, 0.33, 0.37), vec3(0.42, 0.92, 0.91), current);
            float alpha = edge * uReveal * (0.055 + current * 0.14) * smoothstep(0.0, 0.22, vUv.y);
            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  )
}

const buildFlowerGeometry = () => {
  const geometry = new THREE.InstancedBufferGeometry()
  const positions = []
  const uvs = []
  const addQuad = (axis) => {
    const corners = axis === 0
      ? [[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0]]
      : [[0, 0, -0.5], [0, 0, 0.5], [0, 1, 0.5], [0, 0, -0.5], [0, 1, 0.5], [0, 1, -0.5]]
    const quadUvs = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
    corners.forEach((corner, index) => {
      positions.push(...corner)
      uvs.push(...quadUvs[index])
    })
  }
  addQuad(0)
  addQuad(1)
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  return geometry
}

function MeadowGround({ reveal }) {
  const materialRef = useRef(null)
  const uniforms = useMemo(() => ({
    uReveal: { value: 0 },
  }), [])

  useFrame(() => {
    if (materialRef.current) materialRef.current.uniforms.uReveal.value = smoothstep(0.55, 1, reveal)
  })

  return (
    <mesh position={[0, -4.82, -13.8]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
      <planeGeometry args={[27, 18]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uReveal;
          varying vec2 vUv;
          float hash(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
          }
          void main() {
            vec2 centered = vUv * 2.0 - 1.0;
            float riverGap = smoothstep(0.18, 0.42, abs(centered.x + centered.y * 0.13));
            float irregular = hash(floor(vUv * vec2(24.0, 18.0))) * 0.08;
            float edge = smoothstep(0.02, 0.2, vUv.y) * smoothstep(0.0, 0.16, 1.0 - abs(centered.x));
            vec3 nearGreen = vec3(0.17, 0.36, 0.095);
            vec3 farGreen = vec3(0.23, 0.43, 0.14);
            vec3 color = mix(nearGreen, farGreen, vUv.y) * (0.9 + irregular);
            float alpha = riverGap * edge * uReveal * mix(0.5, 0.12, vUv.y);
            gl_FragColor = vec4(color, alpha);
          }
        `}
      />
    </mesh>
  )
}

function FlowerMeadow({ reveal, windRef, reducedMotion }) {
  const meshRef = useRef(null)
  const materialRef = useRef(null)
  const count = useMemo(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches
    return coarse ? 820 : 2100
  }, [])
  const geometry = useMemo(buildFlowerGeometry, [])
  const attributes = useMemo(() => {
    const offsets = new Float32Array(count * 3)
    const scales = new Float32Array(count)
    const phases = new Float32Array(count)
    const stiffness = new Float32Array(count)
    const colors = new Float32Array(count * 3)
    const palette = ['#dfbd49', '#ede8d7', '#7476b6', '#ba7398', '#d78255']
      .map((color) => new THREE.Color(color))

    for (let index = 0; index < count; index += 1) {
      const depth = Math.pow(seededRandom(index * 17 + 9), 0.38)
      const z = THREE.MathUtils.lerp(-22.5, -6.2, depth)
      const near = (z + 22.5) / 16.3
      const side = seededRandom(index * 23 + 5) > 0.59 ? 1 : -1
      const riverHalfWidth = THREE.MathUtils.lerp(0.72, 4.35, near)
      const inner = riverHalfWidth + THREE.MathUtils.lerp(0.5, 0.95, near)
      const outer = THREE.MathUtils.lerp(3.3, 12.2, near)
      let x = THREE.MathUtils.lerp(inner, outer, seededRandom(index * 29 + 12)) * side
      if (side > 0) x += THREE.MathUtils.lerp(0.45, 1.4, near)
      offsets[index * 3] = x
      offsets[index * 3 + 1] = -4.78 + seededRandom(index * 31 + 3) * 0.18
      offsets[index * 3 + 2] = z
      const colony = 0.52 + seededRandom(Math.floor(x * 2.1) + Math.floor(z * 1.4) * 31) * 0.62
      scales[index] = THREE.MathUtils.lerp(0.065, 0.74, near) *
        (0.68 + seededRandom(index * 37 + 4) * 0.58) * colony
      phases[index] = seededRandom(index * 41 + 7) * Math.PI * 2
      stiffness[index] = 0.45 + seededRandom(index * 43 + 2) * 0.55
      const color = palette[Math.floor(seededRandom(index * 47 + 8) * palette.length)]
      colors[index * 3] = color.r
      colors[index * 3 + 1] = color.g
      colors[index * 3 + 2] = color.b
    }
    return { offsets, scales, phases, stiffness, colors }
  }, [count])

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uWind: { value: new THREE.Vector2(0.28, 0.1) },
    uWindStrength: { value: 0 },
    uPointerWorld: { value: new THREE.Vector2(0, -11) },
  }), [])
  const pointerPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 4.76), [])
  const pointerPoint = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(attributes.offsets, 3))
    geometry.setAttribute('aScale', new THREE.InstancedBufferAttribute(attributes.scales, 1))
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(attributes.phases, 1))
    geometry.setAttribute('aStiffness', new THREE.InstancedBufferAttribute(attributes.stiffness, 1))
    geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(attributes.colors, 3))
    geometry.instanceCount = count
    return () => geometry.dispose()
  }, [attributes, count, geometry])

  useFrame((state, delta) => {
    if (!materialRef.current) return
    const wind = windRef.current
    wind.speed = THREE.MathUtils.damp(wind.speed, 0, wind.active ? 2.3 : 4.2, delta)
    const rayPointer = new THREE.Vector2(wind.pointerX, wind.pointerY)
    state.raycaster.setFromCamera(rayPointer, state.camera)
    if (state.raycaster.ray.intersectPlane(pointerPlane, pointerPoint)) {
      materialRef.current.uniforms.uPointerWorld.value.set(pointerPoint.x, pointerPoint.z)
    }
    materialRef.current.uniforms.uTime.value = reducedMotion ? 0 : state.clock.elapsedTime
    materialRef.current.uniforms.uReveal.value = smoothstep(0.68, 1, reveal)
    materialRef.current.uniforms.uWind.value.set(wind.x || 0.28, wind.y || 0.1)
    materialRef.current.uniforms.uWindStrength.value = reducedMotion ? 0 : wind.speed
  })

  return (
    <mesh ref={meshRef} geometry={geometry} frustumCulled={false} renderOrder={12}>
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        transparent
        alphaTest={0.08}
        depthWrite
        side={THREE.DoubleSide}
        vertexShader={`
          attribute vec3 aOffset;
          attribute float aScale;
          attribute float aPhase;
          attribute float aStiffness;
          attribute vec3 aColor;
          uniform float uTime;
          uniform float uReveal;
          uniform vec2 uWind;
          uniform float uWindStrength;
          uniform vec2 uPointerWorld;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vTip;

          void main() {
            vUv = uv;
            vColor = aColor;
            vTip = uv.y;
            vec3 transformed = position;
            transformed.xz *= aScale * 0.52;
            transformed.y *= aScale * 0.46;
            vec2 distanceVector = aOffset.xz - uPointerWorld;
            float localGust = exp(-dot(distanceVector, distanceVector) / 16.0) * uWindStrength;
            float ambient = sin(uTime * 0.72 + aPhase) * 0.055 + sin(uTime * 0.31 + aPhase * 1.7) * 0.028;
            float bend = (ambient + localGust * 0.78) * (1.15 - aStiffness * 0.48) * uv.y * uv.y;
            transformed.x += uWind.x * bend;
            transformed.z += uWind.y * bend;
            transformed.y *= uReveal;
            transformed += aOffset;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
          }
        `}
        fragmentShader={`
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vTip;

          float circle(vec2 point, vec2 center, float radius) {
            float distanceToCenter = distance(point, center);
            float softness = max(fwidth(distanceToCenter) * 1.35, 0.014);
            return 1.0 - smoothstep(radius - softness, radius + softness, distanceToCenter);
          }

          void main() {
            float stem = (1.0 - smoothstep(0.025, 0.055, abs(vUv.x - 0.5))) * (1.0 - smoothstep(0.54, 0.59, vUv.y));
            vec2 top = vUv - vec2(0.5, 0.62);
            float petal = 0.0;
            for (int index = 0; index < 5; index++) {
              float angle = 6.283185 * float(index) / 5.0;
              petal = max(petal, circle(top, vec2(cos(angle), sin(angle)) * 0.125, 0.12));
            }
            float center = circle(top, vec2(0.0), 0.082);
            float alpha = max(stem * 0.72, max(petal, center));
            if (alpha < 0.08) discard;
            vec3 stemColor = vec3(0.13, 0.29, 0.12);
            vec3 flowerColor = mix(vColor * 0.84, vColor * 1.08, center);
            vec3 color = mix(stemColor, flowerColor, max(petal, center));
            gl_FragColor = vec4(color, alpha * (0.72 + vTip * 0.24));
          }
        `}
      />
    </mesh>
  )
}

function RevealLight({ reveal }) {
  const materialRef = useRef(null)
  useFrame(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.uOpacity.value =
        smoothstep(0.12, 0.48, reveal) * (1 - smoothstep(0.78, 1, reveal)) * 0.14
    }
  })
  return (
    <mesh position={[4.4, 5.8, -16]} rotation={[0, 0, -0.18]} renderOrder={20}>
      <planeGeometry args={[4.5, 19]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={{ uOpacity: { value: 0 } }}
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uOpacity;
          varying vec2 vUv;
          void main() {
            float horizontal = smoothstep(0.0, 0.34, vUv.x) * (1.0 - smoothstep(0.66, 1.0, vUv.x));
            float vertical = smoothstep(0.0, 0.16, vUv.y) * (1.0 - smoothstep(0.72, 1.0, vUv.y));
            gl_FragColor = vec4(1.0, 0.96, 0.78, horizontal * vertical * uOpacity);
          }
        `}
      />
    </mesh>
  )
}

export default function JourneyV3Scene({
  progress,
  activeGate,
  holdProgress,
  windRef,
  reducedMotion,
}) {
  const { camera, scene, size } = useThree()
  const reveal = activeGate === 'fog'
    ? holdProgress
    : progress >= 82
      ? 1
      : 0

  useEffect(() => {
    scene.background = new THREE.Color('#0b1512')
    scene.fog = new THREE.FogExp2('#91aaa5', 0.006)
    return () => {
      scene.background = null
      scene.fog = null
    }
  }, [scene])

  useFrame((state, delta) => {
    const caveTravel = smoothstep(0, 46, progress)
    const revealTravel = smoothstep(0, 1, reveal)
    const desiredZ = THREE.MathUtils.lerp(10, 5.4, caveTravel) + revealTravel * 2.4
    const desiredY = THREE.MathUtils.lerp(1.15, 1.55, caveTravel) + revealTravel * 0.6
    camera.position.x = THREE.MathUtils.damp(camera.position.x, 0, 4, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, desiredY, 3.4, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredZ, 3.4, delta)
    camera.lookAt(0, -0.25 + revealTravel * 0.55, -25)
    const portrait = size.height > size.width
    const desiredFov = THREE.MathUtils.lerp(36, portrait ? 54 : 43, revealTravel)
    if (Math.abs(camera.fov - desiredFov) > 0.01) {
      camera.fov = THREE.MathUtils.damp(camera.fov, desiredFov, 3.2, delta)
      camera.updateProjectionMatrix()
    }
    state.gl.toneMappingExposure = THREE.MathUtils.lerp(0.74, 1.08, smoothstep(0.08, 0.86, reveal))
    if (scene.fog) {
      scene.fog.density = THREE.MathUtils.lerp(0.022, 0.0012, smoothstep(0.05, 0.96, reveal))
      scene.fog.color.set('#91aaa5').lerp(new THREE.Color('#a9c7ce'), reveal)
    }
  })

  return (
    <>
      <HeroValley reveal={reveal} progress={progress} />
      <RiverLight reveal={reveal} reducedMotion={reducedMotion} />
      <MeadowGround reveal={reveal} />
      <FlowerMeadow reveal={reveal} windRef={windRef} reducedMotion={reducedMotion} />
      <FogBanks progress={progress} reveal={reveal} reducedMotion={reducedMotion} />
      <CaveThreshold progress={progress} reveal={reveal} />
      <RevealLight reveal={reveal} />
      <hemisphereLight intensity={THREE.MathUtils.lerp(0.22, 1.15, reveal)} color="#d8ecec" groundColor="#101a13" />
      <directionalLight position={[-8, 12, 5]} intensity={THREE.MathUtils.lerp(0.36, 1.7, reveal)} color="#fff6d8" />
      <pointLight position={[0, 3, -5]} intensity={1.8 * (1 - reveal)} distance={25} color="#b8d5cf" />
    </>
  )
}
