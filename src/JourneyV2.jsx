import { useEffect, useMemo, useRef, useState } from 'react'
import './JourneyV2.css'

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value))

const smoothstep = (edge0, edge1, value) => {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1)
  return x * x * (3 - 2 * x)
}

const PREVIEW_PROGRESS = {
  loading: 0,
  cave: 24,
  fog: 52,
  clear: 88,
}

const getInitialProgress = () => {
  const preview = new URLSearchParams(window.location.search).get('preview')
  return PREVIEW_PROGRESS[preview] ?? 0
}

const getStage = (progress) => {
  if (progress < 9) return { number: '00', label: 'ENTERING' }
  if (progress < 39) return { number: '01', label: 'THE THRESHOLD' }
  if (progress < 68) return { number: '02', label: 'VALLEY IN MIST' }
  return { number: '03', label: 'KAMIKOCHI' }
}

function CaveFrame() {
  return (
    <svg className="journey-v2__cave" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <filter id="journey-v2-rock-edge" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.018 0.05" numOctaves="3" seed="24" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <radialGradient id="journey-v2-cave-grade" cx="50%" cy="53%" r="70%">
          <stop offset="0%" stopColor="#17201b" stopOpacity="0.88" />
          <stop offset="56%" stopColor="#080b09" stopOpacity="0.97" />
          <stop offset="100%" stopColor="#010302" />
        </radialGradient>
      </defs>
      <path
        className="journey-v2__cave-mass"
        fill="url(#journey-v2-cave-grade)"
        fillRule="evenodd"
        filter="url(#journey-v2-rock-edge)"
        d="M-12-12H112V112H-12Z M41 68C37 62 38 52 42 45C45 39 49 36 53 36C59 36 63 42 65 49C68 57 66 64 62 69C56 72 47 72 41 68Z"
      />
      <path
        className="journey-v2__cave-rim journey-v2__cave-rim--outer"
        d="M41 68C37 62 38 52 42 45C45 39 49 36 53 36C59 36 63 42 65 49C68 57 66 64 62 69C56 72 47 72 41 68Z"
      />
      <path
        className="journey-v2__cave-rim journey-v2__cave-rim--inner"
        d="M42 67C39 61 40 53 43 47C46 42 50 39 53 39C58 39 61 43 63 50C65 56 64 62 60 66C55 69 47 69 42 67Z"
      />
    </svg>
  )
}

function WatercolorLandscape() {
  const image = '/portfolio/nagano-kappabashi-selected.png'
  return (
    <div className="journey-v2__landscape" aria-hidden="true">
      <div className="journey-v2__layer journey-v2__layer--base" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--sky" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--distant" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--forest" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--river" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--foreground" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__river-light" />
      <div className="journey-v2__pigment-light" />
    </div>
  )
}

function FogField() {
  return (
    <div className="journey-v2__fog" aria-hidden="true">
      <div className="journey-v2__fog-wash journey-v2__fog-wash--back" />
      <div className="journey-v2__fog-wash journey-v2__fog-wash--middle" />
      <div className="journey-v2__fog-wash journey-v2__fog-wash--front" />
      <div className="journey-v2__fog-paper" />
    </div>
  )
}

function JourneyV2() {
  const initialProgress = useMemo(getInitialProgress, [])
  const [progress, setProgress] = useState(initialProgress)
  const [loaded, setLoaded] = useState(initialProgress > 0)
  const [soundOn, setSoundOn] = useState(false)
  const targetRef = useRef(initialProgress)
  const progressRef = useRef(initialProgress)
  const pointerRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 })
  const touchRef = useRef({ active: false, y: 0 })
  const audioRef = useRef(null)

  useEffect(() => {
    const timeout = window.setTimeout(() => setLoaded(true), 1450)
    return () => window.clearTimeout(timeout)
  }, [])

  useEffect(() => {
    let frame
    let previousTime = performance.now()
    const tick = (time) => {
      const delta = Math.min((time - previousTime) / 1000, 0.05)
      previousTime = time
      const current = progressRef.current
      const target = targetRef.current
      const next = current + (target - current) * (1 - Math.exp(-delta * 4.2))
      pointerRef.current.x += (pointerRef.current.targetX - pointerRef.current.x) * (1 - Math.exp(-delta * 3.4))
      pointerRef.current.y += (pointerRef.current.targetY - pointerRef.current.y) * (1 - Math.exp(-delta * 3.4))
      if (Math.abs(next - current) > 0.0005) {
        progressRef.current = next
        setProgress(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const advance = (delta) => {
      if (!loaded) return
      targetRef.current = clamp(targetRef.current + delta)
    }
    const onWheel = (event) => {
      event.preventDefault()
      advance(event.deltaY * 0.035)
    }
    const onPointerMove = (event) => {
      pointerRef.current.targetX = clamp((event.clientX / window.innerWidth - 0.5) * 2, -1, 1)
      pointerRef.current.targetY = clamp((event.clientY / window.innerHeight - 0.5) * 2, -1, 1)
    }
    const onTouchStart = (event) => {
      if (event.touches.length !== 1) return
      touchRef.current = { active: true, y: event.touches[0].clientY }
    }
    const onTouchMove = (event) => {
      if (!touchRef.current.active || event.touches.length !== 1) return
      event.preventDefault()
      const y = event.touches[0].clientY
      advance((touchRef.current.y - y) * 0.12)
      touchRef.current.y = y
    }
    const onTouchEnd = () => {
      touchRef.current.active = false
      pointerRef.current.targetX = 0
      pointerRef.current.targetY = 0
    }
    const onKeyDown = (event) => {
      if (event.key === 'ArrowDown' || event.key === 'PageDown' || event.key === ' ') {
        event.preventDefault()
        advance(7)
      }
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        advance(-7)
      }
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [loaded])

  useEffect(() => {
    if (!soundOn) {
      audioRef.current?.forEach((audio) => audio.pause())
      return undefined
    }
    if (!audioRef.current) {
      audioRef.current = [
        new Audio('/journey/audio/cave-ambience.m4a'),
        new Audio('/journey/audio/river-field.m4a'),
      ]
      audioRef.current.forEach((audio) => {
        audio.loop = true
        audio.preload = 'auto'
      })
    }
    audioRef.current.forEach((audio) => audio.play().catch(() => {}))
    return () => audioRef.current?.forEach((audio) => audio.pause())
  }, [soundOn])

  useEffect(() => {
    if (!audioRef.current) return
    const clear = smoothstep(55, 88, progress)
    audioRef.current[0].volume = soundOn ? 0.2 * (1 - clear * 0.82) : 0
    audioRef.current[1].volume = soundOn ? 0.02 + clear * 0.17 : 0
  }, [progress, soundOn])

  const caveTravel = smoothstep(8, 48, progress)
  const thresholdCross = smoothstep(31, 62, progress)
  const clear = smoothstep(55, 88, progress)
  const fogArrival = smoothstep(23, 48, progress)
  // Keep the valley legible inside the mist. The fog should withhold detail,
  // rather than replace the landscape with a white transition card.
  const fog = 0.08 + fogArrival * (1 - clear) * 0.78
  const motionLock = 1 - smoothstep(66, 78, progress)
  const pointerWeight = loaded ? smoothstep(60, 83, progress) * (1 - motionLock * 0.88) : 0
  const stage = getStage(progress)
  const pointerX = pointerRef.current.x * pointerWeight
  const pointerY = pointerRef.current.y * pointerWeight
  const landscapeScale = 1.035 + caveTravel * 0.045 + thresholdCross * 0.035

  const style = {
    '--v2-progress': progress / 100,
    '--v2-clear': clear,
    '--v2-fog': fog,
    '--v2-cave-travel': caveTravel,
    '--v2-threshold': thresholdCross,
    '--v2-landscape-scale': landscapeScale,
    '--v2-cave-scale': 1 + caveTravel * 0.54 + thresholdCross * 3.8,
    '--v2-cave-opacity': 1 - smoothstep(48, 70, progress),
    '--v2-pointer-x': pointerX,
    '--v2-pointer-y': pointerY,
  }

  return (
    <main className={`journey-v2 ${loaded ? 'is-loaded' : ''}`} style={style}>
      <WatercolorLandscape />
      <FogField />
      <CaveFrame />

      <div className="journey-v2__paper" aria-hidden="true" />
      <div className="journey-v2__grade" aria-hidden="true" />

      <section className="journey-v2__loader" aria-label="Journey V2 is loading">
        <div className="journey-v2__loader-stain" aria-hidden="true"><i /></div>
        <p>JOURNEY <span>V2</span></p>
        <small>A MEMORY OF KAMIKOCHI</small>
      </section>

      <header className="journey-v2__header">
        <a href="/journey-v2" aria-label="Journey V2 home">JOURNEY <span>V2</span></a>
        <small>WATERCOLOR SPATIAL STUDY</small>
      </header>

      <aside className="journey-v2__chapter" aria-live="polite">
        <span>{stage.number}</span>
        <p>{stage.label}</p>
      </aside>

      <div className="journey-v2__prompt" aria-hidden="true">
        <span>{progress < 12 ? 'WAIT' : progress > 94 ? 'LOOK' : 'SCROLL'}</span>
        <i><b style={{ transform: `scaleX(${Math.max(0.025, progress / 100)})` }} /></i>
      </div>

      <button className="journey-v2__sound" type="button" onClick={() => setSoundOn((value) => !value)}>
        SOUND {soundOn ? 'ON' : 'OFF'}
      </button>

      <a className="journey-v2__return" href="/journey">V1 ↗</a>
    </main>
  )
}

export default JourneyV2
