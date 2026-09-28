/// <reference lib="webworker" />
// Service worker (Workbox, stratégie injectManifest) :
// - precache de l'app shell (HTML, JS, CSS, polices, icônes) ;
// - toutes les navigations servent index.html précaché, page de repli
//   hors ligne en dernier recours ;
// - stale-while-revalidate sur les lectures REST Supabase : la réponse en
//   cache est marquée (x-sw-cache: hit) et le corps frais est transmis à la
//   page après revalidation.
import { clientsClaim } from 'workbox-core'
import { CacheableResponsePlugin } from 'workbox-cacheable-response'
import { ExpirationPlugin } from 'workbox-expiration'
import { cleanupOutdatedCaches, createHandlerBoundToURL, matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { StaleWhileRevalidate } from 'workbox-strategies'
import type { WorkboxPlugin } from 'workbox-core'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>
}

const DATA_CACHE = 'presence-data'

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
clientsClaim()

// ---- App shell ----
const shell = createHandlerBoundToURL('index.html')
registerRoute(
  new NavigationRoute(async (options) => {
    try {
      return await shell(options)
    } catch {
      return (await matchPrecache('offline.html')) ?? Response.error()
    }
  }),
)

// ---- Données : stale-while-revalidate ----
async function notifyClients(message: Record<string, unknown>): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window' })
  for (const client of clients) client.postMessage(message)
}

const revalidation: WorkboxPlugin = {
  // Réponse servie depuis le cache : la page sait qu'elle peut être ancienne.
  cachedResponseWillBeUsed: async ({ cachedResponse }) => {
    if (!cachedResponse) return cachedResponse
    const headers = new Headers(cachedResponse.headers)
    headers.set('x-sw-cache', 'hit')
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      statusText: cachedResponse.statusText,
      headers,
    })
  },
  // Revalidation terminée : on transmet le corps frais à la page.
  cacheDidUpdate: async ({ request, newResponse }) => {
    const body: unknown = await newResponse
      .clone()
      .json()
      .catch(() => undefined)
    if (body !== undefined) await notifyClients({ type: 'presence:revalidated', url: request.url, body })
  },
  // Revalidation refusée (session expirée…) : la page doit le savoir.
  fetchDidSucceed: async ({ request, response }) => {
    if (!response.ok) await notifyClients({ type: 'presence:revalidation-failed', url: request.url, status: response.status })
    return response
  },
}

registerRoute(
  ({ url, request }) =>
    request.method === 'GET' && url.origin !== self.location.origin && url.pathname.startsWith('/rest/v1/'),
  new StaleWhileRevalidate({
    cacheName: DATA_CACHE,
    matchOptions: { ignoreVary: true },
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 24 * 60 * 60 }),
      revalidation,
    ],
  }),
)

// ---- Messages de la page ----
self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | null
  if (data?.type === 'SKIP_WAITING') void self.skipWaiting()
  if (data?.type === 'CLEAR_DATA_CACHE') event.waitUntil(caches.delete(DATA_CACHE))
})
