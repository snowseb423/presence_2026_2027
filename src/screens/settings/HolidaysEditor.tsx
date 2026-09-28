import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { nowIso } from '../../data/commands.ts'
import { useEngine } from '../../data/DataProvider.tsx'
import { isIsoDate, isWeekend } from '../../domain/dates.ts'
import { capitalize, formatDateLong, monthShort, weekdayShort } from '../../domain/format.ts'
import type { Holiday, IsoDate, Settings } from '../../domain/types.ts'
import { Sheet } from '../../ui/Sheet.tsx'
import { useToast } from '../../ui/Toaster.tsx'
import { Button, Card, Field, inputClass } from '../../ui/controls.tsx'

interface Editing {
  original: Holiday | null
  date: string
  name: string
  note: string
}

export function HolidaysEditor({ holidays, settings }: { holidays: ReadonlyMap<IsoDate, Holiday>; settings: Settings }) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const list = [...holidays.values()].sort((a, b) => a.date.localeCompare(b.date))
  const years = [...new Set(list.map((h) => h.date.slice(0, 4)))]

  return (
    <>
      <Card padded={false}>
        {years.length === 0 ? <p className="p-4 text-ink-2">Aucun jour férié.</p> : null}
        {years.map((year) => (
          <div key={year}>
            <h3 className="border-b border-line bg-surface-2 px-4 py-2 font-display text-base font-bold">{year}</h3>
            <ul className="divide-y divide-line">
              {list
                .filter((holiday) => holiday.date.startsWith(year))
                .map((holiday) => {
                  const outside = holiday.date < settings.periodStart || holiday.date > settings.periodEnd
                  return (
                    <li key={holiday.date}>
                      <button
                        type="button"
                        onClick={() => setEditing({ original: holiday, date: holiday.date, name: holiday.name, note: holiday.note ?? '' })}
                        className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2"
                        aria-label={`${formatDateLong(holiday.date)} : ${holiday.name}. Modifier`}
                      >
                        <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-surface-2 py-1 leading-none" aria-hidden="true">
                          <span className="text-[0.6875rem] font-bold uppercase text-ink-2">{weekdayShort(holiday.date).replace('.', '')}</span>
                          <span className="num font-display text-xl font-extrabold text-ink">{Number(holiday.date.slice(8))}</span>
                          <span className="text-xs font-bold text-ink-2">{monthShort(holiday.date)}</span>
                        </span>
                        <span className="min-w-0 flex-1 leading-snug">
                          <span className="block font-bold text-ink">{holiday.name}</span>
                          {holiday.note ? <span className="block text-sm text-ink-2">{holiday.note}</span> : null}
                          {isWeekend(holiday.date) || outside ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {isWeekend(holiday.date) ? (
                                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">week-end · sans effet</span>
                              ) : null}
                              {outside ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-bold text-ink-2">hors période</span> : null}
                            </span>
                          ) : null}
                        </span>
                        <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
            </ul>
          </div>
        ))}
        <div className="border-t border-line p-3">
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => setEditing({ original: null, date: settings.periodStart, name: '', note: '' })}
          >
            <Plus size={18} aria-hidden="true" />
            Ajouter un jour férié
          </Button>
        </div>
      </Card>
      <HolidaySheet editing={editing} holidays={holidays} onClose={() => setEditing(null)} onChange={setEditing} />
    </>
  )
}

function HolidaySheet({
  editing,
  holidays,
  onClose,
  onChange,
}: {
  editing: Editing | null
  holidays: ReadonlyMap<IsoDate, Holiday>
  onClose: () => void
  onChange: (editing: Editing) => void
}) {
  const engine = useEngine()
  const toast = useToast()
  const id = useId()
  const [submitted, setSubmitted] = useState(false)
  if (!editing) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>

  const validDate = isIsoDate(editing.date)
  const name = editing.name.trim()
  const conflict = validDate && editing.date !== editing.original?.date ? holidays.get(editing.date) : undefined
  const error = !validDate ? 'Date invalide.' : !name ? 'Le nom est obligatoire.' : null

  async function save() {
    setSubmitted(true)
    if (error || !editing) return
    const at = nowIso()
    // Correction de date : l'ancienne date est supprimée, la nouvelle créée.
    if (editing.original && editing.original.date !== editing.date) {
      await engine.commit({ kind: 'holiday.delete', date: editing.original.date, at })
    }
    await engine.commit({ kind: 'holiday.upsert', date: editing.date, name, note: editing.note.trim() || null, at })
    toast({ message: `Férié enregistré : ${name}` })
    setSubmitted(false)
    onClose()
  }

  async function remove() {
    if (!editing?.original) return
    if (!window.confirm(`Supprimer « ${editing.original.name} » du ${formatDateLong(editing.original.date)} ?`)) return
    await engine.commit({ kind: 'holiday.delete', date: editing.original.date, at: nowIso() })
    toast({ message: 'Férié supprimé' })
    onClose()
  }

  return (
    <Sheet
      open
      onClose={() => {
        setSubmitted(false)
        onClose()
      }}
      title={editing.original ? 'Modifier le jour férié' : 'Nouveau jour férié'}
      subtitle={validDate ? capitalize(formatDateLong(editing.date)) : undefined}
      footer={
        <div className="flex items-center gap-2">
          {editing.original ? (
            <Button variant="danger" onClick={() => void remove()}>
              <Trash2 size={18} aria-hidden="true" />
              Supprimer
            </Button>
          ) : null}
          <Button variant="primary" className="ml-auto" onClick={() => void save()}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <Field label="Date" htmlFor={`${id}-date`}>
          <input
            id={`${id}-date`}
            type="date"
            required
            value={editing.date}
            onChange={(event) => onChange({ ...editing, date: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Nom" htmlFor={`${id}-name`}>
          <input
            id={`${id}-name`}
            required
            maxLength={120}
            value={editing.name}
            placeholder="Ex. : Eid-Ul-Fitr"
            onChange={(event) => onChange({ ...editing, name: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Note (facultative)" htmlFor={`${id}-note`}>
          <input
            id={`${id}-note`}
            maxLength={500}
            value={editing.note}
            placeholder="Ex. : à confirmer selon la lune"
            onChange={(event) => onChange({ ...editing, note: event.target.value })}
            className={inputClass}
          />
        </Field>
        {conflict ? (
          <p className="rounded-2xl bg-surface-2 p-3 text-[0.9375rem] text-ink">
            Un férié existe déjà à cette date (« {conflict.name} ») : il sera remplacé.
          </p>
        ) : null}
        {validDate && isWeekend(editing.date) ? (
          <p className="text-[0.9375rem] text-ink-2">Cette date tombe un week-end : elle ne change pas le montant dû.</p>
        ) : null}
        {submitted && error ? (
          <p role="alert" className="text-[0.9375rem] font-bold text-danger">
            {error}
          </p>
        ) : null}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  )
}
