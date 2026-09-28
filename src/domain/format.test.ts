import { describe, expect, it } from 'vitest'
import {
  formatDateLong,
  formatDateNumeric,
  formatDateShort,
  formatDayMonth,
  formatHours,
  formatMonth,
  formatNumber,
  formatRs,
  formatTimestamp,
  parseDecimal,
} from './format.ts'

const NNBSP = ' '
const NBSP = ' '

describe('montants en roupies', () => {
  it('sépare les milliers par une espace fine insécable', () => {
    expect(formatRs(1_227_600)).toBe(`Rs${NBSP}12${NNBSP}276`)
    expect(formatRs(18_748_800)).toBe(`Rs${NBSP}187${NNBSP}488`)
    expect(formatRs(123_456_789_00)).toBe(`Rs${NBSP}123${NNBSP}456${NNBSP}789`)
    expect(formatRs(55_800)).toBe(`Rs${NBSP}558`)
  })

  it('affiche les centimes seulement s’il y en a', () => {
    expect(formatRs(123_450)).toBe(`Rs${NBSP}1${NNBSP}234,50`)
    expect(formatRs(5)).toBe(`Rs${NBSP}0,05`)
    expect(formatRs(0)).toBe(`Rs${NBSP}0`)
  })

  it('signe les écarts avec le vrai signe moins', () => {
    expect(formatRs(-167_400)).toBe(`−Rs${NBSP}1${NNBSP}674`)
    expect(formatRs(-167_400, { signed: true })).toBe(`−Rs${NBSP}1${NNBSP}674`)
    expect(formatRs(55_800, { signed: true })).toBe(`+Rs${NBSP}558`)
    expect(formatRs(0, { signed: true })).toBe(`Rs${NBSP}0`)
  })
})

describe('nombres et heures', () => {
  it('utilise la virgule décimale', () => {
    expect(formatNumber(1.5)).toBe('1,5')
    expect(formatNumber(2.25)).toBe('2,25')
    expect(formatNumber(3)).toBe('3')
    expect(formatNumber(1008)).toBe(`1${NNBSP}008`)
    expect(formatHours(1.5)).toBe(`1,5${NBSP}h`)
    expect(formatHours(66)).toBe(`66${NBSP}h`)
  })

  it('lit les saisies à la française', () => {
    expect(parseDecimal('1,5')).toBe(1.5)
    expect(parseDecimal(' 2.25 ')).toBe(2.25)
    expect(parseDecimal(`1${NNBSP}200`)).toBe(1200)
    expect(parseDecimal(',5')).toBe(0.5)
    expect(parseDecimal('abc')).toBeNull()
    expect(parseDecimal('')).toBeNull()
  })
})

describe('dates en français', () => {
  it('écrit les dates longues, avec « 1er »', () => {
    expect(formatDateLong('2026-09-28')).toBe('lundi 28 septembre 2026')
    expect(formatDateLong('2026-10-01')).toBe('jeudi 1er octobre 2026')
    expect(formatDayMonth('2027-02-06')).toBe('6 février')
    expect(formatDateShort('2026-12-25')).toBe('ven. 25 déc.')
    expect(formatDateNumeric('2027-01-02')).toBe('02/01/2027')
    expect(formatMonth('2027-08')).toBe('août 2027')
  })

  it('affiche les horodatages à l’heure de Maurice', () => {
    expect(formatTimestamp('2026-09-28T10:32:00Z')).toBe('lun. 28/09 à 14:32')
    expect(formatTimestamp('2026-09-28T21:05:00+00:00')).toBe('mar. 29/09 à 01:05')
  })
})
