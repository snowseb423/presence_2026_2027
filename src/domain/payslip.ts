// Fiche de paie d'un mois : rémunération détaillée, cotisations sociales,
// net à payer et coût employeur. Module pur ; montants en centimes entiers.
import { addDays, addMonths, firstDayOfMonth, isoWeekday, lastDayOfMonth, maxDate, minDate } from './dates.ts'
import { DEFAULT_CONTRIBUTIONS } from './defaults.ts'
import { type MonthSummary, periodMonths, summarizeMonth } from './pay.ts'
import { STATUS } from './status.ts'
import type { CalcContext, Contribution, ContributionBase, ContributionBracket, Holiday, IsoDate, IsoMonth, StatusCode } from './types.ts'

export interface EarningLine {
  /** Code du statut, « transport » ou « bonus ». */
  code: StatusCode
  label: string
  days: number
  /** Heures payées (0 pour le transport et le bonus). */
  hours: number
  /** Taux horaire, ou transport par jour (Rs) ; 0 pour le bonus. */
  rate: number
  unit: 'hour' | 'day' | 'bonus'
  amountCents: number
}

export interface ContributionLine {
  id: string
  label: string
  description: string
  /** Cotisation sur le bonus de fin d'année, calculée à part. */
  bonus: boolean
  /** Assiette retenue, plancher et plafond appliqués. */
  baseCents: number
  employeeRate: number
  employerRate: number
  employeeCents: number
  employerCents: number
}

/** Bonus de fin d'année (art. 54 du Workers' Rights Act 2019). */
export interface YearEndBonus {
  /** Mois de l'année pris en compte : ceux compris dans la période suivie. */
  months: IsoMonth[]
  /** Gains retenus : brut (avec le transport) ou salaire de base. */
  base: ContributionBase
  /** Gains de ces mois servant de base. */
  earningsCents: number
  /** 1/12 des gains. */
  cents: number
  /** Part « salaire de base » du bonus : assiette des cotisations sur le bonus. */
  basicCents: number
  /** 75 % à verser au plus tard ce jour-là (5 jours ouvrés avant Noël)… */
  advanceBy: IsoDate
  /** … et le solde au plus tard le dernier jour ouvré de l'année. */
  balanceBy: IsoDate
}

export interface PayrollTotals {
  /** Brut, bonus de fin d'année compris. */
  grossCents: number
  /** Bonus de fin d'année (0 hors décembre). */
  bonusCents: number
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
  bonus: YearEndBonus | null
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
    bonus: false,
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

/** `count`-ième jour ouvré (lundi → vendredi, hors fériés) avant `date`. */
function workingDayBefore(date: IsoDate, count: number, holidays: ReadonlyMap<IsoDate, Holiday>): IsoDate {
  let day = date
  for (let found = 0; found < count; ) {
    day = addDays(day, -1)
    if (isoWeekday(day) <= 5 && !holidays.has(day)) found += 1
  }
  return day
}

/**
 * Bonus de fin d'année, sur la fiche de décembre : 1/12 des gains des mois
 * de l'année compris dans la période suivie (l'app ne connaît pas les
 * autres). `december` : récapitulatif de décembre déjà calculé, s'il existe.
 */
export function yearEndBonus(month: IsoMonth, ctx: CalcContext, december?: MonthSummary): YearEndBonus | null {
  const { settings } = ctx
  if (!settings.endOfYearBonus || !month.endsWith('-12')) return null
  const year = month.slice(0, 4)
  const months = periodMonths(settings).filter((item) => item.startsWith(`${year}-`))
  if (!months.includes(month)) return null
  let basicTotal = 0
  let grossTotal = 0
  for (const item of months) {
    const summary = item === month && december ? december : summarizeMonth(item, ctx)
    basicTotal += summary.prestationCents
    grossTotal += summary.totalCents
  }
  const earningsCents = settings.endOfYearBonusBase === 'basic' ? basicTotal : grossTotal
  return {
    months,
    base: settings.endOfYearBonusBase,
    earningsCents,
    cents: Math.round(earningsCents / 12),
    basicCents: Math.round(basicTotal / 12),
    advanceBy: workingDayBefore(`${year}-12-25`, 5, ctx.holidays),
    balanceBy: workingDayBefore(`${Number(year) + 1}-01-01`, 1, ctx.holidays),
  }
}

/** `summary` : récapitulatif du mois déjà calculé, s'il est disponible. */
export function computePayslip(month: IsoMonth, ctx: CalcContext, summary: MonthSummary = summarizeMonth(month, ctx)): Payslip {
  const { settings } = ctx
  const basicCents = summary.prestationCents
  const applicable = settings.contributions.filter((contribution) => contributionApplies(contribution, month))
  const contributions = applicable.map((contribution) =>
    computeContribution(contribution, { basicCents, grossCents: summary.totalCents }, settings.roundContributions),
  )
  const earnings = earningLines(summary, ctx)
  const bonus = yearEndBonus(month, ctx, summary)
  if (bonus) {
    earnings.push({ code: 'bonus', label: 'Bonus de fin d’année', days: 0, hours: 0, rate: 0, unit: 'bonus', amountCents: bonus.cents })
    // Cotisations sur le bonus : calculées à part, sur sa part « salaire de base ».
    for (const contribution of applicable) {
      if (!contribution.onBonus) continue
      const line = computeContribution(contribution, { basicCents: bonus.basicCents, grossCents: bonus.cents }, settings.roundContributions)
      contributions.push({ ...line, bonus: true })
    }
  }
  const bonusCents = bonus?.cents ?? 0
  const grossCents = summary.totalCents + bonusCents
  const employeeCents = contributions.reduce((sum, line) => sum + line.employeeCents, 0)
  const employerCents = contributions.reduce((sum, line) => sum + line.employerCents, 0)
  return {
    month,
    start: maxDate(firstDayOfMonth(month), settings.periodStart),
    end: minDate(lastDayOfMonth(month), settings.periodEnd),
    payDate: payDate(month, ctx),
    summary,
    earnings,
    basicCents,
    transportCents: summary.transportCents,
    bonus,
    grossCents,
    bonusCents,
    contributions,
    employeeCents,
    employerCents,
    netCents: grossCents - employeeCents,
    costCents: grossCents + employerCents,
  }
}

export function sumPayroll(items: readonly PayrollTotals[]): PayrollTotals {
  const total: PayrollTotals = { grossCents: 0, bonusCents: 0, employeeCents: 0, employerCents: 0, netCents: 0, costCents: 0 }
  for (const item of items) {
    total.grossCents += item.grossCents
    total.bonusCents += item.bonusCents
    total.employeeCents += item.employeeCents
    total.employerCents += item.employerCents
    total.netCents += item.netCents
    total.costCents += item.costCents
  }
  return total
}

// ---- lecture défensive des cotisations enregistrées (JSON) ----

const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const DEFAULT_ON_BONUS = new Map(DEFAULT_CONTRIBUTIONS.map((contribution) => [contribution.id, contribution.onBonus]))

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
    // Enregistrée avant l'ajout du bonus : réglage par défaut de la même cotisation.
    onBonus: typeof item.onBonus === 'boolean' ? item.onBonus : (DEFAULT_ON_BONUS.get(id) ?? false),
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
