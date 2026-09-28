import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, DEFAULT_STATUS_RULES } from '../domain/defaults.ts'
import type { CalcContext, Override } from '../domain/types.ts'
import { buildDailyCsv, csvField, csvNumber } from './csv.ts'
import { fileBaseName, summaryRows } from './tables.ts'
import { buildXlsx } from './xlsx.ts'

function context(overrides: Override[] = []): CalcContext {
  return {
    settings: { ...DEFAULT_SETTINGS, employeeName: 'Marie' },
    rules: new Map(DEFAULT_STATUS_RULES.map((rule) => [rule.code, rule])),
    holidays: new Map(DEFAULT_HOLIDAYS.map((holiday) => [holiday.date, holiday])),
    overrides: new Map(overrides.map((override) => [override.date, override])),
  }
}

const leave = (date: string, comment: string | null = null): Override => ({
  date,
  statusCode: 'conge_non_paye',
  hoursOverride: null,
  comment,
  updatedAt: '2026-09-28T08:00:00Z',
  updatedBy: null,
})

describe('CSV', () => {
  it('formate les nombres et champs pour Excel en français', () => {
    expect(csvNumber(558)).toBe('558')
    expect(csvNumber(1.5)).toBe('1,5')
    expect(csvNumber(255.25)).toBe('255,25')
    expect(csvField('a;b')).toBe('"a;b"')
    expect(csvField('dit "oui"')).toBe('"dit ""oui"""')
    expect(csvField(null)).toBe('')
  })

  it('exporte octobre 2026 jour par jour avec le total', () => {
    const csv = buildDailyCsv(
      context([leave('2026-10-12', 'Mariage; famille'), leave('2026-10-13'), leave('2026-10-14')]),
      { kind: 'month', month: '2026-10' },
    )
    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines).toHaveLength(1 + 31 + 1)
    expect(lines[0]).toBe(
      'Date;Jour;Statut;Saisie;Férié;Heures payées;Heures forcées;Taux horaire (Rs);Prestation (Rs);Transport (Rs);Total (Rs);Commentaire',
    )
    expect(lines[1]).toBe('01/10/2026;Jeudi;Travaillé;par défaut;;3;;170;510;48;558;')
    expect(lines[12]).toBe('12/10/2026;Lundi;Congé non payé;saisi;;0;;170;0;0;0;"Mariage; famille"')
    expect(lines.at(-1)).toMatch(/^TOTAL;;19 jours prestés;;;57;;;9690;912;10602;/)
  })

  it('exporte toute la période : 487 jours, Rs 187 488', () => {
    const csv = buildDailyCsv(context(), { kind: 'period' })
    const lines = csv.slice(1).trimEnd().split('\r\n')
    expect(lines).toHaveLength(1 + 487 + 1)
    expect(lines.at(-1)).toMatch(/^TOTAL;;336 jours prestés;;;1008;;;171360;16128;187488;/)
  })
})

describe('récapitulatif', () => {
  it('ajoute les totaux par année et de période', () => {
    const { rows, totalRows } = summaryRows(context(), { kind: 'period' })
    expect(rows).toHaveLength(16 + 2 + 1)
    expect(totalRows).toEqual([16, 17, 18])
    expect(rows[16]?.[0]).toBe('Total 2026')
    expect(rows[16]?.[10]).toBe(47_430)
    expect(rows[18]?.slice(0, 1)).toEqual(['Total de la période'])
    expect(rows[18]?.[10]).toBe(187_488)
  })

  it('nomme les fichiers d’après la portée', () => {
    expect(fileBaseName(context(), { kind: 'month', month: '2026-10' })).toBe('presence-2026-10')
    expect(fileBaseName(context(), { kind: 'period' })).toBe('presence-2026-09-01_2027-12-31')
  })
})

describe('XLSX', () => {
  it('produit un classeur valide (archive zip)', async () => {
    const blob = await buildXlsx(context([leave('2026-10-12')]), { kind: 'period' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    expect(bytes.length).toBeGreaterThan(5_000)
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe('PK')
  })
})
