// Retour de Supabase dans l'URL de l'app, après un magic link ou la page
// Google : traduction des erreurs pour l'écran de connexion.

/**
 * Erreur renvoyée par Supabase dans l'URL de retour (lien expiré ou déjà
 * utilisé, compte Google refusé ou choix abandonné…), ou null s'il n'y en a pas.
 */
export function describeRedirectError(params: URLSearchParams): string | null {
  const error = params.get('error')
  const code = params.get('error_code')
  const description = params.get('error_description') ?? ''
  if (!error && !code && !description) return null
  // Compte Google hors de la liste : la garde d'inscription refuse de le créer.
  if (code === 'signup_disabled' || /database error|not allowed|non autorisée/i.test(description)) {
    return 'Ce compte Google n’est pas autorisé : ajoutez son adresse depuis l’autre téléphone (Réglages → Comptes).'
  }
  if (code === 'otp_expired' || (!code && /expired|invalid/i.test(description))) {
    return 'Ce lien a expiré ou a déjà servi : demandez-en un nouveau.'
  }
  // Choix du compte abandonné sur la page Google.
  if (error === 'access_denied' && !description) return 'Connexion avec Google annulée.'
  return description || 'La connexion a échoué.'
}
