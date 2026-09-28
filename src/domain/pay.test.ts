import { describe, expect, it } from 'vitest'
import { DEFAULT_HOLIDAYS, DEFAULT_SETTINGS, DEFAULT_STATUS_RULES } from './defaults.ts'
import { formatRs } from './format.ts'
import { computeDay, dayAmountCents, summarizeMonth, summarizePeriod } from './pay.ts'
import type { CalcContext, Holiday, Override, Settings, StatusCode } from './types.ts'

function context(
  overrides: Record<string, StatusCode | Partial<Override>> = {},
  settings: Partial<Settings> = {},
  holidays: Holiday[] = DEFAULT_HOLIDAYS,
): CalcContext {
  const map = new Map<string, Override>()
  for (const [date, value] of Object.entries(overrides)) {
    const fields = typeof value === 'string' ? { statusCode: value } : value
    map.set(date, {
      date,
      statusCode: 'travaille',
      hoursOverride: null,
      comment: null,
      updatedAt: '2026-09-28T08:00:00Z',
      updatedBy: null,
      ...fields,
    })
  }
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    rules: new Map(DEFAULT_STATUS_RULES.map((rule) => [rule.code, rule])),
    holidays: new Map(holidays.map((holiday) => [holiday.date, holiday])),
    overrides: map,
  }
}

const rs = (rupees: number) => rupees * 100

describe('montant d’une journée', () => {
  it('applique heures × taux + transport', () => {
    expect(dayAmountCents(3, 170, true, 48)).toEqual({ prestationCents: rs(510), transportCents: rs(48), totalCents: rs(558) })
    expect(dayAmountCents(3, 170, false, 48).totalCents).toBe(rs(510))
    expect(dayAmountCents(0, 170, false, 48).totalCents).toBe(0)
  })

  it('reste exact avec des heures et des taux décimaux', () => {
    // 2,33 h × Rs 170,50 = Rs 397,265 → arrondi au centime supérieur
    expect(dayAmountCents(2.33, 170.5, false, 48).prestationCents).toBe(39727)
    expect(dayAmountCents(0.1, 0.3, false, 0).prestationCents).toBe(3)
  })

  it.each([
    ['travaille', 558],
    ['demi_journee', 303],
    ['jour_supplementaire', 558],
    ['conge_non_paye', 0],
    ['absence_non_payee', 0],
    ['conge_paye', 510],
    ['ferie_non_paye', 0],
    ['ferie_paye', 510],
    ['week_end', 0],
    ['non_concerne', 0],
  ])('%s vaut Rs %i par défaut', (status, rupees) => {
    const day = computeDay('2026-10-06', context({ '2026-10-06': status }))
    expect(day.totalCents).toBe(rs(rupees))
  })
})

describe('statut par défaut', () => {
  it('lundi → vendredi : Travaillé', () => {
    const day = computeDay('2026-10-05', context())
    expect(day).toMatchObject({ status: 'travaille', defaultStatus: 'travaille', override: null, totalCents: rs(558) })
    expect(day.isPresence).toBe(true)
  })

  it('samedi et dimanche : Week-end', () => {
    expect(computeDay('2026-10-03', context()).status).toBe('week_end')
    expect(computeDay('2026-10-04', context()).status).toBe('week_end')
  })

  it('hors période : Non concerné, sans montant', () => {
    const before = computeDay('2026-08-31', context())
    expect(before).toMatchObject({ status: 'non_concerne', inPeriod: false, totalCents: 0 })
    expect(computeDay('2028-01-03', context()).status).toBe('non_concerne')
  })

  it('suit les jours de prestation réglés', () => {
    const ctx = context({}, { workDays: [1, 2, 4, 5, 6] })
    expect(computeDay('2026-10-07', ctx).status).toBe('non_concerne') // mercredi exclu
    expect(computeDay('2026-10-10', ctx).status).toBe('travaille') // samedi presté
    expect(computeDay('2026-10-11', ctx).status).toBe('week_end')
  })
})

describe('cas métier', () => {
  it('un mois complet sans absence : octobre 2026 = 22 jours, Rs 12 276', () => {
    const october = summarizeMonth('2026-10', context())
    expect(october).toMatchObject({
      workingDays: 22,
      weekdayHolidays: 0,
      unpaidLeaveDays: 0,
      unpaidAbsenceDays: 0,
      paidDays: 22,
      workedDays: 22,
      hours: 66,
      prestationCents: rs(11_220),
      transportCents: rs(1_056),
      totalCents: rs(12_276),
      budgetCents: rs(12_276),
      varianceCents: 0,
    })
    expect(formatRs(october.totalCents)).toBe('Rs 12 276')
  })

  it('3 congés non payés en octobre 2026 : Rs 10 602, écart −Rs 1 674', () => {
    const october = summarizeMonth(
      '2026-10',
      context({ '2026-10-12': 'conge_non_paye', '2026-10-13': 'conge_non_paye', '2026-10-14': 'conge_non_paye' }),
    )
    expect(october).toMatchObject({
      unpaidLeaveDays: 3,
      unpaidAbsenceDays: 0,
      paidDays: 19,
      workedDays: 19,
      totalCents: rs(10_602),
      budgetCents: rs(12_276),
      varianceCents: -rs(1_674),
    })
    expect(formatRs(october.totalCents)).toBe('Rs 10 602')
    expect(formatRs(october.varianceCents, { signed: true })).toBe('−Rs 1 674')
  })

  it('congés non payés et absences restent deux compteurs distincts', () => {
    const october = summarizeMonth(
      '2026-10',
      context({ '2026-10-12': 'conge_non_paye', '2026-10-13': 'absence_non_payee', '2026-10-14': 'absence_non_payee' }),
    )
    expect(october.unpaidLeaveDays).toBe(1)
    expect(october.unpaidAbsenceDays).toBe(2)
    expect(october.totalCents).toBe(rs(10_602))
  })

  it('une demi-journée : 1,5 h payée + transport = Rs 303', () => {
    const ctx = context({ '2026-10-07': 'demi_journee' })
    expect(computeDay('2026-10-07', ctx)).toMatchObject({ hours: 1.5, prestationCents: rs(255), transportCents: rs(48), totalCents: rs(303) })
    const october = summarizeMonth('2026-10', ctx)
    expect(october).toMatchObject({ halfDays: 1, workedDays: 22, hours: 64.5, totalCents: rs(12_021), varianceCents: -rs(255) })
  })

  it('un forçage d’heures remplace les heures du statut sans toucher au transport', () => {
    const worked = computeDay('2026-10-08', context({ '2026-10-08': { statusCode: 'travaille', hoursOverride: 2 } }))
    expect(worked).toMatchObject({ hours: 2, hoursOverridden: true, prestationCents: rs(340), transportCents: rs(48), totalCents: rs(388) })

    const paidLeave = computeDay('2026-10-08', context({ '2026-10-08': { statusCode: 'conge_paye', hoursOverride: 2 } }))
    expect(paidLeave).toMatchObject({ hours: 2, transportCents: 0, totalCents: rs(340) })

    const zero = computeDay('2026-10-08', context({ '2026-10-08': { statusCode: 'travaille', hoursOverride: 0 } }))
    expect(zero).toMatchObject({ hours: 0, transportCents: rs(48), totalCents: rs(48) })
  })

  it('un férié en semaine : non payé par défaut, Rs 558 de moins que les jours ouvrés', () => {
    // 16/09/2026, Ganesh Chaturthi, un mercredi.
    const ctx = context()
    expect(computeDay('2026-09-16', ctx)).toMatchObject({ status: 'ferie_non_paye', totalCents: 0, isPresence: false })
    expect(computeDay('2026-09-16', ctx).holiday?.name).toBe('Ganesh Chaturthi')
    const september = summarizeMonth('2026-09', ctx)
    expect(september).toMatchObject({
      workingDays: 22,
      weekdayHolidays: 1,
      paidDays: 21,
      workedDays: 21,
      totalCents: rs(11_718),
      budgetCents: rs(11_718),
      varianceCents: 0,
    })
  })

  it('un férié payé crée un écart positif par rapport au budget', () => {
    const september = summarizeMonth('2026-09', context({ '2026-09-16': 'ferie_paye' }))
    expect(september).toMatchObject({ paidHolidayDays: 1, paidDays: 22, workedDays: 21, varianceCents: rs(510) })
  })

  it('un férié tombant un dimanche reste un week-end', () => {
    // 08/11/2026, Divali, un dimanche.
    const day = computeDay('2026-11-08', context())
    expect(day).toMatchObject({ weekday: 7, status: 'week_end', totalCents: 0 })
    expect(day.holiday?.name).toBe('Divali')
    const november = summarizeMonth('2026-11', context())
    // 21 jours ouvrés, seul le lundi 02/11 est un férié en semaine.
    expect(november).toMatchObject({ workingDays: 21, weekdayHolidays: 1, workedDays: 20, totalCents: rs(11_160) })
  })

  it('corriger la date d’un férié se propage sans rien stocker', () => {
    const moved = DEFAULT_HOLIDAYS.map((h) => (h.date === '2027-03-10' ? { ...h, date: '2027-03-11' } : h))
    expect(computeDay('2027-03-10', context({}, {}, moved)).status).toBe('travaille')
    expect(computeDay('2027-03-11', context({}, {}, moved)).status).toBe('ferie_non_paye')
  })

  it('un jour supplémentaire un samedi augmente le total', () => {
    const october = summarizeMonth('2026-10', context({ '2026-10-10': 'jour_supplementaire' }))
    expect(october).toMatchObject({ extraDays: 1, workedDays: 23, workingDays: 22, varianceCents: rs(558) })
  })

  it('les réglages modifiés s’appliquent partout', () => {
    const october = summarizeMonth('2026-10', context({}, { hourlyRate: 180, transportPerDay: 50 }))
    expect(october.totalCents).toBe(22 * rs(3 * 180 + 50))
  })
})

describe('période complète', () => {
  it('sans aucune absence : Rs 187 488 pour 336 jours prestés', () => {
    const period = summarizePeriod(context())
    expect(period.months).toHaveLength(16)
    expect(period.totals.workedDays).toBe(336)
    expect(period.totals.totalCents).toBe(rs(187_488))
    expect(period.totals.budgetCents).toBe(rs(187_488))
    expect(period.totals.varianceCents).toBe(0)
    expect(formatRs(period.totals.totalCents)).toBe('Rs 187 488')
  })

  it('totalise par année', () => {
    const period = summarizePeriod(context())
    expect(period.years.map((y) => [y.year, y.months.length, y.totals.workedDays, y.totals.totalCents])).toEqual([
      [2026, 4, 85, rs(85 * 558)],
      [2027, 12, 251, rs(251 * 558)],
    ])
  })

  it('les jours prestés par mois correspondent au calendrier 2026–2027', () => {
    const worked = summarizePeriod(context()).months.map((m) => [m.month, m.workedDays])
    expect(worked).toEqual([
      ['2026-09', 21], ['2026-10', 22], ['2026-11', 20], ['2026-12', 22],
      ['2027-01', 19], ['2027-02', 19], ['2027-03', 21], ['2027-04', 21],
      ['2027-05', 21], ['2027-06', 22], ['2027-07', 22], ['2027-08', 22],
      ['2027-09', 21], ['2027-10', 20], ['2027-11', 20], ['2027-12', 23],
    ])
  })

  it('3 congés non payés en octobre ne changent que ce mois', () => {
    const period = summarizePeriod(
      context({ '2026-10-12': 'conge_non_paye', '2026-10-13': 'conge_non_paye', '2026-10-14': 'conge_non_paye' }),
    )
    expect(period.totals.totalCents).toBe(rs(187_488 - 1_674))
    expect(period.totals.varianceCents).toBe(-rs(1_674))
    expect(period.years[0]?.totals.unpaidLeaveDays).toBe(3)
  })

  it('une période commençant en cours de mois ne compte que ses jours', () => {
    const period = summarizePeriod(context({}, { periodStart: '2026-09-15', periodEnd: '2026-09-30' }))
    expect(period.months).toHaveLength(1)
    // 15 → 30 septembre : 12 jours de semaine dont le férié du 16.
    expect(period.totals).toMatchObject({ workingDays: 12, weekdayHolidays: 1, workedDays: 11 })
  })

  it('une saisie hors période n’est pas comptée', () => {
    const period = summarizePeriod(context({ '2028-01-03': 'jour_supplementaire' }))
    expect(period.totals.totalCents).toBe(rs(187_488))
  })
})
