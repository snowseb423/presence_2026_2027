import { RotateCcw } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider.tsx'
import type { AppData } from '../data/mirror.ts'
import { capitalize, formatDateLong, formatHours, formatRs } from '../domain/format.ts'
import { computeDay } from '../domain/pay.ts'
import { sortRules } from '../domain/status.ts'
import type { CalcContext, IsoDate } from '../domain/types.ts'
import { Sheet } from '../ui/Sheet.tsx'
import { Button, Stepper, inputClass } from '../ui/controls.tsx'
import { LastEdit, StatusChoice, formula } from './shared.tsx'
import { useDayActions } from './useDayActions.ts'

/** Détail d'une journée : statut, forçage d'heures, commentaire, montant. */
export function DaySheet({
  date,
  onClose,
  calc,
  data,
}: {
  date: IsoDate | null
  onClose: () => void
  calc: CalcContext
  data: AppData
}) {
  const actions = useDayActions(calc)
  const { state } = useAuth()
  const commentId = useId()
  // Garde la dernière journée affichée pendant l'animation de fermeture.
  const lastDate = useRef(date)
  if (date) lastDate.current = date
  const open = Boolean(date)
  date = date ?? lastDate.current
  const day = date ? computeDay(date, calc) : null
  const savedComment = day?.override?.comment ?? ''
  const [comment, setComment] = useState(savedComment)
  const [editing, setEditing] = useState(false)

  // Brouillon réinitialisé à l'ouverture, sans écraser une saisie en cours.
  useEffect(() => {
    if (!editing) setComment(savedComment)
  }, [date, savedComment, editing])

  const saveComment = () => {
    if (date && comment.trim() !== savedComment) void actions.setComment(date, comment)
  }

  const close = () => {
    saveComment()
    setEditing(false)
    onClose()
  }

  if (!day || !date) return null

  const rules = sortRules(calc.rules.values())
  const defaultLabel = calc.rules.get(day.defaultStatus)?.label ?? day.defaultStatus
  const currentUserId = state.status === 'signedIn' ? state.user.id : undefined

  return (
    <Sheet
      open={open}
      onClose={close}
      title={capitalize(formatDateLong(date))}
      subtitle={
        !day.inPeriod
          ? 'Hors de la période suivie : non modifiable'
          : day.holiday
            ? `Férié · ${day.holiday.name}${day.holiday.note ? ` (${day.holiday.note})` : ''}`
            : undefined
      }
    >
      <fieldset disabled={!day.inPeriod}>
        <legend className="sr-only">Statut de la journée</legend>
        <div className="grid grid-cols-2 gap-2">
          {rules.map((rule) => (
            <StatusChoice
              key={rule.code}
              rule={rule}
              selected={day.status === rule.code}
              isDefault={day.defaultStatus === rule.code}
              disabled={!day.inPeriod}
              onSelect={() => void actions.setStatus(date, rule.code)}
            />
          ))}
        </div>
      </fieldset>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-surface-2 py-2 pl-4 pr-2">
        <div className="min-w-0">
          <p className="font-bold text-ink">Heures payées</p>
          <p className="text-sm text-ink-2">
            {day.hoursOverridden ? `Forcées (statut : ${formatHours(day.rule.paidHours)})` : 'Celles du statut'}
          </p>
        </div>
        <Stepper
          label="Heures payées"
          value={day.hours}
          disabled={!day.inPeriod}
          onChange={(hours) => void actions.setHours(date, hours === day.rule.paidHours ? null : hours)}
        />
      </div>
      {day.hoursOverridden ? (
        <button
          type="button"
          className="mt-1 min-h-11 px-1 text-[0.9375rem] font-bold text-accent-strong underline-offset-4 hover:underline"
          onClick={() => void actions.setHours(date, null)}
        >
          Revenir aux heures du statut ({formatHours(day.rule.paidHours)})
        </button>
      ) : null}

      <div className="mt-4 flex flex-col gap-1.5">
        <label htmlFor={commentId} className="font-bold text-ink">
          Commentaire
        </label>
        <textarea
          id={commentId}
          rows={2}
          maxLength={500}
          value={comment}
          disabled={!day.inPeriod}
          placeholder="Ex. : partie à 11 h, rendez-vous médical"
          onFocus={() => setEditing(true)}
          onChange={(event) => setComment(event.target.value)}
          onBlur={() => {
            setEditing(false)
            saveComment()
          }}
          className={`${inputClass} min-h-20 resize-none py-3`}
        />
      </div>

      <div className="mt-5 flex items-end justify-between gap-4 rounded-2xl border border-line p-4">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wider text-ink-2">Montant dû</p>
          <p className="text-sm text-ink-2">{formula(day, calc.settings)}</p>
        </div>
        <p className="num shrink-0 font-display text-3xl font-extrabold text-ink">{formatRs(day.totalCents)}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <LastEdit override={day.override} members={data.members} currentUserId={currentUserId} />
        {day.override && day.inPeriod ? (
          <Button variant="ghost" onClick={() => void actions.reset(date)}>
            <RotateCcw size={16} aria-hidden="true" />
            Rétablir « {defaultLabel} »
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}
