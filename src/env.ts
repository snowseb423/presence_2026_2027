// Configuration lue dans les variables d'environnement (aucune clé en dur).
// Sans URL ni clé Supabase, l'app fonctionne en « mode local ».
const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

export const env = {
  supabaseUrl: url.replace(/\/+$/, ''),
  supabaseKey: key,
  /** Synchronisation Supabase configurée. */
  isRemote: Boolean(url && key),
  appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev',
} as const
