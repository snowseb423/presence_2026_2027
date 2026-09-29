// Mode synchronisé, face à un faux Supabase (REST, RPC, Realtime).
import { expect, test } from '@playwright/test'
import { FakeSupabase, OTHER, freezeClock } from './fake-supabase.ts'

let server: FakeSupabase

test.beforeEach(async ({ context, page }) => {
  server = new FakeSupabase()
  await server.install(context)
  await server.signIn(context)
  await freezeClock(page)
})

const pill = (state: RegExp) => ({ name: new RegExp(`Synchronisation : ${state.source}`) })

test('affiche les données du serveur et l’état « en ligne »', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Aujourd’hui · Marie')).toBeVisible()
  await expect(page.getByRole('button', pill(/En ligne, tout est synchronisé/))).toBeVisible({ timeout: 15_000 })
})

test('la saisie faite sur l’autre téléphone apparaît en moins de 5 secondes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('day-status')).toHaveText('Travaillé')
  await expect(page.getByRole('button', pill(/En ligne, tout est synchronisé/))).toBeVisible({ timeout: 15_000 })
  expect(server.channels).toBeGreaterThan(0)

  const started = Date.now()
  // Seulement par le canal temps réel : prouve que c'est lui qui met l'écran à jour.
  server.pushOverride(
    {
      date: '2026-10-12',
      status_code: 'absence_non_payee',
      hours_override: null,
      comment: 'imprévu',
      updated_by: OTHER.id,
      updated_at: '2026-10-12T04:30:00.000Z',
    },
    { persist: false },
  )
  await expect(page.getByTestId('day-status')).toHaveText('Absence non payée', { timeout: 5_000 })
  expect(Date.now() - started).toBeLessThan(5_000)
  await expect(page.getByText(/Modifié par Bob/)).toBeVisible()
})

test('mode avion : les saisies attendent dans la file puis partent dans l’ordre', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.getByRole('button', pill(/En ligne, tout est synchronisé/))).toBeVisible({ timeout: 15_000 })

  await context.setOffline(true)
  await page.getByRole('button', { name: /Congé non payé/ }).first().click()
  await page.getByRole('button', { name: /mardi 13 octobre 2026/ }).click()
  await page.getByRole('button', { name: /Demi-journée/ }).first().click()

  await expect(page.getByRole('button', pill(/Hors ligne, 2 modifications en attente/))).toBeVisible()
  await expect(page.getByTestId('day-status')).toHaveText('Demi-journée')
  expect(server.rpcCalls).toHaveLength(0)

  await context.setOffline(false)
  await expect
    .poll(() => server.rpcCalls.map(({ fn, args }) => `${fn} ${args.p_date} ${args.p_status_code}`), { timeout: 10_000 })
    .toEqual(['set_attendance 2026-10-12 conge_non_paye', 'set_attendance 2026-10-13 demi_journee'])
  await expect(page.getByRole('button', pill(/En ligne/))).toBeVisible({ timeout: 20_000 })
})

test('les informations de la fiche de paie partent vers Supabase, colonne par colonne', async ({ page }) => {
  await page.goto('/reglages')
  await expect(page.getByRole('button', pill(/En ligne, tout est synchronisé/))).toBeVisible({ timeout: 15_000 })

  const employer = page.getByRole('form', { name: 'Employeur' })
  await employer.getByLabel('Nom complet').fill('Famille Lefèvre')
  await employer.getByLabel('N° d’employeur (ERN)').fill('e1234567')
  await employer.getByRole('button', { name: 'Enregistrer' }).click()
  await page.getByRole('switch', { name: 'Arrondir les cotisations à la roupie' }).click()

  await expect
    .poll(() => server.settings, { timeout: 10_000 })
    .toMatchObject({ employer_name: 'Famille Lefèvre', employer_registration: 'E1234567', round_contributions: false })
  const columns = new Set(server.settingsPatches.flatMap((patch) => Object.keys(patch)))
  expect([...columns].sort()).toEqual(['employer_name', 'employer_registration', 'round_contributions', 'updated_at'])
  await expect(page.getByRole('button', pill(/En ligne, tout est synchronisé/))).toBeVisible({ timeout: 10_000 })
})
