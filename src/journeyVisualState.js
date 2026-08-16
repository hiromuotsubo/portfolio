// The sunset and night ramps overlap slightly so the fixed valley never rests
// on one unchanging evening grade. Day and full-night anchors stay in place;
// only the middle of the same long transition keeps moving into blue hour.
export const JOURNEY_VISUAL_TIMING = Object.freeze({
  sunsetStart: 34,
  sunsetEnd: 52,
  nightStart: 48,
  nightEnd: 72,
  starsStart: 58,
  starsEnd: 78,
  nightObservationEnd: 86,
})

const clamp01 = (value) => Math.min(1, Math.max(0, value))

export const smootherstep = (edge0, edge1, value) => {
  const range = edge1 - edge0
  const x = range === 0 ? Number(value >= edge1) : clamp01((value - edge0) / range)
  return x * x * x * (x * (x * 6 - 15) + 10)
}

export const getJourneyTimeOfDay = (progress) => {
  const sunsetRise = smootherstep(
    JOURNEY_VISUAL_TIMING.sunsetStart,
    JOURNEY_VISUAL_TIMING.sunsetEnd,
    progress,
  )
  const nightWeight = smootherstep(
    JOURNEY_VISUAL_TIMING.nightStart,
    JOURNEY_VISUAL_TIMING.nightEnd,
    progress,
  )
  const daylightWeight = 1 - nightWeight
  const dayWeight = daylightWeight * (1 - sunsetRise)
  const sunsetWeight = daylightWeight * sunsetRise
  const starWeight = smootherstep(
    JOURNEY_VISUAL_TIMING.starsStart,
    JOURNEY_VISUAL_TIMING.starsEnd,
    progress,
  )

  return {
    dayWeight,
    sunsetWeight,
    nightWeight,
    starWeight,
  }
}
