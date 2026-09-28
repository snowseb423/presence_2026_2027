import { isoWeekday } from './dates.ts'
import type { IsoDate, Settings, StatusCode, StatusRule } from './types.ts'

/** Codes des statuts (clés de la table status_rules). */
export const STATUS = {
  travaille: 'travaille',
  demiJournee: 'demi_journee',
  congeNonPaye: 'conge_non_paye',
  absenceNonPayee: 'absence_non_payee',
  jourSupplementaire: 'jour_supplementaire',
  congePaye: 'conge_paye',
  ferieNonPaye: 'ferie_non_paye',
  feriePaye: 'ferie_paye',
  weekEnd: 'week_end',
  nonConcerne: 'non_concerne',
} as const satisfies Record<string, StatusCode>

/** Statuts où l'employée est venue : ce sont les jours « prestés ». */
export const PRESENCE_STATUSES: ReadonlySet<StatusCode> = new Set([
  STATUS.travaille,
  STATUS.demiJournee,
  STATUS.jourSupplementaire,
])

export function isPresence(code: StatusCode): boolean {
  return PRESENCE_STATUSES.has(code)
}

/**
 * Statut par défaut d'une journée, calculé et jamais stocké :
 * - hors période → Non concerné ;
 * - jour non presté → Week-end (samedi, dimanche) ou Non concerné ;
 * - jour férié → Férié (non payé) ;
 * - sinon → Travaillé.
 * Un férié tombant un dimanche reste donc un week-end.
 */
export function defaultStatus(
  date: IsoDate,
  settings: Pick<Settings, 'workDays' | 'periodStart' | 'periodEnd'>,
  holidays: { has(date: IsoDate): boolean },
): StatusCode {
  if (date < settings.periodStart || date > settings.periodEnd) return STATUS.nonConcerne
  const weekday = isoWeekday(date)
  if (!settings.workDays.includes(weekday)) {
    return weekday >= 6 ? STATUS.weekEnd : STATUS.nonConcerne
  }
  if (holidays.has(date)) return STATUS.ferieNonPaye
  return STATUS.travaille
}

/** Règle neutre pour un code inconnu (table des statuts pas encore chargée…). */
export function fallbackRule(code: StatusCode): StatusRule {
  return {
    code,
    label: code,
    paidHours: 0,
    transportPaid: false,
    colorToken: 'mist',
    sortOrder: Number.MAX_SAFE_INTEGER,
    updatedAt: null,
  }
}

export function sortRules(rules: Iterable<StatusRule>): StatusRule[] {
  return [...rules].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'fr'))
}
