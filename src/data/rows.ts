// Conversion entre les lignes Supabase (snake_case) et les types du domaine.
import type { Holiday, Member, Override, Settings, StatusRule } from '../domain/types.ts'
import type { MirrorTable } from './db.ts'

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

export function toSettings(row: Json): Settings {
  return {
    hourlyRate: num(row.hourly_rate),
    hoursPerDay: num(row.hours_per_day),
    transportPerDay: num(row.transport_per_day),
    workDays: parseIntArray(row.work_days, [1, 2, 3, 4, 5]),
    periodStart: text(row.period_start),
    periodEnd: text(row.period_end),
    employeeName: text(row.employee_name),
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
