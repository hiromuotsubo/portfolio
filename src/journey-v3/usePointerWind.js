import { useEffect, useRef } from 'react'

export default function usePointerWind(enabled) {
  const windRef = useRef({
    x: 0,
    y: 0,
    speed: 0,
    pointerX: 0,
    pointerY: 0,
    lastX: 0,
    lastY: 0,
    lastTime: 0,
    active: false,
  })

  useEffect(() => {
    if (!enabled) return undefined
    const onPointerMove = (event) => {
      const wind = windRef.current
      const now = performance.now()
      const delta = Math.max(now - wind.lastTime, 8)
      const dx = wind.lastTime ? event.clientX - wind.lastX : 0
      const dy = wind.lastTime ? event.clientY - wind.lastY : 0
      const magnitude = Math.hypot(dx, dy)
      const impulse = Math.min(magnitude / delta / 1.25, 1)
      if (magnitude > 0.01) {
        wind.x = dx / magnitude
        wind.y = -dy / magnitude
      }
      wind.speed = Math.max(wind.speed * 0.45, impulse)
      wind.pointerX = event.clientX / Math.max(window.innerWidth, 1) * 2 - 1
      wind.pointerY = -(event.clientY / Math.max(window.innerHeight, 1) * 2 - 1)
      wind.lastX = event.clientX
      wind.lastY = event.clientY
      wind.lastTime = now
      wind.active = true
    }
    const onPointerLeave = () => {
      windRef.current.active = false
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    document.documentElement.addEventListener('mouseleave', onPointerLeave)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      document.documentElement.removeEventListener('mouseleave', onPointerLeave)
    }
  }, [enabled])

  return windRef
}
