// Routeur minimal sur l'API History : quatre écrans, chemins lisibles.
// (Le fragment d'URL reste libre pour le retour de Supabase : magic link ou Google.)
import { useCallback, useSyncExternalStore } from 'react'

export type Route = 'today' | 'month' | 'budget' | 'settings'

export const ROUTE_PATHS: Record<Route, string> = {
  today: '/',
  month: '/mois',
  budget: '/budget',
  settings: '/reglages',
}

const NAVIGATE_EVENT = 'presence:navigate'

export function routeFromPath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/'
  const match = (Object.entries(ROUTE_PATHS) as [Route, string][]).find(([, p]) => p === path)
  return match ? match[0] : 'today'
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('popstate', callback)
  window.addEventListener(NAVIGATE_EVENT, callback)
  return () => {
    window.removeEventListener('popstate', callback)
    window.removeEventListener(NAVIGATE_EVENT, callback)
  }
}

export function navigate(route: Route): void {
  const path = ROUTE_PATHS[route]
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path)
    window.dispatchEvent(new Event(NAVIGATE_EVENT))
  }
  window.scrollTo({ top: 0 })
}

export function useRoute(): [Route, (route: Route) => void] {
  const route = useSyncExternalStore(subscribe, () => routeFromPath(window.location.pathname))
  return [route, useCallback((next: Route) => navigate(next), [])]
}
