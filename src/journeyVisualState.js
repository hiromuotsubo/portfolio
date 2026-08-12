export const JOURNEY_VISUAL_TIMING = Object.freeze({
  sunsetStart: 30,
  sunsetEnd: 60,
  nightStart: 58,
  nightEnd: 86,
  starsStart: 52,
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
    JOURNEY_VISUAL_TIMING.nightEnd,
    progress,
  )

  return {
    dayWeight,
    sunsetWeight,
    nightWeight,
    starWeight,
  }
}
