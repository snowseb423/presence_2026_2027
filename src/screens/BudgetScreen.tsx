import { ChevronDown, FileSpreadsheet, FileText, ReceiptText } from 'lucide-react'
import { useState } from 'react'
import { monthOf } from '../domain/dates.ts'
import { capitalize, formatDateNumeric, formatMonth, formatRs } from '../domain/format.ts'
import { type MonthSummary, summarizePeriod } from '../domain/pay.ts'
import { type Payslip, computePayslip, sumPayroll } from '../domain/payslip.ts'
import type { CalcContext, IsoDate, IsoMonth, Settings } from '../domain/types.ts'
import type { ExportFormat, ExportScope } from '../export/exporter.ts'
import { AppShell } from '../layout/AppShell.tsx'
import { ROUTE_PATHS, navigate } from '../lib/router.ts'
import { useToast } from '../ui/Toaster.tsx'
import { Button, Card, SectionTitle } from '../ui/controls.tsx'
import { Figures, PayrollFigures, VariancePill } from './shared.tsx'

function useExport(calc: CalcContext) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  async function run(scope: ExportScope, format: ExportFormat) {
    const key = `${scope.kind}-${scope.kind === 'month' ? scope.month : ''}-${format}`
    setBusy(key)
    try {
      // Chargé à la demande : la génération XLSX ou PDF n'alourdit pas le démarrage.
      const { exportData } = await import('../export/exporter.ts')
      const file = await exportData(calc, scope, format)
      toast({ message: `Fichier prêt : ${file}` })
    } catch (error) {
      toast({ message: `Export impossible : ${(error as Error).message}`, tone: 'error' })
    } finally {
      setBusy(null)
    }
  }
  return { run, busy }
}

function ExportButtons({
  scope,
  calc,
  label,
}: {
  scope: ExportScope
  calc: CalcContext
  label: string
}) {
  const { run, busy } = useExport(calc)
  const id = `${scope.kind}-${scope.kind === 'month' ? scope.month : ''}`
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        onClick={() => void run(scope, 'pdf')}
        disabled={busy !== null}
        aria-label={scope.kind === 'month' ? `Fiche de paie ${formatMonth(scope.month)} en PDF` : 'Fiches de paie de toute la période en PDF'}
      >
        <ReceiptText size={18} aria-hidden="true" />
        {busy === `${id}-pdf` ? 'Export…' : scope.kind === 'month' ? 'Fiche de paie (PDF)' : 'Toutes les fiches de paie (PDF)'}
      </Button>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
        <Button onClick={() => void run(scope, 'csv')} disabled={busy !== null} aria-label={`${label} en CSV`}>
          <FileText size={18} aria-hidden="true" />
          {busy === `${id}-csv` ? 'Export…' : 'CSV'}
        </Button>
        <Button onClick={() => void run(scope, 'xlsx')} disabled={busy !== null} aria-label={`${label} en XLSX (Excel)`}>
          <FileSpreadsheet size={18} aria-hidden="true" />
          {busy === `${id}-xlsx` ? 'Export…' : 'XLSX'}
        </Button>
      </div>
    </div>
  )
}

/** Rappel si la fiche de paie sortirait sans le nom de l'employée ou de l'employeur. */
function IdentityReminder({ settings }: { settings: Settings }) {
  const missing = [
    !(settings.employeeFullName.trim() || settings.employeeName.trim()) && 'de l’employée',
    !settings.employerName.trim() && 'de l’employeur',
  ].filter(Boolean)
  if (!missing.length) return null
  return (
    <p className="mt-2 text-sm text-ink-2">
      Nom {missing.join(' et ')} à compléter dans{' '}
      <a
        href={ROUTE_PATHS.settings}
        onClick={(event) => {
          event.preventDefault()
          navigate('settings')
        }}
        className="inline-flex min-h-11 items-center font-bold text-accent-strong underline underline-offset-4"
      >
        Réglages
      </a>
      .
    </p>
  )
}

function MonthBlock({ summary, slip, calc, open }: { summary: MonthSummary; slip: Payslip; calc: CalcContext; open: boolean }) {
  return (
    <details open={open} className="group rounded-3xl border border-line bg-surface shadow-card">
      <summary className="flex min-h-16 list-none items-center gap-3 rounded-3xl px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold leading-tight">{capitalize(formatMonth(summary.month))}</h3>
          <p className="text-sm text-ink-2">
            {summary.workedDays} jours prestés
            {summary.unpaidLeaveDays ? ` · ${summary.unpaidLeaveDays} congé${summary.unpaidLeaveDays > 1 ? 's' : ''}` : ''}
            {summary.unpaidAbsenceDays ? ` · ${summary.unpaidAbsenceDays} absence${summary.unpaidAbsenceDays > 1 ? 's' : ''}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="num font-display text-lg font-extrabold">{formatRs(summary.totalCents)}</span>
          {summary.varianceCents !== 0 ? <VariancePill cents={summary.varianceCents} /> : null}
        </div>
        <ChevronDown size={20} className="shrink-0 text-ink-2 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-line px-4 pb-4 pt-1">
        <Figures totals={summary} workDays={calc.settings.workDays} />
        {slip.contributions.length ? <PayrollFigures payroll={slip} contributions={slip.contributions} /> : null}
        <div className="mt-3">
          <ExportButtons scope={{ kind: 'month', month: summary.month }} calc={calc} label={`Exporter ${formatMonth(summary.month)}`} />
          <IdentityReminder settings={calc.settings} />
        </div>
      </div>
    </details>
  )
}

export function BudgetScreen({ calc, today }: { calc: CalcContext; today: IsoDate }) {
  const period = summarizePeriod(calc)
  const currentMonth: IsoMonth = monthOf(today)
  const { settings } = calc
  const total = period.totals
  const payslips = new Map(period.months.map((summary) => [summary.month, computePayslip(summary.month, calc, summary)]))
  const withContributions = [...payslips.values()].some((slip) => slip.contributions.length > 0)

  const hero = (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.16em] text-header-ink-2">
        Période {formatDateNumeric(settings.periodStart)} → {formatDateNumeric(settings.periodEnd)}
      </p>
      <p className="mt-2 font-display font-extrabold leading-none tracking-tight">
        <span className="mr-1.5 align-[0.9em] text-2xl text-header-ink-2">Rs</span>
        <span className="num text-[3.25rem]">{formatRs(total.totalCents).replace(/^Rs /, '')}</span>
      </p>
      <p className="num mt-2 text-[0.9375rem] text-header-ink-2">
        {total.workedDays} jours prestés · budget {formatRs(total.budgetCents)} · écart{' '}
        <span className="font-bold text-header-ink">{formatRs(total.varianceCents, { signed: true })}</span>
      </p>
    </div>
  )

  return (
    <AppShell title="Budget" hero={hero}>
      <Card>
        <h2 className="font-display text-lg font-bold">Exporter toute la période</h2>
        <p className="mb-3 text-sm text-ink-2">Une fiche de paie par mois, ou le détail jour par jour et le récapitulatif mensuel.</p>
        <ExportButtons scope={{ kind: 'period' }} calc={calc} label="Exporter toute la période" />
      </Card>

      {period.years.map((year) => (
        <section key={year.year} aria-labelledby={`year-${year.year}`} className="mt-7">
          <SectionTitle action={<span className="num font-display text-lg font-extrabold">{formatRs(year.totals.totalCents)}</span>}>
            <span id={`year-${year.year}`}>{year.year}</span>
          </SectionTitle>
          <p className="num -mt-1 mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2">
            {year.totals.workedDays} jours prestés · budget {formatRs(year.totals.budgetCents)}
            <VariancePill cents={year.totals.varianceCents} />
          </p>
          <div className="flex flex-col gap-3">
            {year.months.map((summary) => (
              <MonthBlock
                key={summary.month}
                summary={summary}
                slip={payslips.get(summary.month)!}
                calc={calc}
                open={summary.month === currentMonth}
              />
            ))}
          </div>
        </section>
      ))}

      <SectionTitle>Total de la période</SectionTitle>
      <Card>
        <Figures totals={total} workDays={settings.workDays} />
        {withContributions ? <PayrollFigures payroll={sumPayroll([...payslips.values()])} /> : null}
      </Card>
    </AppShell>
  )
}
