import { CheckCircle2, Download, Monitor, Moon, RefreshCw, Share, SquarePlus, Sun } from 'lucide-react'
import { useState } from 'react'
import { useEngine, useSyncState } from '../../data/DataProvider.tsx'
import { formatTimestamp } from '../../domain/format.ts'
import { env } from '../../env.ts'
import { type ThemeChoice, useTheme } from '../../lib/theme.ts'
import { promptInstall, useInstallState } from '../../pwa/install.ts'
import { Button, Card } from '../../ui/controls.tsx'

/** Aide iOS : Safari n'expose pas beforeinstallprompt. */
export function IosInstallSteps() {
  return (
    <ol className="flex flex-col gap-2 text-[0.9375rem] text-ink">
      <li className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">1</span>
        <span>
          Dans Safari, touchez <Share size={17} className="inline align-[-3px]" aria-label="Partager" /> <strong>Partager</strong>
        </span>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">2</span>
        <span>
          Choisissez <SquarePlus size={17} className="inline align-[-3px]" aria-hidden="true" /> <strong>Sur l’écran d’accueil</strong>
        </span>
      </li>
      <li className="flex items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 font-bold">3</span>
        <span>
          Touchez <strong>Ajouter</strong> : l’app s’ouvre ensuite en plein écran
        </span>
      </li>
    </ol>
  )
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: 'Système', icon: Monitor },
  { value: 'light', label: 'Clair', icon: Sun },
  { value: 'dark', label: 'Sombre', icon: Moon },
]

export function AppSection({ pending }: { pending: number }) {
  const install = useInstallState()
  const [theme, setTheme] = useTheme()
  const sync = useSyncState()
  const engine = useEngine()
  const [busy, setBusy] = useState(false)

  return (
    <Card className="flex flex-col gap-5">
      <div>
        <h3 className="mb-2 font-display text-base font-bold">Installer l’app</h3>
        {install.standalone || install.installed ? (
          <p className="flex items-center gap-2 text-[0.9375rem] text-positive">
            <CheckCircle2 size={18} aria-hidden="true" /> L’app est installée sur cet appareil.
          </p>
        ) : install.canPrompt ? (
          <Button variant="primary" onClick={() => void promptInstall()}>
            <Download size={18} aria-hidden="true" />
            Installer l’app
          </Button>
        ) : install.ios ? (
          <IosInstallSteps />
        ) : (
          <p className="text-[0.9375rem] text-ink-2">
            Ouvrez le menu du navigateur puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».
          </p>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 font-display text-base font-bold">Apparence</legend>
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1">
          {THEMES.map(({ value, label, icon: Icon }) => (
            <label
              key={value}
              className={`flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[0.9375rem] font-bold transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--focus)] ${
                theme === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2'
              }`}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => setTheme(value)}
                className="sr-only"
              />
              <Icon size={16} aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <h3 className="mb-1 font-display text-base font-bold">Synchronisation</h3>
        <p className="text-[0.9375rem] text-ink-2">
          {sync.mode === 'local'
            ? 'Mode local : Supabase n’est pas configuré (voir le README).'
            : sync.lastSyncAt
              ? `Dernière synchronisation complète : ${formatTimestamp(sync.lastSyncAt)}.`
              : 'Pas encore synchronisé.'}
          {pending ? ` ${pending} modification${pending > 1 ? 's' : ''} en attente.` : ''}
        </p>
        {sync.mode === 'remote' ? (
          <Button
            className="mt-2"
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
        ) : null}
      </div>

      <p className="text-sm text-ink-2">Présence · version {env.appVersion}</p>
    </Card>
  )
}
