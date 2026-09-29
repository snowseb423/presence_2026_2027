import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTRIBUTIONS } from '../domain/defaults.ts'
import { settingsColumns } from './remote.ts'
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

  it('complète la fiche de paie par défaut si le serveur n’a pas encore la migration', () => {
    const settings = toSettings({ hourly_rate: 170 })
    expect(settings).toMatchObject({
      employeeFullName: '',
      employeeJobTitle: 'Employée de maison',
      employeeHireDate: null,
      employerName: '',
      payDay: 0,
      roundContributions: true,
      endOfYearBonus: true,
      endOfYearBonusBase: 'gross',
    })
    expect(settings.contributions).toEqual(DEFAULT_CONTRIBUTIONS)
  })

  it('lit les réglages du bonus de fin d’année', () => {
    expect(toSettings({ end_of_year_bonus: false, end_of_year_bonus_base: 'basic' })).toMatchObject({
      endOfYearBonus: false,
      endOfYearBonusBase: 'basic',
    })
    expect(settingsColumns({ endOfYearBonus: true, endOfYearBonusBase: 'gross' })).toEqual({
      end_of_year_bonus: true,
      end_of_year_bonus_base: 'gross',
    })
  })

  it('lit la fiche de paie et les cotisations', () => {
    const settings = toSettings({
      employee_full_name: 'Marie-Claire Dupont',
      employee_job_title: '',
      employee_hire_date: '2026-09-01',
      pay_day: 5,
      round_contributions: false,
      contributions: [{ id: 'csg', label: 'CSG', brackets: [{ upTo: null, employeeRate: 1.5, employerRate: 3 }] }],
    })
    expect(settings).toMatchObject({
      employeeFullName: 'Marie-Claire Dupont',
      employeeJobTitle: '',
      employeeHireDate: '2026-09-01',
      payDay: 5,
      roundContributions: false,
    })
    expect(settings.contributions.map((c) => [c.id, c.enabled, c.base, c.brackets.length])).toEqual([['csg', true, 'basic', 1]])
  })

  it('écrit chaque réglage modifié dans sa colonne, et seulement lui', () => {
    expect(settingsColumns({ employeeNic: 'A0101801234567', payDay: 5, roundContributions: false, contributions: [] })).toEqual({
      employee_nic: 'A0101801234567',
      pay_day: 5,
      round_contributions: false,
      contributions: [],
    })
    expect(settingsColumns({ employeeHireDate: null })).toEqual({ employee_hire_date: null })
  })
})
