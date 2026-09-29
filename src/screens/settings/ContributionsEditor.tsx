import { ChevronRight, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { nowIso } from '../../data/commands.ts'
import { useEngine } from '../../data/DataProvider.tsx'
import type { SettingsPatch } from '../../data/ops.ts'
import { clampDate, monthOf } from '../../domain/dates.ts'
import { DEFAULT_CONTRIBUTIONS } from '../../domain/defaults.ts'
import { capitalize, formatMonth, formatNumber, formatPercent, formatRs, parseDecimal } from '../../domain/format.ts'
import { periodMonths } from '../../domain/pay.ts'
import { bracketFor, computePayslip, contributionApplies } from '../../domain/payslip.ts'
import type { CalcContext, Contribution, ContributionBase, ContributionBracket, IsoMonth } from '../../domain/types.ts'
import { useToday } from '../../lib/useToday.ts'
import { Sheet } from '../../ui/Sheet.tsx'
import { useToast } from '../../ui/Toaster.tsx'
import { Button, Card, Field, Select, Switch, inputClass } from '../../ui/controls.tsx'

interface BracketDraft {
  upTo: string
  employeeRate: string
  employerRate: string
}

interface Editing {
  original: Contribution | null
  label: string
  description: string
  enabled: boolean
  base: ContributionBase
  floor: string
  ceiling: string
  brackets: BracketDraft[]
  from: string
  to: string
  onBonus: boolean
}

/** Montant ou taux affiché dans un champ : « 50 000 », « 1,5 ». */
const decimal = (value: number | null) => (value === null ? '' : formatNumber(value, 3))

function toEditing(contribution: Contribution | null): Editing {
  return {
    original: contribution,
    label: contribution?.label ?? '',
    description: contribution?.description ?? '',
    enabled: contribution?.enabled ?? true,
    base: contribution?.base ?? 'basic',
    floor: decimal(contribution?.floor ?? null),
    ceiling: decimal(contribution?.ceiling ?? null),
    brackets: (contribution?.brackets ?? [{ upTo: null, employeeRate: 0, employerRate: 0 }]).map((bracket) => ({
      upTo: decimal(bracket.upTo),
      employeeRate: decimal(bracket.employeeRate),
      employerRate: decimal(bracket.employerRate),
    })),
    from: contribution?.from ?? '',
    to: contribution?.to ?? '',
    onBonus: contribution?.onBonus ?? false,
  }
}

/** Montant facultatif : vide → null, invalide → undefined. */
function optionalAmount(input: string): number | null | undefined {
  if (!input.trim()) return null
  const value = parseDecimal(input)
  return value !== null && value >= 0 && value <= 10_000_000 ? value : undefined
}

/** Cotisation saisie, ou le premier problème rencontré. */
function fromEditing(editing: Editing, id: string): { contribution: Contribution } | { error: string } {
  const label = editing.label.trim()
  if (!label) return { error: 'Le libellé est obligatoire.' }
  const brackets: ContributionBracket[] = []
  for (const [index, draft] of editing.brackets.entries()) {
    const last = index === editing.brackets.length - 1
    const employeeRate = parseDecimal(draft.employeeRate)
    const employerRate = parseDecimal(draft.employerRate)
    if ([employeeRate, employerRate].some((rate) => rate === null || rate < 0 || rate > 100)) {
      return { error: `Tranche ${index + 1} : taux entre 0 et 100 %.` }
    }
    const upTo = last ? null : parseDecimal(draft.upTo)
    if (!last && (upTo === null || upTo <= 0)) return { error: `Tranche ${index + 1} : montant maximal invalide.` }
    const previous = brackets.at(-1)?.upTo
    if (upTo !== null && previous != null && upTo <= previous) return { error: 'Les tranches doivent aller en croissant.' }
    brackets.push({ upTo, employeeRate: employeeRate!, employerRate: employerRate! })
  }
  const floor = optionalAmount(editing.floor)
  const ceiling = optionalAmount(editing.ceiling)
  if (floor === undefined || ceiling === undefined) return { error: 'Plancher ou plafond invalide.' }
  if (floor !== null && ceiling !== null && floor > ceiling) return { error: 'Le plancher dépasse le plafond.' }
  if (editing.from && editing.to && editing.from > editing.to) return { error: 'Le premier mois doit précéder le dernier.' }
  return {
    contribution: {
      id,
      label,
      description: editing.description.trim(),
      enabled: editing.enabled,
      base: editing.base,
      floor,
      ceiling,
      brackets,
      from: editing.from || null,
      to: editing.to || null,
      onBonus: editing.onBonus,
    },
  }
}

function ratesText(bracket: ContributionBracket): string {
  return `${formatPercent(bracket.employeeRate)} salariée · ${formatPercent(bracket.employerRate)} employeur`
}

const BASES = [
  ['basic', 'Salaire de base'],
  ['gross', 'Brut avec transport'],
] as const

/** Choix d'une assiette : salaire de base, ou brut avec le transport. */
function BaseChoice({
  name,
  legend,
  value,
  onChange,
  hint,
}: {
  name: string
  legend: string
  value: ContributionBase
  onChange: (value: ContributionBase) => void
  hint?: string
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[0.9375rem] font-bold text-ink">{legend}</legend>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
        {BASES.map(([option, text]) => (
          <label
            key={option}
            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-2 text-center text-[0.9375rem] font-bold leading-tight transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-[var(--focus)] ${
              value === option ? 'bg-surface text-ink shadow-sm' : 'text-ink-2'
            }`}
          >
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} className="sr-only" />
            {text}
          </label>
        ))}
      </div>
      {hint ? <p className="mt-1.5 text-sm text-ink-2">{hint}</p> : null}
    </fieldset>
  )
}

function validityText(contribution: Contribution): string {
  const { from, to } = contribution
  if (from && to) return `De ${formatMonth(from)} à ${formatMonth(to)}`
  if (from) return `À partir de ${formatMonth(from)}`
  if (to) return `Jusqu’en ${formatMonth(to)}`
  return ''
}

/** Cotisations de la fiche de paie, date de paiement et arrondi. */
export function ContributionsEditor({ calc }: { calc: CalcContext }) {
  const engine = useEngine()
  const toast = useToast()
  const today = useToday()
  const id = useId()
  const [editing, setEditing] = useState<Editing | null>(null)
  const { settings } = calc
  const commit = (patch: SettingsPatch) => engine.commit({ kind: 'settings.patch', patch, at: nowIso() })

  // Aperçu sur le mois en cours (borné à la période suivie).
  const month = monthOf(clampDate(today, settings.periodStart, settings.periodEnd))
  const slip = computePayslip(month, calc)

  function replace(list: Contribution[], message: string) {
    void commit({ contributions: list })
    toast({ message })
  }

  return (
    <>
      <Card padded={false}>
        <ul className="divide-y divide-line">
          {settings.contributions.map((contribution) => {
            const line = slip.contributions.find((item) => item.id === contribution.id)
            const assiette = contribution.base === 'gross' ? slip.grossCents : slip.basicCents
            const bracket = bracketFor(contribution, Math.max(assiette, 1)) ?? contribution.brackets.at(-1)!
            const amounts = line
              ? [
                  line.employeeCents > 0 ? `retenue ${formatRs(line.employeeCents)}` : '',
                  line.employerCents > 0 ? `employeur ${formatRs(line.employerCents)}` : '',
                ].filter(Boolean)
              : []
            const details = [
              !contribution.enabled
                ? 'Désactivée'
                : line
                  ? `${capitalize(formatMonth(month))} : ${amounts.join(', ') || formatRs(0)}`
                  : contributionApplies(contribution, month)
                    ? ''
                    : `Pas en ${formatMonth(month)}`,
              validityText(contribution),
              contribution.onBonus ? 'aussi sur le bonus' : '',
            ].filter(Boolean)
            return (
              <li key={contribution.id} className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={() => setEditing(toEditing(contribution))}
                  className="flex min-h-16 min-w-0 flex-1 items-center gap-2 py-3 pl-4 text-left hover:bg-surface-2"
                  aria-label={`${contribution.label} : modifier`}
                >
                  <span className="min-w-0 flex-1 leading-snug">
                    <span className="block font-bold text-ink">
                      {contribution.label}
                      {contribution.description ? <span className="font-normal text-ink-2"> · {contribution.description}</span> : null}
                    </span>
                    <span className="num block text-sm text-ink-2">{ratesText(bracket)}</span>
                    {details.length ? <span className="num block text-sm text-ink-2">{details.join(' · ')}</span> : null}
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-ink-3" aria-hidden="true" />
                </button>
                <Switch
                  label={`${contribution.label} active`}
                  checked={contribution.enabled}
                  onChange={(enabled) =>
                    replace(
                      settings.contributions.map((item) => (item.id === contribution.id ? { ...item, enabled } : item)),
                      `${contribution.label} ${enabled ? 'activée' : 'désactivée'}`,
                    )
                  }
                />
              </li>
            )
          })}
          {settings.contributions.length === 0 ? <li className="p-4 text-ink-2">Aucune cotisation : le net est égal au brut.</li> : null}
        </ul>
        <div className="border-t border-line p-3">
          <Button variant="ghost" className="w-full" onClick={() => setEditing(toEditing(null))}>
            <Plus size={18} aria-hidden="true" />
            Ajouter une cotisation
          </Button>
        </div>
      </Card>

      <Card className="mt-3 flex flex-col gap-4">
        <Field label="Date de paiement du salaire" htmlFor={`${id}-payday`}>
          <Select
            id={`${id}-payday`}
            value={settings.payDay}
            onChange={(event) => void commit({ payDay: Number(event.target.value) })}
          >
            <option value={0}>Dernier jour ouvré du mois</option>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                Le {day === 1 ? '1er' : day} du mois suivant
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">Arrondir à la roupie</p>
            <p className="text-sm text-ink-2">Comme dans les déclarations à la MRA, sans centimes.</p>
          </div>
          <Switch
            label="Arrondir les cotisations à la roupie"
            checked={settings.roundContributions}
            onChange={(roundContributions) => void commit({ roundContributions })}
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">Bonus de fin d’année</p>
            <p className="text-sm text-ink-2">1/12 des gains de l’année, ajouté à la fiche de décembre.</p>
          </div>
          <Switch
            label="Bonus de fin d’année sur la fiche de décembre"
            checked={settings.endOfYearBonus}
            onChange={(endOfYearBonus) => void commit({ endOfYearBonus })}
          />
        </div>
        {settings.endOfYearBonus ? (
          <BaseChoice
            name={`${id}-bonus-base`}
            legend="Gains pris en compte pour le bonus"
            value={settings.endOfYearBonusBase}
            onChange={(endOfYearBonusBase) => void commit({ endOfYearBonusBase })}
            hint="Brut par défaut : les gains comprennent les sommes versées en plus du salaire de base."
          />
        ) : null}
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm('Remplacer toutes les cotisations par les taux par défaut (CSG, NSF, PRGF, NPF, taxe de formation) ?')) {
              replace(DEFAULT_CONTRIBUTIONS, 'Cotisations par défaut rétablies')
            }
          }}
        >
          <RotateCcw size={18} aria-hidden="true" />
          Rétablir les cotisations par défaut
        </Button>
      </Card>

      <ContributionSheet
        editing={editing}
        months={periodMonths(settings)}
        onChange={setEditing}
        onClose={() => setEditing(null)}
        onSave={(contribution, original) => {
          const list = original
            ? settings.contributions.map((item) => (item.id === original.id ? contribution : item))
            : [...settings.contributions, contribution]
          replace(list, `Cotisation enregistrée : ${contribution.label}`)
          setEditing(null)
        }}
        onDelete={(original) => {
          if (!window.confirm(`Supprimer la cotisation « ${original.label} » ?`)) return
          replace(
            settings.contributions.filter((item) => item.id !== original.id),
            `Cotisation supprimée : ${original.label}`,
          )
          setEditing(null)
        }}
      />
    </>
  )
}

/** Champ numérique avec son unité à droite (Rs, %). */
function UnitInput({
  id,
  value,
  onChange,
  unit,
  label,
  placeholder,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  unit: string
  label?: string
  placeholder?: string
}) {
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} num pr-11`}
      />
      <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-[0.9375rem] text-ink-2">{unit}</span>
    </div>
  )
}

function ContributionSheet({
  editing,
  months,
  onChange,
  onClose,
  onSave,
  onDelete,
}: {
  editing: Editing | null
  months: IsoMonth[]
  onChange: (editing: Editing) => void
  onClose: () => void
  onSave: (contribution: Contribution, original: Contribution | null) => void
  onDelete: (original: Contribution) => void
}) {
  const id = useId()
  const [submitted, setSubmitted] = useState(false)
  if (!editing) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>

  const result = fromEditing(editing, editing.original?.id ?? `perso-${Date.now().toString(36)}`)
  const error = 'error' in result ? result.error : null
  const set = (patch: Partial<Editing>) => onChange({ ...editing, ...patch })
  const setBracket = (index: number, patch: Partial<BracketDraft>) =>
    set({ brackets: editing.brackets.map((bracket, i) => (i === index ? { ...bracket, ...patch } : bracket)) })
  const monthOptions = (value: string) => (value && !months.includes(value) ? [...months, value].sort() : months)

  function save() {
    setSubmitted(true)
    if ('error' in result || !editing) return
    setSubmitted(false)
    onSave(result.contribution, editing.original)
  }

  return (
    <Sheet
      open
      onClose={() => {
        setSubmitted(false)
        onClose()
      }}
      title={editing.original ? `Cotisation ${editing.original.label}` : 'Nouvelle cotisation'}
      subtitle="Calculée sur chaque fiche de paie"
      footer={
        <div className="flex items-center gap-2">
          {editing.original ? (
            <Button variant="danger" onClick={() => onDelete(editing.original!)}>
              <Trash2 size={18} aria-hidden="true" />
              Supprimer
            </Button>
          ) : null}
          <Button variant="primary" className="ml-auto" onClick={save}>
            Enregistrer
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        noValidate
      >
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 font-bold text-ink">Active</p>
          <Switch label="Cotisation active" checked={editing.enabled} onChange={(enabled) => set({ enabled })} />
        </div>
        <Field label="Libellé" htmlFor={`${id}-label`} hint="Imprimé sur la fiche de paie.">
          <input
            id={`${id}-label`}
            value={editing.label}
            maxLength={30}
            placeholder="Ex. : CSG"
            autoComplete="off"
            onChange={(event) => set({ label: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Intitulé complet (facultatif)" htmlFor={`${id}-description`}>
          <input
            id={`${id}-description`}
            value={editing.description}
            maxLength={80}
            placeholder="Ex. : Contribution sociale généralisée"
            autoComplete="off"
            onChange={(event) => set({ description: event.target.value })}
            className={inputClass}
          />
        </Field>

        <BaseChoice
          name={`${id}-base`}
          legend="Assiette"
          value={editing.base}
          onChange={(base) => set({ base })}
          hint="Salaire de base : heures payées × taux horaire, sans le transport."
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[0.9375rem] font-bold text-ink">Taux par tranche de salaire</legend>
          <p className="-mt-1 text-sm text-ink-2">Les taux de la tranche atteinte s’appliquent à toute l’assiette du mois.</p>
          {editing.brackets.map((bracket, index) => {
            const last = index === editing.brackets.length - 1
            return (
              <div key={index} className="rounded-2xl border border-line p-3">
                <div className="flex min-h-11 items-center gap-2">
                  {last ? (
                    <p className="min-w-0 flex-1 font-bold text-ink">
                      {editing.brackets.length > 1 ? 'Au-delà' : 'Quel que soit le salaire'}
                    </p>
                  ) : (
                    <>
                      <label htmlFor={`${id}-upto-${index}`} className="shrink-0 font-bold text-ink">
                        Jusqu’à
                      </label>
                      <div className="min-w-0 flex-1">
                        <UnitInput
                          id={`${id}-upto-${index}`}
                          value={bracket.upTo}
                          onChange={(upTo) => setBracket(index, { upTo })}
                          unit="Rs"
                          placeholder="Ex. : 50 000"
                        />
                      </div>
                    </>
                  )}
                  {editing.brackets.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => set({ brackets: editing.brackets.filter((_, i) => i !== index) })}
                      className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-surface-2"
                      aria-label={`Supprimer la tranche ${index + 1}`}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div>
                    <p className="mb-1 text-sm text-ink-2">Part salariale</p>
                    <UnitInput
                      value={bracket.employeeRate}
                      onChange={(employeeRate) => setBracket(index, { employeeRate })}
                      unit="%"
                      label={`Part salariale, tranche ${index + 1}`}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-sm text-ink-2">Part patronale</p>
                    <UnitInput
                      value={bracket.employerRate}
                      onChange={(employerRate) => setBracket(index, { employerRate })}
                      unit="%"
                      label={`Part patronale, tranche ${index + 1}`}
                    />
                  </div>
                </div>
              </div>
            )
          })}
          <Button
            variant="ghost"
            onClick={() => {
              // Nouvelle tranche avant « Au-delà », aux mêmes taux.
              const last = editing.brackets.at(-1)!
              set({ brackets: [...editing.brackets.slice(0, -1), { ...last, upTo: '' }, last] })
            }}
          >
            <Plus size={18} aria-hidden="true" />
            Ajouter une tranche
          </Button>
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Plancher" htmlFor={`${id}-floor`}>
            <UnitInput id={`${id}-floor`} value={editing.floor} onChange={(floor) => set({ floor })} unit="Rs" placeholder="Aucun" />
          </Field>
          <Field label="Plafond" htmlFor={`${id}-ceiling`}>
            <UnitInput id={`${id}-ceiling`} value={editing.ceiling} onChange={(ceiling) => set({ ceiling })} unit="Rs" placeholder="Aucun" />
          </Field>
        </div>
        <p className="-mt-3 text-sm text-ink-2">
          Assiette minimale et maximale par mois, facultatives (NSF : révisées chaque 1er juillet). Un mois sans salaire ne cotise pas.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Premier mois" htmlFor={`${id}-from`}>
            <Select id={`${id}-from`} value={editing.from} onChange={(event) => set({ from: event.target.value })}>
              <option value="">Sans limite</option>
              {monthOptions(editing.from).map((option) => (
                <option key={option} value={option}>
                  {capitalize(formatMonth(option))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dernier mois" htmlFor={`${id}-to`}>
            <Select id={`${id}-to`} value={editing.to} onChange={(event) => set({ to: event.target.value })}>
              <option value="">Sans limite</option>
              {monthOptions(editing.to).map((option) => (
                <option key={option} value={option}>
                  {capitalize(formatMonth(option))}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink">Due aussi sur le bonus de fin d’année</p>
            <p className="text-sm text-ink-2">Calculée à part, sur la part « salaire de base » du bonus (cas de la CSG).</p>
          </div>
          <Switch label="Due aussi sur le bonus de fin d’année" checked={editing.onBonus} onChange={(onBonus) => set({ onBonus })} />
        </div>

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
