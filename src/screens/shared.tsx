import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Member } from '../domain/types.ts'
import { formatDateNumeric, formatHours, formatMonthRange, formatPercent, formatRs, formatRupees, formatTimestamp } from '../domain/format.ts'
import type { DayComputation, Totals } from '../domain/pay.ts'
import type { ContributionLine, PayrollTotals, YearEndBonus } from '../domain/payslip.ts'
import type { EffectiveOverride } from '../data/ops.ts'
import type { Settings, StatusRule } from '../domain/types.ts'
import { StatusGlyph } from '../ui/StatusGlyph.tsx'
import { statusVars } from '../ui/status.ts'

/** Bouton de choix d'un statut (écran du jour, feuille de détail). */
export function StatusChoice({
  rule,
  selected,
  isDefault,
  disabled,
  onSelect,
}: {
  rule: StatusRule
  selected: boolean
  isDefault?: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      style={statusVars(rule.colorToken)}
      className={`flex min-h-14 items-center gap-2.5 rounded-2xl border-2 px-3 py-2 text-left transition-colors active:scale-[0.99] disabled:opacity-45 ${
        selected
          ? 'border-[var(--st)] bg-[var(--st-soft)] text-[var(--st-ink)]'
          : 'border-line bg-surface text-ink hover:bg-surface-2'
      }`}
    >
      <StatusGlyph rule={rule} size={18} />
      <span className="min-w-0 flex-1 text-[0.9375rem] font-bold leading-tight">
        {rule.label}
        {isDefault ? (
          <span className={`block text-[0.8125rem] font-semibold ${selected ? '' : 'text-ink-2'}`}>par défaut</span>
        ) : null}
      </span>
      {selected ? <Check size={18} strokeWidth={3} className="shrink-0" aria-hidden="true" /> : null}
    </button>
  )
}

/** Écart par rapport au budget, en pastille. */
export function VariancePill({ cents, className = '' }: { cents: number; className?: string }) {
  const token = cents < 0 ? 'coral' : cents > 0 ? 'lagoon' : null
  return (
    <span
      className={`num inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold ${
        token ? 'bg-[var(--st-soft)] text-[var(--st-ink)]' : 'bg-surface-2 text-ink-2'
      } ${className}`}
      style={token ? statusVars(token) : undefined}
    >
      {cents === 0 ? 'écart Rs 0' : formatRs(cents, { signed: true })}
    </span>
  )
}

/** Explication du montant d'une journée. */
export function formula(day: DayComputation, settings: Settings): string {
  if (!day.inPeriod) return 'Hors de la période suivie'
  if (day.totalCents === 0) {
    if (day.status === 'week_end') return 'Pas de prestation le week-end'
    if (day.status === 'non_concerne') return 'Jour non concerné'
    if (day.status === 'ferie_non_paye') return 'Jour férié non payé'
    return 'Aucun montant dû'
  }
  const parts: string[] = []
  if (day.hours > 0) parts.push(`${formatHours(day.hours)} × ${formatRupees(settings.hourlyRate)}`)
  if (day.transportCents > 0) parts.push(`transport ${formatRs(day.transportCents)}`)
  return parts.join(' + ') + (day.hoursOverridden ? ' · heures forcées' : '')
}

/** Saisie encore dans la file d'envoi (affichage optimiste). */
export function isPending(override: EffectiveOverride | null): boolean {
  return override?.pending === true
}

export function memberName(members: readonly Member[], userId: string | null, currentUserId?: string): string | null {
  if (!userId) return null
  if (userId === currentUserId) return 'vous'
  const member = members.find((m) => m.userId === userId)
  return member?.displayName ?? member?.email.split('@')[0] ?? null
}

/** « Modifié par … le … » (discret, sous le détail d'une journée). */
export function LastEdit({
  override,
  members,
  currentUserId,
}: {
  override: EffectiveOverride | null
  members: readonly Member[]
  currentUserId?: string
}) {
  if (!override) return null
  if (override.pending) return <p className="text-sm text-ink-2">En attente de synchronisation.</p>
  const who = memberName(members, override.updatedBy, currentUserId)
  const when = formatTimestamp(override.updatedAt)
  return <p className="text-sm text-ink-2">{who ? `Modifié par ${who}, ${when}` : `Modifié ${when}`}</p>
}

function Row({ label, value, strong, hint }: { label: ReactNode; value: ReactNode; strong?: boolean; hint?: ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2 ${strong ? 'text-[1.0625rem]' : ''}`}>
      <dt className={strong ? 'font-display font-extrabold tracking-wide text-ink' : 'text-ink-2'}>
        {label}
        {hint ? <span className="block text-sm text-ink-2">{hint}</span> : null}
      </dt>
      <dd className={`num text-right ${strong ? 'font-display font-extrabold text-ink' : 'font-bold text-ink'}`}>{value}</dd>
    </div>
  )
}

const DAY_LETTERS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']

export function workDaysLabel(workDays: readonly number[]): string {
  const sorted = [...workDays].sort((a, b) => a - b)
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1]! + 1)
  if (sorted.length > 2 && contiguous) return `${DAY_LETTERS[sorted[0]! - 1]}–${DAY_LETTERS[sorted.at(-1)! - 1]}`
  return sorted.map((d) => DAY_LETTERS[d - 1]).join(', ')
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count > 1 ? many : one}`
}

/** Bloc de chiffres d'un mois (ou d'un total) : tel que demandé pour le budget. */
export function Figures({ totals, workDays }: { totals: Totals; workDays: readonly number[] }) {
  const extras = [
    totals.halfDays && plural(totals.halfDays, 'demi-journée', 'demi-journées'),
    totals.extraDays && plural(totals.extraDays, 'jour supplémentaire', 'jours supplémentaires'),
    totals.paidLeaveDays && plural(totals.paidLeaveDays, 'congé payé', 'congés payés'),
    totals.paidHolidayDays && plural(totals.paidHolidayDays, 'férié payé', 'fériés payés'),
  ].filter(Boolean)
  return (
    <>
      <dl className="divide-y divide-line">
        <Row label={`Jours ouvrés (${workDaysLabel(workDays)})`} value={totals.workingDays} />
        <Row label="Fériés en semaine" value={totals.weekdayHolidays} />
        <Row label="Congés non payés" value={totals.unpaidLeaveDays} />
        <Row label="Absences non payées" value={totals.unpaidAbsenceDays} />
        <Row label="Jours payés" value={totals.paidDays} hint={`dont ${plural(totals.workedDays, 'jour presté', 'jours prestés')}`} />
        <Row label="Heures" value={formatHours(totals.hours)} />
        <Row label="Prestation" value={formatRs(totals.prestationCents)} />
        <Row label="Transport" value={formatRs(totals.transportCents)} />
        <Row label="SALAIRE BRUT" value={formatRs(totals.totalCents)} strong />
        <Row label="Budget de référence" value={formatRs(totals.budgetCents)} hint="sans aucune absence" />
        <Row label="Écart" value={<VariancePill cents={totals.varianceCents} />} />
      </dl>
      {extras.length ? <p className="mt-2 text-sm text-ink-2">Dont {extras.join(', ')}.</p> : null}
    </>
  )
}

/** « CSG 1,5 %, NSF 1 % » : cotisations dont la part demandée n'est pas nulle. */
function ratesHint(lines: readonly ContributionLine[], share: 'employeeRate' | 'employerRate'): string | undefined {
  const parts = lines
    .filter((line) => line[share] > 0)
    .map((line) => `${line.bonus ? `${line.label} sur le bonus` : line.label} ${formatPercent(line[share])}`)
  return parts.length ? parts.join(', ') : undefined
}

/** « 1/12 des gains de septembre à décembre 2026 · 75 % au plus tard le 18/12/2026 ». */
function bonusHint(bonus: YearEndBonus): string {
  const what = bonus.base === 'gross' ? 'des gains' : 'du salaire de base'
  return `1/12 ${what} de ${formatMonthRange(bonus.months)} · 75 % au plus tard le ${formatDateNumeric(bonus.advanceBy)}`
}

/**
 * Suite de la fiche de paie : bonus de fin d'année (décembre), retenues,
 * net à payer, cotisations patronales, coût employeur.
 */
export function PayrollFigures({
  payroll,
  contributions = [],
  bonus = null,
}: {
  payroll: PayrollTotals
  contributions?: readonly ContributionLine[]
  bonus?: YearEndBonus | null
}) {
  return (
    <dl className="divide-y divide-line border-t border-line">
      {payroll.bonusCents > 0 ? (
        <Row
          label="Bonus de fin d’année"
          value={formatRs(payroll.bonusCents, { signed: true })}
          hint={bonus ? bonusHint(bonus) : undefined}
        />
      ) : null}
      <Row label="Retenues salariales" value={formatRs(-payroll.employeeCents)} hint={ratesHint(contributions, 'employeeRate')} />
      <Row label="NET À PAYER" value={formatRs(payroll.netCents)} strong />
      <Row label="Cotisations patronales" value={formatRs(payroll.employerCents)} hint={ratesHint(contributions, 'employerRate')} />
      <Row
        label="Coût employeur"
        value={formatRs(payroll.costCents)}
        hint={`salaire brut${payroll.bonusCents > 0 ? ' + bonus' : ''} + cotisations patronales`}
      />
    </dl>
  )
}
