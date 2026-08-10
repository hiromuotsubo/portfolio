import { Suspense, useEffect } from 'react'
import { Canvas } from '@react-three/fiber'
import { useProgress } from '@react-three/drei'
import * as THREE from 'three'
import JourneyV3Scene from './JourneyV3Scene.jsx'

function AssetProgress({ onProgress }) {
  const { active, progress } = useProgress()

  useEffect(() => {
    onProgress?.({ active, progress })
  }, [active, onProgress, progress])

  return null
}

export default function JourneyV3Canvas({
  progress,
  activeGate,
  holdProgress,
  windRef,
  reducedMotion,
  onProgress,
}) {
  return (
    <Canvas
      className="journey-v3__canvas"
      dpr={[0.9, 1.5]}
      camera={{ position: [0, 1.2, 10], fov: 36, near: 0.1, far: 180 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = THREE.SRGBColorSpace
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.02
      }}
    >
      <AssetProgress onProgress={onProgress} />
      <Suspense fallback={null}>
        <JourneyV3Scene
          progress={progress}
          activeGate={activeGate}
          holdProgress={holdProgress}
          windRef={windRef}
          reducedMotion={reducedMotion}
        />
      </Suspense>
    </Canvas>
  )
}
