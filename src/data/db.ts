// Base IndexedDB locale : miroir des tables Supabase + file d'écritures.
// L'interface lit uniquement ici, ce qui la rend utilisable hors ligne.
import Dexie, { type EntityTable } from 'dexie'
import type { Holiday, Member, Override, Settings, StatusRule } from '../domain/types.ts'
import type { Op } from './ops.ts'

export interface SettingsRow extends Settings {
  id: 1
}

export interface OutboxEntry {
  id?: number
  /** Clé de fusion : une seule opération en attente par journée, férié… */
  key: string
  op: Op
  /** Incrémenté à chaque fusion : une opération remplacée pendant son envoi n'est pas supprimée. */
  revision: number
  createdAt: string
  attempts: number
  lastError: string | null
}

export interface MetaRow {
  key: string
  value: unknown
}

export class PresenceDB extends Dexie {
  settings!: EntityTable<SettingsRow, 'id'>
  statusRules!: EntityTable<StatusRule, 'code'>
  holidays!: EntityTable<Holiday, 'date'>
  overrides!: EntityTable<Override, 'date'>
  members!: EntityTable<Member, 'email'>
  outbox!: EntityTable<OutboxEntry, 'id'>
  meta!: EntityTable<MetaRow, 'key'>

  constructor(name = 'presence') {
    super(name)
    this.version(1).stores({
      settings: 'id',
      statusRules: 'code',
      holidays: 'date',
      overrides: 'date',
      members: 'email',
      outbox: '++id, key',
      meta: 'key',
    })
  }
}

export const MIRROR_TABLES = ['settings', 'statusRules', 'holidays', 'overrides', 'members'] as const
export type MirrorTable = (typeof MIRROR_TABLES)[number]
