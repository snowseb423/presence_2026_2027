import { useEffect, useId, useState } from 'react'
import { nowIso } from '../../data/commands.ts'
import { useEngine } from '../../data/DataProvider.tsx'
import type { SettingsPatch } from '../../data/ops.ts'
import { diffDays, isIsoDate } from '../../domain/dates.ts'
import { WEEKDAY_INITIALS, formatHours, formatNumber, parseDecimal } from '../../domain/format.ts'
import type { Settings, StatusRule } from '../../domain/types.ts'
import { useToast } from '../../ui/Toaster.tsx'
import { Button, Card, Field, inputClass } from '../../ui/controls.tsx'

const WEEKDAY_NAMES = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

interface Draft {
  employeeName: string
  hourlyRate: string
  hoursPerDay: string
  transportPerDay: string
  workDays: number[]
  periodStart: string
  periodEnd: string
}

type Errors = Partial<Record<keyof Draft, string>>

const decimal = (value: number) => String(value).replace('.', ',')

function toDraft(settings: Settings): Draft {
  return {
    employeeName: settings.employeeName,
    hourlyRate: decimal(settings.hourlyRate),
    hoursPerDay: decimal(settings.hoursPerDay),
    transportPerDay: decimal(settings.transportPerDay),
    workDays: [...settings.workDays].sort(),
    periodStart: settings.periodStart,
    periodEnd: settings.periodEnd,
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function validate(draft: Draft): { values: Omit<SettingsPatch, never> | null; errors: Errors } {
  const errors: Errors = {}
  const hourlyRate = parseDecimal(draft.hourlyRate)
  const hoursPerDay = parseDecimal(draft.hoursPerDay)
  const transportPerDay = parseDecimal(draft.transportPerDay)
  if (hourlyRate === null || hourlyRate < 0 || hourlyRate > 100_000) errors.hourlyRate = 'Montant invalide.'
  if (hoursPerDay === null || hoursPerDay <= 0 || hoursPerDay > 24) errors.hoursPerDay = 'Entre 0 et 24 heures.'
  if (transportPerDay === null || transportPerDay < 0 || transportPerDay > 100_000) errors.transportPerDay = 'Montant invalide.'
  if (draft.workDays.length === 0) errors.workDays = 'Choisissez au moins un jour.'
  if (!isIsoDate(draft.periodStart)) errors.periodStart = 'Date invalide.'
  if (!isIsoDate(draft.periodEnd)) errors.periodEnd = 'Date invalide.'
  else if (isIsoDate(draft.periodStart)) {
    if (draft.periodEnd < draft.periodStart) errors.periodEnd = 'La fin doit suivre le début.'
    else if (diffDays(draft.periodStart, draft.periodEnd) > 3660) errors.periodEnd = 'Dix ans au maximum.'
  }
  if (draft.employeeName.length > 60) errors.employeeName = '60 caractères au maximum.'
  if (Object.keys(errors).length) return { values: null, errors }
  return {
    values: {
      employeeName: draft.employeeName.trim(),
      hourlyRate: hourlyRate!,
      hoursPerDay: hoursPerDay!,
      transportPerDay: transportPerDay!,
      workDays: draft.workDays,
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
    },
    errors,
  }
}

function NumberInput({
  id,
  value,
  onChange,
  suffix,
  error,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  suffix: string
  error?: string
}) {
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${inputClass} num pr-28 ${error ? 'border-danger' : ''}`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[0.9375rem] text-ink-2">{suffix}</span>
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function SettingsForm({ settings, rules }: { settings: Settings; rules: StatusRule[] }) {
  const engine = useEngine()
  const toast = useToast()
  const id = useId()
  const [base, setBase] = useState(settings)
  const [draft, setDraft] = useState(() => toDraft(settings))
  const [rescale, setRescale] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const dirty = !sameDraft(draft, toDraft(base))

  // Modification reçue de l'autre téléphone : on la reprend si rien n'est en cours.
  useEffect(() => {
    if (!dirty) {
      setBase(settings)
      setDraft(toDraft(settings))
    }
  }, [settings]) // `dirty` volontairement absent : on ne réagit qu'aux réglages reçus

  const { values, errors } = validate(draft)
  const shown = submitted ? errors : {}
  const newHours = parseDecimal(draft.hoursPerDay)
  const hoursChanged = newHours !== null && newHours > 0 && newHours !== settings.hoursPerDay
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  async function save() {
    setSubmitted(true)
    if (!values) return
    const at = nowIso()
    const patch: SettingsPatch = {}
    for (const key of Object.keys(values) as (keyof SettingsPatch)[]) {
      if (JSON.stringify(values[key]) !== JSON.stringify(settings[key])) (patch as Record<string, unknown>)[key] = values[key]
    }
    if (Object.keys(patch).length) await engine.commit({ kind: 'settings.patch', patch, at })
    if (hoursChanged && rescale && newHours) {
      // Les statuts suivent la nouvelle durée : 3 h → 4 h, 1,5 h → 2 h…
      for (const rule of rules) {
        if (rule.paidHours <= 0) continue
        const paidHours = Math.round(((rule.paidHours * newHours) / settings.hoursPerDay) * 100) / 100
        await engine.commit({ kind: 'statusRule.patch', code: rule.code, patch: { paidHours }, at })
      }
    }
    setBase({ ...settings, ...values })
    setSubmitted(false)
    toast({ message: 'Réglages enregistrés' })
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        noValidate
      >
        <Field label="Nom de l’employée" htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            value={draft.employeeName}
            maxLength={60}
            autoComplete="off"
            placeholder="Ex. : Marie"
            onChange={(event) => set('employeeName', event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Taux horaire" htmlFor={`${id}-rate`}>
          <NumberInput id={`${id}-rate`} value={draft.hourlyRate} onChange={(v) => set('hourlyRate', v)} suffix="Rs / heure" error={shown.hourlyRate} />
        </Field>
        <Field label="Heures par jour" htmlFor={`${id}-hours`}>
          <NumberInput id={`${id}-hours`} value={draft.hoursPerDay} onChange={(v) => set('hoursPerDay', v)} suffix="heures" error={shown.hoursPerDay} />
        </Field>
        {hoursChanged ? (
          <label className="-mt-2 flex min-h-11 items-start gap-3 rounded-2xl bg-surface-2 p-3 text-[0.9375rem]">
            <input
              type="checkbox"
              checked={rescale}
              onChange={(event) => setRescale(event.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
            />
            <span>
              Adapter les heures des statuts ({formatHours(settings.hoursPerDay)} → {formatHours(newHours!)},{' '}
              {formatHours(settings.hoursPerDay / 2)} → {formatHours(newHours! / 2)}…)
            </span>
          </label>
        ) : null}
        <Field label="Transport" htmlFor={`${id}-transport`} hint="Payé pour chaque jour effectivement presté.">
          <NumberInput
            id={`${id}-transport`}
            value={draft.transportPerDay}
            onChange={(v) => set('transportPerDay', v)}
            suffix="Rs / jour"
            error={shown.transportPerDay}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[0.9375rem] font-bold text-ink">Jours de prestation</legend>
          <div className="-mx-1.5 grid grid-cols-7 gap-0.5">
            {WEEKDAY_INITIALS.map((initial, index) => {
              const day = index + 1
              const on = draft.workDays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  aria-label={WEEKDAY_NAMES[index]}
                  onClick={() =>
                    set('workDays', on ? draft.workDays.filter((d) => d !== day) : [...draft.workDays, day].sort())
                  }
                  className={`min-h-11 rounded-xl border-2 font-bold transition-colors ${
                    on ? 'border-accent bg-accent text-on-accent' : 'border-line bg-surface text-ink-2'
                  }`}
                >
                  {initial}
                </button>
              )
            })}
          </div>
          {shown.workDays ? <p className="mt-1 text-sm font-bold text-danger">{shown.workDays}</p> : null}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Début de période" htmlFor={`${id}-start`}>
            <input
              id={`${id}-start`}
              type="date"
              value={draft.periodStart}
              onChange={(event) => set('periodStart', event.target.value)}
              aria-invalid={Boolean(shown.periodStart)}
              className={`${inputClass} px-3`}
            />
          </Field>
          <Field label="Fin de période" htmlFor={`${id}-end`}>
            <input
              id={`${id}-end`}
              type="date"
              value={draft.periodEnd}
              onChange={(event) => set('periodEnd', event.target.value)}
              aria-invalid={Boolean(shown.periodEnd)}
              className={`${inputClass} px-3`}
            />
          </Field>
        </div>
        {shown.periodStart || shown.periodEnd ? (
          <p className="-mt-2 text-sm font-bold text-danger">{shown.periodStart ?? shown.periodEnd}</p>
        ) : null}

        <div
          className={
            dirty
              ? 'sticky bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-10 -mx-2 flex items-center justify-end gap-2 rounded-2xl bg-surface/95 p-2 shadow-card backdrop-blur-md'
              : 'flex'
          }
        >
          {dirty ? (
            <>
              <p className="mr-auto pl-2 text-sm leading-tight text-ink-2">Non enregistré</p>
              <Button
                variant="quiet"
                onClick={() => {
                  setDraft(toDraft(settings))
                  setSubmitted(false)
                }}
              >
                Annuler
              </Button>
              <Button variant="primary" type="submit">
                Enregistrer
              </Button>
            </>
          ) : (
            <p className="text-sm text-ink-2">
              {formatNumber(settings.hoursPerDay)} h × Rs {formatNumber(settings.hourlyRate)} + Rs {formatNumber(settings.transportPerDay)} de transport par jour presté.
            </p>
          )}
        </div>
      </form>
    </Card>
  )
}
