// Accès à Supabase : exécution des opérations de la file, lecture des tables
// et abonnement temps réel. Le moteur de synchronisation ne dépend que de
// l'interface `Remote`, ce qui permet de le tester sans réseau.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MirrorTable } from './db.ts'
import type { MirrorUpdate } from './mirror.ts'
import type { Op, SettingsPatch } from './ops.ts'
import { REMOTE_TABLES, toHoliday, toOverride, toSettings, toStatusRule } from './rows.ts'

type Json = Record<string, unknown>

export type SyncErrorKind =
  /** Pas de réseau : on réessaiera. */
  | 'network'
  /** Erreur passagère du serveur (5xx, 429…) : on réessaiera. */
  | 'server'
  /** Session expirée ou absente. */
  | 'auth'
  /** Refus définitif (droits, contrainte) : l'opération est abandonnée. */
  | 'rejected'

export class SyncError extends Error {
  readonly kind: SyncErrorKind
  readonly status: number

  constructor(message: string, kind: SyncErrorKind, status = 0) {
    super(message)
    this.name = 'SyncError'
    this.kind = kind
    this.status = status
  }
}

export function classifyStatus(status: number): SyncErrorKind {
  if (!status) return 'network'
  if (status === 401) return 'auth'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'server'
  return 'rejected'
}

export function asSyncError(error: unknown): SyncError {
  if (error instanceof SyncError) return error
  return new SyncError(error instanceof Error ? error.message : String(error), 'network')
}

export type RealtimeStatus = 'connecting' | 'live' | 'error' | 'off'

export interface RealtimeHandlers {
  onChange(table: MirrorTable, type: 'put' | 'delete', row: Json): void
  onStatus(status: RealtimeStatus): void
}

export interface TableSnapshot {
  rows: Json[]
  /** Réponse servie par le cache du service worker (potentiellement ancienne). */
  fromCache: boolean
  url: string
}

export interface Remote {
  execute(op: Op): Promise<MirrorUpdate>
  fetchTable(table: MirrorTable): Promise<TableSnapshot>
  subscribe(handlers: RealtimeHandlers): () => void
}

/** Requêtes REST de lecture complète de chaque table (données petites). */
export const PULL_QUERIES: Record<MirrorTable, string> = {
  settings: 'settings?select=*&id=eq.1',
  statusRules: 'status_rules?select=*&order=sort_order.asc',
  holidays: 'holidays?select=*&order=date.asc',
  overrides: 'attendance_overrides?select=*&order=date.asc',
  members: 'allowed_emails?select=email,display_name,user_id&order=email.asc',
}

/** Retrouve la table miroir d'une URL REST (messages du service worker). */
export function tableForUrl(url: string): MirrorTable | null {
  let path: string
  try {
    path = new URL(url).pathname
  } catch {
    return null
  }
  const remote = path.split('/rest/v1/')[1]
  const entry = Object.entries(REMOTE_TABLES).find(([, name]) => name === remote)
  return entry ? (entry[0] as MirrorTable) : null
}

function settingsColumns(patch: SettingsPatch): Json {
  const columns: Json = {}
  if (patch.hourlyRate !== undefined) columns.hourly_rate = patch.hourlyRate
  if (patch.hoursPerDay !== undefined) columns.hours_per_day = patch.hoursPerDay
  if (patch.transportPerDay !== undefined) columns.transport_per_day = patch.transportPerDay
  if (patch.workDays !== undefined) columns.work_days = patch.workDays
  if (patch.periodStart !== undefined) columns.period_start = patch.periodStart
  if (patch.periodEnd !== undefined) columns.period_end = patch.periodEnd
  if (patch.employeeName !== undefined) columns.employee_name = patch.employeeName
  return columns
}

interface Result {
  data: unknown
  error: { message: string } | null
  status: number
}

function check<T extends Result>(result: T): T {
  if (result.error) {
    throw new SyncError(result.error.message || `HTTP ${result.status}`, classifyStatus(result.status), result.status)
  }
  return result
}

export function createSupabaseRemote(client: SupabaseClient, config: { url: string; key: string }): Remote {
  async function currentHoliday(date: string): Promise<MirrorUpdate> {
    const { data } = check(await client.from('holidays').select('*').eq('date', date).maybeSingle())
    return { table: 'holidays', key: date, row: data ? toHoliday(data as Json) : null }
  }

  return {
    async execute(op) {
      switch (op.kind) {
        case 'attendance.set': {
          const { data } = check(
            await client.rpc('set_attendance', {
              p_date: op.date,
              p_status_code: op.statusCode,
              p_hours_override: op.hoursOverride,
              p_comment: op.comment,
              p_updated_at: op.at,
            }),
          )
          return { table: 'overrides', key: op.date, row: data ? toOverride(data as Json) : null }
        }
        case 'attendance.clear': {
          const { data } = check(await client.rpc('clear_attendance', { p_date: op.date, p_updated_at: op.at }))
          return { table: 'overrides', key: op.date, row: data ? toOverride(data as Json) : null }
        }
        case 'holiday.upsert': {
          const { data } = check(
            await client
              .from('holidays')
              .upsert({ date: op.date, name: op.name, note: op.note, updated_at: op.at }, { onConflict: 'date' })
              .select(),
          )
          const row = (data as Json[] | null)?.[0]
          // Aucune ligne renvoyée : une version plus récente existe déjà.
          return row ? { table: 'holidays', key: op.date, row: toHoliday(row) } : currentHoliday(op.date)
        }
        case 'holiday.delete': {
          check(await client.from('holidays').delete().eq('date', op.date).lte('updated_at', op.at))
          return currentHoliday(op.date)
        }
        case 'settings.patch': {
          const { data } = check(
            await client
              .from('settings')
              .update({ ...settingsColumns(op.patch), updated_at: op.at })
              .eq('id', 1)
              .select()
              .single(),
          )
          return { table: 'settings', row: toSettings(data as Json) }
        }
        case 'statusRule.patch': {
          const columns: Json = { updated_at: op.at }
          if (op.patch.paidHours !== undefined) columns.paid_hours = op.patch.paidHours
          if (op.patch.transportPaid !== undefined) columns.transport_paid = op.patch.transportPaid
          const { data } = check(await client.from('status_rules').update(columns).eq('code', op.code).select().single())
          return { table: 'statusRules', row: toStatusRule(data as Json) }
        }
      }
    },

    async fetchTable(table) {
      const { data } = await client.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new SyncError('Session absente', 'auth', 401)
      const url = `${config.url}/rest/v1/${PULL_QUERIES[table]}`
      let response: Response
      try {
        response = await fetch(url, {
          headers: { apikey: config.key, Authorization: `Bearer ${token}`, Accept: 'application/json' },
        })
      } catch (error) {
        throw asSyncError(error)
      }
      if (!response.ok) {
        throw new SyncError((await response.text()) || `HTTP ${response.status}`, classifyStatus(response.status), response.status)
      }
      return {
        rows: (await response.json()) as Json[],
        fromCache: response.headers.get('x-sw-cache') === 'hit',
        url,
      }
    },

    subscribe(handlers) {
      const channel = client.channel('presence-sync')
      for (const [table, name] of Object.entries(REMOTE_TABLES) as [MirrorTable, string][]) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table: name }, (payload) => {
          if (payload.eventType === 'DELETE') handlers.onChange(table, 'delete', payload.old as Json)
          else handlers.onChange(table, 'put', payload.new as Json)
        })
      }
      handlers.onStatus('connecting')
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') handlers.onStatus('live')
        else if (status === 'CLOSED') handlers.onStatus('off')
        else handlers.onStatus('error')
      })
      return () => {
        void client.removeChannel(channel)
      }
    },
  }
}
