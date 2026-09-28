// Écran de connexion face au faux Supabase : le bouton Google suit le
// réglage du projet, puis aller-retour complet par la page Google.
import { expect, test } from '@playwright/test'
import { FakeSupabase, freezeClock } from './fake-supabase.ts'

let server: FakeSupabase

test.beforeEach(async ({ context, page }) => {
  server = new FakeSupabase()
  await server.install(context)
  await freezeClock(page)
})

const GOOGLE = { name: 'Continuer avec Google' }

test('le bouton Google n’apparaît que si Google est activé dans Supabase', async ({ page }) => {
  const settingsRead = page.waitForResponse(
    (response) => response.url().endsWith('/auth/v1/settings') && response.request().method() === 'GET',
  )
  await page.goto('/')
  await settingsRead
  await expect(page.getByRole('button', { name: 'Recevoir le lien de connexion' })).toBeVisible()
  await expect(page.getByRole('button', GOOGLE)).toHaveCount(0)

  // Fournisseur activé entre-temps : revérifié au retour du réseau.
  server.google = true
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByRole('button', GOOGLE)).toBeVisible()
})

test('« Continuer avec Google » : aller-retour par Google, l’app s’ouvre connectée', async ({ page }) => {
  server.google = true
  await page.goto('/')
  await page.getByRole('button', GOOGLE).click()

  await expect(page.getByText('Aujourd’hui · Marie')).toBeVisible()
  expect(server.authorizeUrls.map((url) => Object.fromEntries(url.searchParams))).toEqual([
    { provider: 'google', redirect_to: 'http://127.0.0.1:4174/', prompt: 'select_account' },
  ])
  // Jetons retirés de l'URL, session conservée sur l'appareil.
  expect(page.url()).not.toContain('access_token')
  expect(await page.evaluate(() => localStorage.getItem('presence-auth'))).toContain('e2e-refresh')
})

test('compte Google non autorisé : retour à l’écran de connexion avec un message clair', async ({ page }) => {
  server.google = true
  server.googleEmail = 'carol@example.com'
  await page.goto('/')
  await page.getByRole('button', GOOGLE).click()

  await expect(page.getByRole('alert')).toHaveText(/Ce compte Google n’est pas autorisé/)
  await expect(page.getByRole('button', GOOGLE)).toBeVisible()
  expect(page.url()).toBe('http://127.0.0.1:4174/')
})
