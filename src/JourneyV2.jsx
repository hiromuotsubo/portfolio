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
  clear: 100,
}

const getInitialProgress = () => {
  const params = new URLSearchParams(window.location.search)
  const requestedProgress = Number(params.get('progress'))
  if (Number.isFinite(requestedProgress) && params.has('progress')) return clamp(requestedProgress)
  const preview = params.get('preview')
  return PREVIEW_PROGRESS[preview] ?? 0
}

const getStage = (progress) => {
  if (progress < 9) return { number: '00', label: 'ENTERING' }
  if (progress < 39) return { number: '01', label: 'THE THRESHOLD' }
  if (progress < 68) return { number: '02', label: 'VALLEY IN MIST' }
  return { number: '03', label: 'KAMIKOCHI' }
}

const CAVE_LAYERS = [
  {
    name: 'back',
    path: 'M-12-12H112V112H-12Z M35 74C30 66 31 52 37 41C42 31 49 27 56 28C65 29 72 39 75 50C78 62 74 72 67 77C57 81 44 80 35 74Z',
    colors: ['#5d6852', '#242d24'],
  },
  {
    name: 'middle',
    path: 'M-12-12H112V112H-12Z M38 71C34 64 35 53 40 44C44 36 50 32 55 33C63 34 68 42 70 51C73 61 70 69 64 73C56 76 45 76 38 71Z',
    colors: ['#263128', '#0e1510'],
  },
  {
    name: 'front',
    path: 'M-12-12H112V112H-12Z M41 68C38 65 37 60 39 55C37 51 40 47 42 44C44 40 48 39 52 35C57 36 61 38 62 43C66 47 66 52 65 56C68 61 64 66 62 69C57 71 52 70 48 72C45 70 43 70 41 68Z',
    colors: ['#07100a', '#010302'],
  },
]

function CaveFrame() {
  return (
    <div className="journey-v2__cave" aria-hidden="true">
      <div className="journey-v2__cave-bounce" />
      <div className="journey-v2__cave-light" />
      {CAVE_LAYERS.map((layer, index) => (
        <svg
          className={`journey-v2__cave-layer journey-v2__cave-layer--${layer.name}`}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          key={layer.name}
        >
          <defs>
            <filter id={`journey-v2-rock-edge-${layer.name}`} x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence type="fractalNoise" baseFrequency={`${0.014 + index * 0.004} ${0.038 + index * 0.006}`} numOctaves="3" seed={18 + index * 9} result="noise" />
              <feDisplacementMap in="SourceGraphic" in2="noise" scale={2.2 + index * 0.9} xChannelSelector="R" yChannelSelector="G" />
            </filter>
            <linearGradient id={`journey-v2-cave-grade-${layer.name}`} x1={index % 2 ? '100%' : '0%'} y1="15%" x2={index % 2 ? '0%' : '100%'} y2="88%">
              <stop offset="0%" stopColor={layer.colors[0]} stopOpacity={0.7 + index * 0.13} />
              <stop offset="58%" stopColor={layer.colors[1]} stopOpacity={0.9 + index * 0.045} />
              <stop offset="100%" stopColor="#010302" />
            </linearGradient>
          </defs>
          <path
            className="journey-v2__cave-mass"
            fill={`url(#journey-v2-cave-grade-${layer.name})`}
            fillRule="evenodd"
            filter={`url(#journey-v2-rock-edge-${layer.name})`}
            d={layer.path}
          />
        </svg>
      ))}
      <div className="journey-v2__cave-grain" />
    </div>
  )
}

function WatercolorLandscape() {
  const image = '/portfolio/nagano-kappabashi-selected.png'
  return (
    <div className="journey-v2__landscape" aria-hidden="true">
      <svg className="journey-v2__filter-defs" width="0" height="0">
        <defs>
          <filter id="journey-v2-mountain-watercolor" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.018" numOctaves="2" seed="31" result="wash" />
            <feDisplacementMap in="SourceGraphic" in2="wash" scale="1.45" xChannelSelector="R" yChannelSelector="B" result="edge" />
            <feGaussianBlur in="edge" stdDeviation="0.22" />
          </filter>
          <filter id="journey-v2-river-brush" x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.09" numOctaves="2" seed="7" result="flow" />
            <feDisplacementMap in="SourceGraphic" in2="flow" scale="2.1" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>
      <div className="journey-v2__layer journey-v2__layer--base" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--distant" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--mountain-wash" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--forest" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__forest-brush" />
      <div className="journey-v2__layer journey-v2__layer--river" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--river-brush" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__layer journey-v2__layer--foreground" style={{ backgroundImage: `url(${image})` }} />
      <div className="journey-v2__river-light" />
      <div className="journey-v2__pigment-light" />
    </div>
  )
}

function FogField() {
  return (
    <div className="journey-v2__fog" aria-hidden="true">
      <div className="journey-v2__fog-depth journey-v2__fog-depth--far"><i /><b /></div>
      <div className="journey-v2__fog-depth journey-v2__fog-depth--middle"><i /><b /></div>
      <div className="journey-v2__fog-depth journey-v2__fog-depth--near"><i /><b /></div>
      <div className="journey-v2__fog-paper" />
    </div>
  )
}

function JourneyV2() {
  const initialProgress = useMemo(getInitialProgress, [])
  const debugUi = useMemo(() => new URLSearchParams(window.location.search).has('debug'), [])
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
  const peakReveal = smoothstep(54, 69, progress)
  const ridgeReveal = smoothstep(62, 79, progress)
  const valleyReveal = smoothstep(70, 90, progress)
  const riverReveal = smoothstep(78, 96, progress)
  const clear = smoothstep(58, 92, progress)
  const fogArrival = smoothstep(23, 48, progress)
  // Keep the valley legible inside the mist. The fog should withhold detail,
  // rather than replace the landscape with a white transition card.
  const fog = 0.06 + fogArrival * (1 - valleyReveal) * 0.8
  const fogFar = 0.012 + fog * (1 - peakReveal) * 0.58
  const fogMiddle = 0.01 + fog * (1 - valleyReveal) * 0.44
  const fogNear = 0.006 + fog * (1 - riverReveal) * 0.17
  const motionLock = 1 - smoothstep(66, 78, progress)
  const pointerWeight = loaded ? smoothstep(60, 83, progress) * (1 - motionLock * 0.88) : 0
  const stage = getStage(progress)
  const pointerX = pointerRef.current.x * pointerWeight
  const pointerY = pointerRef.current.y * pointerWeight
  const landscapeScale = 1.035 + caveTravel * 0.045 + thresholdCross * 0.035

  const style = {
    '--v2-progress': progress / 100,
    '--v2-clear': clear,
    '--v2-peak-reveal': peakReveal,
    '--v2-ridge-reveal': ridgeReveal,
    '--v2-valley-reveal': valleyReveal,
    '--v2-river-reveal': riverReveal,
    '--v2-fog': fog,
    '--v2-fog-far': fogFar,
    '--v2-fog-middle': fogMiddle,
    '--v2-fog-near': fogNear,
    '--v2-cave-travel': caveTravel,
    '--v2-threshold': thresholdCross,
    '--v2-landscape-scale': landscapeScale,
    '--v2-cave-scale': 1 + caveTravel * 0.48 + thresholdCross * 3.9,
    '--v2-cave-opacity': 1 - smoothstep(42, 64, progress),
    '--v2-pointer-x': pointerX,
    '--v2-pointer-y': pointerY,
  }

  return (
    <main className={`journey-v2 ${loaded ? 'is-loaded' : ''} ${debugUi ? 'has-debug-ui' : 'is-visual-mode'}`} style={style}>
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

      <header className="journey-v2__header" aria-hidden={!debugUi}>
        <a href="/journey-v2" aria-label="Journey V2 home">JOURNEY <span>V2</span></a>
        <small>WATERCOLOR SPATIAL STUDY</small>
      </header>

      <aside className="journey-v2__chapter" aria-live="polite" aria-hidden={!debugUi}>
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

      {debugUi && <a className="journey-v2__return" href="/journey">V1 ↗</a>}
    </main>
  )
}

export default JourneyV2
