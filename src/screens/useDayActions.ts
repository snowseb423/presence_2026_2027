import { useMemo } from 'react'
import { type DayState, dayOp } from '../data/commands.ts'
import { useEngine } from '../data/DataProvider.tsx'
import { capitalize, formatDateShort } from '../domain/format.ts'
import { computeDay } from '../domain/pay.ts'
import type { CalcContext, IsoDate, StatusCode } from '../domain/types.ts'
import { useToast } from '../ui/Toaster.tsx'

function sameState(a: DayState, b: DayState): boolean {
  return a.statusCode === b.statusCode && a.hoursOverride === b.hoursOverride && (a.comment ?? '') === (b.comment ?? '')
}

/** Modifications d'une journée, avec « Annuler » dans la notification. */
export function useDayActions(calc: CalcContext) {
  const engine = useEngine()
  const toast = useToast()

  return useMemo(() => {
    function current(date: IsoDate) {
      const day = computeDay(date, calc)
      const state: DayState = day.override
        ? { statusCode: day.override.statusCode, hoursOverride: day.override.hoursOverride, comment: day.override.comment }
        : { statusCode: day.defaultStatus, hoursOverride: null, comment: null }
      return { day, state }
    }

    async function apply(date: IsoDate, next: DayState, notify: string | null) {
      const { day, state } = current(date)
      const normalized = { ...next, comment: next.comment?.trim() ? next.comment.trim() : null }
      if (sameState(state, normalized)) return
      await engine.commit(dayOp(date, day.defaultStatus, normalized))
      navigator.vibrate?.(8)
      if (notify) {
        toast({
          message: `${capitalize(formatDateShort(date))} → ${notify}`,
          action: { label: 'Annuler', onAction: () => void engine.commit(dayOp(date, day.defaultStatus, state)) },
        })
      }
    }

    return {
      setStatus(date: IsoDate, statusCode: StatusCode) {
        const { state } = current(date)
        // Le forçage d'heures était propre à l'ancien statut ; la note reste.
        return apply(date, { statusCode, hoursOverride: null, comment: state.comment }, calc.rules.get(statusCode)?.label ?? statusCode)
      },
      setHours(date: IsoDate, hoursOverride: number | null) {
        const { state } = current(date)
        return apply(date, { ...state, hoursOverride }, null)
      },
      setComment(date: IsoDate, comment: string) {
        const { state } = current(date)
        return apply(date, { ...state, comment }, null)
      },
      reset(date: IsoDate) {
        const { day } = current(date)
        return apply(date, { statusCode: day.defaultStatus, hoursOverride: null, comment: null }, 'statut par défaut')
      },
    }
  }, [calc, engine, toast])
}
