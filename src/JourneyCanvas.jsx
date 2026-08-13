import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Preload } from '@react-three/drei'
import * as THREE from 'three'
import JourneyScene from './JourneyScene.jsx'

const QUALITY_PRESETS = {
  low: { name: 'low', dpr: 0.65, particles: 0.52, shadows: false, fogLayers: 3 },
  medium: { name: 'medium', dpr: 0.9, particles: 0.76, shadows: false, fogLayers: 5 },
  high: { name: 'high', dpr: 0.9, particles: 1, shadows: true, fogLayers: 7 },
}

const getInitialQuality = () => {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'low'
  const memory = navigator.deviceMemory ?? 8
  const cores = navigator.hardwareConcurrency ?? 8
  if (memory < 6 || cores < 6) return 'low'
  if (memory < 8 || cores < 8 || window.matchMedia('(pointer: coarse)').matches) return 'medium'
  return 'high'
}

const getPerformanceDiagnostics = () => {
  const search = new URLSearchParams(window.location.search)
  if (search.get('capture') !== '1') {
    return { disabled: Object.freeze({}), dpr: null, label: 'baseline' }
  }
  const disabled = Object.freeze(Object.fromEntries(
    (search.get('perfOff') ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((value) => [value, true]),
  ))
  const requestedDprValue = search.get('perfDpr')
  const requestedDpr = Number(requestedDprValue)
  const dpr = requestedDprValue !== null && Number.isFinite(requestedDpr)
    ? THREE.MathUtils.clamp(requestedDpr, 0.5, 1.5)
    : null
  return {
    disabled,
    dpr,
    label: search.get('perfOff') || (dpr ? `dpr-${dpr}` : 'baseline'),
  }
}

function FixedQualityController({ quality }) {
  const { gl, setDpr } = useThree()

  useEffect(() => {
    setDpr(quality.dpr)
    gl.shadowMap.enabled = quality.shadows
    gl.shadowMap.type = THREE.PCFShadowMap
    // The light and all shadow casters are story-authored. Re-rendering the
    // same 2K map every idle frame is pure duplicate work; JourneyScene marks
    // it dirty when the authored state actually advances.
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
  }, [gl, quality, setDpr])

  return null
}

function JourneyPerformanceProbe({ diagnostics, quality }) {
  // Exact opt-in keeps production free of telemetry work while allowing the
  // deployed build itself—not only Vite dev mode—to be measured during QA.
  const enabled = new URLSearchParams(window.location.search).get('capture') === '1'
  const sampleRef = useRef({
    elapsed: 0,
    deltas: [],
    maxCalls: 0,
    maxTriangles: 0,
    reportIndex: 0,
    auditElapsed: 0,
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
    sample.auditElapsed += frameDelta
    if (sample.auditElapsed >= 0.5) {
      sample.auditElapsed = 0
      const liveDataset = document.documentElement.dataset
      liveDataset.journeyCurrentTextures = String(gl.info.memory.textures)
      liveDataset.journeyCurrentPrograms = String(gl.info.programs?.length ?? 0)
      liveDataset.journeyCurrentGeometries = String(gl.info.memory.geometries)
      liveDataset.journeyShadowState = JSON.stringify({
        enabled: gl.shadowMap.enabled,
        autoUpdate: gl.shadowMap.autoUpdate,
        type: gl.shadowMap.type,
      })
    }
    if (document.visibilityState !== 'visible') {
      sample.elapsed = 0
      sample.deltas.length = 0
      sample.maxCalls = 0
      sample.maxTriangles = 0
      return
    }
    if (document.documentElement.dataset.journeyVisualReady !== 'true') {
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
      diagnostic: diagnostics.label,
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
    const auditDataset = document.documentElement.dataset
    auditDataset.journeyCurrentTextures = String(gl.info.memory.textures)
    auditDataset.journeyCurrentPrograms = String(gl.info.programs?.length ?? 0)
    auditDataset.journeyCurrentGeometries = String(gl.info.memory.geometries)
    console.info(`[journey-performance] ${JSON.stringify(report)}`)
    sample.elapsed = 0
    sample.deltas.length = 0
    sample.maxCalls = 0
    sample.maxTriangles = 0
  })

  return null
}


const nextAnimationFrame = () => new Promise((resolve) => {
  window.requestAnimationFrame(resolve)
})

const waitForRendererQuiescence = async (gl, isCancelled) => {
  let signature = ''
  let stableSince = performance.now()
  while (!isCancelled()) {
    await nextAnimationFrame()
    const programs = gl.info.programs ?? []
    const nextSignature = [
      programs.length,
      gl.info.memory.textures,
      gl.info.memory.geometries,
    ].join(':')
    const programsReady = programs.every(
      (program) => typeof program.isReady !== 'function' || program.isReady(),
    )
    if (nextSignature !== signature || !programsReady) {
      signature = nextSignature
      stableSince = performance.now()
      continue
    }
    // Observe a genuinely quiet GPU/resource window rather than unlocking on
    // an elapsed-time substitute. This also absorbs programs started by
    // Preload's six offscreen cube faces.
    if (performance.now() - stableSince >= 2000) return
  }
}

function JourneyVisualReadyBridge({ onProgress, quality }) {
  const readyRef = useRef(false)
  const generationRef = useRef(0)
  const onProgressRef = useRef(onProgress)
  const { gl, scene, get } = useThree()

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  useEffect(() => {
    if (readyRef.current) return undefined
    const generation = ++generationRef.current
    let cancelled = false

    const runWarmup = async () => {
      performance.mark?.('journey-visual-ready-start')
      // Layout effects finalize every static instance buffer before this runs.
      // Two browser frames also let the authored GLTF camera become active.
      await nextAnimationFrame()
      await nextAnimationFrame()
      if (cancelled || generation !== generationRef.current) return

      const activeCamera = get().camera
      // `Preload all` uploads geometry offscreen, but its internal synchronous
      // compile can return while KHR_parallel_shader_compile is still pending.
      // Compile every threshold-hidden object asynchronously while preserving
      // its exact authored visibility; no alternate story frame reaches the
      // default framebuffer.
      const hiddenObjects = []
      scene.traverse((object) => {
        if (!object.visible) {
          hiddenObjects.push(object)
          object.visible = true
        }
      })
      try {
        const warmTarget = new THREE.WebGLRenderTarget(16, 16, {
          depthBuffer: true,
          stencilBuffer: false,
        })
        const previousTarget = gl.getRenderTarget()
        const previousXr = gl.xr.enabled
        const previousShadowUpdate = gl.shadowMap.autoUpdate
        try {
          gl.xr.enabled = false
          gl.shadowMap.autoUpdate = true
          gl.setRenderTarget(warmTarget)
          gl.clear()
          // `compileAsync` prepares surface materials but does not instantiate
          // every shadow/depth pass. One hidden offscreen render does, closing
          // the remaining first-meadow program gap without exposing pixels.
          gl.render(scene, activeCamera)
        } finally {
          gl.setRenderTarget(previousTarget)
          gl.xr.enabled = previousXr
          gl.shadowMap.autoUpdate = previousShadowUpdate
          warmTarget.dispose()
        }
        if (typeof gl.compileAsync === 'function') {
          await gl.compileAsync(scene, activeCamera)
        } else {
          gl.compile(scene, activeCamera)
        }
      } finally {
        hiddenObjects.forEach((object) => {
          object.visible = false
        })
      }
      if (cancelled || generation !== generationRef.current) return

      const textures = new Set()
      const addTexture = (value) => {
        if (value?.isTexture) textures.add(value)
        else if (Array.isArray(value)) value.forEach(addTexture)
      }
      const inspectUniformGroup = (group) => {
        if (!group || typeof group !== 'object') return
        Object.values(group).forEach((uniform) => addTexture(uniform?.value ?? uniform))
      }
      scene.traverse((object) => {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material]
        materials.filter(Boolean).forEach((material) => {
          Object.values(material).forEach(addTexture)
          inspectUniformGroup(material.uniforms)
          Object.values(material.userData ?? {}).forEach(inspectUniformGroup)
        })
      })
      textures.forEach((texture) => gl.initTexture(texture))

      // Force the parent/loader's final pre-ready React commit while the CTA
      // is still locked. That commit can finalize program variants owned by
      // reconciled materials, so it belongs inside—not after—the GPU gate.
      onProgressRef.current?.({ active: true, progress: 99 })
      await waitForRendererQuiescence(
        gl,
        () => cancelled || generation !== generationRef.current,
      )
      if (cancelled || generation !== generationRef.current) return
      readyRef.current = true
      window.__JOURNEY_V1_VISUAL_READY__ = {
        quality: quality.name,
        textures: textures.size,
        programs: gl.info.programs?.length ?? 0,
        geometries: gl.info.memory.geometries,
      }
      const readyDataset = document.documentElement.dataset
      readyDataset.journeyVisualReady = 'true'
      readyDataset.journeyQuality = quality.name
      readyDataset.journeyReadyTextures = String(gl.info.memory.textures)
      readyDataset.journeyReadyPrograms = String(gl.info.programs?.length ?? 0)
      readyDataset.journeyReadyGeometries = String(gl.info.memory.geometries)
      performance.mark?.('journey-visual-ready-complete')
      onProgressRef.current?.({ active: false, progress: 100 })
    }

    runWarmup().catch((error) => {
      if (!cancelled) {
        document.documentElement.dataset.journeyVisualReady = 'error'
        console.error('[journey-visual-ready]', error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [get, gl, quality.name, scene])

  return null
}

function JourneyFrameCapture({ captureRequest, paused, onCaptured }) {
  const capturedRequestRef = useRef(0)
  const frozenRequestRef = useRef(0)

  useEffect(() => {
    if (!captureRequest) frozenRequestRef.current = 0
  }, [captureRequest])

  useFrame((state) => {
    if (paused || frozenRequestRef.current) return
    state.gl.setRenderTarget(null)
    state.gl.render(state.scene, state.camera)
    if (!captureRequest || capturedRequestRef.current === captureRequest) return

    try {
      const source = state.gl.domElement.toDataURL('image/png')
      capturedRequestRef.current = captureRequest
      // Stop on the exact frame synchronously. Waiting for PNG decode in the
      // parent allowed the live clock to advance, then snapped backwards when
      // the older bitmap finally painted.
      frozenRequestRef.current = captureRequest
      queueMicrotask(() => onCaptured?.({ requestId: captureRequest, source }))
    } catch (error) {
      capturedRequestRef.current = captureRequest
      console.error('[journey-ending-capture]', error)
      queueMicrotask(() => onCaptured?.({ requestId: captureRequest, error }))
    }
  }, 100)

  return null
}

export default function JourneyCanvas({
  progress,
  skyConnectionProgress,
  activeGate,
  holdProgress,
  fogClearProgress,
  fogCompleted,
  presentationMode,
  endingCaptureRequest,
  endingPaused,
  onEndingCaptured,
  onAssetsProgress,
  onListenerPose,
}) {
  const [qualityTier] = useState(getInitialQuality)
  const [diagnostics] = useState(getPerformanceDiagnostics)
  const [performanceProbeEnabled] = useState(
    () => new URLSearchParams(window.location.search).get('capture') === '1',
  )
  const quality = useMemo(() => {
    const baseQuality = QUALITY_PRESETS[qualityTier]
    return Object.freeze({
      ...baseQuality,
      dpr: diagnostics.dpr ?? baseQuality.dpr,
      shadows: baseQuality.shadows && !diagnostics.disabled.shadows,
    })
  }, [diagnostics, qualityTier])

  return (
    <Canvas
      className="journey-canvas"
      dpr={quality.dpr}
      shadows={quality.shadows ? { enabled: true, type: THREE.PCFShadowMap } : false}
      frameloop="always"
      camera={{ position: [0, 2.35, 23], fov: 40, near: 0.05, far: 1200 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.06
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.shadowMap.enabled = quality.shadows
        gl.shadowMap.type = THREE.PCFShadowMap
      }}
    >
      <FixedQualityController quality={quality} />
      <Suspense fallback={null}>
        <JourneyScene
          progress={presentationMode ? 28 : progress}
          skyConnectionProgress={presentationMode ? 0 : skyConnectionProgress}
          activeGate={presentationMode ? null : activeGate}
          holdProgress={presentationMode ? 0 : holdProgress}
          fogClearProgress={presentationMode ? 1 : fogClearProgress}
          fogCompleted={presentationMode ? true : fogCompleted}
          presentationMode={presentationMode}
          onListenerPose={onListenerPose}
          quality={quality}
          diagnostics={diagnostics.disabled}
        />
        {performanceProbeEnabled && (
          <JourneyPerformanceProbe diagnostics={diagnostics} quality={quality} />
        )}
        <Preload all />
        <JourneyVisualReadyBridge onProgress={onAssetsProgress} quality={quality} />
        <JourneyFrameCapture
          captureRequest={endingCaptureRequest}
          paused={endingPaused}
          onCaptured={onEndingCaptured}
        />
      </Suspense>
    </Canvas>
  )
}
