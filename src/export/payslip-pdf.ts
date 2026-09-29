// Fiche de paie au format PDF (A4) : une page par mois, suite éventuelle si
// le contenu déborde. Chargé à la demande, comme les autres exports.
import { todayIn } from '../domain/dates.ts'
import { capitalize, formatDateNumeric, formatHours, formatMonth, formatNumber, formatPercent, formatRs, monthShort } from '../domain/format.ts'
import { type Payslip, computePayslip } from '../domain/payslip.ts'
import { STATUS } from '../domain/status.ts'
import type { CalcContext, IsoDate, IsoMonth, Settings, StatusCode } from '../domain/types.ts'
import { A4, type Color, type Font, PdfDocument, type PdfPage, fitText, wrapText } from './pdf.ts'

// Palette de l'app, lisible à l'impression.
const INK = '#2a211b'
const INK_2 = '#5c4b3f'
const INK_3 = '#766152'
const LINE = '#eaddd0'
const LINE_STRONG = '#d8c4b1'
const SURFACE = '#f8efe6'
const ACCENT = '#c2410c'
const ACCENT_STRONG = '#9a3412'
const ACCENT_SOFT = '#fce7da'

const MARGIN = 42
const RIGHT = A4.width - MARGIN
const CONTENT_WIDTH = RIGHT - MARGIN
/** Bas de la zone de contenu, au-dessus du pied de page. */
const CONTENT_BOTTOM = A4.height - 44
const CELL_PADDING = 8

const money = (cents: number) => formatRs(cents, { fixed: true })

/** Curseur vertical, avec passage à une page de suite si un bloc ne tient pas. */
class Flow {
  page: PdfPage
  y = MARGIN
  readonly pages: PdfPage[] = []
  private readonly doc: PdfDocument
  private readonly continuation: string

  constructor(doc: PdfDocument, continuation: string) {
    this.doc = doc
    this.continuation = continuation
    this.page = this.newPage()
  }

  private newPage(): PdfPage {
    const page = this.doc.addPage()
    this.pages.push(page)
    return page
  }

  /** Page de suite si `height` points ne tiennent plus sur la page. */
  ensure(height: number): void {
    if (this.y + height > CONTENT_BOTTOM) this.breakPage()
  }

  breakPage(): void {
    this.page = this.newPage()
    this.page.text(MARGIN, MARGIN + 10, this.continuation, { font: 'bold', size: 10, color: INK_2 })
    this.y = MARGIN + 28
  }
}

function label(page: PdfPage, x: number, y: number, text: string, color: Color = INK_3): void {
  page.text(x, y, text.toLocaleUpperCase('fr'), { font: 'bold', size: 7.5, color, spacing: 0.6 })
}

// ---- en-tête ----

function drawHeader(flow: Flow, slip: Payslip, settings: Settings): void {
  const { page } = flow
  const top = flow.y + 14
  page.text(MARGIN, top, 'FICHE DE PAIE', { font: 'bold', size: 20, color: INK, spacing: 0.5 })
  page.text(MARGIN, top + 20, capitalize(formatMonth(slip.month)), { font: 'bold', size: 13, color: ACCENT_STRONG })
  const details = [
    `Période du ${formatDateNumeric(slip.start)} au ${formatDateNumeric(slip.end)}`,
    `Payé le ${formatDateNumeric(slip.payDate)}`,
    settings.employeePaymentMethod.trim() ? `Mode de paiement : ${settings.employeePaymentMethod.trim()}` : '',
  ].filter(Boolean)
  details.forEach((line, index) => page.text(RIGHT, top - 5 + index * 13, line, { size: 9, color: INK_2, align: 'right' }))
  page.line(MARGIN, top + 30, RIGHT, top + 30, { color: ACCENT, width: 1.5 })
  flow.y = top + 42
}

// ---- employeur et salariée ----

interface Party {
  title: string
  name: string
  lines: string[]
}

function employerParty(settings: Settings): Party {
  const registration = settings.employerRegistration.trim()
  return {
    title: 'Employeur',
    name: settings.employerName.trim(),
    lines: [
      settings.employerAddress,
      settings.employerPhone.trim() ? `Tél. : ${settings.employerPhone.trim()}` : '',
      settings.employerEmail.trim(),
      registration ? `N° d’employeur (ERN) : ${registration}` : '',
    ],
  }
}

function employeeParty(settings: Settings): Party {
  return {
    title: 'Salariée',
    name: settings.employeeFullName.trim() || settings.employeeName.trim(),
    lines: [
      settings.employeeAddress,
      settings.employeeNic.trim() ? `NIC : ${settings.employeeNic.trim()}` : '',
      settings.employeeJobTitle.trim() ? `Emploi : ${settings.employeeJobTitle.trim()}` : '',
      settings.employeeHireDate ? `Entrée le ${formatDateNumeric(settings.employeeHireDate)}` : '',
      settings.employeeBankAccount.trim() ? `Compte : ${settings.employeeBankAccount.trim()}` : '',
    ],
  }
}

function drawParties(flow: Flow, parties: [Party, Party]): void {
  const gap = 12
  const width = (CONTENT_WIDTH - gap) / 2
  const pad = 12
  const inner = width - pad * 2
  const blocks = parties.map((party) => ({
    ...party,
    nameLines: party.name ? wrapText(party.name, 'bold', 11, inner) : ['À compléter dans Réglages'],
    detailLines: party.lines.flatMap((line) => (line.trim() ? wrapText(line, 'regular', 8.5, inner) : [])),
  }))
  const heightOf = (block: (typeof blocks)[number]) => pad + 18 + block.nameLines.length * 14 + block.detailLines.length * 11.5 + pad
  const height = Math.max(...blocks.map(heightOf))
  flow.ensure(height)
  const { page, y } = flow
  blocks.forEach((block, index) => {
    const x = MARGIN + index * (width + gap)
    page.rect(x, y, width, height, { fill: SURFACE, radius: 8 })
    label(page, x + pad, y + pad + 6, block.title)
    let line = y + pad + 22
    for (const name of block.nameLines) {
      page.text(x + pad, line, name, { font: 'bold', size: 11, color: block.name ? INK : INK_3 })
      line += 14
    }
    for (const detail of block.detailLines) {
      page.text(x + pad, line, detail, { size: 8.5, color: INK_2 })
      line += 11.5
    }
  })
  flow.y = y + height + 14
}

// ---- tableaux ----

interface Column {
  header: string
  width: number
  align: 'left' | 'right'
}

interface Row {
  cells: string[]
  /** Seconde ligne, plus petite, sous la première cellule. */
  note?: string
}

function cellX(columns: Column[], index: number): number {
  const left = MARGIN + columns.slice(0, index).reduce((sum, column) => sum + column.width, 0)
  return columns[index]!.align === 'right' ? left + columns[index]!.width - CELL_PADDING : left + CELL_PADDING
}

function drawCells(page: PdfPage, columns: Column[], y: number, cells: string[], font: Font, size: number, color: Color): void {
  cells.forEach((cell, index) => {
    const column = columns[index]!
    if (!cell) return
    const text = fitText(cell, font, size, column.width - CELL_PADDING * 2)
    page.text(cellX(columns, index), y, text, { font, size, color, align: column.align })
  })
}

function drawTable(flow: Flow, columns: Column[], rows: Row[], total: string[]): void {
  const headerHeight = 20
  const rowHeight = (row: Row) => (row.note ? 25 : 18)
  const totalHeight = 22
  // En-tête et première ligne restent ensemble.
  flow.ensure(headerHeight + rowHeight(rows[0] ?? { cells: [] }) + totalHeight)
  let { page } = flow
  const header = () => {
    const y = flow.y
    page.rect(MARGIN, y, CONTENT_WIDTH, headerHeight, { fill: SURFACE, radius: 4 })
    columns.forEach((column, index) =>
      page.text(cellX(columns, index), y + 13, column.header.toLocaleUpperCase('fr'), {
        font: 'bold',
        size: 7.5,
        color: INK_2,
        align: column.align,
        spacing: 0.4,
      }),
    )
    flow.y = y + headerHeight
  }
  header()
  rows.forEach((row, index) => {
    const height = rowHeight(row)
    // La dernière ligne reste avec le total.
    if (flow.y + height + (index === rows.length - 1 ? totalHeight : 0) > CONTENT_BOTTOM) {
      flow.breakPage()
      page = flow.page
      header()
    }
    const y = flow.y
    drawCells(page, columns, y + 12.5, row.cells, 'regular', 9.5, INK)
    if (row.note) {
      // La note occupe la place libre sous les deux premières colonnes.
      const noteWidth = columns[0]!.width + (columns[1]?.width ?? 0) - CELL_PADDING * 2
      page.text(cellX(columns, 0), y + 21.5, fitText(row.note, 'regular', 7.5, noteWidth), { size: 7.5, color: INK_3 })
    }
    page.line(MARGIN, y + height, RIGHT, y + height, { color: LINE, width: 0.6 })
    flow.y = y + height
  })
  const y = flow.y
  page.line(MARGIN, y, RIGHT, y, { color: INK, width: 0.8 })
  drawCells(page, columns, y + 14.5, total, 'bold', 9.5, INK)
  flow.y = y + totalHeight + 12
}

function drawEarnings(flow: Flow, slip: Payslip): void {
  const columns: Column[] = [
    { header: 'Rémunération', width: CONTENT_WIDTH - 300, align: 'left' },
    { header: 'Jours', width: 60, align: 'right' },
    { header: 'Heures', width: 70, align: 'right' },
    { header: 'Taux', width: 80, align: 'right' },
    { header: 'Montant', width: 90, align: 'right' },
  ]
  const rows: Row[] = slip.earnings.map((line) => ({
    cells: [
      line.label,
      String(line.days),
      line.unit === 'hour' ? formatHours(line.hours) : '',
      `${money(Math.round(line.rate * 100))} / ${line.unit === 'hour' ? 'h' : 'jour'}`,
      money(line.amountCents),
    ],
  }))
  if (rows.length === 0) rows.push({ cells: ['Aucune heure payée ce mois-ci', '', '', '', money(0)] })
  drawTable(flow, columns, rows, ['Salaire brut', '', '', '', money(slip.grossCents)])
}

function drawContributions(flow: Flow, slip: Payslip): void {
  const columns: Column[] = [
    { header: 'Cotisations', width: CONTENT_WIDTH - 360, align: 'left' },
    { header: 'Assiette', width: 80, align: 'right' },
    { header: 'Taux sal.', width: 55, align: 'right' },
    { header: 'Retenue', width: 75, align: 'right' },
    { header: 'Taux pat.', width: 60, align: 'right' },
    { header: 'Part patronale', width: 90, align: 'right' },
  ]
  const rate = (value: number) => (value > 0 ? formatPercent(value) : '–')
  const share = (cents: number, value: number) => (value > 0 ? money(cents) : '–')
  const rows: Row[] = slip.contributions.map((line) => ({
    cells: [
      line.label,
      money(line.baseCents),
      rate(line.employeeRate),
      share(line.employeeCents, line.employeeRate),
      rate(line.employerRate),
      share(line.employerCents, line.employerRate),
    ],
    note: line.description || undefined,
  }))
  if (rows.length === 0) rows.push({ cells: ['Aucune cotisation ce mois-ci', '', '', '', '', ''] })
  drawTable(flow, columns, rows, ['Total des cotisations', '', '', money(slip.employeeCents), '', money(slip.employerCents)])
}

// ---- net à payer ----

function drawNet(flow: Flow, slip: Payslip): void {
  const height = 48
  flow.ensure(height)
  const { page, y } = flow
  page.rect(MARGIN, y, CONTENT_WIDTH, height, { fill: ACCENT_SOFT, stroke: ACCENT, lineWidth: 1, radius: 8 })
  page.text(MARGIN + 14, y + 20, 'NET À PAYER', { font: 'bold', size: 13, color: INK, spacing: 0.5 })
  page.text(MARGIN + 14, y + 35, `Salaire brut ${money(slip.grossCents)} − retenues salariales ${money(slip.employeeCents)}`, {
    size: 8.5,
    color: INK_2,
  })
  page.text(RIGHT - 14, y + 31, money(slip.netCents), { font: 'bold', size: 20, color: ACCENT_STRONG, align: 'right' })
  flow.y = y + height + 14
}

// ---- présence et coût employeur ----

interface Figure {
  label: string
  value: string
  strong?: boolean
  note?: string
}

/** « 12, 13 et 14 oct. » (dates d'un même mois). */
export function dayList(dates: readonly IsoDate[]): string {
  if (dates.length === 0) return ''
  const days = dates.map((date) => String(Number(date.slice(8))))
  const joined = days.length > 1 ? `${days.slice(0, -1).join(', ')} et ${days.at(-1)}` : days[0]
  return `${joined} ${monthShort(dates[0]!)}`
}

function presenceFigures(slip: Payslip): Figure[] {
  const { summary } = slip
  const datesOf = (code: StatusCode) => summary.days.filter((day) => day.status === code).map((day) => day.date)
  const count = (code: StatusCode, text: string, always = false): Figure | null => {
    const dates = datesOf(code)
    if (!dates.length && !always) return null
    return { label: text, value: String(dates.length), note: dayList(dates) || undefined }
  }
  const holidays = summary.days.filter((day) => day.holiday && day.isWorkDay).map((day) => day.date)
  return [
    { label: 'Jours ouvrés', value: String(summary.workingDays) },
    { label: 'Jours prestés', value: String(summary.workedDays) },
    { label: 'Heures payées', value: formatHours(summary.hours) },
    count(STATUS.congeNonPaye, 'Congés non payés', true),
    count(STATUS.absenceNonPayee, 'Absences non payées', true),
    count(STATUS.congePaye, 'Congés payés'),
    holidays.length ? { label: 'Jours fériés', value: String(holidays.length), note: dayList(holidays) } : null,
  ].filter((figure): figure is Figure => figure !== null)
}

function costFigures(slip: Payslip): Figure[] {
  return [
    { label: 'Salaire brut', value: money(slip.grossCents) },
    { label: 'Cotisations patronales', value: money(slip.employerCents) },
    { label: 'Coût total employeur', value: money(slip.costCents), strong: true },
    {
      label: 'À verser à la MRA',
      value: money(slip.employeeCents + slip.employerCents),
      note: 'Retenues salariales et cotisations patronales',
    },
  ]
}

function drawFigureBoxes(flow: Flow, boxes: [{ title: string; figures: Figure[] }, { title: string; figures: Figure[] }]): void {
  const gap = 12
  const width = (CONTENT_WIDTH - gap) / 2
  const pad = 12
  const heightOf = (figures: Figure[]) => pad + 16 + figures.reduce((sum, f) => sum + 14 + (f.note ? 9 : 0), 0) + pad - 4
  const height = Math.max(...boxes.map((box) => heightOf(box.figures)))
  flow.ensure(height)
  const { page, y } = flow
  boxes.forEach((box, index) => {
    const x = MARGIN + index * (width + gap)
    page.rect(x, y, width, height, { stroke: LINE_STRONG, lineWidth: 0.8, radius: 8 })
    label(page, x + pad, y + pad + 6, box.title)
    let line = y + pad + 23
    for (const figure of box.figures) {
      const font: Font = figure.strong ? 'bold' : 'regular'
      page.text(x + pad, line, figure.label, { font, size: 9, color: figure.strong ? INK : INK_2 })
      page.text(x + width - pad, line, figure.value, { font: 'bold', size: 9, color: INK, align: 'right' })
      if (figure.note) {
        line += 9
        page.text(x + pad, line, fitText(figure.note, 'regular', 7.5, width - pad * 2), { size: 7.5, color: INK_3 })
      }
      line += 14
    }
  })
  flow.y = y + height + 16
}

// ---- signatures et pied de page ----

function drawSignatures(flow: Flow): void {
  const height = 50
  flow.ensure(height)
  const { page, y } = flow
  const width = (CONTENT_WIDTH - 12) / 2
  ;['Signature de l’employeur', 'Signature de la salariée'].forEach((text, index) => {
    const x = MARGIN + index * (width + 12)
    page.text(x, y + 10, text, { size: 8.5, color: INK_2 })
    page.line(x, y + 46, x + width - 24, y + 46, { color: LINE_STRONG, width: 0.8, dash: 2 })
  })
  flow.y = y + height
}

function drawFooter(page: PdfPage, text: string, pageLabel: string | null): void {
  const y = A4.height - 26
  page.line(MARGIN, y - 10, RIGHT, y - 10, { color: LINE, width: 0.6 })
  page.text(MARGIN, y, fitText(text, 'regular', 7, CONTENT_WIDTH - (pageLabel ? 50 : 0)), { size: 7, color: INK_3 })
  if (pageLabel) page.text(RIGHT, y, pageLabel, { size: 7, color: INK_3, align: 'right' })
}

// ---- document ----

export interface PayslipPdfOptions {
  /** Date d'établissement (pied de page et métadonnées). */
  generatedAt?: Date
}

export function payslipTitle(calc: CalcContext, months: readonly IsoMonth[]): string {
  const who = calc.settings.employeeFullName.trim() || calc.settings.employeeName.trim()
  const what =
    months.length === 1
      ? `Fiche de paie — ${formatMonth(months[0]!)}`
      : `Fiches de paie — ${formatMonth(months[0] ?? '')} à ${formatMonth(months.at(-1) ?? '')}`
  return who ? `${what} — ${who}` : what
}

/** Fiches de paie des mois demandés, une (ou plusieurs) page(s) par mois. */
export function buildPayslipPdf(calc: CalcContext, months: readonly IsoMonth[], options: PayslipPdfOptions = {}): Uint8Array<ArrayBuffer> {
  const generatedAt = options.generatedAt ?? new Date()
  const { settings } = calc
  const doc = new PdfDocument({
    title: payslipTitle(calc, months),
    author: settings.employerName.trim() || undefined,
    subject: 'Fiche de paie',
    createdAt: generatedAt,
  })
  const pages: PdfPage[] = []
  for (const month of months) {
    const slip = computePayslip(month, calc)
    const flow = new Flow(doc, `Fiche de paie — ${formatMonth(month)} (suite)`)
    drawHeader(flow, slip, settings)
    drawParties(flow, [employerParty(settings), employeeParty(settings)])
    drawEarnings(flow, slip)
    drawContributions(flow, slip)
    drawNet(flow, slip)
    drawFigureBoxes(flow, [
      { title: 'Présence du mois', figures: presenceFigures(slip) },
      { title: 'Coût employeur', figures: costFigures(slip) },
    ])
    drawSignatures(flow)
    pages.push(...flow.pages)
  }
  const footer =
    `Établie le ${formatDateNumeric(todayIn(undefined, generatedAt))} avec Présence · Cotisations selon les taux` +
    ` paramétrés dans l’app${settings.roundContributions ? ' (arrondies à la roupie)' : ''}, à vérifier auprès de la MRA.`
  pages.forEach((page, index) => drawFooter(page, footer, pages.length > 1 ? `Page ${formatNumber(index + 1)}/${formatNumber(pages.length)}` : null))
  return doc.toBytes()
}
