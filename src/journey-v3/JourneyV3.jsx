import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { JOURNEY_V3_ASSETS } from './journeyV3Config.js'
import useJourneyV3Progress from './useJourneyV3Progress.js'
import usePointerWind from './usePointerWind.js'
import './journeyV3.css'

const JourneyV3Canvas = lazy(() => import('./JourneyV3Canvas.jsx'))

const createTrack = (source, volume) => {
  const audio = new Audio(source)
  audio.loop = true
  audio.preload = 'auto'
  audio.volume = volume
  return audio
}

function JourneyV3Loader({ entered, ready, loadProgress, onEnter }) {
  return (
    <section className={`journey-v3-loader ${entered ? 'is-entered' : ''}`} aria-hidden={entered}>
      <div className="journey-v3-loader__mark" aria-hidden="true">
        <i style={{ '--load-progress': `${Math.max(4, loadProgress) * 3.6}deg` }} />
        <span>V</span>
      </div>
      <p>JOURNEY</p>
      <small>{ready ? 'A VALLEY HELD IN MEMORY' : `PREPARING THE AIR — ${Math.round(loadProgress)}%`}</small>
      <button type="button" onClick={onEnter} disabled={!ready}>
        {ready ? 'ENTER' : 'LOADING'}
      </button>
    </section>
  )
}

export default function JourneyV3() {
  const {
    entered,
    enter,
    progress,
    activeGate,
    holdProgress,
    previewName,
  } = useJourneyV3Progress()
  const [assets, setAssets] = useState({ active: true, progress: 0 })
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const audioRef = useRef(null)
  const windRef = usePointerWind(entered && !activeGate)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!entered || !audioRef.current) return
    const cave = Math.max(0, 1 - progress / 52)
    const openAir = Math.max(0, Math.min(1, (progress - 24) / 66))
    audioRef.current.cave.volume = cave * 0.2
    audioRef.current.wind.volume = openAir * 0.17
    audioRef.current.river.volume = Math.max(0, (progress - 72) / 28) * 0.14
  }, [entered, progress])

  useEffect(() => () => {
    if (!audioRef.current) return
    Object.values(audioRef.current).forEach((audio) => audio.pause())
  }, [])

  const handleAssets = useCallback(({ active, progress: nextProgress }) => {
    setAssets((current) => (
      current.active === active && Math.abs(current.progress - nextProgress) < 0.05
        ? current
        : { active, progress: nextProgress }
    ))
  }, [])

  const enterExperience = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = {
        cave: createTrack(JOURNEY_V3_ASSETS.caveAudio, 0.2),
        wind: createTrack(JOURNEY_V3_ASSETS.windAudio, 0),
        river: createTrack(JOURNEY_V3_ASSETS.riverAudio, 0),
      }
    }
    Object.values(audioRef.current).forEach((audio) => {
      audio.play().catch(() => {})
    })
    enter()
  }, [enter])

  const ready = previewName ? true : !assets.active && assets.progress >= 99
  const phase = activeGate
    ? 'hold'
    : progress < 28
      ? 'cave'
      : progress < 47
        ? 'fog'
        : 'clear'
  const clearAmount = activeGate === 'fog' ? holdProgress : progress >= 82 ? 1 : 0

  return (
    <main
      className={`journey-v3 is-${phase} ${entered ? 'is-entered' : ''}`}
      style={{
        '--journey-progress': `${progress}%`,
        '--hold-progress': `${holdProgress * 360}deg`,
        '--clear-amount': clearAmount,
      }}
    >
      <div className="journey-v3__scene" aria-hidden={!entered}>
        <Suspense fallback={null}>
          <JourneyV3Canvas
            progress={progress}
            activeGate={activeGate}
            holdProgress={holdProgress}
            windRef={windRef}
            reducedMotion={reducedMotion}
            onProgress={handleAssets}
          />
        </Suspense>
      </div>

      <div className="journey-v3__cave-grade" aria-hidden="true" />
      <div className="journey-v3__paper" aria-hidden="true" />
      <div className="journey-v3__vignette" aria-hidden="true" />

      <JourneyV3Loader
        entered={entered}
        ready={ready}
        loadProgress={assets.progress}
        onEnter={enterExperience}
      />

      <header className="journey-v3__title" aria-label="Journey, inspired by Kamikochi">
        <span>JOURNEY</span>
        <small>INSPIRED BY KAMIKOCHI</small>
      </header>

      <div className="journey-v3__progress" aria-hidden="true">
        <i><b /></i>
        <span>{Math.round(progress).toString().padStart(2, '0')}</span>
      </div>

      <div className={`journey-v3__operation ${activeGate ? 'is-hold' : ''}`} role="status" aria-live="polite">
        {activeGate ? (
          <>
            <span>{holdProgress > 0 ? '' : 'HOLD'}</span>
            <i className="journey-v3__hold-mark" />
          </>
        ) : progress < 99.5 ? (
          <>
            <span>SCROLL</span>
            <i className="journey-v3__scroll-mark" />
          </>
        ) : (
          <span className="journey-v3__still">MOVE TO STIR THE FLOWERS</span>
        )}
      </div>

      <p className="journey-v3__sound" aria-hidden="true">SOUND ON</p>
    </main>
  )
}
