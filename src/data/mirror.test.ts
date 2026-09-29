import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTRIBUTIONS, DEFAULT_SETTINGS } from '../domain/defaults.ts'
import { PresenceDB } from './db.ts'
import { loadAppData } from './mirror.ts'

describe('lecture du miroir local', () => {
  it('complète les réglages enregistrés par une version précédente de l’app', async () => {
    const db = new PresenceDB(`mirror-${Math.random()}`)
    // Réglages d'avant le bonus : champs absents, cotisations sans « due sur le bonus ».
    const { endOfYearBonus: _bonus, endOfYearBonusBase: _base, contributions, ...previous } = DEFAULT_SETTINGS
    await db.settings.put({ id: 1, ...previous, contributions: contributions.map(({ onBonus: _onBonus, ...rest }) => rest) } as never)

    const data = await loadAppData(db)
    expect(data.settings).toMatchObject({ endOfYearBonus: true, endOfYearBonusBase: 'gross' })
    expect(data.settings.contributions).toEqual(DEFAULT_CONTRIBUTIONS)
    db.close()
  })
})
