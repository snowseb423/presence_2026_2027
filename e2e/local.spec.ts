// Mode local (sans Supabase), service worker actif.
import { type Page, expect, test } from '@playwright/test'
import { freezeClock } from './fake-supabase.ts'

test.beforeEach(async ({ page }) => {
  await freezeClock(page)
})

async function layoutAudit(page: Page) {
  return page.evaluate(() => {
    const small: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary, [role="switch"]')) {
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height || el.closest('dialog:not([open])') || el.classList.contains('sr-only')) continue
      if (el.getAttribute('aria-hidden') === 'true') continue
      // Tolérance d'arrondi des sous-pixels.
      if (rect.width < 43.5 || rect.height < 43.5) {
        small.push(`${el.tagName} « ${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim()} » ${rect.width}×${rect.height}`)
      }
    }
    const root = document.documentElement
    return { overflow: root.scrollWidth > root.clientWidth, small }
  })
}

test('375 px : pas de défilement horizontal, cibles tactiles d’au moins 44 px', async ({ page }) => {
  const screens: [string, string][] = [
    ['/', 'Changer le statut'],
    ['/mois', 'Détail du mois'],
    ['/budget', 'Total de la période'],
    ['/reglages', 'Employée et tarifs'],
  ]
  for (const [path, marker] of screens) {
    await page.goto(path)
    await expect(page.getByText(marker, { exact: true })).toBeVisible()
    const audit = await layoutAudit(page)
    expect(audit.overflow, `défilement horizontal sur ${path}`).toBe(false)
    expect(audit.small, `petites cibles sur ${path}`).toEqual([])
  }
})

test('« Congé non payé » pour aujourd’hui en un tap dès l’ouverture', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('day-status')).toHaveText('Travaillé')
  await expect(page.getByTestId('day-amount')).toHaveText('558')

  await page.getByRole('button', { name: /Congé non payé/ }).first().click()

  await expect(page.getByTestId('day-status')).toHaveText('Congé non payé')
  await expect(page.getByTestId('day-amount')).toHaveText('0')
})

test('« Congé non payé » pour un autre jour du mois en trois taps', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'Mois' }).click()
  await page.getByRole('button', { name: /mercredi 21 octobre 2026/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Congé non payé/ }).click()

  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click()
  await expect(page.getByRole('button', { name: /mercredi 21 octobre 2026.*Congé non payé/ })).toBeVisible()
})

test('budget : Rs 187 488 pour 336 jours, puis octobre à Rs 10 602 avec 3 congés non payés', async ({ page }) => {
  await page.goto('/budget')
  const hero = page.locator('.band').first()
  await expect(hero).toContainText('187 488')
  await expect(hero).toContainText('336 jours prestés')

  await page.getByRole('link', { name: 'Mois' }).click()
  for (const day of ['lundi 12', 'mardi 13', 'mercredi 14']) {
    await page.getByRole('button', { name: new RegExp(`${day} octobre 2026`) }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Congé non payé/ }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click()
  }

  await page.getByRole('link', { name: 'Budget' }).click()
  const october = page.locator('details', { has: page.getByRole('heading', { name: 'Octobre 2026' }) })
  await expect(october).toContainText('Rs 10 602')
  await expect(october).toContainText('−Rs 1 674')
  await expect(october).toContainText('Budget de référence')
  await expect(october).toContainText('Rs 12 276')
})

test('mode avion : l’app s’ouvre depuis le cache, affiche le mois et accepte une saisie', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByText('Changer le statut')).toBeVisible()
  // Service worker installé et aux commandes de la page.
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 15_000 }).toBe(true)

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Changer le statut')).toBeVisible()

  await page.getByRole('link', { name: 'Mois' }).click()
  await expect(page.getByRole('heading', { name: 'Octobre 2026' })).toBeVisible()
  await page.getByRole('button', { name: /jeudi 15 octobre 2026/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Absence non payée/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Fermer' }).click()
  await expect(page.getByRole('button', { name: /jeudi 15 octobre 2026.*Absence non payée/ })).toBeVisible()

  // Toujours hors ligne : la saisie est conservée après rechargement.
  await page.reload()
  await expect(page.getByRole('button', { name: /jeudi 15 octobre 2026.*Absence non payée/ })).toBeVisible()
  await context.setOffline(false)
})
