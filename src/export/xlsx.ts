// Classeur XLSX : « Récapitulatif » (un mois par ligne, totaux par année et
// de période) et « Détail » (un jour par ligne). Montants au format Rs.
import writeXlsxFile, { type Cell as XlsxCell, type SheetData } from 'write-excel-file/universal'
import { sumTotals } from '../domain/pay.ts'
import { formatHours, formatRupees } from '../domain/format.ts'
import type { CalcContext } from '../domain/types.ts'
import {
  type Cell,
  DAY_HEADERS,
  type ExportScope,
  SUMMARY_HEADERS,
  dayRow,
  exportDays,
  exportSummaries,
  scopeTitle,
  summaryRows,
} from './tables.ts'

const HEADER = {
  fontWeight: 'bold',
  backgroundColor: '#2A211B',
  textColor: '#F6EDE4',
  wrap: true,
  alignVertical: 'center',
} as const

const TOTAL = { fontWeight: 'bold', backgroundColor: '#FCE7DA' } as const

/** Colonnes monétaires (index) de chaque feuille. */
const SUMMARY_MONEY = new Set([8, 9, 10, 11, 12])
const DAY_MONEY = new Set([7, 8, 9, 10])
const SUMMARY_HOURS = new Set([7])
const DAY_HOURS = new Set([5])

function styled(value: Cell, column: number, options: { money: Set<number>; hours: Set<number>; format: string; total: boolean }): XlsxCell {
  const base = options.total ? TOTAL : {}
  if (value === null) return options.total ? { value: '', ...base } : null
  if (typeof value === 'number') {
    if (options.money.has(column)) return { value, type: Number, format: options.format, ...base }
    if (options.hours.has(column)) return { value, type: Number, format: '0.##', ...base }
    return { value, type: Number, ...base }
  }
  return { value, type: String, wrap: column === DAY_HEADERS.length - 1, ...base }
}

export async function buildXlsx(calc: CalcContext, scope: ExportScope): Promise<Blob> {
  const days = exportDays(calc, scope)
  const { rows: recapRows, totalRows } = summaryRows(calc, scope)
  const totals = sumTotals(exportSummaries(calc, scope))
  const hasCents = days.some((day) => day.totalCents % 100 !== 0 || day.prestationCents % 100 !== 0)
  const format = hasCents ? '"Rs "#,##0.00' : '"Rs "#,##0'
  const { settings } = calc

  const recap: SheetData = [
    [{ value: scopeTitle(calc, scope), fontWeight: 'bold', fontSize: 14 }],
    [
      {
        value: `Taux horaire ${formatRupees(settings.hourlyRate)} · ${formatHours(settings.hoursPerDay)} par jour · transport ${formatRupees(settings.transportPerDay)} par jour presté`,
        textColor: '#5C4B3F',
      },
    ],
    [null],
    SUMMARY_HEADERS.map((header) => ({ value: header, ...HEADER })),
    ...recapRows.map((row, index) =>
      row.map((cell, column) =>
        styled(cell, column, { money: SUMMARY_MONEY, hours: SUMMARY_HOURS, format, total: totalRows.includes(index) }),
      ),
    ),
  ]

  const detail: SheetData = [
    DAY_HEADERS.map((header) => ({ value: header, ...HEADER })),
    ...days.map((day) =>
      dayRow(day, calc).map((cell, column) => styled(cell, column, { money: DAY_MONEY, hours: DAY_HOURS, format, total: false })),
    ),
    [
      'TOTAL',
      null,
      `${totals.workedDays} jours prestés`,
      null,
      null,
      totals.hours,
      null,
      null,
      totals.prestationCents / 100,
      totals.transportCents / 100,
      totals.totalCents / 100,
      `Budget ${formatRupees(totals.budgetCents / 100)}, écart ${formatRupees(totals.varianceCents / 100)}`,
    ].map((cell, column) =>
      styled(cell as Cell, column, { money: DAY_MONEY, hours: DAY_HOURS, format, total: true }),
    ),
  ]

  return writeXlsxFile(
    [
      {
        data: recap,
        sheet: 'Récapitulatif',
        columns: [{ width: 22 }, ...SUMMARY_HEADERS.slice(1).map(() => ({ width: 13 }))],
        stickyRowsCount: 4,
      },
      {
        data: detail,
        sheet: 'Détail',
        columns: [
          { width: 12 },
          { width: 11 },
          { width: 20 },
          { width: 11 },
          { width: 26 },
          { width: 9 },
          { width: 9 },
          { width: 11 },
          { width: 13 },
          { width: 12 },
          { width: 12 },
          { width: 40 },
        ],
        stickyRowsCount: 1,
      },
    ],
    { fontFamily: 'Calibri', fontSize: 11 },
  ).toBlob()
}
