// Calcul des montants dus. Module pur : aucune dépendance à React, au
// réseau ou au stockage. Tous les montants sont en centimes entiers pour
// éviter les erreurs d'arrondi des flottants.
import {
  eachDay,
  eachMonth,
  firstDayOfMonth,
  isoWeekday,
  lastDayOfMonth,
  maxDate,
  minDate,
  monthOf,
} from './dates.ts'
import { STATUS, defaultStatus, fallbackRule, isPresence } from './status.ts'
import type { CalcContext, Holiday, IsoDate, IsoMonth, Override, StatusCode, StatusRule } from './types.ts'

export interface DayComputation {
  date: IsoDate
  /** 1 = lundi … 7 = dimanche. */
  weekday: number
  inPeriod: boolean
  /** Jour de prestation habituel (lundi → vendredi par défaut). */
  isWorkDay: boolean
  holiday: Holiday | null
  defaultStatus: StatusCode
  /** Statut effectif : la saisie si elle existe, sinon le défaut. */
  status: StatusCode
  rule: StatusRule
  override: Override | null
  /** Heures payées effectives (forçage éventuel compris). */
  hours: number
  hoursOverridden: boolean
  prestationCents: number
  transportCents: number
  totalCents: number
  /** L'employée est venue ce jour-là. */
  isPresence: boolean
}

export interface Totals {
  /** Jours de prestation du mois dans la période, fériés compris. */
  workingDays: number
  /** Jours fériés tombant un jour de prestation. */
  weekdayHolidays: number
  /** Congés non payés (à la demande de l'employée). */
  unpaidLeaveDays: number
  /** Absences non payées (imprévus). */
  unpaidAbsenceDays: number
  /** Jours avec des heures payées. */
  paidDays: number
  /** Jours prestés (Travaillé, Demi-journée, Jour supplémentaire). */
  workedDays: number
  halfDays: number
  extraDays: number
  paidLeaveDays: number
  paidHolidayDays: number
  hours: number
  prestationCents: number
  transportCents: number
  totalCents: number
  /** Budget de référence : les mêmes jours sans aucune saisie. */
  budgetCents: number
  /** Total − budget de référence. */
  varianceCents: number
}

export interface MonthSummary extends Totals {
  month: IsoMonth
  /** Jours du mois compris dans la période. */
  days: DayComputation[]
}

export interface YearSummary {
  year: number
  months: MonthSummary[]
  totals: Totals
}

export interface PeriodSummary {
  months: MonthSummary[]
  years: YearSummary[]
  totals: Totals
}

/** Montant d'une journée : heures × taux + transport éventuel, en centimes. */
export function dayAmountCents(
  hours: number,
  hourlyRate: number,
  transportPaid: boolean,
  transportPerDay: number,
): { prestationCents: number; transportCents: number; totalCents: number } {
  // Produit d'entiers (centièmes d'heure × centimes) : exact, un seul arrondi.
  const prestationCents = Math.round((Math.round(hours * 100) * Math.round(hourlyRate * 100)) / 100)
  const transportCents = transportPaid ? Math.round(transportPerDay * 100) : 0
  return { prestationCents, transportCents, totalCents: prestationCents + transportCents }
}

export function computeDay(
  date: IsoDate,
  ctx: CalcContext,
  options: { ignoreOverrides?: boolean } = {},
): DayComputation {
  const { settings } = ctx
  const weekday = isoWeekday(date)
  const inPeriod = date >= settings.periodStart && date <= settings.periodEnd
  const holiday = ctx.holidays.get(date) ?? null
  const byDefault = defaultStatus(date, settings, ctx.holidays)
  const override = options.ignoreOverrides ? null : (ctx.overrides.get(date) ?? null)
  const status = override?.statusCode ?? byDefault
  const rule = ctx.rules.get(status) ?? fallbackRule(status)
  const hoursOverridden = override?.hoursOverride != null
  const hours = inPeriod ? (override?.hoursOverride ?? rule.paidHours) : 0
  const amounts = inPeriod
    ? dayAmountCents(hours, settings.hourlyRate, rule.transportPaid, settings.transportPerDay)
    : { prestationCents: 0, transportCents: 0, totalCents: 0 }

  return {
    date,
    weekday,
    inPeriod,
    isWorkDay: settings.workDays.includes(weekday),
    holiday,
    defaultStatus: byDefault,
    status,
    rule,
    override,
    hours,
    hoursOverridden,
    ...amounts,
    isPresence: inPeriod && isPresence(status),
  }
}

export function emptyTotals(): Totals {
  return {
    workingDays: 0,
    weekdayHolidays: 0,
    unpaidLeaveDays: 0,
    unpaidAbsenceDays: 0,
    paidDays: 0,
    workedDays: 0,
    halfDays: 0,
    extraDays: 0,
    paidLeaveDays: 0,
    paidHolidayDays: 0,
    hours: 0,
    prestationCents: 0,
    transportCents: 0,
    totalCents: 0,
    budgetCents: 0,
    varianceCents: 0,
  }
}

const TOTAL_KEYS = Object.keys(emptyTotals()) as (keyof Totals)[]

export function sumTotals(items: readonly Totals[]): Totals {
  const sum = emptyTotals()
  for (const item of items) {
    for (const key of TOTAL_KEYS) sum[key] += item[key]
  }
  sum.hours = Math.round(sum.hours * 100) / 100
  return sum
}

/** Totaux d'une liste de journées (toutes supposées dans la période). */
export function totalsOfDays(days: readonly DayComputation[], ctx: CalcContext): Totals {
  const totals = emptyTotals()
  let hoursCenti = 0
  for (const day of days) {
    if (!day.inPeriod) continue
    if (day.isWorkDay) {
      totals.workingDays += 1
      if (day.holiday) totals.weekdayHolidays += 1
    }
    switch (day.status) {
      case STATUS.congeNonPaye:
        totals.unpaidLeaveDays += 1
        break
      case STATUS.absenceNonPayee:
        totals.unpaidAbsenceDays += 1
        break
      case STATUS.demiJournee:
        totals.halfDays += 1
        break
      case STATUS.jourSupplementaire:
        totals.extraDays += 1
        break
      case STATUS.congePaye:
        totals.paidLeaveDays += 1
        break
      case STATUS.feriePaye:
        totals.paidHolidayDays += 1
        break
    }
    if (day.hours > 0) totals.paidDays += 1
    if (day.isPresence) totals.workedDays += 1
    hoursCenti += Math.round(day.hours * 100)
    totals.prestationCents += day.prestationCents
    totals.transportCents += day.transportCents
    totals.totalCents += day.totalCents
    totals.budgetCents += computeDay(day.date, ctx, { ignoreOverrides: true }).totalCents
  }
  totals.hours = hoursCenti / 100
  totals.varianceCents = totals.totalCents - totals.budgetCents
  return totals
}

/** Journées du mois comprises dans la période. */
export function daysOfMonth(month: IsoMonth, ctx: CalcContext): DayComputation[] {
  const start = maxDate(firstDayOfMonth(month), ctx.settings.periodStart)
  const end = minDate(lastDayOfMonth(month), ctx.settings.periodEnd)
  if (start > end) return []
  return eachDay(start, end).map((date) => computeDay(date, ctx))
}

export function summarizeMonth(month: IsoMonth, ctx: CalcContext): MonthSummary {
  const days = daysOfMonth(month, ctx)
  return { month, days, ...totalsOfDays(days, ctx) }
}

/** Mois couverts par la période, du premier au dernier. */
export function periodMonths(settings: CalcContext['settings']): IsoMonth[] {
  if (settings.periodEnd < settings.periodStart) return []
  return eachMonth(monthOf(settings.periodStart), monthOf(settings.periodEnd))
}

export function summarizePeriod(ctx: CalcContext): PeriodSummary {
  const months = periodMonths(ctx.settings).map((month) => summarizeMonth(month, ctx))
  const byYear = new Map<number, MonthSummary[]>()
  for (const summary of months) {
    const year = Number(summary.month.slice(0, 4))
    byYear.set(year, [...(byYear.get(year) ?? []), summary])
  }
  const years = [...byYear.entries()].map(([year, list]) => ({ year, months: list, totals: sumTotals(list) }))
  return { months, years, totals: sumTotals(months) }
}
