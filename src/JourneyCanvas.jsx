import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import JourneyScene from './JourneyScene.jsx'

const QUALITY_PRESETS = {
  low: { name: 'low', dpr: 0.85, particles: 0.42, shadows: false, fogLayers: 3 },
  medium: { name: 'medium', dpr: 1.15, particles: 0.7, shadows: false, fogLayers: 5 },
  high: { name: 'high', dpr: 1.5, particles: 1, shadows: true, fogLayers: 7 },
}
const QUALITY_ORDER = ['low', 'medium', 'high']

const getInitialQuality = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low'
  const memory = navigator.deviceMemory ?? 8
  const cores = navigator.hardwareConcurrency ?? 8
  if (memory <= 4 || cores <= 4) return 'low'
  if (memory <= 8 || cores <= 8 || window.matchMedia('(pointer: coarse)').matches) return 'medium'
  return 'high'
}

function AdaptiveQualityController({ tier, onTierChange }) {
  const { gl, setDpr } = useThree()
  const sampleRef = useRef({ elapsed: 0, frames: 0, strongSamples: 0, cooldown: 0 })

  useEffect(() => {
    const quality = QUALITY_PRESETS[tier]
    setDpr(quality.dpr)
    gl.shadowMap.enabled = quality.shadows
    gl.shadowMap.needsUpdate = true
    sampleRef.current.elapsed = 0
    sampleRef.current.frames = 0
    sampleRef.current.cooldown = 5
  }, [gl, setDpr, tier])

  useFrame((_, delta) => {
    const sample = sampleRef.current
    if (document.visibilityState !== 'visible') {
      sample.elapsed = 0
      sample.frames = 0
      sample.strongSamples = 0
      return
    }
    sample.cooldown = Math.max(0, sample.cooldown - delta)
    sample.elapsed += Math.min(delta, 0.1)
    sample.frames += 1
    if (sample.elapsed < 2.5 || sample.cooldown > 0) return

    const fps = sample.frames / sample.elapsed
    const index = QUALITY_ORDER.indexOf(tier)
    if (fps < 43 && index > 0) {
      sample.strongSamples = 0
      onTierChange(QUALITY_ORDER[index - 1])
    } else if (fps > 57 && index < QUALITY_ORDER.length - 1) {
      sample.strongSamples += 1
      if (sample.strongSamples >= 2) {
        sample.strongSamples = 0
        onTierChange(QUALITY_ORDER[index + 1])
      }
    } else {
      sample.strongSamples = 0
    }
    sample.elapsed = 0
    sample.frames = 0
  })

  return null
}


function JourneyLoadBridge({ onProgress }) {
  const frameRef = useRef(null)

  useEffect(() => {
    // This component only mounts once every GLTF/texture hook beneath the
    // boundary has resolved. It therefore gives the loader an exact terminal
    // signal without subscribing to drei's global progress store while the
    // scene is suspending or being hot-reloaded.
    frameRef.current = window.requestAnimationFrame(() => {
      onProgress?.({ active: false, progress: 100 })
      frameRef.current = null
    })
    return () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current)
    }
  }, [onProgress])

  return null
}

export default function JourneyCanvas({
  progress,
  skyConnectionProgress,
  activeGate,
  holdProgress,
  fogCompleted,
  presentationMode,
  outroMode,
  mobileLook,
  onAssetsProgress,
  onListenerPose,
}) {
  const [qualityTier, setQualityTier] = useState(getInitialQuality)
  const quality = QUALITY_PRESETS[qualityTier]

  return (
    <Canvas
      className="journey-canvas"
      dpr={quality.dpr}
      frameloop="always"
      camera={{ position: [0, 2.35, 23], fov: 40, near: 0.05, far: 1200 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.06
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.shadowMap.enabled = true
        gl.shadowMap.type = THREE.PCFShadowMap
      }}
    >
      <AdaptiveQualityController tier={qualityTier} onTierChange={setQualityTier} />
      <Suspense fallback={null}>
        <JourneyScene
          progress={presentationMode ? 28 : progress}
          skyConnectionProgress={presentationMode ? 0 : skyConnectionProgress}
          activeGate={activeGate}
          holdProgress={holdProgress}
          fogCompleted={fogCompleted}
          presentationMode={presentationMode}
          outroMode={outroMode}
          mobileLook={mobileLook}
          onListenerPose={onListenerPose}
          quality={quality}
        />
        {/* Mount after the scene resolves. Reading the loader store while the
            GLTF hooks suspend used to trigger a React cross-component update
            warning during the first frame. */}
        <JourneyLoadBridge onProgress={onAssetsProgress} />
      </Suspense>
    </Canvas>
  )
}
