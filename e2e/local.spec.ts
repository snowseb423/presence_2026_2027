// Mode local (sans Supabase), service worker actif.
import { readFileSync } from 'node:fs'
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

test('réglages saisis dès l’ouverture : rien n’est effacé par l’initialisation', async ({ page }) => {
  await page.goto('/reglages')
  await page.getByLabel('Nom de l’employée').fill('Marie')
  await page.getByLabel('Taux horaire').fill('180')
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0)

  await page.getByRole('link', { name: 'Aujourd’hui' }).click()
  await expect(page.getByText('Aujourd’hui · Marie')).toBeVisible()
  // 3 h × Rs 180 + Rs 48 de transport.
  await expect(page.getByTestId('day-amount')).toHaveText('588')
})

test('fiche de paie : identités et cotisations dans Réglages, net du mois, PDF téléchargé', async ({ page }) => {
  await page.goto('/reglages')
  const employee = page.getByRole('form', { name: 'Employée' })
  await employee.getByLabel('Nom complet').fill('Marie-Claire Dupont')
  await employee.getByLabel('N° de carte d’identité (NIC)').fill('d0101801234567')
  await employee.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(employee.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0)
  const employer = page.getByRole('form', { name: 'Employeur' })
  await employer.getByLabel('Nom complet').fill('Famille Lefèvre')
  await employer.getByRole('button', { name: 'Enregistrer' }).click()
  await expect(employer.getByRole('button', { name: 'Enregistrer' })).toHaveCount(0)

  // Part salariale de la NSF passée de 1 % à 2 %.
  await page.getByRole('button', { name: 'NSF : modifier' }).click()
  await page.getByRole('dialog').getByLabel('Part salariale, tranche 1').fill('2')
  await page.getByRole('dialog').getByRole('button', { name: 'Enregistrer' }).click()
  await expect(page.getByRole('button', { name: 'NSF : modifier' })).toContainText('2 % salariée')

  await page.getByRole('link', { name: 'Budget' }).click()
  const october = page.locator('details', { has: page.getByRole('heading', { name: 'Octobre 2026' }) })
  // Brut Rs 12 276 ; salaire de base Rs 11 220 : CSG 1,5 % (Rs 168) + NSF 2 % (Rs 224).
  await expect(october).toContainText('NET À PAYER')
  await expect(october).toContainText('Rs 11 884')
  await expect(october).toContainText('CSG 1,5 %, NSF 2 %')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    october.getByRole('button', { name: 'Fiche de paie octobre 2026 en PDF' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('fiche-de-paie-2026-10.pdf')
  const pdf = readFileSync(await download.path()).toString('latin1')
  expect(pdf.startsWith('%PDF-1.4')).toBe(true)
  expect(pdf).toContain('(Marie-Claire Dupont) Tj')
  expect(pdf).toContain('(NIC : D0101801234567) Tj')
  expect(pdf).toContain('(Famille Lefèvre) Tj')
})

test('bonus de fin d’année : sur la fiche de décembre, désactivable dans Réglages', async ({ page }) => {
  await page.goto('/budget')
  const december = page.locator('details', { has: page.getByRole('heading', { name: 'Décembre 2026' }) })
  await december.locator('summary').click()
  // Brut de septembre à décembre 2026 : Rs 47 430, soit un bonus de Rs 3 952,50 ;
  // CSG à part sur le bonus : net Rs 12 276 + 3 952,50 − (168 + 112 + 54).
  await expect(december).toContainText('Bonus de fin d’année')
  await expect(december).toContainText('+Rs 3 952,50')
  await expect(december).toContainText('Rs 15 894,50')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    december.getByRole('button', { name: 'Fiche de paie décembre 2026 en PDF' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('fiche-de-paie-2026-12.pdf')
  const pdf = new TextDecoder('windows-1252').decode(readFileSync(await download.path()))
  expect(pdf).toContain('(Bonus de fin d’année) Tj')
  expect(pdf).toContain('(CSG sur le bonus) Tj')

  const nav = page.getByRole('navigation', { name: 'Navigation principale' })
  await nav.getByRole('link', { name: 'Réglages' }).click()
  await page.getByRole('switch', { name: 'Bonus de fin d’année sur la fiche de décembre' }).click()
  await nav.getByRole('link', { name: 'Budget' }).click()
  await december.locator('summary').click()
  await expect(december).toContainText('NET À PAYER')
  await expect(december).not.toContainText('Bonus de fin d’année')
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
