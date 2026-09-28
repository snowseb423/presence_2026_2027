import { describe, expect, it } from 'vitest'
import { dayOp } from './commands.ts'
import { applyOps, mergeOps } from './ops.ts'
import { DEFAULT_SETTINGS } from '../domain/defaults.ts'

const AT = '2026-09-28T08:00:00.000Z'

describe('dayOp', () => {
  it('remet la journée au défaut plutôt que de stocker le défaut', () => {
    expect(dayOp('2026-10-05', 'travaille', { statusCode: 'travaille', hoursOverride: null, comment: '  ' }, AT)).toEqual({
      kind: 'attendance.clear',
      date: '2026-10-05',
      at: AT,
    })
  })

  it('stocke un écart au défaut', () => {
    expect(dayOp('2026-10-05', 'travaille', { statusCode: 'conge_non_paye', hoursOverride: null, comment: null }, AT)).toEqual({
      kind: 'attendance.set',
      date: '2026-10-05',
      statusCode: 'conge_non_paye',
      hoursOverride: null,
      comment: null,
      at: AT,
    })
  })

  it('garde le statut par défaut s’il porte un forçage ou un commentaire', () => {
    expect(dayOp('2026-10-05', 'travaille', { statusCode: 'travaille', hoursOverride: 2, comment: null }, AT).kind).toBe('attendance.set')
    expect(dayOp('2026-10-05', 'travaille', { statusCode: 'travaille', hoursOverride: null, comment: ' parti tôt ' }, AT)).toMatchObject({
      kind: 'attendance.set',
      comment: 'parti tôt',
    })
  })
})

describe('fusion des opérations en attente', () => {
  it('cumule les modifications de réglages champ par champ', () => {
    const merged = mergeOps(
      { kind: 'settings.patch', patch: { hourlyRate: 180 }, at: AT },
      { kind: 'settings.patch', patch: { transportPerDay: 50 }, at: AT },
    )
    expect(merged).toMatchObject({ patch: { hourlyRate: 180, transportPerDay: 50 } })
  })

  it('applique les réglages en attente à l’affichage', () => {
    const state = applyOps(
      { settings: DEFAULT_SETTINGS, rules: new Map(), holidays: new Map(), overrides: new Map() },
      [{ kind: 'settings.patch', patch: { employeeName: 'Marie' }, at: AT }],
    )
    expect(state.settings.employeeName).toBe('Marie')
  })
})
