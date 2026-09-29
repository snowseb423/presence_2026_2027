// Données d'export (pures) : lignes journalières et récapitulatifs mensuels.
import { monthOf } from '../domain/dates.ts'
import { capitalize, formatDateNumeric, formatMonth, weekdayName } from '../domain/format.ts'
import { type DayComputation, type MonthSummary, type Totals, daysOfMonth, periodMonths, summarizeMonth, sumTotals } from '../domain/pay.ts'
import type { CalcContext, IsoMonth } from '../domain/types.ts'

export type ExportScope = { kind: 'month'; month: IsoMonth } | { kind: 'period' }
/** Tableurs (présence et montants) ou fiches de paie en PDF. */
export type ExportFormat = 'csv' | 'xlsx' | 'pdf'

export function scopeMonths(calc: CalcContext, scope: ExportScope): IsoMonth[] {
  const all = periodMonths(calc.settings)
  return scope.kind === 'month' ? all.filter((month) => month === scope.month) : all
}

export function exportDays(calc: CalcContext, scope: ExportScope): DayComputation[] {
  return scopeMonths(calc, scope).flatMap((month) => daysOfMonth(month, calc))
}

export function exportSummaries(calc: CalcContext, scope: ExportScope): MonthSummary[] {
  return scopeMonths(calc, scope).map((month) => summarizeMonth(month, calc))
}

export function fileBaseName(calc: CalcContext, scope: ExportScope, format: ExportFormat = 'csv'): string {
  const { periodStart, periodEnd } = calc.settings
  if (format === 'pdf') {
    return scope.kind === 'month' ? `fiche-de-paie-${scope.month}` : `fiches-de-paie-${monthOf(periodStart)}_${monthOf(periodEnd)}`
  }
  if (scope.kind === 'month') return `presence-${scope.month}`
  return `presence-${periodStart}_${periodEnd}`
}

export function scopeTitle(calc: CalcContext, scope: ExportScope): string {
  const who = calc.settings.employeeName.trim()
  const what =
    scope.kind === 'month'
      ? capitalize(formatMonth(scope.month))
      : `Période du ${formatDateNumeric(calc.settings.periodStart)} au ${formatDateNumeric(calc.settings.periodEnd)}`
  return who ? `Présence de ${who} — ${what}` : `Présence — ${what}`
}

export const DAY_HEADERS = [
  'Date',
  'Jour',
  'Statut',
  'Saisie',
  'Férié',
  'Heures payées',
  'Heures forcées',
  'Taux horaire (Rs)',
  'Prestation (Rs)',
  'Transport (Rs)',
  'Total (Rs)',
  'Commentaire',
] as const

export type Cell = string | number | null

/** Une ligne par jour, montants en roupies (nombres). */
export function dayRow(day: DayComputation, calc: CalcContext): Cell[] {
  return [
    formatDateNumeric(day.date),
    capitalize(weekdayName(day.date)),
    day.rule.label,
    day.override ? 'saisi' : 'par défaut',
    day.holiday?.name ?? null,
    day.hours,
    day.hoursOverridden ? 'oui' : null,
    calc.settings.hourlyRate,
    day.prestationCents / 100,
    day.transportCents / 100,
    day.totalCents / 100,
    day.override?.comment ?? null,
  ]
}

export const SUMMARY_HEADERS = [
  'Mois',
  'Jours ouvrés',
  'Fériés en semaine',
  'Congés non payés',
  'Absences non payées',
  'Jours payés',
  'Jours prestés',
  'Heures',
  'Prestation (Rs)',
  'Transport (Rs)',
  'Total à payer (Rs)',
  'Budget de référence (Rs)',
  'Écart (Rs)',
] as const

export function summaryRow(label: string, totals: Totals): Cell[] {
  return [
    label,
    totals.workingDays,
    totals.weekdayHolidays,
    totals.unpaidLeaveDays,
    totals.unpaidAbsenceDays,
    totals.paidDays,
    totals.workedDays,
    totals.hours,
    totals.prestationCents / 100,
    totals.transportCents / 100,
    totals.totalCents / 100,
    totals.budgetCents / 100,
    totals.varianceCents / 100,
  ]
}

/** Récapitulatif : un mois par ligne, puis totaux par année et total général. */
export function summaryRows(calc: CalcContext, scope: ExportScope): { rows: Cell[][]; totalRows: number[] } {
  const summaries = exportSummaries(calc, scope)
  const rows: Cell[][] = summaries.map((s) => summaryRow(capitalize(formatMonth(s.month)), s))
  const totalRows: number[] = []
  if (scope.kind === 'period') {
    const years = [...new Set(summaries.map((s) => s.month.slice(0, 4)))]
    for (const year of years) {
      totalRows.push(rows.length)
      rows.push(summaryRow(`Total ${year}`, sumTotals(summaries.filter((s) => s.month.startsWith(year)))))
    }
  }
  totalRows.push(rows.length)
  rows.push(summaryRow(scope.kind === 'period' ? 'Total de la période' : 'Total du mois', sumTotals(summaries)))
  return { rows, totalRows }
}
