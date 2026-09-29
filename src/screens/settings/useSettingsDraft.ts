import { useEffect, useState } from 'react'
import type { Settings } from '../../domain/types.ts'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Brouillon d'un formulaire de réglages. Les réglages reçus (autre téléphone,
 * synchronisation, premier lancement) remplacent le brouillon seulement s'il
 * n'est pas modifié.
 *
 * Réglages de référence et brouillon forment un seul état, et chaque décision
 * se prend sur l'état courant, au moment où React applique la mise à jour :
 * une frappe arrivée en même temps qu'une mise à jour n'est jamais effacée.
 * `toDraft` doit donner le même brouillon pour les mêmes réglages.
 */
export function useSettingsDraft<Draft>(settings: Settings, toDraft: (settings: Settings) => Draft) {
  const [form, setForm] = useState(() => ({ base: settings, draft: toDraft(settings) }))

  useEffect(() => {
    setForm((current) => (same(current.draft, toDraft(current.base)) ? { base: settings, draft: toDraft(settings) } : current))
  }, [settings]) // `toDraft` volontairement absent : on ne réagit qu'aux réglages reçus

  return {
    draft: form.draft,
    /** Le brouillon diffère des réglages de référence. */
    dirty: !same(form.draft, toDraft(form.base)),
    edit(change: (draft: Draft) => Draft) {
      setForm((current) => ({ ...current, draft: change(current.draft) }))
    },
    /** Abandonne la saisie : retour aux réglages actuels. */
    reset() {
      setForm({ base: settings, draft: toDraft(settings) })
    },
    /**
     * Après l'enregistrement du brouillon `sent` : les réglages obtenus
     * deviennent la référence et le brouillon reprend leurs valeurs
     * normalisées, sauf si la saisie a continué entre-temps.
     */
    saved(sent: Draft, next: Settings) {
      setForm((current) => ({ base: next, draft: same(current.draft, sent) ? toDraft(next) : current.draft }))
    },
  }
}
