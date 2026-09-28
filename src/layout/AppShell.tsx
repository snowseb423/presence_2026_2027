import { CalendarDays, Settings2, Sun, WalletCards } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { ROUTE_PATHS, type Route, useRoute } from '../lib/router.ts'
import { SyncPill } from './SyncPill.tsx'

const NAV: { route: Route; label: string; icon: typeof Sun }[] = [
  { route: 'today', label: 'Aujourd’hui', icon: Sun },
  { route: 'month', label: 'Mois', icon: CalendarDays },
  { route: 'budget', label: 'Budget', icon: WalletCards },
  { route: 'settings', label: 'Réglages', icon: Settings2 },
]

function useScrolled(threshold = 4): boolean {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold)
    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [threshold])
  return scrolled
}

/**
 * Structure commune : bandeau espresso (sous la barre d'état iOS), feuille
 * crème qui le recouvre, navigation au pouce en bas d'écran.
 */
export function AppShell({ title, hero, children }: { title: ReactNode; hero?: ReactNode; children: ReactNode }) {
  const scrolled = useScrolled()
  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={`fixed inset-x-0 top-0 z-30 pt-[env(safe-area-inset-top)] text-header-ink transition-[background-color,box-shadow] duration-200 ${
          scrolled ? 'bg-header shadow-[0_8px_24px_-16px_rgb(0_0_0/0.6)]' : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-3 px-4">
          <h1 className="min-w-0 flex-1 truncate font-display text-[1.375rem] font-bold leading-tight">{title}</h1>
          <SyncPill />
        </div>
      </header>

      <div className="band">
        <div className="h-[calc(env(safe-area-inset-top)+3.5rem)]" aria-hidden="true" />
        {hero ? <div className="mx-auto w-full max-w-xl px-4 pb-3">{hero}</div> : null}
        <div className="h-9" aria-hidden="true" />
      </div>

      <main className="relative z-10 -mt-7 flex-1 rounded-t-[1.75rem] bg-bg">
        <div className="mx-auto w-full max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] pt-5">{children}</div>
      </main>

      <BottomNav />
    </div>
  )
}

function BottomNav() {
  const [route, go] = useRoute()
  return (
    <nav
      aria-label="Navigation principale"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-4">
        {NAV.map(({ route: target, label, icon: Icon }) => {
          const active = route === target
          return (
            <li key={target}>
              <a
                href={ROUTE_PATHS[target]}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  go(target)
                }}
                className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 pt-1.5 pb-1 text-[0.8125rem] font-bold"
              >
                <span
                  className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${
                    active ? 'bg-accent-soft text-accent-strong' : 'text-ink-2'
                  }`}
                >
                  <Icon size={22} strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
                </span>
                <span className={active ? 'text-accent-strong' : 'text-ink-2'}>{label}</span>
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
