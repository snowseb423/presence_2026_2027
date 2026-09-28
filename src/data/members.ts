// Gestion des comptes autorisés (allowed_emails). Opérations en ligne
// uniquement : elles touchent à l'accès, on ne les met pas en file.
import { toMember } from './rows.ts'
import { supabase } from './supabase.ts'
import type { PresenceDB } from './db.ts'

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function isValidEmail(email: string): boolean {
  return EMAIL.test(email.trim())
}

function client() {
  if (!supabase) throw new Error('Supabase n’est pas configuré.')
  return supabase
}

function explain(error: { message: string; code?: string }): Error {
  if (error.code === '23505') return new Error('Cette adresse est déjà autorisée.')
  if (error.code === '42501') return new Error('Action non autorisée.')
  return new Error(error.message)
}

export async function addMember(db: PresenceDB, email: string, displayName: string): Promise<void> {
  const { data, error } = await client()
    .from('allowed_emails')
    .insert({ email: email.trim().toLowerCase(), display_name: displayName.trim() || null })
    .select('email, display_name, user_id')
    .single()
  if (error) throw explain(error)
  await db.members.put(toMember(data))
}

export async function renameMember(db: PresenceDB, email: string, displayName: string): Promise<void> {
  const { data, error } = await client()
    .from('allowed_emails')
    .update({ display_name: displayName.trim() || null })
    .eq('email', email)
    .select('email, display_name, user_id')
    .single()
  if (error) throw explain(error)
  await db.members.put(toMember(data))
}

export async function removeMember(db: PresenceDB, email: string): Promise<void> {
  const { error } = await client().from('allowed_emails').delete().eq('email', email)
  if (error) throw explain(error)
  await db.members.delete(email)
}
