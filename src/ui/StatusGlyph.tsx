import type { StatusRule } from '../domain/types.ts'
import { type Glyph, glyphOf, statusVars } from './status.ts'

function Shape({ glyph }: { glyph: Glyph }) {
  switch (glyph) {
    case 'disc':
      return <circle cx="8" cy="8" r="6" fill="currentColor" />
    case 'half':
      return (
        <>
          <circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M8 2.6a5.4 5.4 0 0 0 0 10.8z" fill="currentColor" />
        </>
      )
    case 'plus':
      return (
        <>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
          <path d="M8 4.8v6.4M4.8 8h6.4" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )
    case 'ring':
      return <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="2.4" />
    case 'slash':
      return (
        <>
          <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
          <path d="M4.5 11.5 11.5 4.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )
    case 'square':
      return <rect x="2.5" y="2.5" width="11" height="11" rx="2.6" fill="currentColor" />
    case 'diamondOutline':
      return <path d="M8 2.2 13.8 8 8 13.8 2.2 8z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    case 'diamond':
      return <path d="M8 1.6 14.4 8 8 14.4 1.6 8z" fill="currentColor" />
    case 'dash':
      return <rect x="3" y="6.9" width="10" height="2.2" rx="1.1" fill="currentColor" />
    case 'dotted':
      return <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="1.6 2.3" />
  }
}

/** Pastille d'un statut : forme propre à chaque statut, dans sa couleur. */
export function StatusGlyph({
  rule,
  size = 16,
  className = '',
}: {
  rule: Pick<StatusRule, 'code' | 'colorToken'>
  size?: number
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 text-[var(--st)] ${className}`}
      style={statusVars(rule.colorToken)}
    >
      <Shape glyph={glyphOf(rule.code)} />
    </svg>
  )
}
