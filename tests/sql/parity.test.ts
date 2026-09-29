// Les valeurs par défaut embarquées dans l'app (premier lancement hors
// ligne, mode local) doivent rester identiques à celles de la base.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, DEFAULT_STATUS_RULES } from '../../src/domain/defaults.ts'

const root = join(import.meta.dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('parité seed SQL ↔ src/domain/defaults.ts', async () => {
  const db = new PGlite()
  await db.exec(read('tests/sql/supabase-stub.sql'))
  for (const file of readdirSync(join(root, 'supabase/migrations')).sort()) {
    await db.exec(read(join('supabase/migrations', file)))
  }
  await db.exec(read('supabase/seed.sql'))

  it('réglages', async () => {
    const { rows } = await db.query<Record<string, unknown>>(`
      select hourly_rate::float8 as "hourlyRate", hours_per_day::float8 as "hoursPerDay",
             transport_per_day::float8 as "transportPerDay", work_days::int[] as "workDays",
             period_start::text as "periodStart", period_end::text as "periodEnd",
             employee_name as "employeeName", employee_full_name as "employeeFullName",
             employee_address as "employeeAddress", employee_nic as "employeeNic",
             employee_job_title as "employeeJobTitle", employee_hire_date::text as "employeeHireDate",
             employee_payment_method as "employeePaymentMethod", employee_bank_account as "employeeBankAccount",
             employer_name as "employerName", employer_address as "employerAddress",
             employer_phone as "employerPhone", employer_email as "employerEmail",
             employer_registration as "employerRegistration", pay_day::int as "payDay",
             round_contributions as "roundContributions", contributions
      from public.settings`)
    const { updatedAt: _a, updatedBy: _b, ...expected } = DEFAULT_SETTINGS
    expect(rows).toEqual([expected])
  })

  it('statuts', async () => {
    const { rows } = await db.query(`
      select code, label, paid_hours::float8 as "paidHours", transport_paid as "transportPaid",
             color_token as "colorToken", sort_order as "sortOrder"
      from public.status_rules order by sort_order`)
    expect(rows).toEqual(DEFAULT_STATUS_RULES.map(({ updatedAt: _u, ...rule }) => rule))
  })

  it('jours fériés', async () => {
    const { rows } = await db.query(`select date::text as date, name, note from public.holidays order by date`)
    expect(rows).toEqual(DEFAULT_HOLIDAYS.map(({ date, name, note }) => ({ date, name, note })))
  })
})
