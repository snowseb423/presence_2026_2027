/** Monogramme « P » : la panse est la pastille pleine du statut Travaillé. */
export function AppMark({ size = 56, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label="Présence" className={className}>
      <rect width="64" height="64" rx="16" fill="#C2410C" />
      <rect x="17" y="13" width="9.5" height="38" rx="4.75" fill="#FDF7F1" />
      <circle cx="35" cy="26" r="13" fill="#FDF7F1" />
      <circle cx="35" cy="26" r="5.25" fill="#C2410C" />
    </svg>
  )
}
