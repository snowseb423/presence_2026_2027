import { ArrowLeft, Mail } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { AppMark } from '../ui/AppMark.tsx'
import { Button, inputClass } from '../ui/controls.tsx'
import { isGoogleEnabled, useAuth } from './AuthProvider.tsx'
import { describeRedirectError } from './redirect.ts'

const LAST_EMAIL_KEY = 'presence:last-email'

/** Erreur renvoyée par Supabase dans l'URL (lien expiré, compte Google refusé…), retirée de l'URL une fois lue. */
function errorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1))
  const message = describeRedirectError(params)
  if (message) window.history.replaceState(null, '', window.location.pathname)
  return message
}

function rememberedEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Le bouton Google n'apparaît que si le fournisseur est activé dans Supabase (revérifié au retour du réseau). */
function useGoogleEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let active = true
    const check = () => {
      void isGoogleEnabled().then((value) => {
        // Une vérification ratée (réseau encore instable) ne retire pas le bouton.
        if (active && value) setEnabled(true)
      })
    }
    check()
    window.addEventListener('online', check)
    return () => {
      active = false
      window.removeEventListener('online', check)
    }
  }, [])
  return enabled
}

/** Logo « G » de Google dans ses couleurs d'origine, comme l'exigent ses règles de marque. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  )
}

export function LoginScreen() {
  const { sendLink, verifyCode, signInWithGoogle } = useAuth()
  const id = useId()
  const google = useGoogleEnabled()
  const [email, setEmail] = useState(rememberedEmail)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [error, setError] = useState<string | null>(errorFromUrl)
  const [info, setInfo] = useState<string | null>(null)

  // Retour arrière depuis la page Google (page restaurée telle quelle) :
  // le bouton reprend son libellé.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false)
    }
    window.addEventListener('pageshow', onPageShow)
    return () => window.removeEventListener('pageshow', onPageShow)
  }, [])

  async function continueWithGoogle() {
    setError(null)
    setLeaving(true)
    const result = await signInWithGoogle()
    if (!result.ok) {
      setLeaving(false)
      setError(result.message)
    }
  }

  async function requestLink() {
    setBusy(true)
    setError(null)
    const result = await sendLink(email)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    try {
      localStorage.setItem(LAST_EMAIL_KEY, email.trim().toLowerCase())
    } catch {
      /* facultatif */
    }
    setStep('code')
    setInfo(null)
  }

  async function submitCode() {
    setBusy(true)
    setError(null)
    const result = await verifyCode(email, code)
    setBusy(false)
    if (!result.ok) setError(result.message)
  }

  return (
    <div className="band flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-end px-6 pb-10 pt-[calc(env(safe-area-inset-top)+2rem)]">
        <AppMark size={64} />
        <h1 className="mt-6 font-display text-[3.25rem] font-extrabold leading-none tracking-tight">Présence</h1>
        <p className="mt-3 max-w-xs text-[1.0625rem] text-header-ink-2">
          Les journées de travail et le montant dû, partagés entre vos deux téléphones.
        </p>
      </div>

      <main className="rounded-t-[1.75rem] bg-bg text-ink">
        <div className="mx-auto w-full max-w-md px-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-7">
          {step === 'email' ? (
            <>
              {google ? (
                <>
                  <Button variant="secondary" size="lg" className="w-full" onClick={() => void continueWithGoogle()}>
                    <GoogleMark />
                    {leaving ? 'Ouverture de Google…' : 'Continuer avec Google'}
                  </Button>
                  <p className="my-5 flex items-center gap-3 text-sm text-ink-2">
                    <span aria-hidden="true" className="h-px flex-1 bg-line-strong" />
                    ou
                    <span aria-hidden="true" className="h-px flex-1 bg-line-strong" />
                  </p>
                </>
              ) : null}
              <form
                onSubmit={(event) => {
                  event.preventDefault()
                  void requestLink()
                }}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={`${id}-email`} className="font-bold">
                    Votre adresse email
                  </label>
                  <input
                    id={`${id}-email`}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="vous@exemple.com"
                    className={inputClass}
                  />
                </div>
                <Button type="submit" variant="primary" size="lg" disabled={busy || !email.includes('@')}>
                  <Mail size={20} aria-hidden="true" />
                  {busy ? 'Envoi…' : 'Recevoir le lien de connexion'}
                </Button>
                <p className="text-sm text-ink-2">Seules les adresses autorisées peuvent se connecter.</p>
              </form>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void submitCode()
              }}
              className="flex flex-col gap-4"
            >
              <p className="text-[1.0625rem]">
                Email envoyé à <strong className="break-all">{email}</strong>. Touchez le lien reçu depuis ce téléphone, ou saisissez
                le code qu’il contient (indispensable si l’app est installée sur iPhone).
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`${id}-code`} className="font-bold">
                  Code reçu par email
                </label>
                <input
                  id={`${id}-code`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9 ]*"
                  maxLength={12}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="123456"
                  className={`${inputClass} num text-center font-display text-2xl tracking-[0.3em]`}
                />
              </div>
              <Button type="submit" variant="primary" size="lg" disabled={busy || code.replace(/\s/g, '').length < 6}>
                {busy ? 'Vérification…' : 'Se connecter'}
              </Button>
              <div className="flex flex-wrap justify-between gap-2">
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStep('email')
                    setCode('')
                    setError(null)
                  }}
                >
                  <ArrowLeft size={18} aria-hidden="true" />
                  Changer d’adresse
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    await requestLink()
                    setInfo('Nouvel email envoyé.')
                  }}
                >
                  Renvoyer l’email
                </Button>
              </div>
            </form>
          )}
          {info ? (
            <p role="status" className="mt-4 text-[0.9375rem] text-positive">
              {info}
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-4 rounded-2xl bg-danger-soft p-3 text-[0.9375rem] font-bold text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </main>
    </div>
  )
}
