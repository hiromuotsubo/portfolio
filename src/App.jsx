import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const JourneyCanvas = lazy(() => import('./JourneyCanvas.jsx'))

// Local-only visual checkpoints for animation and scene QA.
const DEV_PREVIEW = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('preview')
  : null
const PREVIEW_PROGRESS = {
  cave: 5,
  foghold: 15,
  day: 28,
  sunset: 40,
  night: 51,
  riverhold: 55,
  river: 70,
  portfolio: 28,
  outro: 100,
}[DEV_PREVIEW] ?? 0
const PREVIEW_GATE = {
  foghold: 'fog',
  riverhold: 'river',
}[DEV_PREVIEW] ?? null
const PREVIEW_HOLD_PROGRESS = PREVIEW_GATE ? 0.62 : 0
const PREVIEW_ENTERED = Boolean(DEV_PREVIEW)
const PORTFOLIO_PAGES = ['home', 'about', 'project', 'contact']
const PORTFOLIO_PATHS = {
  home: '/',
  about: '/about',
  project: '/project',
  contact: '/contact',
}

const getRouteFromLocation = () => {
  const legacyPage = window.location.hash.replace('#/', '')
  if (PORTFOLIO_PAGES.includes(legacyPage)) {
    const legacyPath = PORTFOLIO_PATHS[legacyPage]
    window.history.replaceState(null, '', `${legacyPath}${window.location.search}`)
    return { view: 'portfolio', page: legacyPage }
  }

  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  if (pathname === '/journey') return { view: 'journey', page: null }
  if (pathname === '/projects') {
    window.history.replaceState(null, '', `/project${window.location.search}`)
    return { view: 'portfolio', page: 'project' }
  }

  const page = Object.entries(PORTFOLIO_PATHS).find(([, path]) => path === pathname)?.[0]
  return { view: 'portfolio', page: page ?? 'home' }
}

const INITIAL_ROUTE = getRouteFromLocation()
const JOURNEY_STORAGE_KEY = 'hiromu-journey-seen'
const HAS_SEEN_JOURNEY = (() => {
  try {
    return window.localStorage.getItem(JOURNEY_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
})()
const INITIAL_VIEW = (
  INITIAL_ROUTE.view === 'journey' ||
  (INITIAL_ROUTE.page === 'home' && !HAS_SEEN_JOURNEY)
) ? 'journey' : 'portfolio'
const INITIAL_PORTFOLIO_PAGE = INITIAL_VIEW === 'portfolio'
  ? INITIAL_ROUTE.page
  : null

// Creator controls: adjust these values when fine-tuning the experience.
const EXPERIENCE_TUNING = {
  scrollSensitivity: 0.005,
  maxInputStep: 1.5,
  maxInputLead: 3,
  followDamping: 2.4,
  reverseSpeedMultiplier: 1.35,
  gateCooldownMs: 520,
}

// Minimum forward time for each chapter. Together these total 30 seconds.
const EXPERIENCE_PACE = [
  { start: 0, end: 12, minSeconds: 4.5 }, // Walk through the cave.
  { start: 12, end: 15, minSeconds: 1.5 }, // Approach the exit.
  { start: 15, end: 20, minSeconds: 2.5 }, // Hold to clear the mist.
  { start: 20, end: 35, minSeconds: 2 }, // Summer daylight.
  { start: 35, end: 45, minSeconds: 6 }, // Day to sunset.
  { start: 45, end: 55, minSeconds: 5 }, // Sunset to night.
  { start: 55, end: 65, minSeconds: 5.5 }, // Illuminate and connect the river.
  { start: 65, end: 82, minSeconds: 1.5 }, // Luminous landscape.
  { start: 82, end: 100, minSeconds: 1.5 }, // Final camera reveal.
]

const getMaximumProgressRate = (progress) => {
  const chapter =
    EXPERIENCE_PACE.find(({ start, end }) => progress >= start && progress < end) ??
    EXPERIENCE_PACE[EXPERIENCE_PACE.length - 1]
  return (chapter.end - chapter.start) / chapter.minSeconds
}

const GATES = {
  fog: {
    at: 15,
    end: 20,
    duration: 2500,
    label: 'HOLD',
  },
  river: {
    at: 55,
    end: 61,
    duration: 3300,
    label: 'HOLD',
  },
}

const SKY_CONNECTION = {
  start: 61,
  end: 65,
  duration: 2200,
}

const STORY_MESSAGES = [
  {
    start: 21,
    end: 31,
    number: '01',
    title: ['The world opens', 'when you stay.'],
    tone: 'dark',
    align: 'left',
  },
  {
    start: 67,
    end: 78,
    number: '02',
    title: ['A river of light,', 'toward the Milky Way.'],
    tone: 'light',
    align: 'left',
  },
  {
    start: 84,
    end: 96,
    number: '03',
    title: ['What you notice,', 'remains.'],
    tone: 'light',
    align: 'right',
  },
]

const clamp = (value, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value))

const PORTFOLIO_IMAGE_URLS = [
  '/portfolio/about-hiromu.jpg',
  '/portfolio/research-vr.jpg',
  '/portfolio/philosophy-lake.jpg',
  '/portfolio/nagano-summer.jpg',
  '/portfolio/journey-day.jpg',
  '/portfolio/journey-cave.jpg',
  '/portfolio/journey-river.jpg',
  '/portfolio/journey-storyboard.jpg',
  '/portfolio/journey-night.jpg',
]

function useAmbientAudio(progress, fogCompleted) {
  const audioRef = useRef(null)
  const [audioReady, setAudioReady] = useState(false)

  const ensureAudio = useCallback(async () => {
    if (audioRef.current) {
      audioRef.current.context.resume()
      return
    }

    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    const context = new AudioContext()
    const master = context.createGain()
    const compressor = context.createDynamicsCompressor()
    master.gain.value = 0.88
    compressor.threshold.value = -24
    compressor.knee.value = 18
    compressor.ratio.value = 2
    compressor.attack.value = 0.08
    compressor.release.value = 0.9
    master.connect(compressor).connect(context.destination)
    audioRef.current = { context, master, compressor, tracks: {}, cancelled: false }
    await context.resume()

    const definitions = {
      cave: {
        url: '/journey/audio/cave-master.m4a',
        position: [0, 3, -8],
        refDistance: 10,
        filter: { type: 'lowpass', frequency: 5200, q: 0.42 },
      },
      wind: {
        url: '/journey/audio/wind-master.m4a',
        position: [-58, 32, -112],
        refDistance: 38,
        filter: { type: 'highpass', frequency: 72, q: 0.48 },
      },
      river: {
        url: '/journey/audio/river-master.m4a',
        position: [12, -1, -82],
        refDistance: 25,
        filter: { type: 'lowpass', frequency: 8200, q: 0.36 },
      },
    }

    try {
      const decoded = await Promise.all(
        Object.entries(definitions).map(async ([name, definition]) => {
          const response = await fetch(definition.url)
          if (!response.ok) throw new Error(`Unable to load ${definition.url}`)
          const buffer = await context.decodeAudioData(await response.arrayBuffer())
          return [name, definition, buffer]
        }),
      )
      if (audioRef.current?.cancelled) return

      decoded.forEach(([name, definition, buffer]) => {
        const source = context.createBufferSource()
        const gain = context.createGain()
        const filter = context.createBiquadFilter()
        const panner = context.createPanner()
        source.buffer = buffer
        source.loop = true
        gain.gain.value = 0.0001
        filter.type = definition.filter.type
        filter.frequency.value = definition.filter.frequency
        filter.Q.value = definition.filter.q
        panner.panningModel = 'HRTF'
        panner.distanceModel = 'inverse'
        panner.refDistance = definition.refDistance
        panner.maxDistance = 320
        panner.rolloffFactor = 0.82
        panner.positionX.value = definition.position[0]
        panner.positionY.value = definition.position[1]
        panner.positionZ.value = definition.position[2]
        source.connect(gain).connect(filter).connect(panner).connect(master)
        source.start(0, Math.min(buffer.duration * 0.18, name === 'cave' ? 2.7 : name === 'wind' ? 4.1 : 1.9))
        audioRef.current.tracks[name] = { source, gain, filter, panner }
      })
      setAudioReady(true)
    } catch {
      // Keep the visual experience usable when audio decoding is unavailable.
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audioReady || !audio?.tracks) return
    const now = audio.context.currentTime
    const outside = clamp((progress - 16) / 10, 0, 1)
    const night = clamp((progress - 44) / 12, 0, 1)
    const valley = clamp((progress - 18) / 18, 0, 1)
    const levels = {
      cave: 0.2 * (1 - clamp((progress - 9) / 15, 0, 1)),
      wind: (fogCompleted ? 0.12 : 0.018) * outside * (1 - night * 0.84),
      river: (0.004 + valley * 0.115) * (1 - night * 0.38),
    }

    Object.entries(levels).forEach(([name, level]) => {
      const gain = audio.tracks[name]?.gain.gain
      if (!gain) return
      gain.cancelScheduledValues(now)
      gain.setTargetAtTime(Math.max(0.0001, level), now, name === 'cave' ? 1.35 : 2.2)
    })

    const windFilter = audio.tracks.wind?.filter
    const riverFilter = audio.tracks.river?.filter
    if (windFilter) {
      windFilter.frequency.setTargetAtTime(72 + outside * 34 + night * 28, now, 1.8)
    }
    if (riverFilter) {
      riverFilter.frequency.setTargetAtTime(5200 + valley * 3000 - night * 1700, now, 2.4)
    }

    const listener = audio.context.listener
    const listenerZ = 18 - progress * 2.25
    if (listener.positionX) {
      listener.positionX.linearRampToValueAtTime(0, now + 0.2)
      listener.positionY.linearRampToValueAtTime(2.2, now + 0.2)
      listener.positionZ.linearRampToValueAtTime(listenerZ, now + 0.2)
      listener.forwardX.value = 0
      listener.forwardY.value = 0
      listener.forwardZ.value = -1
      listener.upX.value = 0
      listener.upY.value = 1
      listener.upZ.value = 0
    } else {
      listener.setPosition(0, 2.2, listenerZ)
      listener.setOrientation(0, 0, -1, 0, 1, 0)
    }
  }, [audioReady, fogCompleted, progress])

  useEffect(
    () => () => {
      if (!audioRef.current) return
      audioRef.current.cancelled = true
      Object.values(audioRef.current.tracks ?? {}).forEach(({ source }) => source.stop())
      audioRef.current.context.close()
    },
    [],
  )

  return ensureAudio
}

function HiromuMark({ stage = 4, compact = false }) {
  return (
    <span className={`hiromu-logo ${compact ? 'is-compact' : ''}`} aria-label="Hiromu">
      <svg viewBox="0 0 86 78" role="img" aria-hidden="true">
        <path
          className={`hiromu-logo__ro ${stage === 1 || stage === 2 ? 'is-focus' : ''}`}
          d="M10 29 14 7l28 18S52 5 65 7c8 1 12 4 13 7 2 4 0 9-1 11"
        />
        <path
          className={`hiromu-logo__hi ${stage === 0 || stage === 2 ? 'is-focus' : ''}`}
          d="M8 43s12-4 8-2c-3 1-3 35 27 36 30 0 35-36 33-39-2-3 3 5 6 4"
        />
        <circle className={`hiromu-logo__mu ${stage === 2 ? 'is-focus' : ''}`} cx="35" cy="41" r="1.4" />
        <circle className={`hiromu-logo__mu ${stage === 2 ? 'is-focus' : ''}`} cx="53" cy="40" r="1.4" />
      </svg>
      {!compact ? (
        <span className="hiromu-logo__word">
          <i className={stage === 0 ? 'is-focus' : ''}>Hi</i>
          <i className={stage === 1 ? 'is-focus' : ''}>ro</i>
          <i className={stage === 2 ? 'is-focus' : ''}>mu</i>
        </span>
      ) : null}
    </span>
  )
}

function ExperienceLoader({ entered, onEnter, assetsActive, assetProgress }) {
  const [dismissed, setDismissed] = useState(false)
  const [visualProgress, setVisualProgress] = useState(0)
  const [animationStage, setAnimationStage] = useState(0)
  const loadComplete = !assetsActive && assetProgress >= 100
  const ready = loadComplete && visualProgress >= 99.5

  useEffect(() => {
    let frame
    let previous = performance.now()
    const tick = (time) => {
      const elapsed = Math.min((time - previous) / 1000, 0.05)
      previous = time
      setVisualProgress((current) => {
        const ceiling = loadComplete ? 100 : 92
        return Math.min(ceiling, current + elapsed * (loadComplete ? 27 : 22))
      })
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frame)
  }, [loadComplete])

  useEffect(() => {
    if (ready) {
      setAnimationStage(4)
      return undefined
    }

    const interval = window.setInterval(() => {
      setAnimationStage((current) => (current + 1) % 3)
    }, 1150)

    return () => window.clearInterval(interval)
  }, [ready])

  useEffect(() => {
    if (!entered) return undefined
    const timeout = window.setTimeout(() => setDismissed(true), 1150)
    return () => window.clearTimeout(timeout)
  }, [entered])

  if (dismissed) return null

  const displayedProgress = Math.min(100, Math.round(visualProgress))

  return (
    <div
      className={`experience-loader stage-${animationStage} ${ready ? 'is-ready' : ''} ${entered ? 'is-entering' : ''}`}
      role="dialog"
      aria-label="Hiromu portfolio loading screen"
    >
      <div className="experience-loader__grain" aria-hidden="true" />
      <div className="experience-loader__brand">
        <span>HIROMU OTSUBO</span>
        <small>PORTFOLIO / 2026</small>
      </div>
      <div className="experience-loader__center">
        <HiromuMark stage={animationStage} />
        <div
          className="experience-loader__count"
          role="progressbar"
          aria-label="Loading portfolio"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={displayedProgress}
        >
          <span>
            {displayedProgress}
            <small>%</small>
          </span>
          <i aria-hidden="true"><b style={{ width: `${visualProgress}%` }} /></i>
        </div>
        <div className="experience-loader__action">
          {ready ? (
            <div className="experience-loader__ready">
              <button type="button" onClick={onEnter}>
                <span>ENTER THE JOURNEY</span>
                <i aria-hidden="true">↗</i>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CursorFollower({ entered, active }) {
  const cursorRef = useRef(null)

  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)')
    if (!finePointer.matches) return undefined

    let frame
    let targetX = window.innerWidth / 2
    let targetY = window.innerHeight / 2
    let currentX = targetX
    let currentY = targetY

    const move = (event) => {
      targetX = event.clientX
      targetY = event.clientY
      if (cursorRef.current) cursorRef.current.dataset.visible = 'true'
    }
    const leave = () => {
      if (cursorRef.current) cursorRef.current.dataset.visible = 'false'
    }
    const tick = () => {
      currentX += (targetX - currentX) * 0.14
      currentY += (targetY - currentY) * 0.14
      if (cursorRef.current) {
        cursorRef.current.style.transform =
          `translate3d(${currentX}px, ${currentY}px, 0) translate(-50%, -50%)`
      }
      frame = window.requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', move, { passive: true })
    document.documentElement.addEventListener('mouseleave', leave)
    frame = window.requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('pointermove', move)
      document.documentElement.removeEventListener('mouseleave', leave)
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <span
      ref={cursorRef}
      className={`journey-cursor ${entered ? 'is-entered' : ''} ${active ? 'is-active' : ''}`}
      aria-hidden="true"
    />
  )
}

const ABOUT_ITEMS = [
  ['profile', 'Profile'],
  ['research', 'Research'],
  ['approach', 'Approach'],
  ['motivation', 'Motivation'],
]

const PROJECT_ITEMS = [
  ['origin', 'From Photo to 3D'],
  ['contrast', 'Spatial Contrast'],
  ['terrain', 'Terrain & Light'],
  ['interaction', 'Interaction'],
  ['atmosphere', 'Sound & Time'],
  ['emotion', 'Emotional Arc'],
]

function PortfolioImage({ src, alt, caption, className = '' }) {
  return (
    <figure className={`portfolio-figure ${className}`}>
      <div className="portfolio-figure__image">
        <img src={src} alt={alt} loading="lazy" />
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  )
}

function PortfolioSite({ onReplay, onNavigate, onScrolledChange, page = 'home' }) {
  const siteScrollRef = useRef(null)
  const transitionTimersRef = useRef([])
  const transitioningRef = useRef(false)
  const [activePanel, setActivePanel] = useState('profile')
  const [panelMotion, setPanelMotion] = useState({})
  const [mistTransition, setMistTransition] = useState({
    phase: 'idle',
    x: '50vw',
    y: '50vh',
  })

  const selectPanel = useCallback((id) => {
    setActivePanel(id)
    const root = siteScrollRef.current
    const panel = root?.querySelector(`[data-story-panel="${id}"]`)
    if (!root || !panel) return

    root.scrollTop = 0
    root.scrollLeft = 0
    const scroller = root.querySelector('.portfolio-story__panels') ?? root
    const targetTop = scroller.scrollTop
      + panel.getBoundingClientRect().top
      - scroller.getBoundingClientRect().top
    scroller.scrollTo({ top: targetTop, behavior: 'smooth' })
  }, [])

  const scrollStoryToTop = useCallback(() => {
    const scroller = siteScrollRef.current?.querySelector('.portfolio-story__panels')
    if (!scroller) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [])

  const navigate = useCallback((nextPage, event) => {
    if (nextPage === page || transitioningRef.current) return

    const targetBounds = event?.currentTarget?.getBoundingClientRect()
    const x = Number.isFinite(event?.clientX) && event.clientX > 0
      ? `${event.clientX}px`
      : `${(targetBounds?.left ?? window.innerWidth / 2) + (targetBounds?.width ?? 0) / 2}px`
    const y = Number.isFinite(event?.clientY) && event.clientY > 0
      ? `${event.clientY}px`
      : `${(targetBounds?.top ?? window.innerHeight / 2) + (targetBounds?.height ?? 0) / 2}px`
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const switchDelay = reduceMotion ? 90 : 1050
    const finishDelay = reduceMotion ? 190 : 2100

    transitioningRef.current = true
    transitionTimersRef.current.forEach(window.clearTimeout)
    setMistTransition({ phase: 'cover', x, y })

    transitionTimersRef.current = [
      window.setTimeout(() => {
        setActivePanel(nextPage === 'project' ? 'goal' : 'profile')
        onNavigate(nextPage)
        setMistTransition({ phase: 'reveal', x, y })
      }, switchDelay),
      window.setTimeout(() => {
        transitioningRef.current = false
        setMistTransition({ phase: 'idle', x, y })
      }, finishDelay),
    ]
  }, [onNavigate, page])

  useEffect(() => () => {
    transitionTimersRef.current.forEach(window.clearTimeout)
  }, [])

  useEffect(() => {
    setActivePanel(page === 'project' ? 'goal' : 'profile')
    onScrolledChange(page !== 'home')
    if (page === 'about' || page === 'project') {
      requestAnimationFrame(() => {
        if (siteScrollRef.current) {
          siteScrollRef.current.scrollTop = 0
          siteScrollRef.current.scrollLeft = 0
        }
        siteScrollRef.current?.querySelector('.portfolio-story__panels')?.scrollTo({ top: 0, behavior: 'auto' })
        siteScrollRef.current?.querySelector('.portfolio-story__rail')?.scrollTo({ top: 0 })
      })
    }
  }, [onScrolledChange, page])

  useEffect(() => {
    if (page !== 'about' && page !== 'project') return undefined
    const root = siteScrollRef.current
    const scroller = root?.querySelector('.portfolio-story__panels')
    if (!root || !scroller) return undefined

    let frame = null
    const updateActivePanel = () => {
      frame = null
      const panels = [...scroller.querySelectorAll('[data-story-panel]')]
      const focusLine = scroller.getBoundingClientRect().top + scroller.clientHeight * 0.38
      const focusedPanel = panels.find((panel) => {
        const bounds = panel.getBoundingClientRect()
        return bounds.top <= focusLine && bounds.bottom > focusLine
      })
      const fallbackPanel = panels.reduce((current, panel) => (
        Math.abs(panel.getBoundingClientRect().top - focusLine)
          < Math.abs(current.getBoundingClientRect().top - focusLine)
          ? panel
          : current
      ), panels[0])
      const nextPanel = focusedPanel ?? fallbackPanel
      if (nextPanel?.dataset.storyPanel) setActivePanel(nextPanel.dataset.storyPanel)
    }

    const handleScroll = () => {
      if (frame !== null) return
      frame = requestAnimationFrame(updateActivePanel)
    }

    scroller.addEventListener('scroll', handleScroll, { passive: true })
    updateActivePanel()
    return () => {
      scroller.removeEventListener('scroll', handleScroll)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [page])

  useEffect(() => {
    if (page !== 'about' && page !== 'project') return undefined
    const root = siteScrollRef.current
    const scroller = root?.querySelector('.portfolio-story__panels')
    const panels = scroller?.querySelectorAll('[data-story-panel]')
    if (!scroller || !panels?.length) return undefined

    setPanelMotion({})
    if (!('IntersectionObserver' in window)) {
      setPanelMotion(Object.fromEntries(
        [...panels].map((panel) => [panel.dataset.storyPanel, 'visible']),
      ))
      return undefined
    }

    const observer = new IntersectionObserver((entries) => {
      setPanelMotion((current) => {
        const next = { ...current }
        let changed = false
        entries.forEach((entry) => {
          const id = entry.target.dataset.storyPanel
          if (!id) return
          const rootTop = entry.rootBounds?.top ?? 0
          const state = entry.intersectionRatio >= 0.12
            ? 'visible'
            : entry.boundingClientRect.top < rootTop
              ? 'before'
              : 'after'
          if (next[id] !== state) {
            next[id] = state
            changed = true
          }
        })
        return changed ? next : current
      })
    }, {
      root: scroller,
      rootMargin: '-7% 0px -7% 0px',
      threshold: [0, 0.12, 0.2],
    })

    panels.forEach((panel) => observer.observe(panel))
    return () => observer.disconnect()
  }, [page])

  const panelClassName = (id, extra = '') => {
    return [
      'portfolio-panel',
      id === activePanel ? 'is-active' : '',
      `is-${panelMotion[id] ?? 'after'}`,
      extra,
    ].filter(Boolean).join(' ')
  }

  const renderAbout = () => (
    <section className="portfolio-story portfolio-page" aria-labelledby="about-title">
      <aside className="portfolio-story__rail">
        <span className="portfolio-kicker">ABOUT</span>
        <h2 id="about-title">Hiromu Otsubo.</h2>
        <nav aria-label="About chapters">
          {ABOUT_ITEMS.map(([id, label], index) => (
            <button key={id} type="button" className={activePanel === id ? 'is-current' : ''} onClick={() => selectPanel(id)}>
              <i>{String(index + 1).padStart(2, '0')}</i><span>{label}</span>
            </button>
          ))}
        </nav>
        <p className="portfolio-story__hint"><span aria-hidden="true">↓</span> SCROLL TO EXPLORE</p>
      </aside>
      <div className="portfolio-story__panels">
        <article id="profile" className={panelClassName('profile')} data-story-panel="profile">
          <PortfolioImage src="/portfolio/about-portrait.webp" alt="Hiromu checking his camera" caption="Photographing" className="is-about-photo" />
          <div className="portfolio-panel__copy">
            <span className="portfolio-kicker">PROFILE</span>
            <h3>I’m interested in how experiences make people feel.</h3>
            <p>I explore those feelings through perspective, atmosphere and interaction.</p>
            <dl className="portfolio-profile-facts">
              <div><dt>BASED IN</dt><dd>NAGANO, JAPAN</dd></div>
              <div><dt>WORK</dt><dd>DESIGN / DEVELOPMENT</dd></div>
              <div><dt>INTERESTS</dt><dd>PHOTOGRAPHY / SOBA</dd></div>
              <div><dt>PHOTOGRAPHS</dt><dd>ALL DOCUMENTARY PHOTOGRAPHS ON THIS PAGE BY HIROMU</dd></div>
            </dl>
          </div>
        </article>

        <article id="research" className={panelClassName('research')} data-story-panel="research">
          <PortfolioImage src="/portfolio/about-perspective.webp" alt="Two people walking beneath a vast mountain and summer sky" caption="Human scale in landscape." className="is-about-photo" />
          <div className="portfolio-panel__copy">
            <span className="portfolio-kicker">RESEARCH</span>
            <h3>A person can make a vast landscape feel even greater.</h3>
            <p>That observation led to my primary study comparing awe in first- and third-person immersive VR.</p>
            <p>I also contributed as a co-author to related studies on awe, emotion and human experience.</p>
            <a href="https://scholar.google.co.jp/citations?user=xiwv18wAAAAJ&hl=ja" target="_blank" rel="noreferrer">VIEW RESEARCH <span>↗</span></a>
          </div>
        </article>

        <article id="approach" className={panelClassName('approach')} data-story-panel="approach">
          <PortfolioImage src="/portfolio/about-stillness.webp" alt="Mist floating above a still lake and quiet boats" caption="MIST OVER STILL WATER" className="is-about-photo" />
          <div className="portfolio-panel__copy">
            <span className="portfolio-kicker">APPROACH</span>
            <h3>Give people time to notice what they feel.</h3>
            <p>I use stillness, space and slower moments to make room for that attention.</p>
          </div>
        </article>

        <article id="motivation" className={panelClassName('motivation')} data-story-panel="motivation">
          <PortfolioImage src="/portfolio/about-origin.webp" alt="Kamikochi mountains and the Azusa River seen from Kappa Bridge" caption="KAMIKOCHI" className="is-about-photo" />
          <div className="portfolio-panel__copy">
            <span className="portfolio-kicker">MOTIVATION</span>
            <h3>A photograph preserved the view, but not the feeling of being there.</h3>
            <p>I spent six weeks working in Kamikochi. Journey uses depth, sound and interaction to translate that experience—from a confined cave to an open valley.</p>
          </div>
        </article>
        <footer className="portfolio-story__end">
          <span>END OF ABOUT</span>
          <button type="button" onClick={scrollStoryToTop}>BACK TO TOP <i aria-hidden="true">↑</i></button>
        </footer>
      </div>
    </section>
  )

  const renderProject = () => (
    <section className="portfolio-story portfolio-page is-project" aria-labelledby="project-title">
      <aside className="portfolio-story__rail">
        <span className="portfolio-kicker">PROJECT</span>
        <h2 id="project-title">Journey.</h2>
        <nav aria-label="Project chapters">
          {PROJECT_ITEMS.map(([id, label], index) => (
            <button key={id} type="button" className={activePanel === id ? 'is-current' : ''} onClick={() => selectPanel(id)}>
              <i>{String(index + 1).padStart(2, '0')}</i><span>{label}</span>
            </button>
          ))}
        </nav>
        <p className="portfolio-story__hint"><span aria-hidden="true">↓</span> SCROLL TO EXPLORE</p>
      </aside>
      <div className="portfolio-story__panels">
        <article id="origin" className={panelClassName('origin')} data-story-panel="origin">
          <PortfolioImage src="/portfolio/project-inspiration-v2.png" alt="A Kamikochi field photograph used as a reference for Journey" caption="FIELD REFERENCE / KAMIKOCHI" />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">FROM PHOTO TO 3D</span><h3>The photograph became a reference, not a blueprint.</h3><p>I spent six weeks working in Kamikochi and photographed its mountains, river and changing atmosphere. In Blender, those memories became a fictional valley: the composition and feeling remain, while the terrain, route and timing were rebuilt for an interactive experience.</p></div>
        </article>
        <article id="contrast" className={panelClassName('contrast')} data-story-panel="contrast">
          <PortfolioImage src="/portfolio/project-contrast-v2.png" alt="Journey beginning inside a dark cave and opening toward the valley" caption="CAVE TO VALLEY" className="is-dark" />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">SPATIAL CONTRAST</span><h3>A confined cave makes the open valley feel larger.</h3><p>The narrow, dark opening intentionally limits the field of view. Emerging into the wide valley creates a stronger contrast in scale—an approach informed by my research into viewpoint, awe and emotional experience.</p></div>
        </article>
        <article id="terrain" className={panelClassName('terrain')} data-story-panel="terrain">
          <PortfolioImage src="/portfolio/project-goal-v2.png" alt="The finished Journey valley beside its Blender terrain wireframe" caption="BLENDER TERRAIN / WEBGL LIGHTING" />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">TERRAIN &amp; LIGHT</span><h3>Actual depth lets every change belong to the same place.</h3><p>The valley was shaped as 3D terrain in Blender, then shaded with projected rock detail and watercolor-like pigment. In the browser, the same geometry receives moving light, mist, shadows and the transition from day to night, so the scene changes without becoming a different image.</p></div>
        </article>
        <article id="interaction" className={panelClassName('interaction')} data-story-panel="interaction">
          <PortfolioImage src="/portfolio/project-interaction-v2.png" alt="The HOLD interaction placed within the night-time Journey landscape" caption="HOLD / WORLD RESPONSE" className="is-dark" />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">INTERACTION</span><h3>Holding gives the landscape time to be seen.</h3><p>Scroll carries the journey forward; HOLD deliberately interrupts that rhythm. A raycast places the response at the touched point in the 3D world, where light gathers and remains as a quiet trace of the viewer’s action.</p></div>
        </article>
        <article id="atmosphere" className={panelClassName('atmosphere')} data-story-panel="atmosphere">
          <PortfolioImage src="/portfolio/project-emotion-v2.png" alt="The Journey valley changing from daylight to a star-filled night" caption="SPATIAL AUDIO / DAY TO NIGHT" className="is-dark" />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">SOUND &amp; TIME</span><h3>Time changes through light before it is explained in words.</h3><p>Cave ambience, wind and water occupy different positions in the world and crossfade as the camera travels. The gradual shift into night slows the experience, while the environment—not an interface—signals when to continue or hold.</p></div>
        </article>
        <article id="emotion" className={panelClassName('emotion')} data-story-panel="emotion">
          <PortfolioImage src="/portfolio/project-night-clean.png" alt="Journey valley at the quiet end of its night sequence" caption="TENSION / AWE / AFTERGLOW" className="is-dark" />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">EMOTIONAL ARC</span><h3>From tension, to awe, to calm.</h3><p>The order of space, interaction, sound and time was planned as one emotional curve: uncertainty in the cave, release in the open valley, wonder as the river and sky connect, then enough stillness for the feeling to remain.</p><button type="button" onClick={onReplay}>EXPERIENCE AGAIN <span>↗</span></button></div>
        </article>
        <footer className="portfolio-story__end">
          <span>END OF PROJECT</span>
          <button type="button" onClick={scrollStoryToTop}>BACK TO TOP <i aria-hidden="true">↑</i></button>
        </footer>
      </div>
    </section>
  )

  return (
    <section
      ref={siteScrollRef}
      className={`portfolio-site is-page-${page} is-mist-${mistTransition.phase}`}
      data-portfolio-page={page}
    >
      <header className="portfolio-nav">
        <button className="portfolio-nav__brand" type="button" onClick={(event) => navigate('home', event)}>
          <HiromuMark compact />
          <span>Hiromu / Portfolio</span>
        </button>
        <nav aria-label="Portfolio navigation">
          {PORTFOLIO_PAGES.map((item) => (
            <button
              key={item}
              type="button"
              className={page === item ? 'is-current' : ''}
              aria-current={page === item ? 'page' : undefined}
              onClick={(event) => navigate(item, event)}
            >
              {item}
            </button>
          ))}
        </nav>
      </header>

      <div
        className={`portfolio-mist-transition is-${mistTransition.phase}`}
        style={{ '--mist-x': mistTransition.x, '--mist-y': mistTransition.y }}
        aria-hidden="true"
      >
        <i />
        <i />
        <i />
      </div>

      <div key={page} className="portfolio-page-transition">
        {page === 'home' ? (
          <section className="portfolio-home portfolio-page" aria-labelledby="portfolio-home-title">
            <div className="portfolio-home__visual" aria-hidden="true" />
            <div className="portfolio-home__copy">
              <span className="portfolio-home__type">IMMERSIVE WEBGL EXPERIENCE</span>
              <h1 id="portfolio-home-title">Journey</h1>
              <p>An interactive landscape inspired by Kamikochi.</p>
              <dl>
                <div><dt>ROLE</dt><dd>ART DIRECTION / 3D / DEVELOPMENT</dd></div>
                <div><dt>EXPERIENCE</dt><dd>SCROLL / HOLD / SPATIAL AUDIO</dd></div>
                <div><dt>BUILT WITH</dt><dd>BLENDER / REACT / THREE.JS</dd></div>
                <div><dt>YEAR</dt><dd>2026</dd></div>
              </dl>
              <button type="button" onClick={onReplay}><span>EXPERIENCE AGAIN</span><i aria-hidden="true">↗</i></button>
            </div>
          </section>
        ) : null}
        {page === 'about' ? renderAbout() : null}
        {page === 'project' ? renderProject() : null}
        {page === 'contact' ? (
          <section className="portfolio-contact portfolio-page" aria-labelledby="contact-title">
            <span className="portfolio-kicker">CONTACT</span>
            <h2 id="contact-title">Let’s Talk.</h2>
            <p>For collaborations, research or thoughtful ideas.</p>
            <div className="portfolio-contact__links">
              <a href="mailto:hiromu.otsubo.design@gmail.com"><small>EMAIL</small><span>hiromu.otsubo.design@gmail.com</span><i>↗</i></a>
              <a href="https://note.com/tabonnu" target="_blank" rel="noreferrer"><small>WRITING</small><span>note / tabonnu</span><i>↗</i></a>
            </div>
            <footer><span>HIROMU OTSUBO</span><span>PORTFOLIO</span><span>© 2026</span></footer>
          </section>
        ) : null}
      </div>
    </section>
  )
}

function App() {
  const [entered, setEntered] = useState(
    PREVIEW_ENTERED || INITIAL_VIEW === 'portfolio',
  )
  const [progress, setProgress] = useState(PREVIEW_PROGRESS)
  const [activeGate, setActiveGate] = useState(PREVIEW_GATE)
  const [holdProgress, setHoldProgress] = useState(PREVIEW_HOLD_PROGRESS)
  const [holdOrigin, setHoldOrigin] = useState({ x: 50, y: 50 })
  const [skyConnectionProgress, setSkyConnectionProgress] = useState(
    DEV_PREVIEW === 'outro' || DEV_PREVIEW === 'riverhold' ? 1 : 0,
  )
  const [isSkyConnecting, setIsSkyConnecting] = useState(false)
  const [fogCompleted, setFogCompleted] = useState(PREVIEW_PROGRESS >= 20)
  const [showOutro, setShowOutro] = useState(
    DEV_PREVIEW === 'outro' || DEV_PREVIEW === 'portfolio' || INITIAL_VIEW === 'portfolio',
  )
  const [showPortfolio, setShowPortfolio] = useState(
    DEV_PREVIEW === 'portfolio' || INITIAL_VIEW === 'portfolio',
  )
  const [portfolioPage, setPortfolioPage] = useState(INITIAL_PORTFOLIO_PAGE ?? 'home')
  const [portfolioScrolled, setPortfolioScrolled] = useState(
    Boolean(INITIAL_PORTFOLIO_PAGE && INITIAL_PORTFOLIO_PAGE !== 'home'),
  )
  const [displayedMessage, setDisplayedMessage] = useState(null)
  const [messageVisible, setMessageVisible] = useState(false)
  const [journeyAssets, setJourneyAssets] = useState({ active: true, progress: 0 })
  const progressRef = useRef(PREVIEW_PROGRESS)
  const enteredRef = useRef(PREVIEW_ENTERED || INITIAL_VIEW === 'portfolio')
  const targetRef = useRef(PREVIEW_PROGRESS)
  const gateRef = useRef(PREVIEW_GATE)
  const pendingGateRef = useRef(null)
  const inputCooldownUntilRef = useRef(0)
  const fogCompletedRef = useRef(PREVIEW_PROGRESS >= 20)
  const riverCompletedRef = useRef(false)
  const holdRef = useRef({ frame: null, startedAt: 0, pointerId: null })
  const skyConnectionRef = useRef({ frame: null, startedAt: 0 })
  const touchRef = useRef({ active: false, y: 0 })
  const shownMessagesRef = useRef(new Set())
  const messageTimersRef = useRef({ reveal: null, hide: null, clear: null })
  const portfolioRef = useRef(DEV_PREVIEW === 'portfolio' || INITIAL_VIEW === 'portfolio')
  const ensureAudio = useAmbientAudio(progress, fogCompleted)

  const handleJourneyAssets = useCallback(({ active, progress: nextProgress }) => {
    setJourneyAssets((current) =>
      current.active === active && Math.abs(current.progress - nextProgress) < 0.05
        ? current
        : { active, progress: nextProgress },
    )
  }, [])

  useEffect(() => {
    if (!entered) return undefined

    const preloadPortfolioImages = () => {
      PORTFOLIO_IMAGE_URLS.forEach((source) => {
        const image = new Image()
        image.decoding = 'async'
        image.src = source
      })
    }
    const idleId = window.requestIdleCallback?.(preloadPortfolioImages, {
      timeout: 5000,
    })
    const timeoutId = idleId == null
      ? window.setTimeout(preloadPortfolioImages, 1800)
      : null

    return () => {
      if (idleId != null) window.cancelIdleCallback?.(idleId)
      if (timeoutId != null) window.clearTimeout(timeoutId)
    }
  }, [entered])

  useEffect(() => {
    if (DEV_PREVIEW || portfolioRef.current) return undefined
    if (progress < 99.85) {
      setShowOutro(false)
      portfolioRef.current = false
      setShowPortfolio(false)
      setPortfolioScrolled(false)
      return undefined
    }
    const timeout = window.setTimeout(() => setShowOutro(true), 1500)
    return () => window.clearTimeout(timeout)
  }, [progress])

  useEffect(() => {
    if (!showOutro || showPortfolio) return undefined
    const timeout = window.setTimeout(() => {
      portfolioRef.current = true
      setPortfolioPage('home')
      try {
        window.localStorage.setItem(JOURNEY_STORAGE_KEY, 'true')
      } catch {
        // The experience still completes when storage is unavailable.
      }
      window.history.replaceState(null, '', '/')
      setShowPortfolio(true)
    }, 6800)
    return () => window.clearTimeout(timeout)
  }, [showOutro, showPortfolio])

  useEffect(() => {
    if (!showPortfolio) return undefined
    const resizeCheckpoints = [0, 180, 420, 760, 1180, 1600, 1880]
    const timeouts = resizeCheckpoints.map((delay) =>
      window.setTimeout(() => window.dispatchEvent(new Event('resize')), delay),
    )
    return () => timeouts.forEach((timeout) => window.clearTimeout(timeout))
  }, [showPortfolio])

  const setTarget = useCallback((value) => {
    targetRef.current = clamp(value)
  }, [])

  const setGate = useCallback((type) => {
    gateRef.current = type
    setActiveGate(type)
    setHoldProgress(0)
  }, [])

  const advance = useCallback(
    (rawDelta) => {
      if (
        !enteredRef.current ||
        portfolioRef.current ||
        !rawDelta ||
        holdRef.current.frame ||
        skyConnectionRef.current.frame
      ) return
      const direction = Math.sign(rawDelta)
      const active = gateRef.current

      if (
        direction > 0 &&
        performance.now() < inputCooldownUntilRef.current
      ) return

      if (pendingGateRef.current) {
        if (direction > 0) return
        pendingGateRef.current = null
      }

      if (active) {
        if (direction > 0) return
        gateRef.current = null
        setActiveGate(null)
        setHoldProgress(0)
      }

      const movement =
        clamp(
          Math.abs(rawDelta) * EXPERIENCE_TUNING.scrollSensitivity,
          0,
          EXPERIENCE_TUNING.maxInputStep,
        ) * direction
      const visualProgress = progressRef.current
      let next = clamp(
        targetRef.current + movement,
        Math.max(0, visualProgress - EXPERIENCE_TUNING.maxInputLead),
        Math.min(100, visualProgress + EXPERIENCE_TUNING.maxInputLead),
      )

      if (
        direction > 0 &&
        !fogCompletedRef.current &&
        targetRef.current < GATES.fog.at &&
        next >= GATES.fog.at
      ) {
        next = GATES.fog.at
        pendingGateRef.current = 'fog'
      } else if (
        direction > 0 &&
        !riverCompletedRef.current &&
        targetRef.current < GATES.river.at &&
        next >= GATES.river.at
      ) {
        next = GATES.river.at
        pendingGateRef.current = 'river'
      }

      if (riverCompletedRef.current) {
        setSkyConnectionProgress(
          clamp(
            (next - SKY_CONNECTION.start) /
              (SKY_CONNECTION.end - SKY_CONNECTION.start),
            0,
            1,
          ),
        )
      }

      setTarget(next)
    },
    [setTarget],
  )

  useEffect(() => {
    if (showPortfolio) return undefined
    let frame
    let previous = performance.now()
    const tick = (time) => {
      const elapsed = Math.min((time - previous) / 1000, 0.05)
      previous = time
      const current = progressRef.current
      const target = targetRef.current
      const difference = target - current
      const damping = 1 - Math.exp(-elapsed * EXPERIENCE_TUNING.followDamping)
      const maximumRate =
        getMaximumProgressRate(current) *
        (difference < 0 ? EXPERIENCE_TUNING.reverseSpeedMultiplier : 1)
      const maximumStep = maximumRate * elapsed
      const easedStep = Math.abs(difference) * damping
      let next =
        Math.abs(difference) < 0.001
          ? target
          : current +
            Math.sign(difference) *
              Math.min(Math.abs(difference), easedStep, maximumStep)

      const pendingGate = pendingGateRef.current
      if (
        pendingGate &&
        next >= GATES[pendingGate].at - 0.012
      ) {
        next = GATES[pendingGate].at
        targetRef.current = next
        pendingGateRef.current = null
        setGate(pendingGate)
      }
      progressRef.current = next
      setProgress(next)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [setGate, showPortfolio])

  useEffect(() => {
    const onWheel = (event) => {
      if (portfolioRef.current) return
      event.preventDefault()
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      advance(event.deltaY * multiplier)
    }
    const onTouchStart = (event) => {
      if (portfolioRef.current) return
      if (gateRef.current || event.touches.length !== 1) return
      touchRef.current = { active: true, y: event.touches[0].clientY }
    }
    const onTouchMove = (event) => {
      if (portfolioRef.current) return
      if (!touchRef.current.active || event.touches.length !== 1) return
      event.preventDefault()
      const y = event.touches[0].clientY
      advance((touchRef.current.y - y) * 1.8)
      touchRef.current.y = y
    }
    const onTouchEnd = () => {
      touchRef.current.active = false
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [advance])

  const startSkyConnection = useCallback(() => {
    if (skyConnectionRef.current.frame) return
    setIsSkyConnecting(true)
    setSkyConnectionProgress(0)
    skyConnectionRef.current.startedAt = performance.now()

    const tick = (time) => {
      const value = clamp(
        (time - skyConnectionRef.current.startedAt) / SKY_CONNECTION.duration,
        0,
        1,
      )
      setSkyConnectionProgress(value)
      setTarget(
        SKY_CONNECTION.start +
          value * (SKY_CONNECTION.end - SKY_CONNECTION.start),
      )

      if (value >= 1) {
        skyConnectionRef.current.frame = null
        riverCompletedRef.current = true
        setIsSkyConnecting(false)
        inputCooldownUntilRef.current =
          performance.now() + EXPERIENCE_TUNING.gateCooldownMs
        setTarget(SKY_CONNECTION.end)
        return
      }
      skyConnectionRef.current.frame = requestAnimationFrame(tick)
    }

    skyConnectionRef.current.frame = requestAnimationFrame(tick)
  }, [setTarget])

  const finishHold = useCallback(
    (type) => {
      cancelAnimationFrame(holdRef.current.frame)
      holdRef.current.frame = null
      setHoldProgress(1)
      if (type === 'fog') {
        fogCompletedRef.current = true
        setFogCompleted(true)
      } else {
        gateRef.current = null
        setActiveGate(null)
        setTarget(GATES.river.end)
        startSkyConnection()
        return
      }
      gateRef.current = null
      setActiveGate(null)
      inputCooldownUntilRef.current =
        performance.now() + EXPERIENCE_TUNING.gateCooldownMs
      setTarget(GATES[type].end)
    },
    [setTarget, startSkyConnection],
  )

  const startHold = useCallback(
    (event) => {
      const type = gateRef.current
      if (!type || holdRef.current.frame) return
      if (Number.isFinite(event?.button) && event.button !== 0) return
      if (event?.cancelable) event.preventDefault()
      setHoldOrigin({
        x: Number.isFinite(event?.clientX) ? event.clientX : window.innerWidth / 2,
        y: Number.isFinite(event?.clientY) ? event.clientY : window.innerHeight / 2,
      })
      ensureAudio()
      const captureTarget = event?.target
      if (captureTarget?.setPointerCapture && Number.isFinite(event?.pointerId)) {
        captureTarget.setPointerCapture(event.pointerId)
      }
      holdRef.current.pointerId = event?.pointerId ?? null
      holdRef.current.startedAt = performance.now()
      const config = GATES[type]
      const tick = (time) => {
        const value = clamp((time - holdRef.current.startedAt) / config.duration, 0, 1)
        setHoldProgress(value)
        setTarget(config.at + value * (config.end - config.at))
        if (value >= 1) {
          finishHold(type)
          return
        }
        holdRef.current.frame = requestAnimationFrame(tick)
      }
      holdRef.current.frame = requestAnimationFrame(tick)
    },
    [ensureAudio, finishHold, setTarget],
  )

  const cancelHold = useCallback(() => {
    const type = gateRef.current
    if (!type || !holdRef.current.frame) return
    cancelAnimationFrame(holdRef.current.frame)
    holdRef.current.frame = null
    setHoldProgress(0)
    setTarget(GATES[type].at)
  }, [setTarget])

  useEffect(() => {
    const onPointerDown = (event) => startHold(event)
    const onPointerUp = () => cancelHold()
    const onKeyDown = (event) => {
      if ((event.code === 'Space' || event.code === 'Enter') && !event.repeat) {
        startHold(event)
      } else if (event.code === 'ArrowDown' || event.code === 'PageDown') {
        event.preventDefault()
        advance(320)
      } else if (event.code === 'ArrowUp' || event.code === 'PageUp') {
        event.preventDefault()
        advance(-320)
      }
    }
    const onKeyUp = (event) => {
      if (event.code === 'Space') cancelHold()
    }

    window.addEventListener('pointerdown', onPointerDown, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onPointerUp)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onPointerUp)
    }
  }, [advance, cancelHold, startHold])

  useEffect(
    () => () => {
      cancelAnimationFrame(holdRef.current.frame)
      cancelAnimationFrame(skyConnectionRef.current.frame)
    },
    [],
  )

  const activeConfig = activeGate ? GATES[activeGate] : null
  const isNight = progress >= 45
  const caveDepth = 1 - clamp((progress - 7) / 13, 0, 1)
  const openAir = clamp((progress - 12) / 8, 0, 1)
  const valleyMist =
    progress < 12
      ? 0
      : progress < 15
        ? clamp((progress - 12) / 3, 0, 1)
        : 1 - clamp((progress - 15) / 5, 0, 1)
  const queuedMessage = STORY_MESSAGES.find(
    (message) => progress >= message.start && progress <= message.end,
  )
  useEffect(() => {
    if (!queuedMessage || shownMessagesRef.current.has(queuedMessage.number)) return
    shownMessagesRef.current.add(queuedMessage.number)
    const timers = messageTimersRef.current
    cancelAnimationFrame(timers.reveal)
    window.clearTimeout(timers.hide)
    window.clearTimeout(timers.clear)
    setDisplayedMessage(queuedMessage)
    setMessageVisible(false)
    timers.reveal = requestAnimationFrame(() => setMessageVisible(true))
    timers.hide = window.setTimeout(() => setMessageVisible(false), 3500)
    timers.clear = window.setTimeout(() => setDisplayedMessage(null), 4100)
  }, [queuedMessage])

  useEffect(
    () => () => {
      const timers = messageTimersRef.current
      cancelAnimationFrame(timers.reveal)
      window.clearTimeout(timers.hide)
      window.clearTimeout(timers.clear)
    },
    [],
  )

  const activeMessage = displayedMessage
  const messageOpacity = activeMessage && messageVisible ? 1 : 0
  const operationState = activeGate
    ? `hold-${activeGate}`
    : 'scroll'

  const enterExperience = useCallback(() => {
    ensureAudio()
    enteredRef.current = true
    setEntered(true)
  }, [ensureAudio])

  const resetExperience = useCallback(() => {
    portfolioRef.current = false
    enteredRef.current = false
    progressRef.current = 0
    targetRef.current = 0
    gateRef.current = null
    pendingGateRef.current = null
    fogCompletedRef.current = false
    riverCompletedRef.current = false
    inputCooldownUntilRef.current = 0
    shownMessagesRef.current.clear()
    const messageTimers = messageTimersRef.current
    cancelAnimationFrame(messageTimers.reveal)
    window.clearTimeout(messageTimers.hide)
    window.clearTimeout(messageTimers.clear)
    setEntered(false)
    setShowPortfolio(false)
    setPortfolioScrolled(false)
    setShowOutro(false)
    setProgress(0)
    setActiveGate(null)
    setHoldProgress(0)
    setSkyConnectionProgress(0)
    setIsSkyConnecting(false)
    setFogCompleted(false)
    setDisplayedMessage(null)
    setMessageVisible(false)
    setPortfolioPage('home')
  }, [])

  const replayExperience = useCallback(() => {
    resetExperience()
    window.history.pushState(null, '', `/journey${window.location.search}`)
  }, [resetExperience])

  const openPortfolioPage = useCallback((page, { updateHistory = true } = {}) => {
    const nextPage = PORTFOLIO_PAGES.includes(page) ? page : 'home'
    portfolioRef.current = true
    enteredRef.current = true
    setEntered(true)
    setShowOutro(true)
    setShowPortfolio(true)
    setPortfolioPage(nextPage)
    setPortfolioScrolled(nextPage !== 'home')
    if (updateHistory) {
      window.history.pushState(null, '', `${PORTFOLIO_PATHS[nextPage]}${window.location.search}`)
    }
  }, [])

  useEffect(() => {
    const syncRoute = () => {
      const route = getRouteFromLocation()
      if (route.view === 'journey') {
        resetExperience()
      } else {
        openPortfolioPage(route.page, { updateHistory: false })
      }
    }
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [openPortfolioPage, resetExperience])

  return (
    <main
      className={`journey-3d ${entered ? 'is-entered' : ''} ${activeGate ? `has-gate is-gate-${activeGate}` : ''} ${activeGate && holdProgress > 0 ? 'is-holding' : ''} ${isNight ? 'is-night' : ''} ${showOutro ? 'is-outro' : ''} ${showPortfolio ? 'is-portfolio' : ''} ${portfolioScrolled ? 'is-portfolio-scrolled' : ''}`}
      style={{
        '--cave-depth': caveDepth,
        '--open-air': openAir,
        '--valley-mist': valleyMist,
        '--hold-x': `${holdOrigin.x}px`,
        '--hold-y': `${holdOrigin.y}px`,
        '--hold-radius': `${80 + holdProgress * 360}px`,
      }}
    >
      <div className="journey-scene-frame" aria-hidden={showOutro && !showPortfolio}>
        {!showPortfolio || !portfolioScrolled ? (
          <Suspense fallback={null}>
            <JourneyCanvas
              progress={progress}
              skyConnectionProgress={skyConnectionProgress}
              activeGate={activeGate}
              holdProgress={holdProgress}
              presentationMode={showPortfolio}
              outroMode={showOutro && !showPortfolio}
              onAssetsProgress={handleJourneyAssets}
            />
          </Suspense>
        ) : null}
      </div>

      {!showPortfolio ? (
        <ExperienceLoader
          entered={entered}
          onEnter={enterExperience}
          assetsActive={journeyAssets.active}
          assetProgress={journeyAssets.progress}
        />
      ) : null}

      <div className="paper-texture" aria-hidden="true" />
      <div className="cave-grade" aria-hidden="true" />
      <div className="valley-mist" aria-hidden="true" />
      <div className="soft-vignette" aria-hidden="true" />

      <section className="journey-outro" aria-label="Thank you so much.">
        <p className="journey-outro__copy" aria-hidden="true">
          <span className="journey-outro__prefix">Thank you so</span>
          <span className="journey-outro__slot">
            <span className="journey-outro__ridge" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="journey-outro__m">m</span>
          </span>
          <span className="journey-outro__suffix">uch.</span>
        </p>
      </section>

      {showPortfolio ? (
        <PortfolioSite
          onReplay={replayExperience}
          onNavigate={openPortfolioPage}
          onScrolledChange={setPortfolioScrolled}
          page={portfolioPage}
        />
      ) : null}

      <header className="journey-ui__header">
        <span>JOURNEY</span>
        <small>INSPIRED BY KAMIKOCHI</small>
      </header>

      {activeMessage ? (
        <aside
          key={activeMessage.number}
          className={`journey-message is-${activeMessage.align}`}
          style={{
            '--message-opacity': messageOpacity,
            '--message-shift': `${(1 - messageOpacity) * 16}px`,
            '--message-blur': `${(1 - messageOpacity) * 4}px`,
            '--message-color': activeMessage.tone === 'dark' ? '#123f35' : '#f6f0e3',
          }}
          aria-live="polite"
        >
          <span className="journey-message__number">{activeMessage.number}</span>
          <div className="journey-message__copy">
            <p>
              {activeMessage.title.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </p>
          </div>
        </aside>
      ) : null}

      <div className="journey-ui__rail" aria-hidden="true">
        <i><b style={{ height: `${progress}%` }} /></i>
        <span>{Math.round(progress).toString().padStart(2, '0')}</span>
      </div>

      <div
        key={operationState}
        className={`journey-ui__operation ${activeGate ? 'is-hold' : ''} ${activeGate && holdProgress > 0 ? 'is-holding' : ''} ${activeMessage && !activeGate ? 'is-quiet' : ''} ${isSkyConnecting ? 'is-transition' : ''} ${progress >= 99 ? 'is-complete' : ''}`}
        role="status"
        aria-live="polite"
        aria-hidden={progress >= 99 ? 'true' : undefined}
      >
        {activeConfig ? (
          <>
            <i
              className="hold-mark"
              style={{ '--hold-progress': `${holdProgress * 360}deg` }}
              aria-hidden="true"
            />
            {holdProgress === 0 ? <span>{activeConfig.label}</span> : null}
          </>
        ) : (
          <>
            <span>SCROLL</span>
            <i className="scroll-mark" aria-hidden="true" />
          </>
        )}
      </div>

      <div className="journey-ui__sound" aria-hidden="true">
        {fogCompleted ? 'SOUND ON' : 'SOUND ON HOLD'}
      </div>

      <CursorFollower entered={entered} active={Boolean(activeGate)} />
    </main>
  )
}

export default App
