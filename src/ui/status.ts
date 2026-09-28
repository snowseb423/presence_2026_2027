// Représentation visuelle des statuts : couleur (token CSS) ET forme, pour
// ne jamais dépendre de la couleur seule.
import type { CSSProperties } from 'react'
import type { StatusCode, StatusRule } from '../domain/types.ts'

export const COLOR_TOKENS = ['olive', 'amber', 'coral', 'brick', 'lagoon', 'plum', 'slate', 'steel', 'stone', 'mist'] as const

export type Glyph = 'disc' | 'half' | 'plus' | 'ring' | 'slash' | 'square' | 'diamondOutline' | 'diamond' | 'dash' | 'dotted'

const GLYPHS: Record<StatusCode, Glyph> = {
  travaille: 'disc',
  demi_journee: 'half',
  jour_supplementaire: 'plus',
  conge_non_paye: 'ring',
  absence_non_payee: 'slash',
  conge_paye: 'square',
  ferie_non_paye: 'diamondOutline',
  ferie_paye: 'diamond',
  week_end: 'dash',
  non_concerne: 'dotted',
}

const SHORT_LABELS: Record<StatusCode, string> = {
  travaille: 'Travaillé',
  demi_journee: 'Demi-journée',
  jour_supplementaire: 'Jour supp.',
  conge_non_paye: 'Congé non payé',
  absence_non_payee: 'Absence non payée',
  conge_paye: 'Congé payé',
  ferie_non_paye: 'Férié',
  ferie_paye: 'Férié payé',
  week_end: 'Week-end',
  non_concerne: 'Non concerné',
}

export function glyphOf(code: StatusCode): Glyph {
  return GLYPHS[code] ?? 'disc'
}

export function shortLabel(rule: Pick<StatusRule, 'code' | 'label'>): string {
  return SHORT_LABELS[rule.code] ?? rule.label
}

export function colorToken(token: string | undefined): string {
  return token && (COLOR_TOKENS as readonly string[]).includes(token) ? token : 'mist'
}

/** Variables CSS d'un statut : --st (pastille), --st-ink (texte), --st-soft (fond). */
export function statusVars(token: string | undefined): CSSProperties {
  const t = colorToken(token)
  return {
    '--st': `var(--st-${t})`,
    '--st-ink': `var(--st-${t}-ink)`,
    '--st-soft': `var(--st-${t}-soft)`,
  } as CSSProperties
}
