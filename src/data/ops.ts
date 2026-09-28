// Opérations d'écriture mises en file (outbox) puis rejouées vers Supabase.
// Module pur : l'état affiché = miroir serveur + opérations en attente.
import type { Holiday, IsoDate, Override, Settings, StatusCode, StatusRule } from '../domain/types.ts'

export type SettingsPatch = Partial<
  Pick<Settings, 'hourlyRate' | 'hoursPerDay' | 'transportPerDay' | 'workDays' | 'periodStart' | 'periodEnd' | 'employeeName'>
>

export type StatusRulePatch = Partial<Pick<StatusRule, 'paidHours' | 'transportPaid'>>

/** `at` : heure de la saisie sur le téléphone, qui départage les conflits. */
export type Op =
  | {
      kind: 'attendance.set'
      date: IsoDate
      statusCode: StatusCode
      hoursOverride: number | null
      comment: string | null
      at: string
    }
  | { kind: 'attendance.clear'; date: IsoDate; at: string }
  | { kind: 'holiday.upsert'; date: IsoDate; name: string; note: string | null; at: string }
  | { kind: 'holiday.delete'; date: IsoDate; at: string }
  | { kind: 'settings.patch'; patch: SettingsPatch; at: string }
  | { kind: 'statusRule.patch'; code: StatusCode; patch: StatusRulePatch; at: string }

/** Une saisie encore dans la file, pas encore confirmée par le serveur. */
export type EffectiveOverride = Override & { pending?: boolean }

export interface MirrorState {
  settings: Settings
  rules: Map<StatusCode, StatusRule>
  holidays: Map<IsoDate, Holiday>
  overrides: Map<IsoDate, EffectiveOverride>
}

export function opKey(op: Op): string {
  switch (op.kind) {
    case 'attendance.set':
    case 'attendance.clear':
      return `attendance:${op.date}`
    case 'holiday.upsert':
    case 'holiday.delete':
      return `holiday:${op.date}`
    case 'settings.patch':
      return 'settings'
    case 'statusRule.patch':
      return `status:${op.code}`
  }
}

/**
 * Fusionne une nouvelle opération avec celle, de même clé, encore en file.
 * Saisies et fériés portent un état complet : la plus récente suffit.
 * Réglages et statuts sont des modifications par champ : on les cumule.
 */
export function mergeOps(previous: Op, next: Op): Op {
  if (previous.kind === 'settings.patch' && next.kind === 'settings.patch') {
    return { ...next, patch: { ...previous.patch, ...next.patch } }
  }
  if (previous.kind === 'statusRule.patch' && next.kind === 'statusRule.patch') {
    return { ...next, patch: { ...previous.patch, ...next.patch } }
  }
  return next
}

/** `a` est-il strictement plus récent que `b` ? (formats ISO variés tolérés) */
export function isNewer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false
  if (!b) return true
  return Date.parse(a) > Date.parse(b)
}

/**
 * Applique les opérations en attente, dans l'ordre, par-dessus le miroir.
 * Comme sur le serveur, une opération plus ancienne que la donnée connue
 * est sans effet (last-write-wins).
 */
export function applyOps(mirror: MirrorState, ops: readonly Op[]): MirrorState {
  if (ops.length === 0) return mirror
  let settings = mirror.settings
  const rules = new Map(mirror.rules)
  const holidays = new Map(mirror.holidays)
  const overrides = new Map(mirror.overrides)

  for (const op of ops) {
    switch (op.kind) {
      case 'attendance.set': {
        if (isNewer(overrides.get(op.date)?.updatedAt, op.at)) break
        overrides.set(op.date, {
          date: op.date,
          statusCode: op.statusCode,
          hoursOverride: op.hoursOverride,
          comment: op.comment,
          updatedAt: op.at,
          updatedBy: null,
          pending: true,
        })
        break
      }
      case 'attendance.clear': {
        if (isNewer(overrides.get(op.date)?.updatedAt, op.at)) break
        overrides.delete(op.date)
        break
      }
      case 'holiday.upsert': {
        if (isNewer(holidays.get(op.date)?.updatedAt, op.at)) break
        holidays.set(op.date, { date: op.date, name: op.name, note: op.note, updatedAt: op.at, updatedBy: null })
        break
      }
      case 'holiday.delete': {
        if (isNewer(holidays.get(op.date)?.updatedAt, op.at)) break
        holidays.delete(op.date)
        break
      }
      case 'settings.patch':
        settings = { ...settings, ...op.patch, updatedAt: op.at }
        break
      case 'statusRule.patch': {
        const rule = rules.get(op.code)
        if (rule) rules.set(op.code, { ...rule, ...op.patch, updatedAt: op.at })
        break
      }
    }
  }
  return { settings, rules, holidays, overrides }
}
