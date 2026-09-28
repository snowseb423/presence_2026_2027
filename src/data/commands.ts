// Construction des opérations à partir des intentions de l'utilisateur.
import type { IsoDate, StatusCode } from '../domain/types.ts'
import type { Op } from './ops.ts'

export function nowIso(): string {
  return new Date().toISOString()
}

export interface DayState {
  statusCode: StatusCode
  hoursOverride: number | null
  comment: string | null
}

/**
 * Opération qui amène une journée à l'état voulu. Si cet état est
 * exactement le défaut (même statut, ni forçage ni commentaire), la
 * journée est remise au défaut : rien n'est stocké.
 */
export function dayOp(date: IsoDate, defaultStatus: StatusCode, next: DayState, at: string = nowIso()): Op {
  const comment = next.comment?.trim() ? next.comment.trim() : null
  const hoursOverride = next.hoursOverride ?? null
  if (next.statusCode === defaultStatus && hoursOverride === null && comment === null) {
    return { kind: 'attendance.clear', date, at }
  }
  return { kind: 'attendance.set', date, statusCode: next.statusCode, hoursOverride, comment, at }
}
