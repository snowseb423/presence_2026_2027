import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type PointerEvent, useRef, useState } from 'react'
import type { AppData } from '../data/mirror.ts'
import { addMonths, eachDay, firstDayOfMonth, isoWeekday, lastDayOfMonth, monthOf } from '../domain/dates.ts'
import { WEEKDAY_INITIALS, capitalize, formatDateLong, formatMonth, formatRs } from '../domain/format.ts'
import { computeDay, summarizeMonth } from '../domain/pay.ts'
import { computePayslip } from '../domain/payslip.ts'
import { sortRules } from '../domain/status.ts'
import type { CalcContext, IsoDate, IsoMonth } from '../domain/types.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { StatusGlyph } from '../ui/StatusGlyph.tsx'
import { Card, SectionTitle } from '../ui/controls.tsx'
import { shortLabel } from '../ui/status.ts'
import { DaySheet } from './DaySheet.tsx'
import { Figures, PayrollFigures, VariancePill } from './shared.tsx'

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

/** Glissement horizontal sur la grille : mois précédent / suivant. */
function useSwipe(onPrevious: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  return {
    onPointerDown: (event: PointerEvent) => {
      start.current = { x: event.clientX, y: event.clientY }
    },
    onPointerUp: (event: PointerEvent) => {
      const origin = start.current
      start.current = null
      if (!origin) return
      const dx = event.clientX - origin.x
      const dy = event.clientY - origin.y
      if (Math.abs(dx) < 60 || Math.abs(dy) > 45) return
      if (dx > 0) onPrevious()
      else onNext()
    },
    onPointerCancel: () => {
      start.current = null
    },
  }
}

export function MonthScreen({
  data,
  calc,
  today,
  month,
  onMonthChange,
}: {
  data: AppData
  calc: CalcContext
  today: IsoDate
  month: IsoMonth
  onMonthChange: (month: IsoMonth) => void
}) {
  const [openDate, setOpenDate] = useState<IsoDate | null>(null)
  const firstMonth = monthOf(calc.settings.periodStart)
  const lastMonth = monthOf(calc.settings.periodEnd)
  const canPrevious = month > firstMonth
  const canNext = month < lastMonth
  const previous = () => canPrevious && onMonthChange(addMonths(month, -1))
  const next = () => canNext && onMonthChange(addMonths(month, 1))
  const swipe = useSwipe(previous, next)

  const summary = summarizeMonth(month, calc)
  const slip = computePayslip(month, calc, summary)
  const days = eachDay(firstDayOfMonth(month), lastDayOfMonth(month))
  const offset = isoWeekday(days[0]!) - 1
  const rules = sortRules(calc.rules.values())

  const hero = (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={previous}
          disabled={!canPrevious}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-header-ink ring-1 ring-white/15 disabled:opacity-35"
          aria-label="Mois précédent"
        >
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <h2 className="min-w-0 text-center font-display text-[1.625rem] font-extrabold leading-tight" aria-live="polite">
          {capitalize(formatMonth(month))}
        </h2>
        <button
          type="button"
          onClick={next}
          disabled={!canNext}
          className="grid size-11 place-items-center rounded-full bg-white/10 text-header-ink ring-1 ring-white/15 disabled:opacity-35"
          aria-label="Mois suivant"
        >
          <ChevronRight size={22} aria-hidden="true" />
        </button>
      </div>
      <p className="num mt-2 text-center text-[0.9375rem] text-header-ink-2">
        <span className="font-bold text-header-ink">{formatRs(summary.totalCents)}</span> · {summary.workedDays} jours prestés
      </p>
    </div>
  )

  return (
    <AppShell title="Mois" hero={hero}>
      <div className="touch-pan-y select-none" {...swipe}>
        <div className="grid grid-cols-7 gap-1 pb-1.5" aria-hidden="true">
          {WEEKDAY_INITIALS.map((initial, index) => (
            <span key={index} className={`text-center text-sm font-bold ${index >= 5 ? 'text-ink-3' : 'text-ink-2'}`}>
              {initial}
            </span>
          ))}
        </div>
        <ol className="grid grid-cols-7 gap-1" aria-label={`Journées de ${formatMonth(month)}`}>
          {Array.from({ length: offset }, (_, i) => (
            <li key={`blank-${i}`} aria-hidden="true" />
          ))}
          {days.map((date) => {
            const day = computeDay(date, calc)
            const weekend = day.weekday >= 6
            const isToday = date === today
            const marked = Boolean(day.override?.comment) || day.hoursOverridden
            return (
              <li key={date}>
                <button
                  type="button"
                  disabled={!day.inPeriod}
                  onClick={() => setOpenDate(date)}
                  aria-label={`${formatDateLong(date)}${isToday ? ' (aujourd’hui)' : ''} : ${day.rule.label}, ${formatRs(day.totalCents)}${
                    day.override?.comment ? `, note : ${day.override.comment}` : ''
                  }`}
                  className={`relative flex h-[3.25rem] w-full flex-col items-center justify-center gap-1 rounded-xl border-2 transition-colors disabled:opacity-35 ${
                    isToday ? 'border-accent' : weekend ? 'border-dashed border-line' : 'border-transparent'
                  } ${
                    openDate === date
                      ? 'bg-header text-header-ink'
                      : weekend
                        ? 'bg-transparent text-ink-3'
                        : 'bg-surface text-ink shadow-[0_1px_0_var(--border)]'
                  }`}
                >
                  <span className={`num text-[0.9375rem] leading-none ${weekend ? 'font-semibold' : 'font-bold'}`}>
                    {Number(date.slice(8))}
                  </span>
                  <span className={`grid size-4 place-items-center rounded-full ${openDate === date ? 'bg-surface' : ''}`}>
                    <StatusGlyph rule={day.rule} size={13} />
                  </span>
                  {marked ? (
                    <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            )
          })}
        </ol>
      </div>

      {/* Légende collée au-dessus de la navigation tant que la grille est à l'écran. */}
      <ul
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-20 mt-3 grid grid-cols-3 gap-x-2 gap-y-1 rounded-2xl border border-line bg-surface/95 px-3 py-2.5 shadow-card backdrop-blur-md"
        aria-label="Légende des statuts"
      >
        {rules.map((rule) => (
          <li key={rule.code} className="flex items-center gap-1.5 text-[0.8125rem] leading-tight text-ink-2">
            <StatusGlyph rule={rule} size={13} />
            {shortLabel(rule)}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-[0.8125rem] leading-tight text-ink-2">
          <span className="grid size-[13px] shrink-0 place-items-center" aria-hidden="true">
            <span className="size-1.5 rounded-full bg-accent" />
          </span>
          Note, heures
        </li>
      </ul>

      <SectionTitle action={<VariancePill cents={summary.varianceCents} />}>Détail du mois</SectionTitle>
      <Card>
        <Figures totals={summary} workDays={calc.settings.workDays} />
        {slip.contributions.length || slip.bonus ? (
          <PayrollFigures payroll={slip} contributions={slip.contributions} bonus={slip.bonus} />
        ) : null}
      </Card>
      <p className="mt-3 text-sm text-ink-2">
        {`Jours non prestés par défaut : ${WEEKDAY_NAMES.filter((_, i) => !calc.settings.workDays.includes(i + 1)).join(', ') || 'aucun'}.`}
      </p>

      <DaySheet date={openDate} onClose={() => setOpenDate(null)} calc={calc} data={data} />
    </AppShell>
  )
}
