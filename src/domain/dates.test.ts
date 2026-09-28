import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  diffDays,
  eachDay,
  eachMonth,
  isIsoDate,
  isoWeekday,
  lastDayOfMonth,
  msUntilNextMidnight,
  startOfWeek,
  todayIn,
  weekOf,
} from './dates.ts'

describe('calendrier', () => {
  it('calcule le jour ISO de la semaine', () => {
    expect(isoWeekday('2026-09-01')).toBe(2) // mardi
    expect(isoWeekday('2026-11-08')).toBe(7) // dimanche
    expect(isoWeekday('2027-01-01')).toBe(5) // vendredi
  })

  it('valide les dates ISO', () => {
    expect(isIsoDate('2027-02-28')).toBe(true)
    expect(isIsoDate('2027-02-29')).toBe(false)
    expect(isIsoDate('2028-02-29')).toBe(true)
    expect(isIsoDate('28/02/2027')).toBe(false)
  })

  it('additionne jours et mois en franchissant les années', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-03-01', -1)).toBe('2027-02-28')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
    expect(diffDays('2026-09-01', '2027-12-31')).toBe(486)
  })

  it('énumère jours et mois bornes incluses', () => {
    expect(eachDay('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'])
    expect(eachMonth('2026-09', '2027-12')).toHaveLength(16)
    expect(lastDayOfMonth('2027-02')).toBe('2027-02-28')
  })

  it('construit la semaine du lundi au dimanche', () => {
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28')
    expect(weekOf('2026-10-04')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ])
  })
})

describe('aujourd’hui à Maurice (UTC+4)', () => {
  it('change de jour à minuit heure de Maurice, pas à minuit UTC', () => {
    expect(todayIn('Indian/Mauritius', new Date('2026-09-28T19:59:59Z'))).toBe('2026-09-28')
    expect(todayIn('Indian/Mauritius', new Date('2026-09-28T20:00:00Z'))).toBe('2026-09-29')
  })

  it('calcule le délai jusqu’au prochain minuit', () => {
    expect(msUntilNextMidnight('Indian/Mauritius', new Date('2026-09-28T19:00:00Z'))).toBe(3_600_000)
  })
})
