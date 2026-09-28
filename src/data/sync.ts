// Moteur de synchronisation :
// - les écritures partent dans la file (outbox) puis sont rejouées dans
//   l'ordre dès que le réseau le permet ;
// - les tables sont relues entièrement (elles sont petites) au démarrage,
//   à la reconnexion temps réel et au retour au premier plan ;
// - les changements temps réel de l'autre téléphone sont appliqués au fil
//   de l'eau.
import { MIRROR_TABLES, type MirrorTable, type OutboxEntry, type PresenceDB } from './db.ts'
import { applyMirrorUpdate, applyOpLocally, enqueue, localKey, rowUpdatedAt, tableOf } from './mirror.ts'
import { type Op, isNewer } from './ops.ts'
import { type RealtimeStatus, type Remote, SyncError, asSyncError, classifyStatus, tableForUrl } from './remote.ts'
import { ROW_MAPPERS, remoteKey } from './rows.ts'

type Json = Record<string, unknown>

export interface SyncState {
  mode: 'local' | 'remote'
  /** Le serveur est joignable (d'après le navigateur et le dernier échange). */
  online: boolean
  realtime: RealtimeStatus
  syncing: boolean
  lastSyncAt: string | null
  lastError: string | null
  /** La session doit être renouvelée (reconnexion nécessaire). */
  authRequired: boolean
}

export interface RejectedOp {
  op: Op
  message: string
  at: string
}

export interface SyncOptions {
  /** Tente de renouveler la session ; `true` si elle est de nouveau valide. */
  refreshAuth?: () => Promise<boolean>
  /** Une opération a été refusée définitivement par le serveur. */
  onRejected?: (rejected: RejectedOp) => void
  /** Délais de nouvelle tentative (ms) après une erreur réseau. */
  retryDelays?: number[]
}

interface RecentEvent {
  receivedAt: number
  table: MirrorTable
  type: 'put' | 'delete'
  row: Json
}

const EVENT_MEMORY_MS = 120_000
const SNAPSHOT_MARGIN_MS = 2_000
const REFRESH_ON_FOCUS_MS = 60_000

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

export class SyncEngine {
  private state: SyncState
  private listeners = new Set<() => void>()
  private flushing: Promise<void> | null = null
  private flushRequested = false
  private pulling: Promise<void> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryIndex = 0
  private recentEvents: RecentEvent[] = []
  private pendingRevalidation = new Map<string, number>()
  private unsubscribeRealtime: (() => void) | null = null
  private detachWindow: (() => void) | null = null
  private started = false
  private readonly db: PresenceDB
  private readonly remote: Remote | null
  private readonly options: SyncOptions

  constructor(db: PresenceDB, remote: Remote | null, options: SyncOptions = {}) {
    this.db = db
    this.remote = remote
    this.options = options
    this.state = {
      mode: remote ? 'remote' : 'local',
      online: browserOnline(),
      realtime: 'off',
      syncing: false,
      lastSyncAt: null,
      lastError: null,
      authRequired: false,
    }
  }

  // ---- état observable (useSyncExternalStore) ----

  getState = (): SyncState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private setState(patch: Partial<SyncState>): void {
    const next = { ...this.state, ...patch }
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof SyncState] === value)) return
    this.state = next
    for (const listener of this.listeners) listener()
  }

  // ---- cycle de vie ----

  async start(): Promise<void> {
    if (this.started || !this.remote) return
    this.started = true
    const lastSync = await this.db.meta.get('lastPullAt')
    this.setState({ lastSyncAt: typeof lastSync?.value === 'string' ? lastSync.value : null })

    if (typeof window !== 'undefined') {
      const onOnline = () => {
        this.setState({ online: true })
        this.retryIndex = 0
        void this.sync()
      }
      const onOffline = () => this.setState({ online: false })
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return
        const last = this.state.lastSyncAt ? Date.parse(this.state.lastSyncAt) : 0
        if (Date.now() - last > REFRESH_ON_FOCUS_MS || this.state.realtime !== 'live') void this.sync()
        else void this.flush()
      }
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      document.addEventListener('visibilitychange', onVisible)
      this.detachWindow = () => {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }

    this.unsubscribeRealtime = this.remote.subscribe({
      onChange: (table, type, row) => void this.applyRealtime(table, type, row),
      onStatus: (status) => {
        this.setState({ realtime: status })
        // (Re)connexion : rattraper ce qui a pu être manqué, vider la file.
        if (status === 'live') {
          this.markReachable()
          void this.sync()
        }
      },
    })
    await this.sync()
  }

  stop(): void {
    this.started = false
    this.unsubscribeRealtime?.()
    this.unsubscribeRealtime = null
    this.detachWindow?.()
    this.detachWindow = null
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
    this.setState({ realtime: 'off', syncing: false })
  }

  /** Relit les tables et vide la file. */
  async sync(): Promise<void> {
    await Promise.all([this.flush(), this.pullAll()])
  }

  /** Le navigateur se sait hors ligne (mode avion) : inutile d'essayer. */
  private offlineForSure(): boolean {
    if (browserOnline()) return false
    this.setState({ online: false })
    return true
  }

  // ---- écritures ----

  /** Enregistre une écriture : immédiate en mode local, via la file sinon. */
  async commit(op: Op): Promise<void> {
    if (!this.remote) {
      await applyOpLocally(this.db, op)
      return
    }
    await enqueue(this.db, op)
    void this.flush()
  }

  /**
   * Rejoue la file dans l'ordre. Une seule exécution à la fois ; un appel
   * pendant une exécution relance un passage à la fin de celle-ci, et la
   * promesse renvoyée couvre ce passage.
   */
  flush(): Promise<void> {
    if (!this.remote || this.offlineForSure()) return Promise.resolve()
    this.flushRequested = true
    this.flushing ??= this.withLock(async () => {
      while (this.flushRequested) {
        this.flushRequested = false
        await this.drain()
      }
    }).finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  /** Attend la fin des envois et lectures en cours. */
  async whenIdle(): Promise<void> {
    await Promise.all([this.flushing, this.pulling])
  }

  /** Verrou inter-onglets : un seul onglet vide la file à la fois. */
  private async withLock(task: () => Promise<void>): Promise<void> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
    if (!locks) return task()
    await locks.request('presence-outbox', task)
  }

  private async drain(): Promise<void> {
    const remote = this.remote!
    let refreshedAuth = false
    for (;;) {
      const entry: OutboxEntry | undefined = await this.db.outbox.orderBy('id').first()
      if (!entry?.id) break
      this.setState({ syncing: true })
      try {
        const update = await remote.execute(entry.op)
        await this.db.transaction(
          'rw',
          [this.db.outbox, this.db.overrides, this.db.holidays, this.db.settings, this.db.statusRules],
          async () => {
            // Modifiée pendant l'envoi ? On la garde pour l'envoyer à nouveau.
            const current = await this.db.outbox.get(entry.id!)
            if (current && current.revision === entry.revision) await this.db.outbox.delete(entry.id!)
            await applyMirrorUpdate(this.db, update)
          },
        )
        this.markReachable()
      } catch (raw) {
        const error = asSyncError(raw)
        await this.db.outbox.update(entry.id, { attempts: entry.attempts + 1, lastError: error.message })
        if (error.kind === 'rejected') {
          await this.reject(entry, error)
          continue
        }
        if (error.kind === 'auth' && !refreshedAuth && (await this.options.refreshAuth?.())) {
          refreshedAuth = true
          continue
        }
        this.handleError(error)
        break
      }
    }
    this.setState({ syncing: false })
  }

  private async reject(entry: OutboxEntry, error: SyncError): Promise<void> {
    const rejected: RejectedOp = { op: entry.op, message: error.message, at: new Date().toISOString() }
    await this.db.transaction('rw', [this.db.outbox, this.db.meta], async () => {
      await this.db.outbox.delete(entry.id!)
      const previous = await this.db.meta.get('rejectedOps')
      const list = Array.isArray(previous?.value) ? (previous.value as RejectedOp[]) : []
      await this.db.meta.put({ key: 'rejectedOps', value: [rejected, ...list].slice(0, 20) })
    })
    this.options.onRejected?.(rejected)
    // L'affichage optimiste disparaît : on s'assure que le miroir est à jour.
    void this.pullAll()
  }

  // ---- lectures ----

  pullAll(): Promise<void> {
    if (!this.remote || this.offlineForSure()) return Promise.resolve()
    this.pulling ??= this.pullTables().finally(() => {
      this.pulling = null
    })
    return this.pulling
  }

  private async pullTables(): Promise<void> {
    const remote = this.remote!
    const requestedAt = Date.now()
    try {
      const snapshots = await Promise.all(MIRROR_TABLES.map(async (table) => [table, await remote.fetchTable(table)] as const))
      const neverSynced = !(await this.db.meta.get('lastPullAt'))
      for (const [table, snapshot] of snapshots) {
        if (snapshot.fromCache) {
          // Réponse du cache du service worker : il enverra la version fraîche.
          this.pendingRevalidation.set(snapshot.url, requestedAt)
          if (!neverSynced) continue
        }
        await this.applySnapshot(table, snapshot.rows, requestedAt)
      }
      // Des réponses venues du cache ne prouvent pas que le serveur répond.
      if (snapshots.every(([, snapshot]) => !snapshot.fromCache)) {
        await this.markSynced()
        this.markReachable()
      }
    } catch (raw) {
      const error = asSyncError(raw)
      if (error.kind === 'auth' && (await this.options.refreshAuth?.())) return
      this.handleError(error)
    }
  }

  /** Corps frais transmis par le service worker après revalidation. */
  async applyRevalidated(url: string, rows: unknown): Promise<void> {
    const table = tableForUrl(url)
    const requestedAt = this.pendingRevalidation.get(url)
    // Seulement les lectures de ce moteur (pas celles d'un autre onglet).
    if (!table || requestedAt === undefined || !Array.isArray(rows)) return
    this.pendingRevalidation.delete(url)
    await this.applySnapshot(table, rows as Json[], requestedAt)
    if (this.pendingRevalidation.size === 0) await this.markSynced()
    this.markReachable()
  }

  /** La revalidation par le service worker a échoué (ex. session expirée). */
  async revalidationFailed(url: string, status: number): Promise<void> {
    if (!this.pendingRevalidation.delete(url)) return
    const error = new SyncError(`HTTP ${status}`, classifyStatus(status), status)
    if (error.kind === 'auth' && (await this.options.refreshAuth?.())) {
      void this.pullAll()
      return
    }
    this.handleError(error)
  }

  /**
   * Remplace une table par l'instantané du serveur, puis rejoue par-dessus
   * les événements temps réel reçus pendant la requête (plus récents que
   * l'instantané).
   */
  private async applySnapshot(table: MirrorTable, rows: Json[], requestedAt: number): Promise<void> {
    const store = tableOf(this.db, table)
    const mapper = ROW_MAPPERS[table]
    await this.db.transaction('rw', store, async () => {
      await store.clear()
      await store.bulkPut(rows.map((row) => mapper(row) as never))
      for (const event of this.recentEvents) {
        if (event.table === table && event.receivedAt >= requestedAt - SNAPSHOT_MARGIN_MS) {
          await this.applyEvent(event, true)
        }
      }
    })
  }

  private async applyEvent(event: RecentEvent, onlyIfNewer: boolean): Promise<void> {
    const store = tableOf(this.db, event.table)
    if (event.type === 'delete') {
      await store.delete(remoteKey(event.table, event.row))
      return
    }
    const row = ROW_MAPPERS[event.table](event.row) as Parameters<typeof localKey>[1]
    if (onlyIfNewer) {
      const existing = await store.get(localKey(event.table, row))
      if (isNewer(rowUpdatedAt(existing), rowUpdatedAt(row))) return
    }
    await store.put(row as never)
  }

  private async applyRealtime(table: MirrorTable, type: 'put' | 'delete', row: Json): Promise<void> {
    const now = Date.now()
    const event: RecentEvent = { receivedAt: now, table, type, row }
    this.recentEvents = [...this.recentEvents.filter((e) => now - e.receivedAt < EVENT_MEMORY_MS), event]
    // Les événements arrivent dans l'ordre des validations : toujours appliqués.
    await this.applyEvent(event, false)
  }

  // ---- état réseau ----

  private async markSynced(): Promise<void> {
    const at = new Date().toISOString()
    await this.db.meta.put({ key: 'lastPullAt', value: at })
    this.setState({ lastSyncAt: at })
  }

  private markReachable(): void {
    this.retryIndex = 0
    this.setState({ online: true, lastError: null, authRequired: false })
  }

  private handleError(error: SyncError): void {
    if (error.kind === 'auth') {
      this.setState({ authRequired: true, lastError: 'Session expirée : reconnectez-vous.' })
      return
    }
    this.setState({
      online: error.kind === 'network' ? false : this.state.online,
      lastError: error.kind === 'network' ? null : error.message,
    })
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (!this.started || this.retryTimer) return
    const delays = this.options.retryDelays ?? [2_000, 5_000, 15_000, 30_000, 60_000]
    const delay = delays[Math.min(this.retryIndex, delays.length - 1)]!
    this.retryIndex += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.sync()
    }, delay)
  }

  /** Déconnexion : efface toutes les données locales. */
  async clearLocalData(): Promise<void> {
    this.stop()
    await this.db.transaction(
      'rw',
      [this.db.settings, this.db.statusRules, this.db.holidays, this.db.overrides, this.db.members, this.db.outbox, this.db.meta],
      async () => {
        await Promise.all([
          this.db.settings.clear(),
          this.db.statusRules.clear(),
          this.db.holidays.clear(),
          this.db.overrides.clear(),
          this.db.members.clear(),
          this.db.outbox.clear(),
          this.db.meta.clear(),
        ])
      },
    )
  }
}
