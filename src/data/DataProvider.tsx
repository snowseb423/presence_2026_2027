import { useLiveQuery } from 'dexie-react-hooks'
import { type ReactNode, createContext, use, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { CalcContext } from '../domain/types.ts'
import { env } from '../env.ts'
import { PresenceDB } from './db.ts'
import { type AppData, loadAppData, seedDefaults } from './mirror.ts'
import { createSupabaseRemote } from './remote.ts'
import { supabase } from './supabase.ts'
import { type RejectedOp, SyncEngine, type SyncState } from './sync.ts'

/** Base locale unique de l'application. */
export const db = new PresenceDB()

interface DataContextValue {
  engine: SyncEngine
  db: PresenceDB
}

const DataContext = createContext<DataContextValue | null>(null)

async function refreshAuth(): Promise<boolean> {
  if (!supabase) return false
  const { data, error } = await supabase.auth.refreshSession()
  return !error && Boolean(data.session)
}

export function DataProvider({
  sessionKey,
  onRejected,
  children,
}: {
  /** Change à chaque changement d'utilisateur : recrée le moteur. */
  sessionKey: string
  onRejected?: (rejected: RejectedOp) => void
  children: ReactNode
}) {
  const onRejectedRef = useRef(onRejected)
  useEffect(() => {
    onRejectedRef.current = onRejected
  })

  const engine = useMemo(() => {
    void sessionKey
    const remote = supabase ? createSupabaseRemote(supabase, { url: env.supabaseUrl, key: env.supabaseKey }) : null
    return new SyncEngine(db, remote, {
      refreshAuth,
      onRejected: (rejected) => onRejectedRef.current?.(rejected),
    })
  }, [sessionKey])

  useEffect(() => {
    let cancelled = false
    void seedDefaults(db).then(() => {
      if (!cancelled) void engine.start()
    })
    // Réponses fraîches envoyées par le service worker après revalidation.
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string; body?: unknown } | null
      if (data?.type === 'presence:revalidated' && data.url) void engine.applyRevalidated(data.url, data.body)
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    return () => {
      cancelled = true
      navigator.serviceWorker?.removeEventListener('message', onMessage)
      engine.stop()
    }
  }, [engine])

  const value = useMemo(() => ({ engine, db }), [engine])
  return <DataContext value={value}>{children}</DataContext>
}

export function useData(): DataContextValue {
  const context = use(DataContext)
  if (!context) throw new Error('useData() hors de <DataProvider>')
  return context
}

export function useEngine(): SyncEngine {
  return useData().engine
}

/** Données affichées : miroir local + écritures en attente, mises à jour en direct. */
export function useAppData(): AppData | undefined {
  return useLiveQuery(() => loadAppData(db), [])
}

export function useSyncState(): SyncState {
  const engine = useEngine()
  return useSyncExternalStore(engine.subscribe, engine.getState)
}

export function useCalcContext(data: AppData | undefined): CalcContext | null {
  return useMemo(
    () => (data ? { settings: data.settings, rules: data.rules, holidays: data.holidays, overrides: data.overrides } : null),
    [data],
  )
}
