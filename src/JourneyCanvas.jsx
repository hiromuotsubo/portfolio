import { Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import JourneyScene from './JourneyScene.jsx'

const QUALITY_PRESETS = {
  low: { name: 'low', dpr: 0.65, particles: 0.52, shadows: false, fogLayers: 3 },
  medium: { name: 'medium', dpr: 0.9, particles: 0.76, shadows: false, fogLayers: 5 },
  high: { name: 'high', dpr: 1.15, particles: 1, shadows: true, fogLayers: 7 },
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

function AdaptiveQualityController({ tier, onTierChange, maximumTier }) {
  const { gl, setDpr } = useThree()
  const sampleRef = useRef({
    elapsed: 0,
    frames: 0,
    slowFrames: 0,
    deltas: [],
    strongSamples: 0,
    cooldown: 0,
  })

  useEffect(() => {
    const quality = QUALITY_PRESETS[tier]
    setDpr(quality.dpr)
    gl.shadowMap.enabled = quality.shadows
    gl.shadowMap.needsUpdate = true
    sampleRef.current.elapsed = 0
    sampleRef.current.frames = 0
    sampleRef.current.slowFrames = 0
    sampleRef.current.deltas.length = 0
    sampleRef.current.cooldown = 5
  }, [gl, setDpr, tier])

  useFrame((_, delta) => {
    const sample = sampleRef.current
    if (document.visibilityState !== 'visible') {
      sample.elapsed = 0
      sample.frames = 0
      sample.strongSamples = 0
      sample.slowFrames = 0
      sample.deltas.length = 0
      return
    }
    sample.cooldown = Math.max(0, sample.cooldown - delta)
    sample.elapsed += Math.min(delta, 0.1)
    sample.frames += 1
    sample.slowFrames += delta > 1 / 38 ? 1 : 0
    sample.deltas.push(Math.min(delta, 0.25))
    if (sample.elapsed < 2.5 || sample.cooldown > 0) return

    const fps = sample.frames / sample.elapsed
    const index = QUALITY_ORDER.indexOf(tier)
    const slowRatio = sample.slowFrames / Math.max(sample.frames, 1)
    const sortedDeltas = sample.deltas.slice().sort((left, right) => left - right)
    const p95 = sortedDeltas[Math.min(sortedDeltas.length - 1, Math.floor(sortedDeltas.length * 0.95))] ?? 0
    if ((fps < 43 || slowRatio > 0.12 || p95 > 1 / 32) && index > 0) {
      sample.strongSamples = 0
      onTierChange(QUALITY_ORDER[index - 1])
    } else if (
      fps > 57 && slowRatio < 0.025 && p95 < 1 / 50 &&
      index < QUALITY_ORDER.indexOf(maximumTier)
    ) {
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
    sample.slowFrames = 0
    sample.deltas.length = 0
  })

  return null
}

function JourneyPerformanceProbe({ quality }) {
  // Exact opt-in keeps production free of telemetry work while allowing the
  // deployed build itself—not only Vite dev mode—to be measured during QA.
  const enabled = new URLSearchParams(window.location.search).get('capture') === '1'
  const sampleRef = useRef({
    elapsed: 0,
    deltas: [],
    maxCalls: 0,
    maxTriangles: 0,
    reportIndex: 0,
  })

  useEffect(() => () => {
    if (!enabled) return
    if (window.__JOURNEY_V1_PERFORMANCE__?.source === 'JourneyPerformanceProbe') {
      delete window.__JOURNEY_V1_PERFORMANCE__
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    sampleRef.current.elapsed = 0
    sampleRef.current.deltas.length = 0
    sampleRef.current.maxCalls = 0
    sampleRef.current.maxTriangles = 0
    window.__JOURNEY_V1_PERFORMANCE__ = {
      source: 'JourneyPerformanceProbe',
      status: 'sampling',
      quality: quality.name,
    }
  }, [enabled, quality.name])

  useFrame(({ gl }, frameDelta) => {
    if (!enabled) return
    const sample = sampleRef.current
    if (document.visibilityState !== 'visible') {
      sample.elapsed = 0
      sample.deltas.length = 0
      sample.maxCalls = 0
      sample.maxTriangles = 0
      return
    }
    sample.elapsed += frameDelta
    sample.deltas.push(frameDelta)
    sample.maxCalls = Math.max(sample.maxCalls, gl.info.render.calls)
    sample.maxTriangles = Math.max(sample.maxTriangles, gl.info.render.triangles)
    if (sample.elapsed < 10 || sample.deltas.length < 30) return

    const sorted = sample.deltas.slice().sort((left, right) => left - right)
    const percentile = (value) => (
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0
    )
    const report = {
      source: 'JourneyPerformanceProbe',
      report: sample.reportIndex + 1,
      quality: quality.name,
      seconds: Number(sample.elapsed.toFixed(3)),
      frames: sample.deltas.length,
      fps: Number((sample.deltas.length / sample.elapsed).toFixed(2)),
      frameMs: {
        median: Number((percentile(0.5) * 1000).toFixed(2)),
        p95: Number((percentile(0.95) * 1000).toFixed(2)),
        p99: Number((percentile(0.99) * 1000).toFixed(2)),
        max: Number((sorted.at(-1) * 1000).toFixed(2)),
      },
      slowFrameRatio: Number((
        sample.deltas.filter((value) => value > 1 / 30).length / sample.deltas.length
      ).toFixed(4)),
      renderer: {
        mainPassMaxCalls: sample.maxCalls,
        mainPassMaxTriangles: sample.maxTriangles,
        note: 'Manual planar-reflection work is included in frame timing, not main-pass counters.',
        width: gl.domElement.width,
        height: gl.domElement.height,
        dpr: quality.dpr,
      },
    }
    sample.reportIndex += 1
    window.__JOURNEY_V1_PERFORMANCE__ = report
    console.info(`[journey-performance] ${JSON.stringify(report)}`)
    sample.elapsed = 0
    sample.deltas.length = 0
    sample.maxCalls = 0
    sample.maxTriangles = 0
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
  onAssetsProgress,
  onListenerPose,
}) {
  const [qualityTier, setQualityTier] = useState(getInitialQuality)
  const [performanceProbeEnabled] = useState(
    () => new URLSearchParams(window.location.search).get('capture') === '1',
  )
  const quality = QUALITY_PRESETS[qualityTier]
  const maximumTier = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'low'
    : window.matchMedia('(pointer: coarse)').matches
      ? 'medium'
      : 'high'

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
      <AdaptiveQualityController
        tier={qualityTier}
        onTierChange={setQualityTier}
        maximumTier={maximumTier}
      />
      <Suspense fallback={null}>
        <JourneyScene
          progress={presentationMode ? 28 : progress}
          skyConnectionProgress={presentationMode ? 0 : skyConnectionProgress}
          activeGate={activeGate}
          holdProgress={holdProgress}
          fogCompleted={fogCompleted}
          presentationMode={presentationMode}
          outroMode={outroMode}
          onListenerPose={onListenerPose}
          quality={quality}
        />
        {performanceProbeEnabled && <JourneyPerformanceProbe quality={quality} />}
        {/* Mount after the scene resolves. Reading the loader store while the
            GLTF hooks suspend used to trigger a React cross-component update
            warning during the first frame. */}
        <JourneyLoadBridge onProgress={onAssetsProgress} />
      </Suspense>
    </Canvas>
  )
}
