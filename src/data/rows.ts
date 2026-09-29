// Conversion entre les lignes Supabase (snake_case) et les types du domaine.
import { DEFAULT_SETTINGS } from '../domain/defaults.ts'
import { sanitizeContributions } from '../domain/payslip.ts'
import type { Holiday, Member, Override, Settings, StatusRule } from '../domain/types.ts'
import type { MirrorTable } from './db.ts'
import type { SettingsPatch } from './ops.ts'

type Json = Record<string, unknown>

const text = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value))
const nullableText = (value: unknown): string | null => (value == null || value === '' ? null : String(value))
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0))
const nullableNum = (value: unknown): number | null => (value == null ? null : num(value))

/** Tableau d'entiers : JSON ([1,2]) ou littéral Postgres (« {1,2} »). */
function parseIntArray(value: unknown, fallback: number[]): number[] {
  const items = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.replace(/[{}\s]/g, '').split(',').filter(Boolean)
      : null
  if (!items) return fallback
  const numbers = items.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  return numbers.length ? [...new Set(numbers)].sort((a, b) => a - b) : fallback
}

/** Tables Supabase miroitées en local. */
export const REMOTE_TABLES: Record<MirrorTable, string> = {
  settings: 'settings',
  statusRules: 'status_rules',
  holidays: 'holidays',
  overrides: 'attendance_overrides',
  members: 'allowed_emails',
}

/** Colonne Supabase de chaque réglage modifiable depuis l'app. */
export const SETTINGS_COLUMNS: { [K in keyof Required<SettingsPatch>]: string } = {
  hourlyRate: 'hourly_rate',
  hoursPerDay: 'hours_per_day',
  transportPerDay: 'transport_per_day',
  workDays: 'work_days',
  periodStart: 'period_start',
  periodEnd: 'period_end',
  employeeName: 'employee_name',
  employeeFullName: 'employee_full_name',
  employeeAddress: 'employee_address',
  employeeNic: 'employee_nic',
  employeeJobTitle: 'employee_job_title',
  employeeHireDate: 'employee_hire_date',
  employeePaymentMethod: 'employee_payment_method',
  employeeBankAccount: 'employee_bank_account',
  employerName: 'employer_name',
  employerAddress: 'employer_address',
  employerPhone: 'employer_phone',
  employerEmail: 'employer_email',
  employerRegistration: 'employer_registration',
  payDay: 'pay_day',
  roundContributions: 'round_contributions',
  contributions: 'contributions',
}

/** Colonne absente (migration de la fiche de paie pas encore appliquée) : valeur par défaut. */
function or<T>(value: unknown, fallback: T, read: (value: unknown) => T): T {
  return value === undefined ? fallback : read(value)
}

export function toSettings(row: Json): Settings {
  return {
    hourlyRate: num(row.hourly_rate),
    hoursPerDay: num(row.hours_per_day),
    transportPerDay: num(row.transport_per_day),
    workDays: parseIntArray(row.work_days, [1, 2, 3, 4, 5]),
    periodStart: text(row.period_start),
    periodEnd: text(row.period_end),
    employeeName: text(row.employee_name),
    employeeFullName: text(row.employee_full_name),
    employeeAddress: text(row.employee_address),
    employeeNic: text(row.employee_nic),
    employeeJobTitle: or(row.employee_job_title, DEFAULT_SETTINGS.employeeJobTitle, text),
    employeeHireDate: nullableText(row.employee_hire_date),
    employeePaymentMethod: text(row.employee_payment_method),
    employeeBankAccount: text(row.employee_bank_account),
    employerName: text(row.employer_name),
    employerAddress: text(row.employer_address),
    employerPhone: text(row.employer_phone),
    employerEmail: text(row.employer_email),
    employerRegistration: text(row.employer_registration),
    payDay: or(row.pay_day, DEFAULT_SETTINGS.payDay, num),
    roundContributions: or(row.round_contributions, DEFAULT_SETTINGS.roundContributions, Boolean),
    contributions: sanitizeContributions(row.contributions) ?? DEFAULT_SETTINGS.contributions,
    updatedAt: nullableText(row.updated_at),
    updatedBy: nullableText(row.updated_by),
  }
}

export function toStatusRule(row: Json): StatusRule {
  return {
    code: text(row.code),
    label: text(row.label),
    paidHours: num(row.paid_hours),
    transportPaid: Boolean(row.transport_paid),
    colorToken: text(row.color_token),
    sortOrder: num(row.sort_order),
    updatedAt: nullableText(row.updated_at),
  }
}

export function toHoliday(row: Json): Holiday {
  return {
    date: text(row.date),
    name: text(row.name),
    note: nullableText(row.note),
    updatedAt: nullableText(row.updated_at),
    updatedBy: nullableText(row.updated_by),
  }
}

export function toOverride(row: Json): Override {
  return {
    date: text(row.date),
    statusCode: text(row.status_code),
    hoursOverride: nullableNum(row.hours_override),
    comment: nullableText(row.comment),
    updatedAt: text(row.updated_at),
    updatedBy: nullableText(row.updated_by),
  }
}

export function toMember(row: Json): Member {
  return {
    email: text(row.email),
    displayName: nullableText(row.display_name),
    userId: nullableText(row.user_id),
  }
}

export const ROW_MAPPERS: { [T in MirrorTable]: (row: Json) => unknown } = {
  settings: (row) => ({ id: 1, ...toSettings(row) }),
  statusRules: toStatusRule,
  holidays: toHoliday,
  overrides: toOverride,
  members: toMember,
}

/** Clé primaire d'une ligne Supabase, pour appliquer un DELETE temps réel. */
export function remoteKey(table: MirrorTable, row: Json): string | number {
  switch (table) {
    case 'settings':
      return 1
    case 'statusRules':
      return text(row.code)
    case 'holidays':
    case 'overrides':
      return text(row.date)
    case 'members':
      return text(row.email)
  }
}
