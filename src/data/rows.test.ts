import { describe, expect, it } from 'vitest'
import { toOverride, toSettings } from './rows.ts'

describe('conversion des lignes Supabase', () => {
  it('lit les jours de prestation en tableau JSON ou en littéral Postgres', () => {
    expect(toSettings({ work_days: [5, 1, 3] }).workDays).toEqual([1, 3, 5])
    expect(toSettings({ work_days: '{1,2,3,4,5,6}' }).workDays).toEqual([1, 2, 3, 4, 5, 6])
    expect(toSettings({ work_days: null }).workDays).toEqual([1, 2, 3, 4, 5])
  })

  it('convertit les montants numériques renvoyés en texte', () => {
    expect(toSettings({ hourly_rate: '170.00', transport_per_day: 48 })).toMatchObject({ hourlyRate: 170, transportPerDay: 48 })
    expect(toOverride({ date: '2026-10-12', status_code: 'travaille', hours_override: '2.50', updated_at: 'x' }).hoursOverride).toBe(2.5)
    expect(toOverride({ date: '2026-10-12', status_code: 'travaille', hours_override: null, updated_at: 'x' }).hoursOverride).toBeNull()
  })
})
