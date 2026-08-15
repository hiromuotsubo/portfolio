const ARROW_PATHS = Object.freeze({
  internal: 'M3 8h9.5M8.75 4.25 12.5 8l-3.75 3.75',
  external: 'M3.25 12.75 12.5 3.5M6.25 3.5h6.25v6.25',
  back: 'M13 8H3.5m3.75-3.75L3.5 8l3.75 3.75',
})

export default function NavigationArrow({ kind = 'internal' }) {
  const resolvedKind = ARROW_PATHS[kind] ? kind : 'internal'

  return (
    <svg
      className={`short-arrow short-arrow--${resolvedKind}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d={ARROW_PATHS[resolvedKind]} />
    </svg>
  )
}
