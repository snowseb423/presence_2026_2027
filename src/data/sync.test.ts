import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PresenceDB } from './db.ts'
import { loadAppData, seedDefaults } from './mirror.ts'
import type { Op } from './ops.ts'
import { PULL_QUERIES, type RealtimeHandlers, type Remote, SyncError, type TableSnapshot } from './remote.ts'
import { toOverride } from './rows.ts'
import { SyncEngine } from './sync.ts'
import type { MirrorTable } from './db.ts'

type Json = Record<string, unknown>

/** Serveur en mémoire reproduisant la résolution last-write-wins du SQL. */
class FakeServer implements Remote {
  overrides = new Map<string, Json>()
  tombstones = new Map<string, string>()
  online = true
  sent: Op[] = []
  failures: SyncError[] = []
  handlers: RealtimeHandlers | null = null
  /** Appelé pendant l'envoi d'une opération (simule une saisie concurrente). */
  duringExecute: (() => Promise<void>) | null = null

  async execute(op: Op) {
    if (!this.online) throw new SyncError('Failed to fetch', 'network')
    const failure = this.failures.shift()
    if (failure) throw failure
    this.sent.push(op)
    if (this.duringExecute) {
      const hook = this.duringExecute
      this.duringExecute = null
      await hook()
    }
    if (op.kind === 'attendance.set') {
      const current = this.overrides.get(op.date)
      const tomb = this.tombstones.get(op.date)
      const olderThanTomb = tomb && Date.parse(tomb) > Date.parse(op.at)
      const olderThanRow = current && Date.parse(String(current.updated_at)) > Date.parse(op.at)
      if (!olderThanTomb && !olderThanRow) {
        this.overrides.set(op.date, {
          date: op.date,
          status_code: op.statusCode,
          hours_override: op.hoursOverride,
          comment: op.comment,
          updated_by: 'user-a',
          updated_at: op.at,
        })
      }
      const row = this.overrides.get(op.date)
      return { table: 'overrides' as const, key: op.date, row: row ? toOverride(row) : null }
    }
    if (op.kind === 'attendance.clear') {
      const current = this.overrides.get(op.date)
      if (current && Date.parse(String(current.updated_at)) <= Date.parse(op.at)) this.overrides.delete(op.date)
      this.tombstones.set(op.date, op.at)
      const row = this.overrides.get(op.date)
      return { table: 'overrides' as const, key: op.date, row: row ? toOverride(row) : null }
    }
    throw new SyncError('non géré par le faux serveur', 'rejected', 400)
  }

  tableUrl(table: MirrorTable): string {
    return `https://x.supabase.co/rest/v1/${PULL_QUERIES[table]}`
  }

  async fetchTable(table: MirrorTable): Promise<TableSnapshot> {
    if (!this.online) throw new SyncError('Failed to fetch', 'network')
    const rows = table === 'overrides' ? [...this.overrides.values()] : []
    return { rows, fromCache: false, url: this.tableUrl(table) }
  }

  subscribe(handlers: RealtimeHandlers) {
    this.handlers = handlers
    return () => {
      this.handlers = null
    }
  }
}

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 8, minutes)).toISOString()
const setOp = (date: string, statusCode: string, minutes: number): Op => ({
  kind: 'attendance.set',
  date,
  statusCode,
  hoursOverride: null,
  comment: null,
  at: at(minutes),
})

let db: PresenceDB
let server: FakeServer
let engine: SyncEngine
let counter = 0

beforeEach(async () => {
  db = new PresenceDB(`test-${++counter}`)
  await seedDefaults(db)
  server = new FakeServer()
  engine = new SyncEngine(db, server, { retryDelays: [60_000] })
})

afterEach(async () => {
  engine.stop()
  await engine.whenIdle()
  db.close()
})

async function effectiveStatus(date: string) {
  return (await loadAppData(db)).overrides.get(date)
}

describe('file d’écritures hors ligne', () => {
  it('affiche la saisie immédiatement puis la rejoue dans l’ordre au retour du réseau', async () => {
    server.online = false
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    await engine.commit(setOp('2026-10-13', 'absence_non_payee', 2))
    await engine.commit(setOp('2026-10-14', 'demi_journee', 3))

    expect(await effectiveStatus('2026-10-12')).toMatchObject({ statusCode: 'conge_non_paye', pending: true })
    expect(await db.outbox.count()).toBe(3)
    expect(engine.getState().online).toBe(false)

    server.online = true
    await engine.flush()

    expect(server.sent.map((op) => (op.kind === 'attendance.set' ? op.date : ''))).toEqual([
      '2026-10-12', '2026-10-13', '2026-10-14',
    ])
    expect(await db.outbox.count()).toBe(0)
    expect(await effectiveStatus('2026-10-13')).toMatchObject({ statusCode: 'absence_non_payee', updatedBy: 'user-a' })
    expect((await effectiveStatus('2026-10-13'))?.pending).toBeUndefined()
    expect(engine.getState().online).toBe(true)
  })

  it('fusionne plusieurs saisies du même jour en une seule opération', async () => {
    server.online = false
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    await engine.commit(setOp('2026-10-12', 'absence_non_payee', 2))
    await engine.commit({ kind: 'attendance.clear', date: '2026-10-12', at: at(3) })
    expect(await db.outbox.count()).toBe(1)
    server.online = true
    await engine.flush()
    expect(server.sent).toEqual([{ kind: 'attendance.clear', date: '2026-10-12', at: at(3) }])
    expect(await effectiveStatus('2026-10-12')).toBeUndefined()
  })

  it('ne perd pas une saisie faite pendant l’envoi de la précédente', async () => {
    server.duringExecute = () => engine.commit(setOp('2026-10-12', 'absence_non_payee', 2))
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    await engine.flush()
    expect(server.sent.map((op) => (op.kind === 'attendance.set' ? op.statusCode : ''))).toEqual([
      'conge_non_paye', 'absence_non_payee',
    ])
    expect(await db.outbox.count()).toBe(0)
    expect(await effectiveStatus('2026-10-12')).toMatchObject({ statusCode: 'absence_non_payee' })
  })

  it('abandonne une opération refusée et continue avec les suivantes', async () => {
    const rejected: string[] = []
    engine = new SyncEngine(db, server, { onRejected: (r) => rejected.push(r.message) })
    server.failures.push(new SyncError('violates foreign key constraint', 'rejected', 409))
    server.online = false
    await engine.commit(setOp('2026-10-12', 'inconnu', 1))
    await engine.commit(setOp('2026-10-13', 'conge_non_paye', 2))
    server.online = true
    await engine.flush()
    expect(rejected).toEqual(['violates foreign key constraint'])
    expect(await db.outbox.count()).toBe(0)
    expect(await effectiveStatus('2026-10-12')).toBeUndefined()
    expect(await effectiveStatus('2026-10-13')).toMatchObject({ statusCode: 'conge_non_paye' })
  })

  it('garde la file intacte après une erreur réseau', async () => {
    server.online = false
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    await engine.flush()
    expect(await db.outbox.count()).toBe(1)
    const [entry] = await db.outbox.toArray()
    expect(entry?.attempts).toBeGreaterThanOrEqual(1)
    expect(entry?.lastError).toBe('Failed to fetch')
    server.online = true
    await engine.flush()
    expect(await db.outbox.count()).toBe(0)
  })

  it('renouvelle la session une fois sur une erreur d’authentification', async () => {
    let refreshed = 0
    engine = new SyncEngine(db, server, { refreshAuth: async () => ++refreshed > 0 })
    server.failures.push(new SyncError('JWT expired', 'auth', 401))
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    await engine.flush()
    expect(refreshed).toBe(1)
    expect(await db.outbox.count()).toBe(0)
  })
})

describe('conflits', () => {
  it('une saisie hors ligne plus ancienne ne remplace pas celle de l’autre téléphone', async () => {
    server.online = false
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    // Pendant ce temps, l'autre téléphone saisit « absence » plus tard.
    server.overrides.set('2026-10-12', {
      date: '2026-10-12', status_code: 'absence_non_payee', hours_override: null,
      comment: 'imprévu', updated_by: 'user-b', updated_at: at(5),
    })
    server.online = true
    await engine.flush()
    expect(await effectiveStatus('2026-10-12')).toMatchObject({ statusCode: 'absence_non_payee', updatedBy: 'user-b' })
  })

  it('une remise au défaut plus récente l’emporte sur une saisie rejouée', async () => {
    server.online = false
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    server.tombstones.set('2026-10-12', at(5))
    server.online = true
    await engine.flush()
    expect(await effectiveStatus('2026-10-12')).toBeUndefined()
  })

  it('l’affichage local ignore une opération plus ancienne que la donnée reçue', async () => {
    server.online = false
    await engine.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    await db.overrides.put({
      date: '2026-10-12', statusCode: 'absence_non_payee', hoursOverride: null,
      comment: null, updatedAt: at(5), updatedBy: 'user-b',
    })
    expect(await effectiveStatus('2026-10-12')).toMatchObject({ statusCode: 'absence_non_payee' })
  })
})

describe('lecture et temps réel', () => {
  it('applique les changements temps réel de l’autre téléphone', async () => {
    await engine.start()
    server.handlers!.onChange('overrides', 'put', {
      date: '2026-10-20', status_code: 'demi_journee', hours_override: null,
      comment: null, updated_by: 'user-b', updated_at: at(9),
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await effectiveStatus('2026-10-20')).toMatchObject({ statusCode: 'demi_journee' })
    server.handlers!.onChange('overrides', 'delete', { date: '2026-10-20' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await effectiveStatus('2026-10-20')).toBeUndefined()
  })

  it('un instantané servi par le cache n’écrase pas des données plus fraîches', async () => {
    await engine.pullAll() // première synchronisation
    await db.overrides.put({
      date: '2026-10-21', statusCode: 'conge_paye', hoursOverride: null,
      comment: null, updatedAt: at(9), updatedBy: 'user-b',
    })
    server.fetchTable = async (table) => ({ rows: [], fromCache: true, url: `https://x.supabase.co/rest/v1/${PULL_QUERIES[table]}` })
    await engine.pullAll()
    expect(await effectiveStatus('2026-10-21')).toMatchObject({ statusCode: 'conge_paye' })

    // Une réponse fraîche non demandée par ce moteur (autre onglet) est ignorée.
    await engine.applyRevalidated('https://x.supabase.co/rest/v1/holidays?select=*&other=1', [])
    // Le service worker transmet ensuite la réponse fraîche demandée.
    await engine.applyRevalidated(`https://x.supabase.co/rest/v1/${PULL_QUERIES.overrides}`, [])
    expect(await effectiveStatus('2026-10-21')).toBeUndefined()
  })

  it('applique un corps frais du service worker arrivé avant la réponse en cache', async () => {
    await engine.pullAll() // première synchronisation, par le réseau
    const fresh = {
      date: '2026-10-23', status_code: 'conge_paye', hours_override: null,
      comment: null, updated_by: 'user-b', updated_at: at(9),
    }
    server.fetchTable = async (table) => {
      const url = server.tableUrl(table)
      // Le service worker a déjà revalidé et transmis la version fraîche…
      if (table === 'overrides') await engine.applyRevalidated(url, [fresh])
      // … avant que la page ne lise la réponse en cache, plus ancienne.
      return { rows: [], fromCache: true, url }
    }
    await engine.pullAll()
    expect(await effectiveStatus('2026-10-23')).toMatchObject({ statusCode: 'conge_paye' })
  })

  it('au premier lancement, une réponse en cache ne remplace pas un corps frais déjà reçu', async () => {
    const fresh = {
      date: '2026-10-26', status_code: 'absence_non_payee', hours_override: null,
      comment: null, updated_by: 'user-b', updated_at: at(9),
    }
    const stale = { ...fresh, status_code: 'demi_journee', updated_at: at(1) }
    server.fetchTable = async (table) => {
      const url = server.tableUrl(table)
      if (table === 'overrides') await engine.applyRevalidated(url, [fresh])
      return { rows: table === 'overrides' ? [stale] : [], fromCache: true, url }
    }
    await engine.pullAll()
    expect(await effectiveStatus('2026-10-26')).toMatchObject({ statusCode: 'absence_non_payee' })
  })

  it('rejoue les événements reçus pendant la lecture par-dessus l’instantané', async () => {
    await engine.start()
    const slowFetch = server.fetchTable.bind(server)
    server.fetchTable = async (table) => {
      const snapshot = await slowFetch(table)
      if (table === 'overrides') {
        // Un événement arrive pendant la requête, après la prise d'instantané.
        server.handlers!.onChange('overrides', 'put', {
          date: '2026-10-22', status_code: 'absence_non_payee', hours_override: null,
          comment: null, updated_by: 'user-b', updated_at: at(9),
        })
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return snapshot
    }
    await engine.pullAll()
    expect(await effectiveStatus('2026-10-22')).toMatchObject({ statusCode: 'absence_non_payee' })
  })
})

describe('mode local', () => {
  it('applique les écritures directement, sans file', async () => {
    const local = new SyncEngine(db, null)
    await local.commit(setOp('2026-10-12', 'conge_non_paye', 1))
    expect(await db.outbox.count()).toBe(0)
    expect(await effectiveStatus('2026-10-12')).toMatchObject({ statusCode: 'conge_non_paye' })
    await local.commit({ kind: 'settings.patch', patch: { hourlyRate: 180 }, at: at(2) })
    expect((await loadAppData(db)).settings.hourlyRate).toBe(180)
    expect(local.getState().mode).toBe('local')
  })
})
