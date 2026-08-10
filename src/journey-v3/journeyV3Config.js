export const JOURNEY_V3_TIMING = {
  caveEnd: 34,
  fogStart: 30,
  gateAt: 46,
  gateEnd: 82,
  holdDuration: 2600,
  clearStart: 82,
  clearEnd: 100,
}

export const JOURNEY_V3_PREVIEWS = {
  loading: { entered: false, progress: 0, gate: null, hold: 0 },
  cave: { entered: true, progress: 14, gate: null, hold: 0 },
  fog: { entered: true, progress: 40, gate: null, hold: 0 },
  hold: { entered: true, progress: 68.3, gate: 'fog', hold: 0.62 },
  clear: { entered: true, progress: 100, gate: null, hold: 1 },
}

export const JOURNEY_V3_ASSETS = {
  valley: '/portfolio/nagano-kappabashi-selected.png',
  caveAudio: '/journey/audio/cave-master.m4a',
  windAudio: '/journey/audio/wind-master.m4a',
  riverAudio: '/journey/audio/river-master.m4a',
}

export const clamp = (value, min = 0, max = 100) =>
  Math.min(max, Math.max(min, value))

export const smoothstep = (edge0, edge1, value) => {
  const amount = clamp((value - edge0) / Math.max(edge1 - edge0, 0.0001), 0, 1)
  return amount * amount * (3 - 2 * amount)
}
