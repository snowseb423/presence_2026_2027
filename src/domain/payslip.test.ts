import { describe, expect, it } from 'vitest'
import { DEFAULT_CONTRIBUTIONS, DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, DEFAULT_STATUS_RULES } from './defaults.ts'
import {
  bracketFor,
  computeContribution,
  computePayslip,
  contributionApplies,
  payDate,
  sanitizeContributions,
  sumPayroll,
  yearEndBonus,
} from './payslip.ts'
import { periodMonths, summarizeMonth } from './pay.ts'
import type { CalcContext, Contribution, Holiday, Override, Settings, StatusCode } from './types.ts'

function context(overrides: Record<string, StatusCode> = {}, settings: Partial<Settings> = {}, holidays: Holiday[] = DEFAULT_HOLIDAYS): CalcContext {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    rules: new Map(DEFAULT_STATUS_RULES.map((rule) => [rule.code, rule])),
    holidays: new Map(holidays.map((holiday) => [holiday.date, holiday])),
    overrides: new Map(
      Object.entries(overrides).map(([date, statusCode]): [string, Override] => [
        date,
        { date, statusCode, hoursOverride: null, comment: null, updatedAt: '2026-09-28T08:00:00Z', updatedBy: null },
      ]),
    ),
  }
}

const rs = (rupees: number) => Math.round(rupees * 100)
const byId = (id: string) => DEFAULT_CONTRIBUTIONS.find((c) => c.id === id)!
const THREE_LEAVES = { '2026-10-12': 'conge_non_paye', '2026-10-13': 'conge_non_paye', '2026-10-14': 'conge_non_paye' }

describe('fiche de paie : rémunération', () => {
  it('octobre 2026 sans absence : 66 h et 22 jours de transport, Rs 12 276 brut', () => {
    const slip = computePayslip('2026-10', context())
    expect(slip.earnings).toEqual([
      { code: 'travaille', label: 'Heures travaillées', days: 22, hours: 66, rate: 170, unit: 'hour', amountCents: rs(11_220) },
      { code: 'transport', label: 'Transport', days: 22, hours: 0, rate: 48, unit: 'day', amountCents: rs(1_056) },
    ])
    expect(slip).toMatchObject({ basicCents: rs(11_220), transportCents: rs(1_056), grossCents: rs(12_276) })
    expect(slip).toMatchObject({ start: '2026-10-01', end: '2026-10-31', payDate: '2026-10-30' })
  })

  it('une ligne par statut payé, dans l’ordre des statuts, transport en dernier', () => {
    const slip = computePayslip(
      '2026-10',
      context({ '2026-10-05': 'conge_paye', '2026-10-06': 'demi_journee', '2026-10-10': 'jour_supplementaire', '2026-10-12': 'conge_non_paye' }),
    )
    expect(slip.earnings.map(({ label, days, hours, amountCents }) => [label, days, hours, amountCents / 100])).toEqual([
      ['Heures travaillées', 19, 57, 9_690],
      ['Demi-journées', 1, 1.5, 255],
      ['Jours supplémentaires', 1, 3, 510],
      ['Congés payés', 1, 3, 510],
      ['Transport', 21, 0, 1_008],
    ])
    expect(slip.grossCents).toBe(rs(9_690 + 255 + 510 + 510 + 1_008))
  })
})

describe('fiche de paie : cotisations par défaut', () => {
  it('octobre 2026 avec 3 congés non payés : CSG, NSF et PRGF arrondis à la roupie', () => {
    const slip = computePayslip('2026-10', context(THREE_LEAVES))
    expect(slip.grossCents).toBe(rs(10_602))
    expect(slip.contributions.map(({ id, baseCents, employeeRate, employerRate, employeeCents, employerCents }) => [
      id,
      baseCents / 100,
      employeeRate,
      employerRate,
      employeeCents / 100,
      employerCents / 100,
    ])).toEqual([
      ['csg', 9_690, 1.5, 3, 145, 291],
      ['nsf', 9_690, 1, 2.5, 97, 242],
      ['prgf', 9_690, 0, 4.5, 0, 436],
    ])
    expect(slip).toMatchObject({
      employeeCents: rs(242),
      netCents: rs(10_360),
      employerCents: rs(969),
      costCents: rs(11_571),
    })
  })

  it('sans arrondi : montants au centime', () => {
    const slip = computePayslip('2026-10', context(THREE_LEAVES, { roundContributions: false }))
    expect(slip.contributions.map((line) => [line.employeeCents, line.employerCents])).toEqual([
      [14_535, 29_070],
      [9_690, 24_225],
      [0, 43_605],
    ])
    expect(slip.netCents).toBe(rs(10_359.75))
  })

  it('le NPF remplace la CSG et le PRGF à partir de juillet 2027', () => {
    expect(computePayslip('2027-06', context()).contributions.map((line) => line.id)).toEqual(['csg', 'nsf', 'prgf'])
    const july = computePayslip('2027-07', context())
    expect(july.contributions.map(({ id, employeeCents, employerCents }) => [id, employeeCents / 100, employerCents / 100])).toEqual([
      ['nsf', 112, 281],
      ['npf', 168, 842],
    ])
  })

  it('employé de maison payé au plus Rs 3 000 : CSG patronale seule, NSF sur le plancher', () => {
    // Période commencée le 26 octobre : 5 jours, Rs 2 550 de salaire de base.
    const slip = computePayslip('2026-10', context({}, { periodStart: '2026-10-26' }))
    expect(slip.basicCents).toBe(rs(2_550))
    const [csg, nsf] = slip.contributions
    expect(csg).toMatchObject({ employeeRate: 0, employerRate: 3, employeeCents: 0, employerCents: rs(77) })
    expect(nsf).toMatchObject({ baseCents: rs(2_795), employeeCents: rs(28), employerCents: rs(70) })
  })

  it('au-delà de Rs 50 000 : CSG à 3 % et 6 %, NSF plafonnée', () => {
    const slip = computePayslip('2026-10', context({}, { hourlyRate: 1_000 }))
    expect(slip.basicCents).toBe(rs(66_000))
    const [csg, nsf, prgf] = slip.contributions
    expect(csg).toMatchObject({ employeeRate: 3, employerRate: 6, employeeCents: rs(1_980), employerCents: rs(3_960) })
    expect(nsf).toMatchObject({ baseCents: rs(28_570), employeeCents: rs(286), employerCents: rs(714) })
    expect(prgf).toMatchObject({ employerCents: rs(2_970) })
  })

  it('mois sans salaire : aucune cotisation malgré le plancher', () => {
    const allLeave = Object.fromEntries(
      ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'].map((date) => [date, 'conge_non_paye']),
    )
    const slip = computePayslip('2026-10', context(allLeave, { periodStart: '2026-10-26' }))
    expect(slip.grossCents).toBe(0)
    expect(slip.contributions.every((line) => line.employeeCents === 0 && line.employerCents === 0)).toBe(true)
    expect(slip.netCents).toBe(0)
  })

  it('toute la période : net = brut − retenues, coût = brut + charges', () => {
    const ctx = context()
    const total = sumPayroll(periodMonths(ctx.settings).map((month) => computePayslip(month, ctx)))
    // Présences de la période, plus les bonus de décembre 2026 et 2027.
    expect(total.grossCents - total.bonusCents).toBe(rs(187_488))
    expect(total.bonusCents).toBeGreaterThan(0)
    expect(total.netCents).toBe(total.grossCents - total.employeeCents)
    expect(total.costCents).toBe(total.grossCents + total.employerCents)
    expect(total.employeeCents).toBeGreaterThan(0)
  })
})

describe('cotisation paramétrée', () => {
  const custom: Contribution = {
    id: 'test',
    label: 'Test',
    description: '',
    enabled: true,
    base: 'gross',
    floor: null,
    ceiling: null,
    brackets: [{ upTo: null, employeeRate: 2, employerRate: 0 }],
    from: '2026-11',
    to: '2026-12',
    onBonus: false,
  }

  it('assiette brute : transport compris', () => {
    const line = computeContribution(custom, { basicCents: rs(9_690), grossCents: rs(10_602) }, false)
    expect(line).toMatchObject({ baseCents: rs(10_602), employeeCents: rs(212.04), employerCents: 0 })
  })

  it('mois d’application et désactivation', () => {
    expect(contributionApplies(custom, '2026-10')).toBe(false)
    expect(contributionApplies(custom, '2026-11')).toBe(true)
    expect(contributionApplies(custom, '2026-12')).toBe(true)
    expect(contributionApplies(custom, '2027-01')).toBe(false)
    expect(contributionApplies({ ...custom, enabled: false }, '2026-11')).toBe(false)
    const slip = computePayslip('2026-10', context({}, { contributions: [{ ...byId('csg'), enabled: false }] }))
    expect(slip.contributions).toEqual([])
    expect(slip.netCents).toBe(slip.grossCents)
  })

  it('tranches : bornes incluses, aucune tranche au-delà de la dernière borne', () => {
    const csg = byId('csg')
    expect(bracketFor(csg, rs(3_000))?.employeeRate).toBe(0)
    expect(bracketFor(csg, rs(3_000.01))?.employeeRate).toBe(1.5)
    expect(bracketFor(csg, rs(50_000))?.employeeRate).toBe(1.5)
    expect(bracketFor(csg, rs(50_000.01))?.employeeRate).toBe(3)
    const bounded = { ...custom, brackets: [{ upTo: 1_000, employeeRate: 1, employerRate: 1 }] }
    expect(bracketFor(bounded, rs(1_000.01))).toBeNull()
    expect(computeContribution(bounded, { basicCents: rs(2_000), grossCents: rs(2_000) }, true).employeeCents).toBe(0)
  })
})

describe('date de paiement', () => {
  it('dernier jour ouvré du mois, hors week-end et fériés', () => {
    expect(payDate('2026-10', context())).toBe('2026-10-30')
    expect(payDate('2027-01', context())).toBe('2027-01-29')
    const holiday: Holiday = { date: '2026-10-30', name: 'Test', note: null, updatedAt: null, updatedBy: null }
    expect(payDate('2026-10', context({}, {}, [holiday]))).toBe('2026-10-29')
  })

  it('jour fixe du mois suivant', () => {
    expect(payDate('2026-10', context({}, { payDay: 5 }))).toBe('2026-11-05')
    expect(payDate('2026-12', context({}, { payDay: 28 }))).toBe('2027-01-28')
  })
})

describe('lecture des cotisations enregistrées', () => {
  it('colonne absente ou illisible : null (valeurs par défaut)', () => {
    expect(sanitizeContributions(undefined)).toBeNull()
    expect(sanitizeContributions('pas du json')).toBeNull()
    expect(sanitizeContributions({})).toBeNull()
    expect(sanitizeContributions([])).toEqual([])
  })

  it('relit à l’identique les valeurs par défaut, en objet ou en texte JSON', () => {
    expect(sanitizeContributions(structuredClone(DEFAULT_CONTRIBUTIONS))).toEqual(DEFAULT_CONTRIBUTIONS)
    expect(sanitizeContributions(JSON.stringify(DEFAULT_CONTRIBUTIONS))).toEqual(DEFAULT_CONTRIBUTIONS)
  })

  it('écarte les éléments invalides et remet les tranches dans l’ordre', () => {
    const list = sanitizeContributions([
      { id: 'a', label: 'A', brackets: [{ upTo: null, employeeRate: 1, employerRate: 2 }, { upTo: 100, employeeRate: 0, employerRate: 1 }] },
      { id: 'a', label: 'Doublon', brackets: [{ upTo: null, employeeRate: 1, employerRate: 1 }] },
      { id: 'b', label: '', brackets: [{ upTo: null, employeeRate: 1, employerRate: 1 }] },
      { id: 'c', label: 'Taux hors bornes', brackets: [{ upTo: null, employeeRate: 150, employerRate: 1 }] },
      { id: 'd', label: 'D', base: 'gross', enabled: false, floor: -5, from: '2027-13', to: '2027-07', brackets: [{ employeeRate: 0, employerRate: 3 }] },
      null,
    ])
    expect(list).toEqual([
      {
        id: 'a',
        label: 'A',
        description: '',
        enabled: true,
        base: 'basic',
        floor: null,
        ceiling: null,
        brackets: [
          { upTo: 100, employeeRate: 0, employerRate: 1 },
          { upTo: null, employeeRate: 1, employerRate: 2 },
        ],
        from: null,
        to: null,
        onBonus: false,
      },
      {
        id: 'd',
        label: 'D',
        description: '',
        enabled: false,
        base: 'gross',
        floor: null,
        ceiling: null,
        brackets: [{ upTo: null, employeeRate: 0, employerRate: 3 }],
        from: null,
        to: '2027-07',
        onBonus: false,
      },
    ])
  })

  it('cotisations enregistrées avant le bonus : « due sur le bonus » repris des valeurs par défaut', () => {
    const stored = DEFAULT_CONTRIBUTIONS.map(({ onBonus: _onBonus, ...rest }) => rest)
    expect(sanitizeContributions(stored)).toEqual(DEFAULT_CONTRIBUTIONS)
    expect(sanitizeContributions([{ id: 'perso', label: 'P', brackets: [{ upTo: null, employeeRate: 1, employerRate: 1 }] }])?.[0]?.onBonus).toBe(false)
  })
})

describe('bonus de fin d’année', () => {
  it('décembre 2026 : 1/12 du brut de septembre à décembre, CSG à part sur la part salaire de base', () => {
    const slip = computePayslip('2026-12', context())
    // Brut 2026 suivi : 11 718 + 12 276 + 11 160 + 12 276 = Rs 47 430 ; salaire de base Rs 43 350.
    expect(slip.bonus).toEqual({
      months: ['2026-09', '2026-10', '2026-11', '2026-12'],
      base: 'gross',
      earningsCents: rs(47_430),
      cents: rs(3_952.5),
      basicCents: rs(3_612.5),
      advanceBy: '2026-12-18',
      balanceBy: '2026-12-31',
    })
    expect(slip.earnings.at(-1)).toMatchObject({ code: 'bonus', unit: 'bonus', amountCents: rs(3_952.5) })
    expect(slip.contributions.map(({ id, bonus, baseCents, employeeCents, employerCents }) => [id, bonus, baseCents / 100, employeeCents / 100, employerCents / 100])).toEqual([
      ['csg', false, 11_220, 168, 337],
      ['nsf', false, 11_220, 112, 281],
      ['prgf', false, 11_220, 0, 505],
      ['csg', true, 3_612.5, 54, 108],
    ])
    expect(slip).toMatchObject({
      bonusCents: rs(3_952.5),
      grossCents: rs(16_228.5),
      employeeCents: rs(334),
      netCents: rs(15_894.5),
      employerCents: rs(1_231),
      costCents: rs(17_459.5),
    })
  })

  it('sur le salaire de base seulement, si réglé ainsi', () => {
    const slip = computePayslip('2026-12', context({}, { endOfYearBonusBase: 'basic' }))
    expect(slip.bonus).toMatchObject({ earningsCents: rs(43_350), cents: rs(3_612.5), basicCents: rs(3_612.5) })
  })

  it('rien hors décembre, ni si le bonus est désactivé ou décembre hors période', () => {
    expect(computePayslip('2026-11', context()).bonus).toBeNull()
    expect(computePayslip('2026-12', context({}, { endOfYearBonus: false })).bonus).toBeNull()
    expect(yearEndBonus('2026-12', context({}, { periodEnd: '2026-11-30' }))).toBeNull()
  })

  it('décembre 2027 : toute l’année, NPF sur le bonus (la CSG ne s’applique plus)', () => {
    const ctx = context()
    const slip = computePayslip('2027-12', ctx)
    const months = periodMonths(ctx.settings).filter((month) => month.startsWith('2027-'))
    const gross = months.reduce((sum, month) => sum + summarizeMonth(month, ctx).totalCents, 0)
    expect(slip.bonus).toMatchObject({ months, earningsCents: gross, cents: Math.round(gross / 12), advanceBy: '2027-12-20', balanceBy: '2027-12-31' })
    expect(slip.contributions.filter((line) => line.bonus).map((line) => line.id)).toEqual(['npf'])
  })

  it('une cotisation sans « due sur le bonus » n’est pas prélevée sur le bonus', () => {
    const contributions = DEFAULT_CONTRIBUTIONS.map((contribution) => ({ ...contribution, onBonus: false }))
    const slip = computePayslip('2026-12', context({}, { contributions }))
    expect(slip.contributions.some((line) => line.bonus)).toBe(false)
    expect(slip.netCents).toBe(slip.grossCents - slip.employeeCents)
  })
})
