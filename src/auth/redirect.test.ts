import { describe, expect, it } from 'vitest'
import { describeRedirectError } from './redirect.ts'

const messageFor = (query: string) => describeRedirectError(new URLSearchParams(query))

describe('erreurs dans l’URL de retour de Supabase', () => {
  it('ne signale rien sans paramètre d’erreur (retour réussi ou ouverture normale)', () => {
    expect(messageFor('')).toBeNull()
    expect(messageFor('access_token=abc&refresh_token=def&expires_in=3600&token_type=bearer')).toBeNull()
  })

  it('compte Google absent de la liste : la garde d’inscription l’a refusé', () => {
    const refused = 'Ce compte Google n’est pas autorisé : ajoutez son adresse depuis l’autre téléphone (Réglages → Comptes).'
    expect(messageFor('error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user')).toBe(refused)
    // Message de la garde transmis tel quel par certaines versions de Supabase Auth.
    expect(messageFor('error=access_denied&error_description=Adresse+non+autoris%C3%A9e+pour+cette+application.')).toBe(refused)
    expect(messageFor('error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance')).toBe(refused)
  })

  it('magic link expiré ou déjà utilisé', () => {
    const expired = 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau.'
    expect(messageFor('error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toBe(expired)
    expect(messageFor('error_description=Email+link+is+invalid+or+has+expired')).toBe(expired)
  })

  it('choix du compte abandonné sur la page Google', () => {
    expect(messageFor('error=access_denied')).toBe('Connexion avec Google annulée.')
    expect(messageFor('error=access_denied&error_description=')).toBe('Connexion avec Google annulée.')
  })

  it('autre erreur : description de Supabase, sans la confondre avec un lien expiré', () => {
    expect(messageFor('error=invalid_request&error_code=bad_oauth_state&error_description=OAuth+callback+with+invalid+state')).toBe(
      'OAuth callback with invalid state',
    )
    expect(messageFor('error=server_error')).toBe('La connexion a échoué.')
  })
})
