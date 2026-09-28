import { ArrowRight, Clock3, ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import type { AppData } from '../data/mirror.ts'
import { monthOf, weekOf } from '../domain/dates.ts'
import {
  WEEKDAY_INITIALS,
  capitalize,
  formatDateLong,
  formatDayMonth,
  formatMonth,
  formatRs,
  weekdayName,
} from '../domain/format.ts'
import { computeDay, summarizeMonth } from '../domain/pay.ts'
import { sortRules } from '../domain/status.ts'
import type { CalcContext, IsoDate } from '../domain/types.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { ROUTE_PATHS, navigate } from '../lib/router.ts'
import { Sheet } from '../ui/Sheet.tsx'
import { StatusGlyph } from '../ui/StatusGlyph.tsx'
import { Button, Card, SectionTitle } from '../ui/controls.tsx'
import { statusVars } from '../ui/status.ts'
import { DaySheet } from './DaySheet.tsx'
import { LastEdit, StatusChoice, VariancePill, formula, isPending } from './shared.tsx'
import { useDayActions } from './useDayActions.ts'

/** Nombre de statuts proposés en accès direct (les premiers par ordre). */
const QUICK_COUNT = 4

export function TodayScreen({ data, calc, today }: { data: AppData; calc: CalcContext; today: IsoDate }) {
  const [selected, setSelected] = useState(today)
  const [sheet, setSheet] = useState<'all' | 'details' | null>(null)
  const actions = useDayActions(calc)
  const { state } = useAuth()

  // Passage à minuit : on revient sur le nouveau jour.
  useEffect(() => setSelected(today), [today])

  const day = computeDay(selected, calc)
  const rules = sortRules(calc.rules.values())
  const quick = rules.slice(0, QUICK_COUNT)
  const month = summarizeMonth(monthOf(today), calc)
  const upcoming = month.days.filter((d) => d.date > today && d.isPresence).length
  const isToday = selected === today
  const name = calc.settings.employeeName.trim()
  const amount = formatRs(day.totalCents).replace(/^Rs /, '')

  const hero = (
    <div className="pt-1">
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-header-ink-2">
        {isToday ? 'Aujourd’hui' : 'Journée choisie'}
        {name ? ` · ${name}` : ''}
      </p>
      <p className="mt-1 font-display text-[2.375rem] font-extrabold leading-[1.02] tracking-tight">
        {capitalize(weekdayName(selected))}
        <br />
        {formatDayMonth(selected)}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className="inline-flex min-h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-[0.9375rem] font-bold text-ink"
          style={statusVars(day.rule.colorToken)}
        >
          <StatusGlyph rule={day.rule} size={16} />
          {day.rule.label}
        </span>
        <span className="text-[0.9375rem] text-header-ink-2">
          {day.override ? (isPending(day.override) ? 'en attente d’envoi' : 'saisi') : 'par défaut'}
          {day.holiday ? ` · férié : ${day.holiday.name}` : ''}
        </span>
      </div>
      <p className="mt-5 font-display font-extrabold leading-none tracking-tight">
        <span className="mr-1.5 align-[0.9em] text-2xl text-header-ink-2">Rs</span>
        <span className="num text-[4rem]">{amount}</span>
      </p>
      <p className="mt-2 text-[0.9375rem] text-header-ink-2">{formula(day, calc.settings)}</p>
      {!isToday ? (
        <button
          type="button"
          onClick={() => setSelected(today)}
          className="mt-2 min-h-11 font-bold text-header-accent underline underline-offset-4"
        >
          Revenir à aujourd’hui
        </button>
      ) : null}
    </div>
  )

  return (
    <AppShell title="Présence" hero={hero}>
      <SectionTitle>Changer le statut</SectionTitle>
      {!day.inPeriod ? (
        <p className="mb-3 rounded-2xl bg-surface-2 p-3 text-[0.9375rem] text-ink-2">
          Cette date est hors de la période suivie ; modifiez la période dans les réglages si besoin.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5">
        {quick.map((rule) => (
          <StatusChoice
            key={rule.code}
            rule={rule}
            selected={day.status === rule.code}
            isDefault={day.defaultStatus === rule.code}
            disabled={!day.inPeriod}
            onSelect={() => void actions.setStatus(selected, rule.code)}
          />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <Button variant="quiet" onClick={() => setSheet('all')} disabled={!day.inPeriod}>
          <ListChecks size={18} aria-hidden="true" />
          Autres statuts
        </Button>
        <Button variant="quiet" onClick={() => setSheet('details')}>
          <Clock3 size={18} aria-hidden="true" />
          Heures, note
        </Button>
      </div>
      {day.override ? (
        <div className="mt-2">
          <LastEdit override={day.override} members={data.members} currentUserId={state.status === 'signedIn' ? state.user.id : undefined} />
        </div>
      ) : null}

      <SectionTitle>Cette semaine</SectionTitle>
      <ol className="grid grid-cols-7 gap-1">
        {weekOf(today).map((date, index) => {
          const d = computeDay(date, calc)
          const active = date === selected
          const weekend = index >= 5
          return (
            <li key={date}>
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${formatDateLong(date)}${date === today ? ' (aujourd’hui)' : ''} : ${d.rule.label}`}
                onClick={() => setSelected(date)}
                className={`relative flex min-h-[4.75rem] w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 transition-colors ${
                  active
                    ? 'border-header bg-header text-header-ink'
                    : weekend
                      ? 'border-dashed border-line bg-transparent text-ink-2'
                      : 'border-line bg-surface text-ink'
                }`}
              >
                <span className="text-xs font-bold">{WEEKDAY_INITIALS[index]}</span>
                <span className="num font-display text-lg font-bold leading-none">{Number(date.slice(8))}</span>
                <span className="grid size-5 place-items-center rounded-full bg-surface">
                  <StatusGlyph rule={d.rule} size={13} />
                </span>
                {date === today ? (
                  <span
                    className={`absolute inset-x-3 -bottom-0.5 h-1 rounded-full ${active ? 'bg-header-accent' : 'bg-accent'}`}
                    aria-hidden="true"
                  />
                ) : null}
              </button>
            </li>
          )
        })}
      </ol>

      <SectionTitle
        action={
          <a
            href={ROUTE_PATHS.budget}
            onClick={(event) => {
              event.preventDefault()
              navigate('budget')
            }}
            className="inline-flex min-h-11 items-center gap-1 font-bold text-accent-strong"
          >
            Budget <ArrowRight size={16} aria-hidden="true" />
          </a>
        }
      >
        Ce mois-ci
      </SectionTitle>
      <Card>
        <p className="font-display text-lg font-bold">{capitalize(formatMonth(month.month))}</p>
        <dl className="mt-3 grid grid-cols-3 gap-3">
          <div>
            <dt className="text-sm text-ink-2">Jours prestés</dt>
            <dd className="num font-display text-2xl font-extrabold">{month.workedDays}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-sm text-ink-2">Total à payer</dt>
            <dd className="num font-display text-2xl font-extrabold">{formatRs(month.totalCents)}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-3 text-[0.9375rem] text-ink-2">
          <VariancePill cents={month.varianceCents} />
          <span>par rapport au budget de référence ({formatRs(month.budgetCents)})</span>
        </div>
        {upcoming > 0 ? (
          <p className="mt-2 text-sm text-ink-2">
            Projection : {upcoming === 1 ? 'le jour à venir est compté' : `les ${upcoming} jours à venir sont comptés`} comme
            travaillés.
          </p>
        ) : null}
      </Card>

      <Sheet open={sheet === 'all'} onClose={() => setSheet(null)} title="Tous les statuts" subtitle={capitalize(formatDateLong(selected))}>
        <div className="grid grid-cols-2 gap-2">
          {rules.map((rule) => (
            <StatusChoice
              key={rule.code}
              rule={rule}
              selected={day.status === rule.code}
              isDefault={day.defaultStatus === rule.code}
              onSelect={() => {
                void actions.setStatus(selected, rule.code)
                setSheet(null)
              }}
            />
          ))}
        </div>
      </Sheet>

      <DaySheet date={sheet === 'details' ? selected : null} onClose={() => setSheet(null)} calc={calc} data={data} />
    </AppShell>
  )
}
