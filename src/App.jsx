import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { getJourneyTimeOfDay } from './journeyVisualState.js'
import {
  getJourneyCavePresence,
  getJourneyFogArrival,
  getJourneyOutdoorPresence,
  getJourneyReverseFogClearance,
  JOURNEY_CAVE_SEQUENCE,
} from './journeyStoryTimeline.js'

const JourneyCanvas = lazy(() => import('./JourneyCanvas.jsx'))
const JourneyV2 = lazy(() => import('./JourneyV2.jsx'))
const JourneyV3 = lazy(() => import('./journey-v3/JourneyV3.jsx'))

// Local-only visual checkpoints for animation and scene QA. `?showcase=day`
// is the single public exception: an opt-in, fixed Day Clear frame
// that lets a reviewer see the finished valley without skipping the normal
// Enter → cave → valley experience on `/journey`.
const journeySearch = new URLSearchParams(window.location.search)
const ENDING_PERFORMANCE_LEGACY = journeySearch.get('endingPerfLegacy') === '1'
const PUBLIC_SHOWCASE = journeySearch.get('showcase') === 'day'
const requestedPreviewProgressValue = journeySearch.get('previewProgress')
const requestedPreviewProgress = Number(requestedPreviewProgressValue)
const DEV_PREVIEW_PROGRESS = (
  (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(window.location.hostname)) &&
  requestedPreviewProgressValue !== null &&
  Number.isFinite(requestedPreviewProgress)
) ? clampPreviewProgress(requestedPreviewProgress) : null
const DEV_PREVIEW = (import.meta.env.DEV || ['localhost', '127.0.0.1'].includes(window.location.hostname) || PUBLIC_SHOWCASE)
  ? (PUBLIC_SHOWCASE ? 'day' : journeySearch.get('preview'))
  : null
function clampPreviewProgress(value) {
  return Math.min(100, Math.max(0, value))
}

const PREVIEW_PROGRESS = DEV_PREVIEW_PROGRESS ?? ({
  cave: 5,
  foghold: JOURNEY_CAVE_SEQUENCE.fogGate,
  fogclear: JOURNEY_CAVE_SEQUENCE.fogGate,
  day: 30,
  sunset: 46,
  night: 68,
  riverready: 70,
  riverhold: 70,
  river: 80,
  forming: 82,
  figure: 84,
  final: 92,
  wide: 96,
  portfolio: 28,
  outro: 100,
}[DEV_PREVIEW] ?? 0)
const PREVIEW_GATE = {
  foghold: 'fog',
  riverready: 'river',
  riverhold: 'river',
}[DEV_PREVIEW] ?? null
const PREVIEW_HOLD_PROGRESS = ['foghold', 'riverhold'].includes(DEV_PREVIEW) ? 0.62 : 0
const PREVIEW_ENTERED = Boolean(DEV_PREVIEW || DEV_PREVIEW_PROGRESS !== null)
const PREVIEW_FOG_COMPLETED = (
  DEV_PREVIEW === 'fogclear' || (
    PREVIEW_GATE !== 'fog' &&
    PREVIEW_PROGRESS > JOURNEY_CAVE_SEQUENCE.fogGate
  )
)
const ENDING_SETTLE_PROGRESS = 99.995
const ENDING_SETTLE_MS = 2600
const ENDING_INPUT_RELEASE_MS = 420
const ENDING_INPUT_NEUTRAL_MS = 520
const ENDING_CAPTURE_MAX_ATTEMPTS = 3
const ENDING_MEMORY_HOME_MS = 4850
const ENDING_MEMORY_COMPLETE_MS = 6900
const PORTFOLIO_TRANSITION_MS = 480
const PORTFOLIO_ROUTE_SWITCH_MS = 220
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
  if (pathname === '/journey-v2') return { view: 'journey-v2', page: null }
  if (pathname === '/journey-v3') return { view: 'journey-v3', page: null }
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

// Minimum forward time for each chapter. The final night chapter deliberately slows the exit.
const EXPERIENCE_PACE = [
  { start: 0, end: 11.5, minSeconds: 4.5 }, // Walk through the cave.
  { start: 11.5, end: 13.5, minSeconds: 1 }, // Cross the portal and reach the outdoor mist.
  { start: 13.5, end: 20, minSeconds: 2.5 }, // Continue from the same view after HOLD.
  { start: 20, end: 38, minSeconds: 6.5 }, // Let the clear blue valley breathe.
  { start: 38, end: 54, minSeconds: 7.5 }, // Day drifts gradually into evening.
  { start: 54, end: 70, minSeconds: 8 }, // Evening settles continuously into night.
  { start: 70, end: 80, minSeconds: 5.5 }, // Illuminate and connect the river after night arrives.
  { start: 80, end: 92, minSeconds: 6.5 }, // Look up slowly while the figure gathers from stars.
  { start: 92, end: 100, minSeconds: 5 }, // Pull back, hold the scale, then return the figure to the sky.
]

const getMaximumProgressRate = (progress) => {
  const chapter =
    EXPERIENCE_PACE.find(({ start, end }) => progress >= start && progress < end) ??
    EXPERIENCE_PACE[EXPERIENCE_PACE.length - 1]
  return (chapter.end - chapter.start) / chapter.minSeconds
}

const GATES = {
  fog: {
    at: JOURNEY_CAVE_SEQUENCE.fogGate,
    end: JOURNEY_CAVE_SEQUENCE.fogGate,
    duration: JOURNEY_CAVE_SEQUENCE.fogDuration,
    advanceStoryDuringHold: false,
    label: 'HOLD',
  },
  river: {
    at: 70,
    end: 76,
    duration: 3300,
    advanceStoryDuringHold: true,
    label: 'HOLD',
  },
}

const SKY_CONNECTION = {
  start: 76,
  end: 80,
  duration: 2200,
}

const STORY_MESSAGES = [
  {
    start: 21,
    end: 34,
    number: '01',
    title: ['The world opens', 'when you stay.'],
    tone: 'dark',
    align: 'left',
  },
  {
    start: 76,
    end: 84,
    number: '02',
    title: ['A river of light,', 'toward the Milky Way.'],
    tone: 'light',
    align: 'left',
  },
  {
    start: 88,
    end: 97,
    number: '03',
    title: ['Night settles', 'over the valley.'],
    tone: 'light',
    align: 'right',
  },
]

const clamp = (value, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value))

const decodeImageSource = (source) => new Promise((resolve, reject) => {
  const image = new Image()
  let settled = false
  const finish = (callback, value) => {
    if (settled) return
    settled = true
    image.onload = null
    image.onerror = null
    callback(value)
  }
  image.decoding = 'sync'
  image.onload = () => finish(resolve, image)
  image.onerror = () => finish(reject, new Error('Unable to decode the Journey ending frame.'))
  image.src = source
  if (image.complete && image.naturalWidth > 0) finish(resolve, image)
  image.decode?.().then(
    () => finish(resolve, image),
    () => {
      // The load/error events remain the fallback for browsers whose decode()
      // promise rejects before the data URL has completed loading.
    },
  )
})

const PORTFOLIO_IMAGE_URLS = [
  '/portfolio/home-kamikochi.webp',
  '/portfolio/project-interaction-meadow-v4.jpg',
]

const preloadPortfolioImageSource = (source) => new Promise((resolve) => {
  const image = new Image()
  let settled = false
  const finish = () => {
    if (settled) return
    settled = true
    image.onload = null
    image.onerror = null
    resolve()
  }
  image.decoding = 'async'
  image.fetchPriority = 'low'
  image.onload = finish
  image.onerror = finish
  image.src = source
  image.decode?.().then(finish, () => {})
})

const JOURNEY_AUDIO_DEFINITIONS = Object.freeze({
  cave: Object.freeze({
    url: '/journey/audio/cave-master.m4a',
    position: [0, 3, -8],
    refDistance: 10,
    filter: Object.freeze({ type: 'lowpass', frequency: 5200, q: 0.42 }),
  }),
  wind: Object.freeze({
    url: '/journey/audio/wind-master.m4a',
    position: [-58, 32, -112],
    refDistance: 38,
    filter: Object.freeze({ type: 'highpass', frequency: 72, q: 0.48 }),
  }),
  river: Object.freeze({
    url: '/journey/audio/river-master.m4a',
    position: [12, -1, -82],
    refDistance: 25,
    filter: Object.freeze({ type: 'lowpass', frequency: 8200, q: 0.36 }),
  }),
})

let journeyAudioPreloadPromise = null
let portfolioImagePreloadPromise = null

const preloadPortfolioImages = () => {
  if (portfolioImagePreloadPromise) return portfolioImagePreloadPromise
  performance.mark?.('journey-portfolio-images-preload-start')
  portfolioImagePreloadPromise = Promise.all(
    PORTFOLIO_IMAGE_URLS.map(preloadPortfolioImageSource),
  ).finally(() => {
    performance.mark?.('journey-portfolio-images-preload-complete')
  })
  return portfolioImagePreloadPromise
}

const preloadJourneyAudio = () => {
  if (journeyAudioPreloadPromise) return journeyAudioPreloadPromise
  performance.mark?.('journey-audio-preload-start')
  journeyAudioPreloadPromise = Promise.all(
    Object.entries(JOURNEY_AUDIO_DEFINITIONS).map(async ([name, definition]) => {
      const response = await fetch(definition.url)
      if (!response.ok) throw new Error(`Unable to load ${definition.url}`)
      return [name, definition, await response.arrayBuffer()]
    }),
  ).then(async (encodedTracks) => {
    const OfflineAudioContext = window.OfflineAudioContext || window.webkitOfflineAudioContext
    if (!OfflineAudioContext) return { encodedTracks, decodedTracks: null }
    try {
      const decoder = new OfflineAudioContext(2, 1, 44100)
      const decodedTracks = await Promise.all(
        encodedTracks.map(async ([name, definition, encoded]) => [
          name,
          definition,
          await decoder.decodeAudioData(encoded.slice(0)),
        ]),
      )
      return { encodedTracks: null, decodedTracks }
    } catch {
      // Network data is still cached; decode it after the ENTER gesture in
      // browsers that do not permit an OfflineAudioContext during loading.
      return { encodedTracks, decodedTracks: null }
    }
  }).finally(() => {
    performance.mark?.('journey-audio-preload-complete')
  })
  return journeyAudioPreloadPromise
}

function useAmbientAudio(progress, fogCompleted, endingQuiet = false, preloadEnabled = true) {
  const audioRef = useRef(null)
  const listenerPoseRef = useRef({
    time: 0,
    position: [Infinity, Infinity, Infinity],
    forward: [Infinity, Infinity, Infinity],
  })
  const [audioReady, setAudioReady] = useState(false)
  const [audioPrepared, setAudioPrepared] = useState(!preloadEnabled)

  useEffect(() => {
    if (!preloadEnabled) {
      setAudioPrepared(true)
      return undefined
    }
    let cancelled = false
    setAudioPrepared(false)
    preloadJourneyAudio()
      .catch(() => {
        // Audio is progressive enhancement; a network/audio codec failure
        // must not deadlock the visual experience.
      })
      .finally(() => {
        if (!cancelled) setAudioPrepared(true)
      })
    return () => {
      cancelled = true
    }
  }, [preloadEnabled])

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

    try {
      const prepared = await preloadJourneyAudio()
      const decoded = prepared.decodedTracks ?? await Promise.all(
        prepared.encodedTracks.map(async ([name, definition, encoded]) => [
          name,
          definition,
          await context.decodeAudioData(encoded.slice(0)),
        ]),
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

  const updateListenerPose = useCallback((camera) => {
    const audio = audioRef.current
    if (!audio || audio.context.state === 'closed' || !camera?.matrixWorld) return
    const listener = audio.context.listener
    const elements = camera.matrixWorld.elements
    const pose = listenerPoseRef.current
    const time = performance.now()
    if (time - pose.time < 32) return
    const positionChange =
      Math.abs(elements[12] - pose.position[0]) +
      Math.abs(elements[13] - pose.position[1]) +
      Math.abs(elements[14] - pose.position[2])
    const forwardChange =
      Math.abs(-elements[8] - pose.forward[0]) +
      Math.abs(-elements[9] - pose.forward[1]) +
      Math.abs(-elements[10] - pose.forward[2])
    if (positionChange < 0.0015 && forwardChange < 0.0005) return
    pose.time = time
    pose.position[0] = elements[12]
    pose.position[1] = elements[13]
    pose.position[2] = elements[14]
    pose.forward[0] = -elements[8]
    pose.forward[1] = -elements[9]
    pose.forward[2] = -elements[10]
    const now = audio.context.currentTime
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(elements[12], now, 0.045)
      listener.positionY.setTargetAtTime(elements[13], now, 0.045)
      listener.positionZ.setTargetAtTime(elements[14], now, 0.045)
      listener.forwardX.setTargetAtTime(-elements[8], now, 0.045)
      listener.forwardY.setTargetAtTime(-elements[9], now, 0.045)
      listener.forwardZ.setTargetAtTime(-elements[10], now, 0.045)
      listener.upX.setTargetAtTime(elements[4], now, 0.045)
      listener.upY.setTargetAtTime(elements[5], now, 0.045)
      listener.upZ.setTargetAtTime(elements[6], now, 0.045)
    } else {
      listener.setPosition(elements[12], elements[13], elements[14])
      listener.setOrientation(
        -elements[8], -elements[9], -elements[10],
        elements[4], elements[5], elements[6],
      )
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audioReady || !audio?.tracks) return
    const now = audio.context.currentTime
    const masterTarget = endingQuiet ? 0.0001 : 0.88
    audio.master.gain.cancelScheduledValues(now)
    audio.master.gain.setTargetAtTime(masterTarget, now, endingQuiet ? 1.7 : 1.05)
    const outside = clamp((progress - 13.5) / 9, 0, 1)
    const night = clamp((progress - 52) / 18, 0, 1)
    const quietNight = clamp((progress - 68) / 18, 0, 1)
    const valley = clamp((progress - 16) / 18, 0, 1)
    const levels = {
      cave: 0.2 * (1 - clamp((progress - 8) / 12, 0, 1)),
      wind:
        (fogCompleted ? 0.12 : 0.018) * outside * (1 - quietNight),
      river:
        (0.004 + valley * 0.115) *
        (1 - night * 0.28) *
        (1 - quietNight * 0.42),
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
      windFilter.frequency.setTargetAtTime(72 + outside * 34 - quietNight * 38, now, 1.8)
    }
    if (riverFilter) {
      riverFilter.frequency.setTargetAtTime(5200 + valley * 3000 - night * 1700, now, 2.4)
    }

  }, [audioReady, endingQuiet, fogCompleted, progress])

  useEffect(
    () => () => {
      if (!audioRef.current) return
      audioRef.current.cancelled = true
      Object.values(audioRef.current.tracks ?? {}).forEach(({ source }) => source.stop())
      audioRef.current.context.close()
    },
    [],
  )

  return { ensureAudio, updateListenerPose, audioPrepared }
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

function ExperienceLoader({
  entered,
  onEnter,
  assetsActive,
  assetProgress,
  audioPrepared,
  portfolioImagesPrepared,
}) {
  const [dismissed, setDismissed] = useState(false)
  const [visualProgress, setVisualProgress] = useState(0)
  const [animationStage, setAnimationStage] = useState(0)
  const safeAssetProgress = Number.isFinite(assetProgress)
    ? clamp(assetProgress, 0, 100)
    : 0
  const loadComplete = !assetsActive &&
    safeAssetProgress >= 100 &&
    audioPrepared &&
    portfolioImagesPrepared
  const ready = loadComplete && visualProgress >= 99.5

  useEffect(() => {
    let frame
    let previous = performance.now()
    const tick = (time) => {
      const elapsed = Math.max(0, Math.min((time - previous) / 1000, 0.05))
      previous = time
      setVisualProgress((current) => {
        const ceiling = loadComplete ? 100 : 92
        const safeCurrent = Number.isFinite(current) ? clamp(current, 0, 100) : 0
        return clamp(
          safeCurrent + elapsed * (loadComplete ? 27 : 22),
          0,
          ceiling,
        )
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
    if (!entered || !ready) return undefined
    const timeout = window.setTimeout(() => setDismissed(true), 1150)
    return () => window.clearTimeout(timeout)
  }, [entered, ready])

  if (dismissed) return null

  const displayedProgress = clamp(
    Math.round(Number.isFinite(visualProgress) ? visualProgress : 0),
    0,
    100,
  )

  return (
    <div
      className={`experience-loader stage-${animationStage} ${ready ? 'is-ready' : ''} ${entered && ready ? 'is-entering' : ''}`}
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
          <i aria-hidden="true"><b style={{ width: `${displayedProgress}%` }} /></i>
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
  ['origin', 'Inspiration'],
  ['contrast', 'Space'],
  ['terrain', 'Atmosphere'],
  ['interaction', 'Interaction'],
  ['emotion', 'Emotion'],
]

function ShortArrow() {
  return (
    <svg className="short-arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.25 12.75 12.5 3.5M6.25 3.5h6.25v6.25" />
    </svg>
  )
}

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

function PortfolioVideo({ src, poster, alt }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || !('IntersectionObserver' in window)) return undefined

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.28) {
        video.play().catch(() => {})
      } else {
        video.pause()
      }
    }, { threshold: [0, 0.28, 0.7] })

    observer.observe(video)
    return () => {
      observer.disconnect()
      video.pause()
    }
  }, [])

  return (
    <video
      ref={videoRef}
      src={src}
      poster={poster}
      aria-label={alt}
      muted
      loop
      playsInline
      preload="metadata"
    />
  )
}

function PortfolioMediaFigure({ items, caption, className = '' }) {
  return (
    <figure className={`portfolio-figure portfolio-media-v5 ${className}`}>
      <div className="portfolio-media-v5__grid">
        {items.map((item) => (
          <div className="portfolio-media-v5__item" key={item.src}>
            <div className="portfolio-media-v5__frame">
              {item.type === 'video' ? (
                <PortfolioVideo src={item.src} poster={item.poster} alt={item.alt} />
              ) : (
                <img src={item.src} alt={item.alt} loading="lazy" />
              )}
            </div>
            {item.label ? <span>{item.label}</span> : null}
          </div>
        ))}
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  )
}

function PortfolioSite({ onReplay, onNavigate, onScrolledChange, page = 'home' }) {
  const siteScrollRef = useRef(null)
  const transitionTimersRef = useRef([])
  const transitioningRef = useRef(false)
  const homeMotionFrameRef = useRef(null)
  const homeMotionTargetRef = useRef(null)
  const [activePanel, setActivePanel] = useState('profile')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [panelMotion, setPanelMotion] = useState({})
  const [mistTransition, setMistTransition] = useState({
    phase: 'idle',
    x: '50vw',
    y: '50vh',
  })

  useEffect(() => {
    preloadPortfolioImages()
  }, [])

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
    setMobileMenuOpen(false)

    const targetBounds = event?.currentTarget?.getBoundingClientRect()
    const x = Number.isFinite(event?.clientX) && event.clientX > 0
      ? `${event.clientX}px`
      : `${(targetBounds?.left ?? window.innerWidth / 2) + (targetBounds?.width ?? 0) / 2}px`
    const y = Number.isFinite(event?.clientY) && event.clientY > 0
      ? `${event.clientY}px`
      : `${(targetBounds?.top ?? window.innerHeight / 2) + (targetBounds?.height ?? 0) / 2}px`
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const switchDelay = reduceMotion ? 80 : PORTFOLIO_ROUTE_SWITCH_MS
    const finishDelay = reduceMotion ? 170 : PORTFOLIO_TRANSITION_MS

    transitioningRef.current = true
    transitionTimersRef.current.forEach(window.clearTimeout)
    setMistTransition({ phase: 'cover', x, y })

    transitionTimersRef.current = [
      window.setTimeout(() => {
        setActivePanel(nextPage === 'project' ? 'origin' : 'profile')
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
    if (homeMotionFrameRef.current !== null) {
      window.cancelAnimationFrame(homeMotionFrameRef.current)
    }
  }, [])

  const moveHomeAtmosphere = useCallback((event) => {
    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(pointer: coarse)').matches
    ) return

    const bounds = event.currentTarget.getBoundingClientRect()
    homeMotionTargetRef.current = {
      element: event.currentTarget,
      x: (event.clientX - bounds.left) / bounds.width - 0.5,
      y: (event.clientY - bounds.top) / bounds.height - 0.5,
    }
    if (homeMotionFrameRef.current !== null) return

    homeMotionFrameRef.current = window.requestAnimationFrame(() => {
      const target = homeMotionTargetRef.current
      homeMotionFrameRef.current = null
      if (!target?.element?.isConnected) return
      target.element.style.setProperty('--home-reality-x', `${target.x * -7}px`)
      target.element.style.setProperty('--home-memory-x', `${target.x * 9}px`)
      target.element.style.setProperty('--home-atmosphere-x', `${target.x * 15}px`)
      target.element.style.setProperty('--home-atmosphere-y', `${target.y * 5}px`)
      target.element.style.setProperty('--home-copy-x', `${target.x * 3}px`)
    })
  }, [])

  const settleHomeAtmosphere = useCallback((event) => {
    event.currentTarget.style.setProperty('--home-reality-x', '0px')
    event.currentTarget.style.setProperty('--home-memory-x', '0px')
    event.currentTarget.style.setProperty('--home-atmosphere-x', '0px')
    event.currentTarget.style.setProperty('--home-atmosphere-y', '0px')
    event.currentTarget.style.setProperty('--home-copy-x', '0px')
  }, [])

  useEffect(() => {
    setActivePanel(page === 'project' ? 'origin' : 'profile')
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
        <h2 id="about-title">Hiromu Otsubo</h2>
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
            <h3>Experiences shape emotion.</h3>
            <p>I explore how perspective, atmosphere and interaction influence the way people feel.</p>
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
            <h3>Human scale amplifies vastness.</h3>
            <p>This idea became the foundation of my research on awe in immersive VR, comparing first- and third-person perspectives.</p>
            <p>I also contributed as a co-author to related studies on awe, emotion and human experience.</p>
            <a href="https://scholar.google.co.jp/citations?user=xiwv18wAAAAJ&hl=ja" target="_blank" rel="noreferrer">VIEW RESEARCH <span>↗</span></a>
          </div>
        </article>

        <article id="approach" className={panelClassName('approach')} data-story-panel="approach">
          <PortfolioImage src="/portfolio/about-stillness.webp" alt="Mist floating above a still lake and quiet boats" caption="MIST OVER STILL WATER" className="is-about-photo" />
          <div className="portfolio-panel__copy">
            <span className="portfolio-kicker">APPROACH</span>
            <h3>People need time to feel.</h3>
            <p>I use stillness, space and slower moments to make room for that attention.</p>
          </div>
        </article>

        <article id="motivation" className={panelClassName('motivation')} data-story-panel="motivation">
          <PortfolioImage src="/portfolio/about-origin.webp" alt="Kamikochi mountains and the Azusa River seen from Kappa Bridge" caption="KAMIKOCHI" className="is-about-photo" />
          <div className="portfolio-panel__copy">
            <span className="portfolio-kicker">MOTIVATION</span>
            <h3>Photographs preserve views, not feelings.</h3>
            <p>Six weeks in Kamikochi taught me that photographs can preserve scenery, but not the feeling of being there. Journey translates that experience through depth, sound and interaction.</p>
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
        <h2 id="project-title">Journey</h2>
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
          <PortfolioMediaFigure
            items={[
              { src: '/portfolio/project-v5/field-reference.jpg', alt: 'The real Kamikochi valley and Azusa River that inspired Journey', label: 'FIELD / KAMIKOCHI' },
              { src: '/portfolio/project-v5/blender-massing.jpg', alt: 'The Journey valley terrain being shaped as a neutral Blender model', label: 'MASSING / BLENDER' },
              { src: '/portfolio/project-v5/day-clear.jpg', alt: 'The finished Journey valley in clear daylight', label: 'EXPERIENCE / WEBGL' },
            ]}
            caption="REALITY / FORM / MEMORY"
            className="is-origin-triptych"
          />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">INSPIRATION</span><h3>A photograph captured the view, not the feeling.</h3><p>Six weeks in Kamikochi taught me that photographs can preserve a view, but not the feeling of being there.<br />Journey begins from that gap.<br />Rather than reproducing the landscape exactly, it rebuilds the experience through space, interaction and time.</p></div>
        </article>
        <article id="contrast" className={panelClassName('contrast')} data-story-panel="contrast">
          <PortfolioMediaFigure
            items={[
              {
                type: 'video',
                src: '/portfolio/project-v5/cave-to-fog.mp4',
                poster: '/portfolio/project-v5/cave-to-fog-poster.jpg',
                alt: 'The camera moving through the dark Journey cave toward the fog-covered open valley',
                label: 'CAVE → OPEN AIR',
              },
            ]}
            caption="CONTRACTION / RELEASE"
            className="is-space-cinema"
          />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">SPACE</span><h3>Emotion begins with space.</h3><p>The cave narrows the view.<br />Darkness holds the landscape back.<br />Emerging into the valley makes its scale feel greater by contrast.</p></div>
        </article>
        <article id="terrain" className={panelClassName('terrain')} data-story-panel="terrain">
          <PortfolioMediaFigure
            items={[
              { src: '/portfolio/project-v5/day-clear.jpg', alt: 'The Journey valley in soft clear daylight', label: 'DAY' },
              { src: '/portfolio/project-v5/dusk.jpg', alt: 'The same Journey valley in muted dusk light', label: 'DUSK' },
              { src: '/portfolio/project-v5/night.jpg', alt: 'The same Journey valley beneath the night sky', label: 'NIGHT' },
            ]}
            caption="ONE VALLEY / CHANGING LIGHT"
            className="is-atmosphere-triptych"
          />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">ATMOSPHERE</span><h3>Light lets the landscape breathe.</h3><p>Day fades into dusk.<br />Dusk deepens into night.<br />Light, mist and color slowly transform the same valley over time.</p></div>
        </article>
        <article id="interaction" className={panelClassName('interaction')} data-story-panel="interaction">
          <PortfolioMediaFigure
            items={[
              {
                type: 'video',
                src: '/portfolio/project-v5/hold-fog-reveal.mp4',
                poster: '/portfolio/project-v5/hold-fog-reveal-poster.jpg',
                alt: 'The fog gradually clearing as the visitor holds the Journey interaction',
                label: 'HOLD / FOG REVEAL',
              },
            ]}
            caption="THE LANDSCAPE RESPONDS"
            className="is-interaction-cinema"
          />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">INTERACTION</span><h3>The landscape responds when you slow down.</h3><p>Scroll moves you forward.<br />HOLD lets the moment linger.<br />Move the cursor to stir the wind, and the grass moves with it.</p></div>
        </article>
        <article id="emotion" className={panelClassName('emotion', 'is-emotion-panel')} data-story-panel="emotion">
          <PortfolioMediaFigure
            items={[
              { src: '/portfolio/project-v5/emotion-final.jpg', alt: 'A small seated figure beneath the Journey mountains and immense star-filled night sky', label: 'FINAL NIGHT / HUMAN SCALE' },
            ]}
            caption="A QUIET SENSE OF SCALE"
            className="is-emotion-hero"
          />
          <div className="portfolio-panel__copy"><span className="portfolio-kicker">EMOTION</span><h3>Wonder grows in quiet moments.</h3><p>The journey ends beneath an immense night sky.<br />A small figure stands against the mountains.<br />For a moment, the landscape feels larger—and we feel smaller within it.</p><button type="button" onClick={onReplay}>EXPERIENCE AGAIN <ShortArrow /></button></div>
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
      className={`portfolio-site is-page-${page} is-mist-${mistTransition.phase} ${mobileMenuOpen ? 'is-menu-open' : ''}`}
      data-portfolio-page={page}
    >
      <header className="portfolio-nav">
        <button className="portfolio-nav__brand" type="button" onClick={(event) => navigate('home', event)}>
          <HiromuMark compact />
          <span>Hiromu / Portfolio</span>
        </button>
        <button
          className="portfolio-nav__toggle"
          type="button"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          <i /><i /><i />
        </button>
        <nav className={mobileMenuOpen ? 'is-open' : ''} aria-label="Portfolio navigation">
          {PORTFOLIO_PAGES.map((item) => (
            <button
              key={item}
              type="button"
              className={page === item ? 'is-current' : ''}
              aria-current={page === item ? 'page' : undefined}
              onClick={(event) => {
                setMobileMenuOpen(false)
                navigate(item, event)
              }}
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

      <div
        key={page}
        className="portfolio-page-transition"
        aria-hidden={mobileMenuOpen || undefined}
      >
        {page === 'home' ? (
          <section className="portfolio-home portfolio-page" aria-labelledby="portfolio-home-title">
            <div
              className="portfolio-home__diptych"
              onPointerMove={moveHomeAtmosphere}
              onPointerLeave={settleHomeAtmosphere}
            >
              <figure
                className="portfolio-home__landscape"
                aria-label="A Kamikochi field photograph dissolving through mist into the Journey digital valley"
              >
                <div className="portfolio-home__reality" aria-hidden="true">
                  <img
                    src="/portfolio/home-kamikochi.webp"
                    alt=""
                    decoding="async"
                    fetchPriority="high"
                    draggable="false"
                  />
                </div>
                <div className="portfolio-home__memory" aria-hidden="true">
                  <img
                    src="/portfolio/project-interaction-meadow-v4.jpg"
                    alt=""
                    decoding="async"
                    fetchPriority="high"
                    draggable="false"
                  />
                </div>
                <div className="portfolio-home__threshold" aria-hidden="true" />
              </figure>

              <div className="portfolio-home__copy">
                <h1 id="portfolio-home-title">Journey</h1>
                <p>An interactive landscape inspired by Kamikochi.</p>
                <button type="button" onClick={onReplay}><span>EXPERIENCE JOURNEY</span><ShortArrow /></button>
              </div>
            </div>

            <dl className="portfolio-home__meta">
              <div><dt>ROLE</dt><dd>ART DIRECTION / 3D / DEVELOPMENT</dd></div>
              <div><dt>EXPERIENCE</dt><dd>SCROLL / HOLD / SPATIAL AUDIO</dd></div>
              <div><dt>BUILT WITH</dt><dd>BLENDER / REACT / THREE.JS</dd></div>
              <div><dt>YEAR</dt><dd>2026</dd></div>
            </dl>
          </section>
        ) : null}
        {page === 'about' ? renderAbout() : null}
        {page === 'project' ? renderProject() : null}
        {page === 'contact' ? (
          <section className="portfolio-contact portfolio-page" aria-labelledby="contact-title">
            <span className="portfolio-kicker">CONTACT</span>
            <h2 id="contact-title">Let’s Talk</h2>
            <p>For collaborations, research or thoughtful ideas.</p>
            <div className="portfolio-contact__links">
              <a href="mailto:hiromu.otsubo.design@gmail.com"><small>EMAIL</small><span>hiromu.otsubo.design@gmail.com</span><i>↗</i></a>
              <a href="https://note.com/hiromu_o" target="_blank" rel="noreferrer"><small>WRITING</small><span>note / hiromu_o</span><i>↗</i></a>
            </div>
            <footer><span>HIROMU OTSUBO</span><span>PORTFOLIO</span><span>© 2026</span></footer>
          </section>
        ) : null}
      </div>
    </section>
  )
}

function LegacyApp() {
  const [entered, setEntered] = useState(
    PREVIEW_ENTERED || INITIAL_VIEW === 'portfolio',
  )
  const [progress, setProgress] = useState(PREVIEW_PROGRESS)
  const [activeGate, setActiveGate] = useState(PREVIEW_GATE)
  const [holdProgress, setHoldProgress] = useState(PREVIEW_HOLD_PROGRESS)
  const [holdOrigin, setHoldOrigin] = useState({ x: 50, y: 50 })
  const [skyConnectionProgress, setSkyConnectionProgress] = useState(
    ['riverhold', 'river', 'forming', 'figure', 'final', 'wide', 'outro'].includes(DEV_PREVIEW) ? 1 : 0,
  )
  const [isSkyConnecting, setIsSkyConnecting] = useState(false)
  const [fogCompleted, setFogCompleted] = useState(PREVIEW_FOG_COMPLETED)
  const [fogReverseActive, setFogReverseActive] = useState(false)
  const [fogReverseStartProgress, setFogReverseStartProgress] = useState(
    JOURNEY_CAVE_SEQUENCE.reverseFogStart,
  )
  const [fogReverseAtGate, setFogReverseAtGate] = useState(false)
  const [fogReverseAtGateProgress, setFogReverseAtGateProgress] = useState(0)
  const [showOutro, setShowOutro] = useState(
    DEV_PREVIEW === 'portfolio' || INITIAL_VIEW === 'portfolio',
  )
  const [showPortfolio, setShowPortfolio] = useState(
    DEV_PREVIEW === 'portfolio' || INITIAL_VIEW === 'portfolio',
  )
  const [portfolioPage, setPortfolioPage] = useState(INITIAL_PORTFOLIO_PAGE ?? 'home')
  const [portfolioScrolled, setPortfolioScrolled] = useState(
    Boolean(INITIAL_PORTFOLIO_PAGE && INITIAL_PORTFOLIO_PAGE !== 'home'),
  )
  const [memoryHome, setMemoryHome] = useState(false)
  const [displayedMessage, setDisplayedMessage] = useState(null)
  const [messageVisible, setMessageVisible] = useState(false)
  const [journeyAssets, setJourneyAssets] = useState({ active: true, progress: 0 })
  const [portfolioImagesPrepared, setPortfolioImagesPrepared] = useState(showPortfolio)
  const [endingCaptureRequest, setEndingCaptureRequest] = useState(0)
  const [endingFrameSource, setEndingFrameSource] = useState(null)
  const [endingFrameLoaded, setEndingFrameLoaded] = useState(false)
  const [endingCapturePreparing, setEndingCapturePreparing] = useState(false)
  const [endingCaptureBlocked, setEndingCaptureBlocked] = useState(false)
  const [endingReleaseRequested, setEndingReleaseRequested] = useState(false)
  const [endingInputReady, setEndingInputReady] = useState(DEV_PREVIEW === 'outro')
  const progressRef = useRef(PREVIEW_PROGRESS)
  const enteredRef = useRef(PREVIEW_ENTERED || INITIAL_VIEW === 'portfolio')
  const targetRef = useRef(PREVIEW_PROGRESS)
  const gateRef = useRef(PREVIEW_GATE)
  const pendingGateRef = useRef(null)
  const inputCooldownUntilRef = useRef(0)
  const fogCompletedRef = useRef(PREVIEW_FOG_COMPLETED)
  const fogReverseActiveRef = useRef(false)
  const fogReverseStartProgressRef = useRef(JOURNEY_CAVE_SEQUENCE.reverseFogStart)
  const fogReverseAtGateRef = useRef({ frame: null, startedAt: 0 })
  const riverCompletedRef = useRef(false)
  const holdRef = useRef({ frame: null, startedAt: 0, pointerId: null })
  const skyConnectionRef = useRef({ frame: null, startedAt: 0 })
  const touchRef = useRef({ active: false, x: 0, y: 0, startX: 0, startY: 0, mode: null })
  const activeMessageNumberRef = useRef(null)
  const previousStoryProgressRef = useRef(PREVIEW_PROGRESS)
  const storyDirectionRef = useRef(1)
  const messageTimersRef = useRef({ reveal: null, hide: null, clear: null })
  const portfolioRef = useRef(DEV_PREVIEW === 'portfolio' || INITIAL_VIEW === 'portfolio')
  const endingRequestSerialRef = useRef(0)
  const activeEndingRequestRef = useRef(0)
  const endingCaptureFailureCountRef = useRef(0)
  const endingInputReadyRef = useRef(DEV_PREVIEW === 'outro')
  const endingReleaseRequestedRef = useRef(false)
  const endingInputReleaseTimerRef = useRef(null)
  const endingCommittedRef = useRef(
    DEV_PREVIEW === 'portfolio' || INITIAL_VIEW === 'portfolio',
  )
  const { ensureAudio, updateListenerPose, audioPrepared } = useAmbientAudio(
    progress,
    fogCompleted,
    showOutro,
    !showPortfolio,
  )

  const clearEndingCapture = useCallback(() => {
    activeEndingRequestRef.current = 0
    setEndingCaptureRequest(0)
    setEndingFrameSource(null)
    setEndingFrameLoaded(false)
  }, [])

  const resetEndingInputGate = useCallback(() => {
    window.clearTimeout(endingInputReleaseTimerRef.current)
    endingInputReleaseTimerRef.current = null
    endingInputReadyRef.current = false
    endingReleaseRequestedRef.current = false
    setEndingInputReady(false)
    setEndingReleaseRequested(false)
  }, [])

  const markEndingInputReady = useCallback(() => {
    if (endingReleaseRequestedRef.current) return
    window.clearTimeout(endingInputReleaseTimerRef.current)
    endingInputReleaseTimerRef.current = null
    endingInputReadyRef.current = true
    setEndingInputReady(true)
  }, [])

  const waitForEndingInputRelease = useCallback(() => {
    if (endingReleaseRequestedRef.current) return
    endingInputReadyRef.current = false
    setEndingInputReady(false)
    window.clearTimeout(endingInputReleaseTimerRef.current)
    endingInputReleaseTimerRef.current = window.setTimeout(() => {
      endingInputReleaseTimerRef.current = null
      if (
        touchRef.current.active ||
        progressRef.current < ENDING_SETTLE_PROGRESS ||
        endingReleaseRequestedRef.current
      ) return
      markEndingInputReady()
    }, ENDING_INPUT_NEUTRAL_MS)
  }, [markEndingInputReady])

  const recordEndingCaptureFailure = useCallback((requestId, error, stage) => {
    if (!requestId || requestId !== activeEndingRequestRef.current) return
    const attempt = endingCaptureFailureCountRef.current + 1
    endingCaptureFailureCountRef.current = attempt
    console.error(`[journey-ending-${stage}] Capture attempt ${attempt} failed.`, error)
    clearEndingCapture()
    if (attempt >= ENDING_CAPTURE_MAX_ATTEMPTS) {
      setEndingCaptureBlocked(true)
      console.error(
        `[journey-ending] Capture stopped after ${ENDING_CAPTURE_MAX_ATTEMPTS} attempts; retaining the live final frame.`,
      )
    }
  }, [clearEndingCapture])

  const handleEndingCaptured = useCallback(async ({ requestId, source, error }) => {
    if (error) {
      recordEndingCaptureFailure(requestId, error, 'webgl')
      return
    }
    if (
      !source ||
      requestId !== activeEndingRequestRef.current ||
      (DEV_PREVIEW !== 'outro' && progressRef.current < ENDING_SETTLE_PROGRESS)
    ) return

    try {
      await decodeImageSource(source)
    } catch (error) {
      recordEndingCaptureFailure(requestId, error, 'decode')
      return
    }
    if (
      requestId !== activeEndingRequestRef.current ||
      (DEV_PREVIEW !== 'outro' && progressRef.current < ENDING_SETTLE_PROGRESS)
    ) return

    setEndingCaptureRequest(0)
    setEndingFrameLoaded(false)
    setEndingFrameSource(source)
  }, [recordEndingCaptureFailure])

  const handleJourneyAssets = useCallback(({ active, progress: nextProgress }) => {
    const safeProgress = Number.isFinite(nextProgress)
      ? clamp(nextProgress, 0, 100)
      : 0
    setJourneyAssets((current) =>
      current.active === Boolean(active) && Math.abs(current.progress - safeProgress) < 0.05
        ? current
        : { active: Boolean(active), progress: safeProgress },
    )
  }, [])

  useEffect(() => {
    if (showPortfolio) {
      setPortfolioImagesPrepared(true)
      return undefined
    }
    let cancelled = false
    setPortfolioImagesPrepared(false)
    preloadPortfolioImages().finally(() => {
      if (!cancelled) setPortfolioImagesPrepared(true)
    })
    return () => {
      cancelled = true
    }
  }, [showPortfolio])

  useEffect(() => {
    const isOutroPreview = DEV_PREVIEW === 'outro'
    if (portfolioRef.current || showPortfolio) return undefined
    if (DEV_PREVIEW && !isOutroPreview) return undefined
    if (journeyAssets.active || journeyAssets.progress < 99.95) return undefined
    if (!isOutroPreview && progress < ENDING_SETTLE_PROGRESS) {
      clearEndingCapture()
      endingCaptureFailureCountRef.current = 0
      setEndingCapturePreparing(false)
      setEndingCaptureBlocked(false)
      resetEndingInputGate()
      setShowOutro(false)
      portfolioRef.current = false
      setShowPortfolio(false)
      setPortfolioScrolled(false)
      return undefined
    }
    setEndingCapturePreparing(true)
    if (endingCaptureBlocked) return undefined
    if (
      showOutro ||
      activeEndingRequestRef.current ||
      endingCaptureRequest ||
      endingFrameSource
    ) return undefined

    if (!isOutroPreview && !endingReleaseRequested) return undefined

    const timeout = window.setTimeout(() => {
      if (!isOutroPreview && progressRef.current < ENDING_SETTLE_PROGRESS) return
      const requestId = endingRequestSerialRef.current + 1
      endingRequestSerialRef.current = requestId
      activeEndingRequestRef.current = requestId
      setEndingCaptureRequest(requestId)
    }, isOutroPreview ? ENDING_SETTLE_MS : ENDING_INPUT_RELEASE_MS)
    return () => window.clearTimeout(timeout)
  }, [
    clearEndingCapture,
    endingCaptureRequest,
    endingCaptureBlocked,
    endingFrameSource,
    endingReleaseRequested,
    journeyAssets.active,
    journeyAssets.progress,
    progress,
    resetEndingInputGate,
    showOutro,
    showPortfolio,
  ])

  useEffect(() => {
    if (!endingCapturePreparing || showOutro || showPortfolio) {
      window.clearTimeout(endingInputReleaseTimerRef.current)
      endingInputReleaseTimerRef.current = null
      return undefined
    }
    if (DEV_PREVIEW === 'outro') {
      markEndingInputReady()
      return undefined
    }
    if (!endingReleaseRequestedRef.current) waitForEndingInputRelease()
    return () => {
      window.clearTimeout(endingInputReleaseTimerRef.current)
      endingInputReleaseTimerRef.current = null
    }
  }, [endingCapturePreparing, markEndingInputReady, showOutro, showPortfolio, waitForEndingInputRelease])

  useEffect(() => {
    if (journeySearch.get('capture') !== '1') return
    document.documentElement.dataset.journeyEndingInputState = endingReleaseRequested
      ? 'triggered'
      : endingInputReady
        ? 'ready'
        : endingCapturePreparing
          ? 'awaiting-release'
          : 'inactive'
  }, [endingCapturePreparing, endingInputReady, endingReleaseRequested])

  useEffect(() => {
    if (!endingFrameSource || !endingFrameLoaded || showOutro || showPortfolio) return undefined
    let cancelled = false
    let firstPaintFrame = null
    let secondPaintFrame = null
    const requestId = activeEndingRequestRef.current

    const armOutro = () => {
      firstPaintFrame = window.requestAnimationFrame(() => {
        secondPaintFrame = window.requestAnimationFrame(() => {
          if (
            cancelled ||
            requestId !== activeEndingRequestRef.current ||
            (DEV_PREVIEW !== 'outro' && progressRef.current < ENDING_SETTLE_PROGRESS)
          ) return
          endingCaptureFailureCountRef.current = 0
          setEndingCaptureBlocked(false)
          endingCommittedRef.current = true
          setShowOutro(true)
        })
      })
    }
    armOutro()
    return () => {
      cancelled = true
      if (firstPaintFrame != null) window.cancelAnimationFrame(firstPaintFrame)
      if (secondPaintFrame != null) window.cancelAnimationFrame(secondPaintFrame)
    }
  }, [endingFrameLoaded, endingFrameSource, showOutro, showPortfolio])

  useEffect(() => {
    if (!showOutro || portfolioRef.current) return undefined
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const homeDelay = reduceMotion ? 220 : ENDING_MEMORY_HOME_MS
    const completeDelay = reduceMotion ? 760 : ENDING_MEMORY_COMPLETE_MS
    const homeTimeout = window.setTimeout(() => {
      portfolioRef.current = true
      setPortfolioPage('home')
      setMemoryHome(true)
      try {
        window.localStorage.setItem(JOURNEY_STORAGE_KEY, 'true')
      } catch {
        // The experience still completes when storage is unavailable.
      }
      window.history.replaceState(null, '', '/')
      setShowPortfolio(true)
    }, homeDelay)
    const completeTimeout = window.setTimeout(() => {
      clearEndingCapture()
      setEndingCapturePreparing(false)
    }, completeDelay)
    return () => {
      window.clearTimeout(homeTimeout)
      window.clearTimeout(completeTimeout)
    }
  }, [clearEndingCapture, showOutro])

  useEffect(() => {
    if (!showOutro || journeySearch.get('capture') !== '1') return undefined
    const deltas = []
    const longTasks = []
    const startedAt = performance.now()
    let previousFrame = startedAt
    let frame = null
    let observer = null
    let classMutations = 0
    const mutationObserver = new MutationObserver((records) => {
      classMutations += records.length
    })
    mutationObserver.observe(document.querySelector('main') ?? document.body, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
    })
    try {
      observer = new PerformanceObserver((list) => {
        longTasks.push(...list.getEntries().map((entry) => ({
          start: Number((entry.startTime - startedAt).toFixed(2)),
          duration: Number(entry.duration.toFixed(2)),
        })))
      })
      observer.observe({ type: 'longtask' })
    } catch {
      observer = null
    }

    const finish = () => {
      const sorted = deltas.slice().sort((left, right) => left - right)
      const percentile = (value) => sorted[
        Math.min(sorted.length - 1, Math.floor(sorted.length * value))
      ] ?? 0
      const elapsed = (performance.now() - startedAt) / 1000
      const report = {
        source: 'JourneyEndingPerformanceProbe',
        legacy: ENDING_PERFORMANCE_LEGACY,
        seconds: Number(elapsed.toFixed(3)),
        frames: deltas.length,
        fps: Number((deltas.length / Math.max(elapsed, 0.001)).toFixed(2)),
        frameMs: {
          median: Number(percentile(0.5).toFixed(2)),
          p95: Number(percentile(0.95).toFixed(2)),
          p99: Number(percentile(0.99).toFixed(2)),
          max: Number((sorted.at(-1) ?? 0).toFixed(2)),
        },
        slowFrameRatio: Number((
          deltas.filter((value) => value > 1000 / 30).length /
          Math.max(deltas.length, 1)
        ).toFixed(4)),
        longTasks,
        classMutations,
        renderer: window.__JOURNEY_ENDING_RENDERER__ ?? null,
      }
      window.__JOURNEY_ENDING_PERFORMANCE__ = report
      document.documentElement.dataset.journeyEndingPerformance = JSON.stringify(report)
      console.info(`[journey-ending-performance] ${JSON.stringify(report)}`)
    }
    const tick = (time) => {
      deltas.push(time - previousFrame)
      previousFrame = time
      if (time - startedAt >= ENDING_MEMORY_COMPLETE_MS + 240) {
        finish()
        observer?.disconnect()
        mutationObserver.disconnect()
        return
      }
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => {
      if (frame != null) window.cancelAnimationFrame(frame)
      observer?.disconnect()
      mutationObserver.disconnect()
    }
  }, [showOutro])

  useEffect(() => {
    if (!showPortfolio) return undefined
    // Layout is pre-mounted behind the frozen memory frame. One immediate and
    // one post-transition resize are sufficient; seven synthetic resize
    // events forced repeated R3F/layout work during the heaviest overlap.
    const resizeCheckpoints = [0, 920]
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

  const restoreFogAtGateForReverse = useCallback(() => {
    if (fogReverseAtGateRef.current.frame || !fogCompletedRef.current) return
    targetRef.current = JOURNEY_CAVE_SEQUENCE.fogGate
    fogReverseActiveRef.current = true
    setFogReverseActive(true)
    setFogReverseAtGate(true)
    setFogReverseAtGateProgress(0)
    fogReverseAtGateRef.current.startedAt = performance.now()

    const tick = (time) => {
      const value = clamp(
        (time - fogReverseAtGateRef.current.startedAt) /
          JOURNEY_CAVE_SEQUENCE.reverseFogAtGateDuration,
        0,
        1,
      )
      setFogReverseAtGateProgress(value)
      if (value >= 1) {
        fogReverseAtGateRef.current.frame = null
        fogReverseActiveRef.current = false
        fogCompletedRef.current = false
        setFogReverseActive(false)
        setFogReverseAtGate(false)
        setFogReverseAtGateProgress(0)
        setFogCompleted(false)
        setGate('fog')
        return
      }
      fogReverseAtGateRef.current.frame = requestAnimationFrame(tick)
    }

    fogReverseAtGateRef.current.frame = requestAnimationFrame(tick)
  }, [setGate])

  const advance = useCallback(
    (rawDelta) => {
      if (
        PUBLIC_SHOWCASE ||
        !enteredRef.current ||
        portfolioRef.current ||
        endingCommittedRef.current ||
        !rawDelta ||
        holdRef.current.frame ||
        fogReverseAtGateRef.current.frame ||
        skyConnectionRef.current.frame
      ) return
      const direction = Math.sign(rawDelta)
      const active = gateRef.current

      if (
        direction > 0 &&
        endingCapturePreparing &&
        !endingFrameSource &&
        progressRef.current >= ENDING_SETTLE_PROGRESS
      ) {
        if (endingInputReadyRef.current && !endingReleaseRequestedRef.current) {
          endingReleaseRequestedRef.current = true
          setEndingReleaseRequested(true)
        }
        return
      }

      if (
        direction < 0 &&
        fogCompletedRef.current &&
        targetRef.current <= JOURNEY_CAVE_SEQUENCE.fogGate + 0.02
      ) {
        restoreFogAtGateForReverse()
        return
      }

      if (
        direction < 0 &&
        fogCompletedRef.current &&
        targetRef.current > JOURNEY_CAVE_SEQUENCE.fogGate &&
        !fogReverseActiveRef.current
      ) {
        const reverseStart = clamp(
          progressRef.current,
          JOURNEY_CAVE_SEQUENCE.fogGate + 0.001,
          JOURNEY_CAVE_SEQUENCE.reverseFogStart,
        )
        fogReverseStartProgressRef.current = reverseStart
        fogReverseActiveRef.current = true
        setFogReverseStartProgress(reverseStart)
        setFogReverseActive(true)
      }

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
    [endingCapturePreparing, endingFrameSource, restoreFogAtGateForReverse, setTarget],
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
      if (
        fogReverseActiveRef.current &&
        difference < 0 &&
        next <= JOURNEY_CAVE_SEQUENCE.fogGate
      ) {
        fogReverseActiveRef.current = false
        fogReverseStartProgressRef.current = JOURNEY_CAVE_SEQUENCE.reverseFogStart
        fogCompletedRef.current = false
        setFogReverseActive(false)
        setFogReverseStartProgress(JOURNEY_CAVE_SEQUENCE.reverseFogStart)
        setFogCompleted(false)
        setHoldProgress(0)
      } else if (
        fogReverseActiveRef.current &&
        difference > 0 &&
        next >= fogReverseStartProgressRef.current
      ) {
        fogReverseActiveRef.current = false
        setFogReverseActive(false)
      }
      // Keep the render loop alive for Three.js, but do not enqueue a React
      // update once the eased progress has settled. Updating on every frame
      // caused a feedback loop in narrow/short viewports and could stop input.
      if (Math.abs(next - current) > 0.0001) {
        progressRef.current = next
        setProgress(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [setGate, showPortfolio])

  useEffect(() => {
    const onWheel = (event) => {
      if (PUBLIC_SHOWCASE) return
      if (portfolioRef.current) return
      event.preventDefault()
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      if (
        endingCapturePreparing &&
        !endingInputReadyRef.current &&
        !endingReleaseRequestedRef.current &&
        progressRef.current >= ENDING_SETTLE_PROGRESS
      ) {
        waitForEndingInputRelease()
        return
      }
      advance(event.deltaY * multiplier)
    }
    const onTouchStart = (event) => {
      if (PUBLIC_SHOWCASE) return
      if (portfolioRef.current) return
      if (gateRef.current || event.touches.length !== 1) return
      const touch = event.touches[0]
      touchRef.current = {
        active: true,
        x: touch.clientX,
        y: touch.clientY,
        startX: touch.clientX,
        startY: touch.clientY,
        mode: null,
      }
    }
    const onTouchMove = (event) => {
      if (PUBLIC_SHOWCASE) return
      if (portfolioRef.current) return
      if (!touchRef.current.active || event.touches.length !== 1) return
      const touch = event.touches[0]
      const totalX = touch.clientX - touchRef.current.startX
      const totalY = touch.clientY - touchRef.current.startY
      if (!touchRef.current.mode && Math.hypot(totalX, totalY) > 14) {
        const horizontal = Math.abs(totalX)
        const vertical = Math.abs(totalY)
        if (horizontal >= vertical * 1.22) {
          touchRef.current.mode = 'ignore'
        } else if (vertical >= horizontal * 1.08) {
          touchRef.current.mode = 'scroll'
        }
      }
      if (!touchRef.current.mode) return
      if (touchRef.current.mode === 'ignore') return
      event.preventDefault()
      const deltaY = touch.clientY - touchRef.current.y
      if (
        endingCapturePreparing &&
        !endingInputReadyRef.current &&
        !endingReleaseRequestedRef.current &&
        progressRef.current >= ENDING_SETTLE_PROGRESS
      ) {
        touchRef.current.x = touch.clientX
        touchRef.current.y = touch.clientY
        return
      }
      advance(-deltaY * 1.8)
      touchRef.current.x = touch.clientX
      touchRef.current.y = touch.clientY
    }
    const onTouchEnd = () => {
      touchRef.current.active = false
      touchRef.current.mode = null
      if (
        endingCapturePreparing &&
        !endingReleaseRequestedRef.current &&
        progressRef.current >= ENDING_SETTLE_PROGRESS
      ) markEndingInputReady()
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [advance, endingCapturePreparing, markEndingInputReady, waitForEndingInputRelease])

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
        fogReverseActiveRef.current = false
        fogReverseStartProgressRef.current = JOURNEY_CAVE_SEQUENCE.reverseFogStart
        fogCompletedRef.current = true
        setFogReverseActive(false)
        setFogReverseStartProgress(JOURNEY_CAVE_SEQUENCE.reverseFogStart)
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
      if (PUBLIC_SHOWCASE || !type || holdRef.current.frame) return
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
      if (!config.advanceStoryDuringHold) setTarget(config.at)
      const tick = (time) => {
        const value = clamp((time - holdRef.current.startedAt) / config.duration, 0, 1)
        setHoldProgress(value)
        if (config.advanceStoryDuringHold) {
          setTarget(config.at + value * (config.end - config.at))
        }
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
      if (event.code === 'Space' || event.code === 'Enter') cancelHold()
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
      cancelAnimationFrame(fogReverseAtGateRef.current.frame)
      cancelAnimationFrame(skyConnectionRef.current.frame)
    },
    [],
  )

  const activeConfig = activeGate ? GATES[activeGate] : null
  const { nightWeight } = getJourneyTimeOfDay(progress)
  const caveDepth = getJourneyCavePresence(progress)
  const openAir = getJourneyOutdoorPresence(progress)
  const fogClearProgress = fogCompleted
    ? fogReverseActive
      ? fogReverseAtGate
        ? 1 - fogReverseAtGateProgress
        : getJourneyReverseFogClearance(progress, fogReverseStartProgress)
      : 1
    : activeGate === 'fog'
      ? holdProgress
      : 0
  const valleyMist = getJourneyFogArrival(progress) * openAir * (1 - fogClearProgress)
  const queuedMessage = STORY_MESSAGES.find(
    (message) => progress >= message.start && progress <= message.end,
  )
  useEffect(() => {
    const previousProgress = previousStoryProgressRef.current
    const nextDirection = progress < previousProgress ? -1 : progress > previousProgress ? 1 : storyDirectionRef.current
    const directionChanged = nextDirection !== storyDirectionRef.current
    previousStoryProgressRef.current = progress
    storyDirectionRef.current = nextDirection

    if (!queuedMessage) {
      activeMessageNumberRef.current = null
      return
    }
    if (
      activeMessageNumberRef.current === queuedMessage.number &&
      !directionChanged
    ) return
    activeMessageNumberRef.current = queuedMessage.number
    const timers = messageTimersRef.current
    cancelAnimationFrame(timers.reveal)
    window.clearTimeout(timers.hide)
    window.clearTimeout(timers.clear)
    setDisplayedMessage(queuedMessage)
    setMessageVisible(false)
    timers.reveal = requestAnimationFrame(() => setMessageVisible(true))
    timers.hide = window.setTimeout(() => setMessageVisible(false), 3500)
    timers.clear = window.setTimeout(() => setDisplayedMessage(null), 4100)
  }, [progress, queuedMessage])

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
    clearEndingCapture()
    endingCaptureFailureCountRef.current = 0
    setEndingCapturePreparing(false)
    setEndingCaptureBlocked(false)
    resetEndingInputGate()
    portfolioRef.current = false
    endingCommittedRef.current = false
    enteredRef.current = false
    progressRef.current = 0
    previousStoryProgressRef.current = 0
    storyDirectionRef.current = 1
    targetRef.current = 0
    gateRef.current = null
    pendingGateRef.current = null
    fogReverseActiveRef.current = false
    fogReverseStartProgressRef.current = JOURNEY_CAVE_SEQUENCE.reverseFogStart
    cancelAnimationFrame(fogReverseAtGateRef.current.frame)
    fogReverseAtGateRef.current.frame = null
    fogCompletedRef.current = false
    riverCompletedRef.current = false
    inputCooldownUntilRef.current = 0
    activeMessageNumberRef.current = null
    const messageTimers = messageTimersRef.current
    cancelAnimationFrame(messageTimers.reveal)
    window.clearTimeout(messageTimers.hide)
    window.clearTimeout(messageTimers.clear)
    setEntered(false)
    setShowPortfolio(false)
    setPortfolioScrolled(false)
    setMemoryHome(false)
    setShowOutro(false)
    setProgress(0)
    setActiveGate(null)
    setHoldProgress(0)
    setFogReverseActive(false)
    setFogReverseStartProgress(JOURNEY_CAVE_SEQUENCE.reverseFogStart)
    setFogReverseAtGate(false)
    setFogReverseAtGateProgress(0)
    setSkyConnectionProgress(0)
    setIsSkyConnecting(false)
    setFogCompleted(false)
    setDisplayedMessage(null)
    setMessageVisible(false)
    setMobileLook({ x: 0, y: 0 })
    setPortfolioPage('home')
  }, [clearEndingCapture, resetEndingInputGate])

  const replayExperience = useCallback(() => {
    resetExperience()
    window.history.pushState(null, '', `/journey${window.location.search}`)
  }, [resetExperience])

  const openPortfolioPage = useCallback((page, { updateHistory = true } = {}) => {
    const nextPage = PORTFOLIO_PAGES.includes(page) ? page : 'home'
    portfolioRef.current = true
    clearEndingCapture()
    endingCaptureFailureCountRef.current = 0
    setEndingCapturePreparing(false)
    setEndingCaptureBlocked(false)
    resetEndingInputGate()
    enteredRef.current = true
    setEntered(true)
    setShowOutro(true)
    setShowPortfolio(true)
    setMemoryHome(false)
    setPortfolioPage(nextPage)
    setPortfolioScrolled(nextPage !== 'home')
    if (updateHistory) {
      window.history.pushState(null, '', `${PORTFOLIO_PATHS[nextPage]}${window.location.search}`)
    }
  }, [clearEndingCapture, resetEndingInputGate])

  const portfolioRouteTransitionRef = useRef(null)

  const transitionPortfolioRoute = useCallback((page, options = {}) => {
    const nextPage = PORTFOLIO_PAGES.includes(page) ? page : 'home'
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    window.clearTimeout(portfolioRouteTransitionRef.current)
    document.documentElement.dataset.portfolioRouteTransition = 'cover'
    portfolioRouteTransitionRef.current = window.setTimeout(() => {
      openPortfolioPage(nextPage, options)
      document.documentElement.dataset.portfolioRouteTransition = 'reveal'
      portfolioRouteTransitionRef.current = window.setTimeout(() => {
        delete document.documentElement.dataset.portfolioRouteTransition
      }, reduceMotion ? 100 : PORTFOLIO_ROUTE_SWITCH_MS)
    }, reduceMotion ? 80 : PORTFOLIO_ROUTE_SWITCH_MS)
  }, [openPortfolioPage])

  useEffect(() => () => {
    window.clearTimeout(portfolioRouteTransitionRef.current)
    delete document.documentElement.dataset.portfolioRouteTransition
  }, [])

  useEffect(() => {
    const syncRoute = () => {
      const route = getRouteFromLocation()
      if (route.view === 'journey') {
        resetExperience()
      } else {
        transitionPortfolioRoute(route.page, { updateHistory: false })
      }
    }
    window.addEventListener('popstate', syncRoute)
    return () => window.removeEventListener('popstate', syncRoute)
  }, [resetExperience, transitionPortfolioRoute])

  return (
    <main
      className={`journey-3d ${entered ? 'is-entered' : ''} ${PUBLIC_SHOWCASE ? 'is-showcase' : ''} ${ENDING_PERFORMANCE_LEGACY ? 'is-ending-perf-legacy' : ''} ${activeGate ? `has-gate is-gate-${activeGate}` : ''} ${activeGate && holdProgress > 0 ? 'is-holding' : ''} ${endingCapturePreparing ? 'is-ending-preparing' : ''} ${endingFrameSource ? 'has-ending-frame' : ''} ${showOutro ? 'is-outro' : ''} ${showPortfolio ? 'is-portfolio' : ''} ${memoryHome ? 'is-memory-home' : ''} ${portfolioScrolled ? 'is-portfolio-scrolled' : ''}`}
      style={{
        '--cave-depth': caveDepth,
        '--open-air': openAir,
        '--night-weight': nightWeight,
        '--valley-mist': valleyMist,
        '--hold-x': `${holdOrigin.x}px`,
        '--hold-y': `${holdOrigin.y}px`,
        '--hold-radius': `${80 + holdProgress * 360}px`,
      }}
    >
      {!showPortfolio ? (
        <div className="journey-scene-frame" aria-hidden={showOutro}>
          <Suspense fallback={null}>
            <JourneyCanvas
              progress={progress}
              skyConnectionProgress={skyConnectionProgress}
              activeGate={activeGate}
              holdProgress={holdProgress}
              fogClearProgress={fogClearProgress}
              fogCompleted={fogCompleted}
              endingCaptureRequest={endingCaptureRequest}
              endingPaused={Boolean(endingFrameSource)}
              endingActive={showOutro}
              endingPerformanceLegacy={ENDING_PERFORMANCE_LEGACY}
              onEndingCaptured={handleEndingCaptured}
              onAssetsProgress={handleJourneyAssets}
              onListenerPose={updateListenerPose}
            />
          </Suspense>
        </div>
      ) : null}

      {endingFrameSource ? (
        <div className="journey-ending-frame" aria-hidden="true">
          <img
            className="journey-ending-frame__landscape"
            src={endingFrameSource}
            alt=""
            onLoad={() => {
              if (activeEndingRequestRef.current) setEndingFrameLoaded(true)
            }}
            onError={() => {
              recordEndingCaptureFailure(
                activeEndingRequestRef.current,
                new Error('Captured frame failed to paint.'),
                'paint',
              )
            }}
          />
          <img
            className="journey-ending-frame__echo"
            src={endingFrameSource}
            alt=""
          />
          <div className="journey-ending-frame__air" aria-hidden="true">
            <i />
            <i />
          </div>
        </div>
      ) : null}

      {!showPortfolio ? (
        <ExperienceLoader
          entered={entered}
          onEnter={enterExperience}
          assetsActive={journeyAssets.active}
          assetProgress={journeyAssets.progress}
          audioPrepared={audioPrepared}
          portfolioImagesPrepared={portfolioImagesPrepared}
        />
      ) : null}

      <div className="paper-texture" aria-hidden="true" />
      <div className="cave-grade" aria-hidden="true" />
      <div className="valley-mist" aria-hidden="true" />
      <div className="soft-vignette" aria-hidden="true" />

      {endingCapturePreparing || showOutro || showPortfolio ? (
        <PortfolioSite
          onReplay={replayExperience}
          onNavigate={openPortfolioPage}
          onScrolledChange={setPortfolioScrolled}
          page={portfolioPage}
        />
      ) : null}

      {endingCapturePreparing && endingInputReady && !endingFrameSource && !showOutro ? (
        <div
          className={`journey-ending-pause-cue ${endingReleaseRequested ? 'is-releasing' : ''}`}
          role="status"
          aria-live="polite"
        >
          <span>FEEL THE VIEW</span>
          <small>SCROLL WHEN READY</small>
        </div>
      ) : null}

      <header className="journey-ui__header">
        <span>JOURNEY</span>
        <small>INSPIRED BY KAMIKOCHI</small>
      </header>

      {PUBLIC_SHOWCASE ? (
        <aside className="journey-showcase-note" aria-label="Journey visual showcase">
          <span>DAY CLEAR</span>
          <small>VALLEY STUDY</small>
        </aside>
      ) : null}

      {activeMessage ? (
        <aside
          key={activeMessage.number}
          className={`journey-message is-${activeMessage.align}`}
          style={{
            '--message-opacity': messageOpacity,
            '--message-shift': `${(1 - messageOpacity) * 16}px`,
            '--message-blur': `${(1 - messageOpacity) * 4}px`,
            '--message-color': '#f8f4e9',
          }}
          aria-live="polite"
        >
          <span className="journey-message__number">{activeMessage.number}</span>
          <div className="journey-message__copy">
            <p>
              {activeMessage.title.slice(0, 3).map((line) => (
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
            <span>{activeConfig.label}</span>
            <i
              className="hold-mark"
              style={{ '--hold-progress': `${holdProgress * 360}deg` }}
              aria-hidden="true"
            />
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

function App() {
  if (INITIAL_ROUTE.view === 'journey-v3') {
    return (
      <Suspense fallback={<div className="journey-v3-fallback" aria-label="Loading Journey V3" />}>
        <JourneyV3 />
      </Suspense>
    )
  }

  if (INITIAL_ROUTE.view === 'journey-v2') {
    return (
      <Suspense fallback={<div className="journey-v2-fallback" aria-label="Loading Journey V2" />}>
        <JourneyV2 />
      </Suspense>
    )
  }

  return <LegacyApp />
}

export default App
