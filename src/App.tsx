import { useState } from 'react'
import { AuthProvider, useAuth } from './auth/AuthProvider.tsx'
import { LoginScreen } from './auth/LoginScreen.tsx'
import { DataProvider, useAppData, useCalcContext, useData, useSyncState } from './data/DataProvider.tsx'
import { clampDate, monthOf } from './domain/dates.ts'
import { formatDateShort } from './domain/format.ts'
import type { IsoMonth } from './domain/types.ts'
import { useRoute } from './lib/router.ts'
import { useToday } from './lib/useToday.ts'
import { UpdatePrompt } from './pwa/UpdatePrompt.tsx'
import { BudgetScreen } from './screens/BudgetScreen.tsx'
import { MonthScreen } from './screens/MonthScreen.tsx'
import { TodayScreen } from './screens/TodayScreen.tsx'
import { SettingsScreen } from './screens/settings/SettingsScreen.tsx'
import { AppMark } from './ui/AppMark.tsx'
import { ToastProvider, useToast } from './ui/Toaster.tsx'
import { Button } from './ui/controls.tsx'

function Splash() {
  return (
    <div className="band grid min-h-dvh place-items-center" aria-busy="true" aria-label="Chargement">
      <AppMark size={72} className="motion-safe:animate-pulse" />
    </div>
  )
}

function AccessDenied() {
  const { signOut, state } = useAuth()
  const { engine } = useData()
  return (
    <div className="band flex min-h-dvh flex-col items-start justify-end gap-4 px-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
      <AppMark size={56} />
      <h1 className="font-display text-3xl font-extrabold">Accès non autorisé</h1>
      <p className="max-w-sm text-header-ink-2">
        {state.status === 'signedIn' ? state.user.email : 'Cette adresse'} ne fait pas partie des comptes autorisés. Demandez à l’autre
        compte de l’ajouter dans Réglages → Comptes, puis reconnectez-vous.
      </p>
      <Button
        variant="primary"
        onClick={async () => {
          await engine.clearLocalData()
          await signOut()
        }}
      >
        Se déconnecter
      </Button>
    </div>
  )
}

function Main() {
  const data = useAppData()
  const calc = useCalcContext(data)
  const sync = useSyncState()
  const today = useToday()
  const [route] = useRoute()
  const [month, setMonth] = useState<IsoMonth | null>(null)

  if (!data || !calc) return <Splash />
  // Première synchronisation réussie mais aucune donnée visible : RLS refuse.
  if (sync.mode === 'remote' && sync.lastSyncAt && !data.hydrated) return <AccessDenied />

  const shownMonth = month ?? monthOf(clampDate(today, calc.settings.periodStart, calc.settings.periodEnd))

  switch (route) {
    case 'month':
      return <MonthScreen data={data} calc={calc} today={today} month={shownMonth} onMonthChange={setMonth} />
    case 'budget':
      return <BudgetScreen calc={calc} today={today} />
    case 'settings':
      return <SettingsScreen data={data} calc={calc} />
    default:
      return <TodayScreen data={data} calc={calc} today={today} />
  }
}

function Gate() {
  const { state } = useAuth()
  const toast = useToast()
  if (state.status === 'loading') return <Splash />
  if (state.status === 'signedOut') return <LoginScreen />
  return (
    <DataProvider
      sessionKey={state.user.id}
      onRejected={(rejected) =>
        toast({
          tone: 'error',
          message: `Modification refusée par le serveur${
            'date' in rejected.op ? ` (${formatDateShort(rejected.op.date)})` : ''
          } : ${rejected.message}`,
        })
      }
    >
      <Main />
    </DataProvider>
  )
}

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
      <UpdatePrompt />
    </ToastProvider>
  )
}
