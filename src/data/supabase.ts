import { type SupabaseClient, createClient } from '@supabase/supabase-js'
import { env } from '../env.ts'

/** Clé du stockage local de la session Supabase. */
export const AUTH_STORAGE_KEY = 'presence-auth'

/** Client Supabase, ou null en mode local (variables non renseignées). */
export const supabase: SupabaseClient | null = env.isRemote
  ? createClient(env.supabaseUrl, env.supabaseKey, {
      auth: {
        storageKey: AUTH_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Flux implicite : un lien ouvert dans un autre navigateur que celui
        // de la demande fonctionne quand même (pas de code_verifier local).
        flowType: 'implicit',
      },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null
