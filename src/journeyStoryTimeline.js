import { JOURNEY_VISUAL_TIMING } from './journeyVisualState.js'

const clamp01 = (value) => Math.min(1, Math.max(0, value))

const smootherstep = (start, end, value) => {
  const range = Math.max(end - start, Number.EPSILON)
  const t = clamp01((value - start) / range)
  return t * t * t * (t * (t * 6 - 15) + 10)
}

// Geometry-derived V1 handoff points. Exterior fog and the complete valley are
// resident behind the opening while the camera is still inside the cave. The
// rock frame then leaves only as the camera physically crosses it, so there is
// never an empty background between Cave and Fog/HOLD. The HOLD gate remains
// at the established 13.5 visual anchor so the later valley/TOD baseline stays
// unchanged.
export const JOURNEY_CAVE_SEQUENCE = Object.freeze({
  portalApproach: 8.2,
  portalCrossing: 11.82,
  portalCleared: 12.74,
  outdoorSettled: 13.5,
  caveFadeEnd: 13.05,
  fogArrivalStart: 11.82,
  fogArrivalEnd: 13.5,
  fogGate: 13.5,
  fogDuration: 2500,
  reverseFogStart: 15.5,
})

// The valley reaches its fully dark night state through scroll alone. Only
// after that visual state has settled does one world-only HOLD illuminate the
// river and carry the same light into the Milky Way. Completion is one-shot:
// reverse travel fades the connection with story progress but never arms a
// second river HOLD during the same Journey.
export const JOURNEY_NIGHT_SEQUENCE = Object.freeze({
  fullNight: JOURNEY_VISUAL_TIMING.nightEnd,
  riverGate: 88,
  riverHoldDuration: 3300,
  connectionReverseFadeStart: 78,
  figureGatherStart: 90,
  figureGatherEnd: 93,
  figureSilhouetteStart: 91.15,
  figureSilhouetteEnd: 92.65,
  figureReleaseStart: 97,
  figureReleaseEnd: 100,
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
  JOURNEY_CAVE_SEQUENCE.fogArrivalEnd,
  progress,
)

// Every exterior layer belongs to the same physical portal handoff. Distant
// forms are readable first through the opening; ground, river and meadow then
// resolve only as the camera crosses into open air. These weights are pure
// functions of the actual story/camera progress, so forward and reverse are
// identical at the same checkpoint.
export const getJourneyValleyFarPresence = (progress) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalApproach,
  JOURNEY_CAVE_SEQUENCE.portalCleared,
  progress,
)

export const getJourneyValleyPresence = (progress) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalCrossing,
  JOURNEY_CAVE_SEQUENCE.outdoorSettled,
  progress,
)

export const getJourneyValleyGroundPresence = (progress) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalCrossing,
  JOURNEY_CAVE_SEQUENCE.caveFadeEnd,
  progress,
)

export const getJourneyValleyRiverPresence = (progress) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalCrossing,
  JOURNEY_CAVE_SEQUENCE.outdoorSettled - 0.2,
  progress,
)

export const getJourneyValleyDetailPresence = (progress) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalCleared,
  JOURNEY_CAVE_SEQUENCE.outdoorSettled,
  progress,
)

export const getJourneyReverseFogClearance = (
  progress,
  reverseStart = JOURNEY_CAVE_SEQUENCE.reverseFogStart,
) => smootherstep(
  JOURNEY_CAVE_SEQUENCE.portalCrossing,
  Math.max(JOURNEY_CAVE_SEQUENCE.portalCrossing + 0.001, reverseStart),
  progress,
)
