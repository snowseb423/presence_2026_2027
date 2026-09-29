// Fiche de paie d'un mois : rémunération détaillée, cotisations sociales,
// net à payer et coût employeur. Module pur ; montants en centimes entiers.
import { addDays, addMonths, firstDayOfMonth, isoWeekday, lastDayOfMonth, maxDate, minDate } from './dates.ts'
import { type MonthSummary, summarizeMonth } from './pay.ts'
import { STATUS } from './status.ts'
import type { CalcContext, Contribution, ContributionBracket, IsoDate, IsoMonth, StatusCode } from './types.ts'

export interface EarningLine {
  /** Code du statut, ou « transport ». */
  code: StatusCode
  label: string
  days: number
  /** Heures payées (0 pour le transport). */
  hours: number
  /** Taux horaire, ou transport par jour (Rs). */
  rate: number
  unit: 'hour' | 'day'
  amountCents: number
}

export interface ContributionLine {
  id: string
  label: string
  description: string
  /** Assiette retenue, plancher et plafond appliqués. */
  baseCents: number
  employeeRate: number
  employerRate: number
  employeeCents: number
  employerCents: number
}

export interface PayrollTotals {
  grossCents: number
  /** Retenues salariales. */
  employeeCents: number
  /** Cotisations patronales. */
  employerCents: number
  netCents: number
  /** Coût employeur : brut + cotisations patronales. */
  costCents: number
}

export interface Payslip extends PayrollTotals {
  month: IsoMonth
  /** Période de paie : le mois, borné à la période suivie. */
  start: IsoDate
  end: IsoDate
  payDate: IsoDate
  summary: MonthSummary
  earnings: EarningLine[]
  /** Salaire de base : heures payées × taux horaire. */
  basicCents: number
  transportCents: number
  contributions: ContributionLine[]
}

/** Libellés de la fiche de paie pour les statuts payés. */
const EARNING_LABELS: Record<StatusCode, string> = {
  [STATUS.travaille]: 'Heures travaillées',
  [STATUS.demiJournee]: 'Demi-journées',
  [STATUS.jourSupplementaire]: 'Jours supplémentaires',
  [STATUS.congePaye]: 'Congés payés',
  [STATUS.feriePaye]: 'Jours fériés payés',
}

/** Lignes de rémunération : une par statut payé, puis le transport. */
export function earningLines(summary: MonthSummary, ctx: CalcContext): EarningLine[] {
  const byStatus = new Map<StatusCode, { label: string; order: number; days: number; hoursCenti: number; cents: number }>()
  let transportDays = 0
  for (const day of summary.days) {
    if (day.transportCents > 0) transportDays += 1
    if (day.hours <= 0) continue
    const line = byStatus.get(day.status) ?? {
      label: EARNING_LABELS[day.status] ?? day.rule.label,
      order: day.rule.sortOrder,
      days: 0,
      hoursCenti: 0,
      cents: 0,
    }
    line.days += 1
    line.hoursCenti += Math.round(day.hours * 100)
    line.cents += day.prestationCents
    byStatus.set(day.status, line)
  }
  const lines: EarningLine[] = [...byStatus.entries()]
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([code, line]) => ({
      code,
      label: line.label,
      days: line.days,
      hours: line.hoursCenti / 100,
      rate: ctx.settings.hourlyRate,
      unit: 'hour',
      amountCents: line.cents,
    }))
  if (transportDays > 0) {
    lines.push({
      code: 'transport',
      label: 'Transport',
      days: transportDays,
      hours: 0,
      rate: ctx.settings.transportPerDay,
      unit: 'day',
      amountCents: summary.transportCents,
    })
  }
  return lines
}

/** La cotisation est-elle active et en vigueur pour ce mois ? */
export function contributionApplies(contribution: Contribution, month: IsoMonth): boolean {
  if (!contribution.enabled) return false
  if (contribution.from && month < contribution.from) return false
  if (contribution.to && month > contribution.to) return false
  return true
}

/** Tranche atteinte par une assiette ; null si elle dépasse toutes les bornes. */
export function bracketFor(contribution: Contribution, amountCents: number): ContributionBracket | null {
  return contribution.brackets.find((bracket) => bracket.upTo === null || amountCents <= Math.round(bracket.upTo * 100)) ?? null
}

/**
 * Cotisation d'un mois. La tranche est choisie d'après l'assiette réelle ;
 * les taux s'appliquent à l'assiette bornée par le plancher et le plafond.
 * Un mois sans salaire ne cotise pas, même avec un plancher.
 */
export function computeContribution(
  contribution: Contribution,
  amounts: { basicCents: number; grossCents: number },
  round: boolean,
): ContributionLine {
  const amountCents = contribution.base === 'gross' ? amounts.grossCents : amounts.basicCents
  const bracket = amountCents > 0 ? bracketFor(contribution, amountCents) : null
  let baseCents = Math.max(0, amountCents)
  if (baseCents > 0 && contribution.floor !== null) baseCents = Math.max(baseCents, Math.round(contribution.floor * 100))
  if (contribution.ceiling !== null) baseCents = Math.min(baseCents, Math.round(contribution.ceiling * 100))
  // Centimes × centièmes de pour cent : produit entier exact, un seul arrondi
  // (au centime, ou directement à la roupie).
  const share = (rate: number) => {
    const exact = baseCents * Math.round(rate * 100)
    return round ? Math.round(exact / 1_000_000) * 100 : Math.round(exact / 10_000)
  }
  const employeeRate = bracket?.employeeRate ?? 0
  const employerRate = bracket?.employerRate ?? 0
  return {
    id: contribution.id,
    label: contribution.label,
    description: contribution.description,
    baseCents,
    employeeRate,
    employerRate,
    employeeCents: share(employeeRate),
    employerCents: share(employerRate),
  }
}

/** Date de paiement : dernier jour ouvré du mois, ou jour fixe du mois suivant. */
export function payDate(month: IsoMonth, ctx: CalcContext): IsoDate {
  const { payDay, workDays } = ctx.settings
  if (payDay >= 1 && payDay <= 28) return `${addMonths(month, 1)}-${String(payDay).padStart(2, '0')}`
  const first = firstDayOfMonth(month)
  for (let date = lastDayOfMonth(month); date >= first; date = addDays(date, -1)) {
    if (workDays.includes(isoWeekday(date)) && !ctx.holidays.has(date)) return date
  }
  return lastDayOfMonth(month)
}

export function computePayslip(month: IsoMonth, ctx: CalcContext): Payslip {
  const summary = summarizeMonth(month, ctx)
  const { settings } = ctx
  const basicCents = summary.prestationCents
  const grossCents = summary.totalCents
  const contributions = settings.contributions
    .filter((contribution) => contributionApplies(contribution, month))
    .map((contribution) => computeContribution(contribution, { basicCents, grossCents }, settings.roundContributions))
  const employeeCents = contributions.reduce((sum, line) => sum + line.employeeCents, 0)
  const employerCents = contributions.reduce((sum, line) => sum + line.employerCents, 0)
  return {
    month,
    start: maxDate(firstDayOfMonth(month), settings.periodStart),
    end: minDate(lastDayOfMonth(month), settings.periodEnd),
    payDate: payDate(month, ctx),
    summary,
    earnings: earningLines(summary, ctx),
    basicCents,
    transportCents: summary.transportCents,
    grossCents,
    contributions,
    employeeCents,
    employerCents,
    netCents: grossCents - employeeCents,
    costCents: grossCents + employerCents,
  }
}

export function sumPayroll(items: readonly PayrollTotals[]): PayrollTotals {
  const total: PayrollTotals = { grossCents: 0, employeeCents: 0, employerCents: 0, netCents: 0, costCents: 0 }
  for (const item of items) {
    total.grossCents += item.grossCents
    total.employeeCents += item.employeeCents
    total.employerCents += item.employerCents
    total.netCents += item.netCents
    total.costCents += item.costCents
  }
  return total
}

// ---- lecture défensive des cotisations enregistrées (JSON) ----

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function rate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

function sanitizeBracket(value: unknown): ContributionBracket | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const employeeRate = rate(item.employeeRate)
  const employerRate = rate(item.employerRate)
  if (employeeRate === null || employerRate === null) return null
  return { upTo: amount(item.upTo), employeeRate, employerRate }
}

function sanitizeContribution(value: unknown): Contribution | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const label = typeof item.label === 'string' ? item.label.trim() : ''
  const brackets = (Array.isArray(item.brackets) ? item.brackets : [])
    .map(sanitizeBracket)
    .filter((bracket): bracket is ContributionBracket => bracket !== null)
    // Bornes croissantes, la tranche sans limite en dernier.
    .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))
  if (!id || !label || brackets.length === 0) return null
  const month = (value: unknown) => (typeof value === 'string' && ISO_MONTH.test(value) ? value : null)
  return {
    id,
    label,
    description: typeof item.description === 'string' ? item.description.trim() : '',
    enabled: item.enabled !== false,
    base: item.base === 'gross' ? 'gross' : 'basic',
    floor: amount(item.floor),
    ceiling: amount(item.ceiling),
    brackets,
    from: month(item.from),
    to: month(item.to),
  }
}

/**
 * Cotisations lues depuis le serveur ou le stockage local : les éléments
 * invalides sont écartés. null si la valeur n'est pas une liste (colonne
 * absente) : l'appelant prend alors les valeurs par défaut.
 */
export function sanitizeContributions(value: unknown): Contribution[] | null {
  let parsed = value
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return null
    }
  }
  if (!Array.isArray(parsed)) return null
  const seen = new Set<string>()
  const list: Contribution[] = []
  for (const item of parsed) {
    const contribution = sanitizeContribution(item)
    if (!contribution || seen.has(contribution.id)) continue
    seen.add(contribution.id)
    list.push(contribution)
  }
  return list
}
