const clamp01 = (value) => Math.min(1, Math.max(0, value))

const smootherstep = (start, end, value) => {
  const range = Math.max(end - start, Number.EPSILON)
  const t = clamp01((value - start) / range)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// Geometry-derived V1 handoff points. The source camera clears the cave shell
// between progress 11.75 and 12.0. Fog therefore arrives only after that
// crossing, and the HOLD gate stays at the established 13.5 visual anchor.
// Keeping the gate at 13.5 preserves the later valley/TOD baseline.
export const JOURNEY_CAVE_SEQUENCE = Object.freeze({
  portalCrossing: 11.82,
  portalCleared: 12.08,
  outdoorSettled: 13.5,
  caveFadeEnd: 13.35,
  fogArrivalStart: 12.15,
  fogGate: 13.5,
  fogDuration: 2500,
  reverseFogStart: 15.5,
  reverseFogAtGateDuration: 900,
})

export const getJourneyCavePresence = (progress) => 1 - smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalCrossing,
  JOURNEY_CAVE_SEQUENCE.caveFadeEnd,
  progress,
)

export const getJourneyOutdoorPresence = (progress) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalCrossing,
  JOURNEY_CAVE_SEQUENCE.outdoorSettled,
  progress,
)

export const getJourneyFogArrival = (progress) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.fogArrivalStart,
  JOURNEY_CAVE_SEQUENCE.fogGate,
  progress,
)

export const getJourneyReverseFogClearance = (
  progress,
  reverseStart = JOURNEY_CAVE_SEQUENCE.reverseFogStart,
) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.fogGate,
  Math.max(JOURNEY_CAVE_SEQUENCE.fogGate + 0.001, reverseStart),
  progress,
)
