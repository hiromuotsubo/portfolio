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
  fullNight: JOURNEY_VISUAL_TIMING.nightObservationEnd,
  riverGate: 88,
  riverHoldDuration: 3300,
  connectionReverseFadeStart: 78,
  fixedVistaCameraProgress: 20,
  closeUpCameraStartProgress: 55,
  closeUpCameraProgress: 70,
  finalCameraProgress: 90,
  postHoldTravelStart: 88.35,
  postHoldLookUpStart: 88.35,
  postHoldWidenStart: 89.45,
  postHoldLiftEnd: 94,
  figureGatherStart: 94,
  figureGatherEnd: 96,
  figureSilhouetteStart: 94.55,
  figureSilhouetteEnd: 96,
  finalWideStart: 96,
  finalWideEnd: 100,
  figureReleaseStart: 98.2,
  figureReleaseEnd: 100,
})

// Camera and weather intentionally use different clocks after the valley has
// opened. Day, sunset and night all share the exact p20 composition; only
// after full darkness does the authored camera travel into its close view.
// The river HOLD is therefore world-only at one settled close-up, and later
// scroll resumes the lift without a hidden camera jump.
export const getJourneyCameraProgress = (progress) => {
  const sequence = JOURNEY_NIGHT_SEQUENCE
  if (progress <= sequence.fixedVistaCameraProgress) return progress
  if (progress <= sequence.fullNight) return sequence.fixedVistaCameraProgress
  if (progress <= sequence.riverGate) {
    // The authored clip is visually still from p20 to roughly p55. Starting
    // this chapter at the last identical pose spends the full interval on the
    // visible close-up instead of hiding most of the allotted time in a flat
    // section of the source animation.
    return sequence.closeUpCameraStartProgress + (
      sequence.closeUpCameraProgress - sequence.closeUpCameraStartProgress
    ) * smootherstep(sequence.fullNight, sequence.riverGate, progress)
  }
  if (progress <= sequence.postHoldTravelStart) return sequence.closeUpCameraProgress
  if (progress <= sequence.postHoldLiftEnd) {
    return sequence.closeUpCameraProgress + (
      sequence.finalCameraProgress - sequence.closeUpCameraProgress
    ) * smootherstep(sequence.postHoldTravelStart, sequence.postHoldLiftEnd, progress)
  }
  return sequence.finalCameraProgress
}

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
