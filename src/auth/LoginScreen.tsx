import { ArrowLeft, Mail } from 'lucide-react'
import { useId, useState } from 'react'
import { AppMark } from '../ui/AppMark.tsx'
import { Button, inputClass } from '../ui/controls.tsx'
import { useAuth } from './AuthProvider.tsx'

const LAST_EMAIL_KEY = 'presence:last-email'

/** Erreur renvoyée par Supabase dans l'URL (lien expiré, déjà utilisé…). */
function linkErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1))
  const code = params.get('error_code')
  const description = params.get('error_description')
  if (!code && !description) return null
  window.history.replaceState(null, '', window.location.pathname)
  if (code === 'otp_expired' || /expired|invalid/i.test(description ?? '')) {
    return 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau.'
  }
  return description ?? 'La connexion a échoué.'
}

function rememberedEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function LoginScreen() {
  const { sendLink, verifyCode } = useAuth()
  const id = useId()
  const [email, setEmail] = useState(rememberedEmail)
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(linkErrorFromUrl)
  const [info, setInfo] = useState<string | null>(null)

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
