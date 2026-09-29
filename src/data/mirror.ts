// Lecture et écriture du miroir local (Dexie). L'état affiché combine le
// miroir serveur et les opérations encore dans la file.
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, DEFAULT_STATUS_RULES } from '../domain/defaults.ts'
import { sanitizeContributions } from '../domain/payslip.ts'
import type { Holiday, IsoDate, Member, Override, Settings, StatusRule } from '../domain/types.ts'
import type { MirrorTable, OutboxEntry, PresenceDB, SettingsRow } from './db.ts'
import { type MirrorState, type Op, applyOps, isNewer, mergeOps, opKey } from './ops.ts'

/** Résultat d'une opération côté serveur, à reporter dans le miroir. */
export type MirrorUpdate =
  | { table: 'overrides'; key: IsoDate; row: Override | null }
  | { table: 'holidays'; key: IsoDate; row: Holiday | null }
  | { table: 'settings'; row: Settings }
  | { table: 'statusRules'; row: StatusRule }

export interface AppData extends MirrorState {
  members: Member[]
  outbox: OutboxEntry[]
  /** Des données (serveur ou valeurs par défaut) sont disponibles localement. */
  hydrated: boolean
}

/**
 * Réglages enregistrés avant l'ajout de champs (mode local, miroir pas encore
 * relu) : complétés par les valeurs par défaut, cotisations relues comme
 * celles du serveur.
 */
function stripId({ id: _id, ...settings }: SettingsRow): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    contributions: sanitizeContributions(settings.contributions) ?? DEFAULT_SETTINGS.contributions,
  }
}

export async function loadAppData(db: PresenceDB): Promise<AppData> {
  const [settingsRow, rules, holidays, overrides, members, outbox] = await Promise.all([
    db.settings.get(1),
    db.statusRules.toArray(),
    db.holidays.toArray(),
    db.overrides.toArray(),
    db.members.toArray(),
    db.outbox.orderBy('id').toArray(),
  ])
  const mirror: MirrorState = {
    settings: settingsRow ? stripId(settingsRow) : DEFAULT_SETTINGS,
    rules: new Map((rules.length ? rules : DEFAULT_STATUS_RULES).map((rule) => [rule.code, rule])),
    holidays: new Map(holidays.map((holiday) => [holiday.date, holiday])),
    overrides: new Map(overrides.map((override) => [override.date, override])),
  }
  return {
    ...applyOps(
      mirror,
      outbox.map((entry) => entry.op),
    ),
    members: members.sort((a, b) => a.email.localeCompare(b.email)),
    outbox,
    hydrated: Boolean(settingsRow),
  }
}

/** Premier lancement : valeurs par défaut, remplacées au premier pull. */
export async function seedDefaults(db: PresenceDB): Promise<boolean> {
  return db.transaction('rw', [db.settings, db.statusRules, db.holidays, db.meta], async () => {
    if (await db.settings.get(1)) return false
    await db.settings.put({ id: 1, ...DEFAULT_SETTINGS })
    await db.statusRules.bulkPut(DEFAULT_STATUS_RULES)
    await db.holidays.bulkPut(DEFAULT_HOLIDAYS)
    await db.meta.put({ key: 'seededAt', value: new Date().toISOString() })
    return true
  })
}

export async function applyMirrorUpdate(db: PresenceDB, update: MirrorUpdate): Promise<void> {
  switch (update.table) {
    case 'overrides':
      if (update.row) await db.overrides.put(update.row)
      else await db.overrides.delete(update.key)
      return
    case 'holidays':
      if (update.row) await db.holidays.put(update.row)
      else await db.holidays.delete(update.key)
      return
    case 'settings':
      await db.settings.put({ id: 1, ...update.row })
      return
    case 'statusRules':
      await db.statusRules.put(update.row)
      return
  }
}

/** Met une opération en file, fusionnée avec celle de même clé si elle existe. */
export async function enqueue(db: PresenceDB, op: Op): Promise<void> {
  const key = opKey(op)
  await db.transaction('rw', db.outbox, async () => {
    const existing = await db.outbox.where('key').equals(key).first()
    if (existing?.id != null) {
      await db.outbox.update(existing.id, {
        op: mergeOps(existing.op, op),
        revision: existing.revision + 1,
        lastError: null,
      })
    } else {
      await db.outbox.add({ key, op, revision: 0, createdAt: new Date().toISOString(), attempts: 0, lastError: null })
    }
  })
}

/** Mode local : l'opération est appliquée directement au miroir. */
export async function applyOpLocally(db: PresenceDB, op: Op): Promise<void> {
  await db.transaction('rw', [db.settings, db.statusRules, db.holidays, db.overrides], async () => {
    switch (op.kind) {
      case 'attendance.set': {
        if (isNewer((await db.overrides.get(op.date))?.updatedAt, op.at)) return
        await db.overrides.put({
          date: op.date,
          statusCode: op.statusCode,
          hoursOverride: op.hoursOverride,
          comment: op.comment,
          updatedAt: op.at,
          updatedBy: null,
        })
        return
      }
      case 'attendance.clear':
        await db.overrides.delete(op.date)
        return
      case 'holiday.upsert':
        await db.holidays.put({ date: op.date, name: op.name, note: op.note, updatedAt: op.at, updatedBy: null })
        return
      case 'holiday.delete':
        await db.holidays.delete(op.date)
        return
      case 'settings.patch': {
        const current = (await db.settings.get(1)) ?? { id: 1 as const, ...DEFAULT_SETTINGS }
        await db.settings.put({ ...current, ...op.patch, updatedAt: op.at })
        return
      }
      case 'statusRule.patch': {
        const rule = await db.statusRules.get(op.code)
        if (rule) await db.statusRules.put({ ...rule, ...op.patch, updatedAt: op.at })
        return
      }
    }
  })
}

type MirrorRow = SettingsRow | StatusRule | Holiday | Override | Member

export function tableOf(db: PresenceDB, table: MirrorTable) {
  return db.table<MirrorRow, string | number>(table)
}

/** Clé primaire d'une ligne du miroir. */
export function localKey(table: MirrorTable, row: MirrorRow): string | number {
  switch (table) {
    case 'settings':
      return 1
    case 'statusRules':
      return (row as StatusRule).code
    case 'holidays':
    case 'overrides':
      return (row as Holiday | Override).date
    case 'members':
      return (row as Member).email
  }
}

/** Date de dernière modification d'une ligne, si la table en porte une. */
export function rowUpdatedAt(row: MirrorRow | undefined): string | null {
  return row && 'updatedAt' in row ? row.updatedAt : null
}
