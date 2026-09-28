// Mode synchronisé AVEC service worker : lectures en stale-while-revalidate.
// La réponse en cache s'affiche d'abord, la version fraîche arrive ensuite
// par message du service worker, sans jamais faire régresser l'écran.
import { expect, test } from '@playwright/test'
import { FakeSupabase, freezeClock } from './fake-supabase.ts'

test('les lectures passent par le cache puis se mettent à jour après revalidation', async ({ context, page }) => {
  const server = new FakeSupabase()
  await server.install(context)
  await server.signIn(context)
  await freezeClock(page)

  await page.goto('/')
  await expect(page.getByText('Aujourd’hui · Marie')).toBeVisible()
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true)

  // Première lecture contrôlée par le service worker : elle remplit son cache.
  await page.reload()
  await expect(page.getByText('Aujourd’hui · Marie')).toBeVisible()
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open('presence-data')).keys()).length), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(5)

  // L'autre téléphone change le nom : la réponse en cache est ancienne,
  // la revalidation doit apporter la nouvelle valeur.
  server.settings = { ...server.settings, employee_name: 'Marie-Claire' }
  await page.reload()
  await expect(page.getByText('Aujourd’hui · Marie-Claire')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: /Synchronisation : En ligne/ })).toBeVisible({ timeout: 15_000 })
})
