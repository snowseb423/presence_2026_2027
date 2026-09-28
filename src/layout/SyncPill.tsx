import { useLiveQuery } from 'dexie-react-hooks'
import { CloudOff, RefreshCw, TriangleAlert, Wifi } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import { db, useAppData, useEngine, useSyncState } from '../data/DataProvider.tsx'
import type { Op } from '../data/ops.ts'
import type { SyncState } from '../data/sync.ts'
import { formatDateNumeric, formatDateShort, formatTimestamp } from '../domain/format.ts'
import type { StatusRule } from '../domain/types.ts'
import { Sheet } from '../ui/Sheet.tsx'
import { Button } from '../ui/controls.tsx'

type Tone = 'ok' | 'pending' | 'offline' | 'error' | 'local'

export function describeSync(sync: SyncState, pending: number): { short: string; long: string; tone: Tone } {
  const waiting = pending === 1 ? '1 modification en attente' : `${pending} modifications en attente`
  if (sync.mode === 'local') return { short: 'Local', long: 'Mode local : données sur cet appareil uniquement', tone: 'local' }
  if (sync.authRequired) return { short: 'Session expirée', long: 'Session expirée : reconnectez-vous', tone: 'error' }
  if (!sync.online) {
    return pending
      ? { short: `Hors ligne · ${pending}`, long: `Hors ligne, ${waiting}`, tone: 'offline' }
      : { short: 'Hors ligne', long: 'Hors ligne : les saisies partiront au retour du réseau', tone: 'offline' }
  }
  if (pending) return { short: `${pending} en attente`, long: `En ligne, ${waiting}`, tone: 'pending' }
  if (sync.lastError) return { short: 'Erreur', long: `Erreur de synchronisation : ${sync.lastError}`, tone: 'error' }
  if (sync.realtime !== 'live') return { short: 'Connexion…', long: 'Connexion au temps réel en cours', tone: 'pending' }
  return { short: 'En ligne', long: 'En ligne, tout est synchronisé', tone: 'ok' }
}

const DOT: Record<Tone, string> = {
  ok: 'bg-[#84cc16]',
  pending: 'bg-[#f59e0b] animate-pulse',
  offline: 'bg-[#a8a29e]',
  error: 'bg-[#f87171]',
  local: 'bg-[#d2bfae]',
}

function describeOp(op: Op, rules: Map<string, StatusRule>): string {
  switch (op.kind) {
    case 'attendance.set':
      return `${formatDateShort(op.date)} → ${rules.get(op.statusCode)?.label ?? op.statusCode}`
    case 'attendance.clear':
      return `${formatDateShort(op.date)} → statut par défaut`
    case 'holiday.upsert':
      return `Férié du ${formatDateNumeric(op.date)} : ${op.name}`
    case 'holiday.delete':
      return `Suppression du férié du ${formatDateNumeric(op.date)}`
    case 'settings.patch':
      return 'Réglages modifiés'
    case 'statusRule.patch':
      return `Statut « ${rules.get(op.code)?.label ?? op.code} » modifié`
  }
}

export function SyncPill() {
  const sync = useSyncState()
  const pending = useLiveQuery(() => db.outbox.count(), [], 0)
  const [open, setOpen] = useState(false)
  const view = describeSync(sync, pending)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-white/10 px-3.5 text-sm font-bold text-header-ink ring-1 ring-white/15 transition-colors hover:bg-white/15"
        aria-label={`Synchronisation : ${view.long}`}
        aria-haspopup="dialog"
      >
        <span className={`size-2.5 rounded-full ${DOT[view.tone]}`} aria-hidden="true" />
        <span className="num">{view.short}</span>
      </button>
      <SyncSheet open={open} onClose={() => setOpen(false)} view={view} />
    </>
  )
}

function SyncSheet({ open, onClose, view }: { open: boolean; onClose: () => void; view: ReturnType<typeof describeSync> }) {
  const sync = useSyncState()
  const engine = useEngine()
  const data = useAppData()
  const { signOut } = useAuth()
  const [busy, setBusy] = useState(false)
  const Icon = view.tone === 'offline' ? CloudOff : view.tone === 'error' ? TriangleAlert : Wifi

  return (
    <Sheet open={open} onClose={onClose} title="Synchronisation" subtitle={view.long}>
      <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-4">
        <Icon size={22} className="shrink-0 text-ink-2" aria-hidden="true" />
        <p className="text-[0.9375rem] text-ink">
          {sync.mode === 'local'
            ? 'Supabase n’est pas configuré : rien n’est partagé avec l’autre téléphone.'
            : sync.lastSyncAt
              ? `Dernière synchronisation complète : ${formatTimestamp(sync.lastSyncAt)}.`
              : 'Aucune synchronisation complète pour l’instant.'}
        </p>
      </div>

      {data && data.outbox.length > 0 ? (
        <div className="mt-5">
          <h3 className="mb-2 font-display text-base font-bold">En attente d’envoi</h3>
          <ol className="divide-y divide-line rounded-2xl border border-line">
            {data.outbox.slice(0, 12).map((entry) => (
              <li key={entry.id} className="px-4 py-3 text-[0.9375rem]">
                {describeOp(entry.op, data.rules)}
                {entry.lastError ? <span className="block text-sm text-ink-2">Dernier essai : {entry.lastError}</span> : null}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-sm text-ink-2">Envoyées dans l’ordre dès que le réseau revient, même si l’app a été fermée entre-temps (à sa réouverture).</p>
        </div>
      ) : null}

      {sync.lastError && sync.mode === 'remote' ? <p className="mt-4 text-sm text-danger">{sync.lastError}</p> : null}

      {sync.mode === 'remote' ? (
        <div className="mt-6 flex flex-wrap gap-3">
          {sync.authRequired ? (
            <Button variant="primary" onClick={() => void signOut()}>
              Se reconnecter
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy || !sync.online}
              onClick={async () => {
                setBusy(true)
                try {
                  await engine.sync()
                } finally {
                  setBusy(false)
                }
              }}
            >
              <RefreshCw size={18} className={busy ? 'animate-spin' : ''} aria-hidden="true" />
              Synchroniser maintenant
            </Button>
          )}
        </div>
      ) : null}
    </Sheet>
  )
}
