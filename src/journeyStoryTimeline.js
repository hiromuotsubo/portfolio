const clamp01 = (value) => Math.min(1, Math.max(0, value))

const smootherstep = (start, end, value) => {
  const t = clamp01((value - start) / Math.max(end - start, Number.EPSILON))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// One shared timeline owns the Cave → outdoor → Fog/HOLD → Valley handoff.
// Keeping these boundaries together prevents UI gates, camera motion and
// world visibility from drifting into separate, contradictory sequences.
export const JOURNEY_STORY_SEQUENCE = Object.freeze({
  cave: Object.freeze({
    openingVisible: 9.3,
    cameraExitApproach: 13.5,
    cameraClearsExit: 19,
    outdoorSettled: 20.2,
  }),
  fog: Object.freeze({
    revealStart: 20.2,
    gate: 24.5,
    duration: 2500,
  }),
  valley: Object.freeze({
    revealStart: 16.5,
    visualReady: 22,
  }),
  sky: Object.freeze({
    revealStart: 15,
    visualReady: 21,
  }),
})

export const getJourneyFogArrival = (progress) => smootherstep(
  JOURNEY_STORY_SEQUENCE.fog.revealStart,
  JOURNEY_STORY_SEQUENCE.fog.gate,
  progress,
)

export const getJourneyCavePresence = (progress) => 1 - smootherstep(
  JOURNEY_STORY_SEQUENCE.cave.cameraClearsExit,
  JOURNEY_STORY_SEQUENCE.cave.outdoorSettled,
  progress,
)

export const getJourneyOutdoorPresence = (progress) => smootherstep(
  JOURNEY_STORY_SEQUENCE.cave.cameraClearsExit,
  JOURNEY_STORY_SEQUENCE.cave.outdoorSettled,
  progress,
)

export const getJourneyValleyReadiness = (progress) => smootherstep(
  JOURNEY_STORY_SEQUENCE.valley.revealStart,
  JOURNEY_STORY_SEQUENCE.valley.visualReady,
  progress,
)

export const getJourneySkyReadiness = (progress) => smootherstep(
  JOURNEY_STORY_SEQUENCE.sky.revealStart,
  JOURNEY_STORY_SEQUENCE.sky.visualReady,
  progress,
)
