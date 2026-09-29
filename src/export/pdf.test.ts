import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, DEFAULT_STATUS_RULES } from '../domain/defaults.ts'
import type { CalcContext, Override, Settings } from '../domain/types.ts'
import { PdfDocument, encodeWinAnsi, fitText, textWidth, wrapText } from './pdf.ts'
import { buildPayslipPdf, dayList, payslipTitle } from './payslip-pdf.ts'
import { fileBaseName } from './tables.ts'

/**
 * Octets du PDF relus en WinAnsi (windows-1252) : texte comparable
 * directement, espaces insécables des montants ramenées à des espaces
 * (même longueur : les positions des objets ne bougent pas).
 */
const decode = (bytes: Uint8Array) => new TextDecoder('windows-1252').decode(bytes).replace(/ /g, ' ')

/** Opérateur d'affichage d'un texte dans le flux (parenthèses échappées). */
const shown = (text: string) => `(${text.replace(/[()\\]/g, (char) => `\\${char}`)}) Tj`

/** Vérifie la table des références croisées : chaque objet est à l'octet annoncé. */
function checkXref(pdf: string): number {
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1])
  expect(pdf.slice(start, start + 4)).toBe('xref')
  const [, count] = /^xref\n0 (\d+)\n/.exec(pdf.slice(start)) ?? []
  const entries = pdf.slice(start).split('\n').slice(3, 2 + Number(count))
  entries.forEach((entry, index) => {
    expect(entry).toMatch(/^\d{10} 00000 n $/)
    expect(pdf.slice(Number(entry.slice(0, 10))).startsWith(`${index + 1} 0 obj\n`)).toBe(true)
  })
  return entries.length
}

describe('écriture PDF', () => {
  it('code le texte en WinAnsi', () => {
    expect(encodeWinAnsi('Payé à l’employée : 10 €')).toEqual([
      0x50, 0x61, 0x79, 0xe9, 0x20, 0xe0, 0x20, 0x6c, 0x92, 0x65, 0x6d, 0x70, 0x6c, 0x6f, 0x79, 0xe9, 0x65, 0x20, 0x3a, 0x20,
      0x31, 0x30, 0x20, 0x80,
    ])
    // Espace fine insécable et signe moins des montants de l'app.
    expect(encodeWinAnsi('\u2212Rs\u00a01\u202f674')).toEqual([0x96, 0x52, 0x73, 0xa0, 0x31, 0xa0, 0x36, 0x37, 0x34])
    expect(encodeWinAnsi('Łódź 日\n')).toEqual([0x3f, 0xf3, 0x64, 0x7a, 0x20, 0x3f, 0x20])
  })

  it('mesure le texte avec les métriques de Helvetica', () => {
    expect(textWidth('AV', 'regular', 10)).toBeCloseTo(13.34)
    expect(textWidth('A', 'bold', 1000)).toBe(722)
    expect(textWidth('ab', 'regular', 10, 1)).toBeCloseTo(13.12)
    expect(textWidth('é', 'regular', 1000)).toBe(textWidth('e', 'regular', 1000))
  })

  it('coupe les lignes et abrège ce qui dépasse', () => {
    expect(wrapText('12, rue des Flamboyants\nQuatre-Bornes', 'regular', 10, 1000)).toEqual(['12, rue des Flamboyants', 'Quatre-Bornes'])
    const lines = wrapText('un deux trois quatre cinq six', 'regular', 10, 60)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => textWidth(line, 'regular', 10) <= 60)).toBe(true)
    const word = wrapText('adresse.tres.longue@example.com', 'regular', 10, 50)
    expect(word.join('')).toBe('adresse.tres.longue@example.com')
    expect(word.every((line) => textWidth(line, 'regular', 10) <= 50)).toBe(true)
    expect(fitText('Court', 'regular', 10, 100)).toBe('Court')
    const fitted = fitText('Portable Retirement Gratuity Fund', 'regular', 10, 80)
    expect(fitted.endsWith('…')).toBe(true)
    expect(textWidth(fitted, 'regular', 10)).toBeLessThanOrEqual(80)
  })

  it('produit un fichier dont les références croisées sont exactes', () => {
    const doc = new PdfDocument({ title: 'Essai — été', createdAt: new Date('2026-10-30T10:00:00Z') })
    doc.addPage().text(40, 60, 'Parenthèses (et \\ barre)', { font: 'bold', align: 'right' })
    doc.addPage().rect(40, 40, 100, 50, { fill: '#fce7da', stroke: '#c2410c', radius: 8 })
    const pdf = decode(doc.toBytes())
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    expect(checkXref(pdf)).toBe(5 + 2 * 2)
    expect(pdf).toContain('/Count 2')
    expect(pdf).toContain('(Parenthèses \\(et \\\\ barre\\)) Tj')
    expect(pdf).toContain('/CreationDate (D:20261030100000Z)')
    // Titre en UTF-16BE : « Essai — été ».
    expect(pdf).toContain('/Title <FEFF0045007300730061006900202014002000E9007400E9>')
  })
})

function context(settings: Partial<Settings> = {}, overrides: string[] = []): CalcContext {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    rules: new Map(DEFAULT_STATUS_RULES.map((rule) => [rule.code, rule])),
    holidays: new Map(DEFAULT_HOLIDAYS.map((holiday) => [holiday.date, holiday])),
    overrides: new Map(
      overrides.map((date): [string, Override] => [
        date,
        { date, statusCode: 'conge_non_paye', hoursOverride: null, comment: null, updatedAt: '2026-10-01T00:00:00Z', updatedBy: null },
      ]),
    ),
  }
}

const IDENTITY: Partial<Settings> = {
  employeeName: 'Marie',
  employeeFullName: 'Marie-Claire Dupont',
  employeeNic: 'D0101801234567',
  employerName: 'Famille Lefèvre',
  employerRegistration: 'E1234567',
  employeePaymentMethod: 'Virement bancaire',
}

describe('fiche de paie PDF', () => {
  it('octobre 2026 avec 3 congés non payés : une page, montants et identités', () => {
    const bytes = buildPayslipPdf(context(IDENTITY, ['2026-10-12', '2026-10-13', '2026-10-14']), ['2026-10'], {
      generatedAt: new Date('2026-10-30T10:00:00Z'),
    })
    const pdf = decode(bytes)
    checkXref(pdf)
    expect(pdf).toContain('/Count 1')
    for (const text of [
      'FICHE DE PAIE',
      'Octobre 2026',
      'Période du 01/10/2026 au 31/10/2026',
      'Payé le 30/10/2026',
      'Mode de paiement : Virement bancaire',
      'Famille Lefèvre',
      'N° d’employeur (ERN) : E1234567',
      'Marie-Claire Dupont',
      'NIC : D0101801234567',
      'Heures travaillées',
      'Rs 9 690,00',
      'Rs 10 602,00',
      'NET À PAYER',
      'Rs 10 360,00',
      '12, 13 et 14 oct.',
    ]) {
      expect(pdf, text).toContain(shown(text))
    }
    expect(pdf).toContain('(Établie le 30/10/2026 avec Présence · Cotisations selon les taux paramétrés')
  })

  it('toutes les fiches de la période : une page par mois, numérotées', () => {
    const ctx = context()
    const pdf = decode(buildPayslipPdf(ctx, ['2026-09', '2026-10', '2026-11'], { generatedAt: new Date('2026-12-01T10:00:00Z') }))
    expect(pdf).toContain('/Count 3')
    expect(pdf).toContain('(Page 3/3) Tj')
    expect(pdf).toContain('(À compléter dans Réglages) Tj')
  })

  it('nomme et titre les fiches', () => {
    const ctx = context(IDENTITY)
    expect(fileBaseName(ctx, { kind: 'month', month: '2026-10' }, 'pdf')).toBe('fiche-de-paie-2026-10')
    expect(fileBaseName(ctx, { kind: 'period' }, 'pdf')).toBe('fiches-de-paie-2026-09_2027-12')
    expect(payslipTitle(ctx, ['2026-10'])).toBe('Fiche de paie — octobre 2026 — Marie-Claire Dupont')
    expect(payslipTitle(context(), ['2026-09', '2027-12'])).toBe('Fiches de paie — septembre 2026 à décembre 2027')
  })

  it('liste les jours d’un mois', () => {
    expect(dayList([])).toBe('')
    expect(dayList(['2026-10-20'])).toBe('20 oct.')
    expect(dayList(['2026-10-12', '2026-10-13', '2026-10-14'])).toBe('12, 13 et 14 oct.')
  })
})
