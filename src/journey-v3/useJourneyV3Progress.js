import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp, JOURNEY_V3_PREVIEWS, JOURNEY_V3_TIMING } from './journeyV3Config.js'

const getPreview = () => {
  if (!import.meta.env.DEV) return null
  return new URLSearchParams(window.location.search).get('preview')
}

export default function useJourneyV3Progress() {
  const previewName = useRef(getPreview()).current
  const preview = JOURNEY_V3_PREVIEWS[previewName] ?? null
  const initialProgress = preview?.progress ?? 0
  const [entered, setEntered] = useState(preview?.entered ?? false)
  const [progress, setProgress] = useState(initialProgress)
  const [activeGate, setActiveGate] = useState(preview?.gate ?? null)
  const [holdProgress, setHoldProgress] = useState(preview?.hold ?? 0)
  const progressRef = useRef(initialProgress)
  const targetRef = useRef(initialProgress)
  const gateRef = useRef(preview?.gate ?? null)
  const pendingGateRef = useRef(false)
  const holdRef = useRef({ frame: 0, startedAt: 0 })
  const touchRef = useRef({ active: false, y: 0 })

  const setGate = useCallback((nextGate) => {
    gateRef.current = nextGate
    setActiveGate(nextGate)
    if (nextGate) setHoldProgress(0)
  }, [])

  const advance = useCallback((rawDelta) => {
    if (!entered || !rawDelta || holdRef.current.frame) return
    const direction = Math.sign(rawDelta)

    if (gateRef.current) {
      if (direction > 0) return
      setGate(null)
      pendingGateRef.current = false
    }

    const movement = clamp(Math.abs(rawDelta) * 0.006, 0, 1.65) * direction
    let next = clamp(
      targetRef.current + movement,
      Math.max(0, progressRef.current - 3.2),
      Math.min(100, progressRef.current + 3.2),
    )

    if (
      direction > 0 &&
      progressRef.current < JOURNEY_V3_TIMING.gateAt &&
      next >= JOURNEY_V3_TIMING.gateAt - 0.35
    ) {
      next = JOURNEY_V3_TIMING.gateAt
      pendingGateRef.current = true
    }

    if (direction < 0 && next < JOURNEY_V3_TIMING.gateEnd - 1) {
      setHoldProgress(0)
    }

    targetRef.current = next
  }, [entered, setGate])

  useEffect(() => {
    if (!entered || preview) return undefined
    let frame = 0
    let previous = performance.now()
    const tick = (time) => {
      const delta = Math.min((time - previous) / 1000, 0.05)
      previous = time
      const current = progressRef.current
      const difference = targetRef.current - current
      const damping = 1 - Math.exp(-delta * 3.1)
      const maxStep = delta * (difference < 0 ? 18 : 13)
      let next = Math.abs(difference) < 0.001
        ? targetRef.current
        : current + Math.sign(difference) * Math.min(Math.abs(difference), Math.abs(difference) * damping, maxStep)

      if (pendingGateRef.current && next >= JOURNEY_V3_TIMING.gateAt - 0.35) {
        next = JOURNEY_V3_TIMING.gateAt
        targetRef.current = next
        pendingGateRef.current = false
        setGate('fog')
      }

      if (Math.abs(next - current) > 0.0001) {
        progressRef.current = next
        setProgress(next)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [entered, preview, setGate])

  const finishHold = useCallback(() => {
    cancelAnimationFrame(holdRef.current.frame)
    holdRef.current.frame = 0
    setHoldProgress(1)
    setGate(null)
    targetRef.current = JOURNEY_V3_TIMING.gateEnd
    progressRef.current = JOURNEY_V3_TIMING.gateEnd
    setProgress(JOURNEY_V3_TIMING.gateEnd)
  }, [setGate])

  const startHold = useCallback((event) => {
    if (gateRef.current !== 'fog' || holdRef.current.frame) return
    if (Number.isFinite(event?.button) && event.button !== 0) return
    event?.preventDefault?.()
    holdRef.current.startedAt = performance.now()
    const tick = (time) => {
      const value = clamp(
        (time - holdRef.current.startedAt) / JOURNEY_V3_TIMING.holdDuration,
        0,
        1,
      )
      setHoldProgress(value)
      const next = JOURNEY_V3_TIMING.gateAt +
        value * (JOURNEY_V3_TIMING.gateEnd - JOURNEY_V3_TIMING.gateAt)
      progressRef.current = next
      targetRef.current = next
      setProgress(next)
      if (value >= 1) {
        finishHold()
        return
      }
      holdRef.current.frame = requestAnimationFrame(tick)
    }
    holdRef.current.frame = requestAnimationFrame(tick)
  }, [finishHold])

  const cancelHold = useCallback(() => {
    if (!holdRef.current.frame || gateRef.current !== 'fog') return
    cancelAnimationFrame(holdRef.current.frame)
    holdRef.current.frame = 0
    setHoldProgress(0)
    progressRef.current = JOURNEY_V3_TIMING.gateAt
    targetRef.current = JOURNEY_V3_TIMING.gateAt
    setProgress(JOURNEY_V3_TIMING.gateAt)
  }, [])

  useEffect(() => {
    if (!entered || preview) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      advance(event.deltaY * multiplier)
    }
    const onTouchStart = (event) => {
      if (gateRef.current || event.touches.length !== 1) return
      touchRef.current.active = true
      touchRef.current.y = event.touches[0].clientY
    }
    const onTouchMove = (event) => {
      if (!touchRef.current.active || event.touches.length !== 1) return
      event.preventDefault()
      const nextY = event.touches[0].clientY
      advance((touchRef.current.y - nextY) * 2)
      touchRef.current.y = nextY
    }
    const onTouchEnd = () => {
      touchRef.current.active = false
    }
    const onPointerDown = (event) => startHold(event)
    const onPointerUp = () => cancelHold()
    const onKeyDown = (event) => {
      if ((event.code === 'Space' || event.code === 'Enter') && !event.repeat) {
        startHold(event)
      } else if (event.code === 'ArrowDown' || event.code === 'PageDown') {
        event.preventDefault()
        advance(280)
      } else if (event.code === 'ArrowUp' || event.code === 'PageUp') {
        event.preventDefault()
        advance(-280)
      }
    }
    const onKeyUp = (event) => {
      if (event.code === 'Space' || event.code === 'Enter') cancelHold()
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onPointerUp)
    return () => {
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onPointerUp)
    }
  }, [advance, cancelHold, entered, preview, startHold])

  useEffect(() => () => cancelAnimationFrame(holdRef.current.frame), [])

  const enter = useCallback(() => setEntered(true), [])

  return {
    entered,
    enter,
    progress,
    activeGate,
    holdProgress,
    previewName,
  }
}
