// CSV pour Excel en français : séparateur « ; », virgule décimale, BOM UTF-8
// (accents correctement lus), fins de ligne CRLF.
import { sumTotals } from '../domain/pay.ts'
import type { CalcContext } from '../domain/types.ts'
import { type Cell, DAY_HEADERS, type ExportScope, dayRow, exportDays, exportSummaries } from './tables.ts'

const BOM = '﻿'

export function csvNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2).replace(/0$/, '').replace('.', ',')
}

export function csvField(value: Cell): string {
  if (value === null) return ''
  const text = typeof value === 'number' ? csvNumber(value) : value
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: readonly (readonly Cell[])[]): string {
  return BOM + rows.map((row) => row.map(csvField).join(';')).join('\r\n') + '\r\n'
}

/** Détail jour par jour de la portée demandée, avec une ligne de total. */
export function buildDailyCsv(calc: CalcContext, scope: ExportScope): string {
  const totals = sumTotals(exportSummaries(calc, scope))
  const total: Cell[] = [
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
    `Budget de référence : ${csvNumber(totals.budgetCents / 100)} ; écart : ${csvNumber(totals.varianceCents / 100)}`,
  ]
  return toCsv([[...DAY_HEADERS], ...exportDays(calc, scope).map((day) => dayRow(day, calc)), total])
}
