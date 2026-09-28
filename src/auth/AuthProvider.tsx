// Session Supabase (magic link, code reçu par email ou compte Google),
// tolérante au hors ligne : un utilisateur déjà connecté reste dans l'app,
// avec ses données en cache, même si le jeton ne peut pas être renouvelé
// faute de réseau.
import type { AuthError } from '@supabase/supabase-js'
import { type ReactNode, createContext, use, useCallback, useEffect, useMemo, useState } from 'react'
import { AUTH_STORAGE_KEY, supabase } from '../data/supabase.ts'
import { env } from '../env.ts'

export interface AuthUser {
  id: string
  email: string
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: AuthUser; local: boolean }

export type AuthResult = { ok: true } | { ok: false; message: string }

interface AuthContextValue {
  state: AuthState
  sendLink(email: string): Promise<AuthResult>
  verifyCode(email: string, code: string): Promise<AuthResult>
  /** Part vers la page Google ; le résultat n'arrive qu'en cas d'échec immédiat. */
  signInWithGoogle(): Promise<AuthResult>
  signOut(): Promise<void>
}

const LAST_USER_KEY = 'presence:last-user'
const LOCAL_USER: AuthUser = { id: 'local', email: 'cet appareil' }

function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER_KEY)
    const user = raw ? (JSON.parse(raw) as Partial<AuthUser>) : null
    return user?.id && user.email ? { id: user.id, email: user.email } : null
  } catch {
    return null
  }
}

function writeCachedUser(user: AuthUser | null): void {
  try {
    if (user) localStorage.setItem(LAST_USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(LAST_USER_KEY)
  } catch {
    /* stockage indisponible */
  }
}

function hasStoredSession(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null
  } catch {
    return false
  }
}

function initialState(): AuthState {
  if (!supabase) return { status: 'signedIn', user: LOCAL_USER, local: true }
  const cached = readCachedUser()
  if (cached && hasStoredSession()) return { status: 'signedIn', user: cached, local: false }
  return { status: 'loading' }
}

const OFFLINE_MESSAGE = 'Pas de connexion internet. Réessayez une fois en ligne.'

export function describeAuthError(error: AuthError | Error): string {
  const status = 'status' in error ? (error.status as number | undefined) : undefined
  const code = 'code' in error ? String(error.code ?? '') : ''
  const message = error.message ?? ''
  if (!status && /fetch|network|load failed/i.test(message)) return OFFLINE_MESSAGE
  if (status === 429 || code.includes('rate_limit')) return 'Trop de demandes : patientez une minute avant de réessayer.'
  if (/database error|not allowed|non autorisée/i.test(message) || code === 'signup_disabled') {
    return 'Cette adresse n’est pas autorisée. Demandez à l’autre compte de l’ajouter dans les réglages.'
  }
  if (code === 'otp_expired' || /expired|invalid/i.test(message)) return 'Code invalide ou expiré. Demandez un nouvel email.'
  return message || 'Une erreur est survenue.'
}

/**
 * Connexion Google activée dans Supabase (Authentication → Sign In /
 * Providers) ? Lu dans les réglages publics de Supabase Auth : le bouton
 * n'apparaît qu'une fois le fournisseur configuré, sans variable de plus.
 */
export async function isGoogleEnabled(): Promise<boolean> {
  if (!supabase) return false
  try {
    const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseKey } })
    if (!response.ok) return false
    const settings = (await response.json()) as { external?: { google?: boolean } }
    return settings.external?.google === true
  } catch {
    return false
  }
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(initialState)

  useEffect(() => {
    if (!supabase) return
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const user = { id: session.user.id, email: session.user.email ?? '' }
        writeCachedUser(user)
        setState((previous) =>
          previous.status === 'signedIn' && previous.user.id === user.id && previous.user.email === user.email
            ? previous
            : { status: 'signedIn', user, local: false },
        )
        return
      }
      if (event === 'SIGNED_OUT') {
        writeCachedUser(null)
        setState({ status: 'signedOut' })
        return
      }
      if (event === 'INITIAL_SESSION') {
        // Pas de session utilisable maintenant. Si une session est stockée,
        // c'est que son renouvellement a échoué faute de réseau : on garde
        // l'utilisateur connu, la synchronisation reprendra au retour du réseau.
        const cached = readCachedUser()
        setState(cached && hasStoredSession() ? { status: 'signedIn', user: cached, local: false } : { status: 'signedOut' })
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const sendLink = useCallback(async (email: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: 'Supabase n’est pas configuré.' }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/`, shouldCreateUser: true },
      })
      return error ? { ok: false, message: describeAuthError(error) } : { ok: true }
    } catch (error) {
      return { ok: false, message: describeAuthError(error as Error) }
    }
  }, [])

  const verifyCode = useCallback(async (email: string, code: string): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: 'Supabase n’est pas configuré.' }
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.replace(/\s/g, ''),
        type: 'email',
      })
      return error ? { ok: false, message: describeAuthError(error) } : { ok: true }
    } catch (error) {
      return { ok: false, message: describeAuthError(error as Error) }
    }
  }, [])

  const signInWithGoogle = useCallback(async (): Promise<AuthResult> => {
    if (!supabase) return { ok: false, message: 'Supabase n’est pas configuré.' }
    if (!navigator.onLine) return { ok: false, message: OFFLINE_MESSAGE }
    try {
      // Le navigateur part vers Google puis revient sur l'app avec la session
      // dans l'URL (flux implicite), lue au chargement par detectSessionInUrl.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/`,
          // Choix du compte à chaque fois : le compte Google ouvert sur le
          // téléphone n'est pas forcément l'adresse autorisée.
          queryParams: { prompt: 'select_account' },
        },
      })
      return error ? { ok: false, message: describeAuthError(error) } : { ok: true }
    } catch (error) {
      return { ok: false, message: describeAuthError(error as Error) }
    }
  }, [])

  const signOut = useCallback(async () => {
    writeCachedUser(null)
    if (supabase) {
      try {
        await supabase.auth.signOut({ scope: 'local' })
      } catch {
        /* hors ligne : on retire la session à la main ci-dessous */
      }
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY)
      } catch {
        /* stockage indisponible */
      }
    }
    setState(supabase ? { status: 'signedOut' } : initialState())
  }, [])

  const value = useMemo(
    () => ({ state, sendLink, verifyCode, signInWithGoogle, signOut }),
    [state, sendLink, verifyCode, signInWithGoogle, signOut],
  )
  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth(): AuthContextValue {
  const context = use(AuthContext)
  if (!context) throw new Error('useAuth() hors de <AuthProvider>')
  return context
}
