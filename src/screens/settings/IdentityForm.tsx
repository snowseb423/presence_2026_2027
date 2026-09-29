import { useEffect, useId, useState } from 'react'
import { nowIso } from '../../data/commands.ts'
import { useEngine } from '../../data/DataProvider.tsx'
import { isValidEmail } from '../../data/members.ts'
import type { SettingsPatch } from '../../data/ops.ts'
import { isIsoDate } from '../../domain/dates.ts'
import type { Settings } from '../../domain/types.ts'
import { useToast } from '../../ui/Toaster.tsx'
import { Card, Field, Select, inputClass, textareaClass } from '../../ui/controls.tsx'
import { SaveBar } from './SaveBar.tsx'

/** Réglages de la fiche de paie saisis en texte (la date d'entrée : date ou vide). */
type IdentityKey =
  | 'employeeFullName'
  | 'employeeAddress'
  | 'employeeNic'
  | 'employeeJobTitle'
  | 'employeeHireDate'
  | 'employeePaymentMethod'
  | 'employeeBankAccount'
  | 'employerName'
  | 'employerAddress'
  | 'employerPhone'
  | 'employerEmail'
  | 'employerRegistration'

interface FieldSpec {
  key: IdentityKey
  label: string
  kind?: 'text' | 'textarea' | 'date' | 'email' | 'tel' | 'select'
  maxLength?: number
  placeholder?: string
  hint?: string
  autoComplete?: string
  uppercase?: boolean
}

export const PAYMENT_METHODS = ['Espèces', 'Virement bancaire', 'Chèque', 'Paiement mobile'] as const

// Longueurs maximales : celles des contraintes SQL (migration de la fiche de paie).
const EMPLOYEE_FIELDS: FieldSpec[] = [
  {
    key: 'employeeFullName',
    label: 'Nom complet',
    maxLength: 120,
    placeholder: 'Ex. : Marie-Claire Dupont',
    hint: 'Tel qu’il figure sur la carte d’identité.',
    autoComplete: 'off',
  },
  { key: 'employeeAddress', label: 'Adresse postale', kind: 'textarea', maxLength: 300, placeholder: 'Rue, localité', autoComplete: 'off' },
  {
    key: 'employeeNic',
    label: 'N° de carte d’identité (NIC)',
    maxLength: 20,
    placeholder: 'Ex. : D0101801234567',
    autoComplete: 'off',
    uppercase: true,
  },
  { key: 'employeeJobTitle', label: 'Emploi', maxLength: 60, placeholder: 'Employée de maison', autoComplete: 'off' },
  { key: 'employeeHireDate', label: 'Date d’entrée', kind: 'date' },
  { key: 'employeePaymentMethod', label: 'Mode de paiement', kind: 'select' },
  {
    key: 'employeeBankAccount',
    label: 'Compte bancaire (facultatif)',
    maxLength: 60,
    placeholder: 'Banque et numéro de compte',
    autoComplete: 'off',
  },
]

const EMPLOYER_FIELDS: FieldSpec[] = [
  { key: 'employerName', label: 'Nom complet', maxLength: 120, placeholder: 'Ex. : Sébastien Dupont', autoComplete: 'name' },
  { key: 'employerAddress', label: 'Adresse postale', kind: 'textarea', maxLength: 300, placeholder: 'Rue, localité', autoComplete: 'street-address' },
  { key: 'employerPhone', label: 'Téléphone', kind: 'tel', maxLength: 40, placeholder: 'Ex. : +230 5 712 34 56', autoComplete: 'tel' },
  { key: 'employerEmail', label: 'Email', kind: 'email', maxLength: 120, placeholder: 'adresse@exemple.com', autoComplete: 'email' },
  {
    key: 'employerRegistration',
    label: 'N° d’employeur (ERN)',
    maxLength: 40,
    hint: 'Numéro d’enregistrement attribué par la MRA à l’employeur.',
    autoComplete: 'off',
    uppercase: true,
  },
]

const FORMS = {
  employee: { title: 'Employée', fields: EMPLOYEE_FIELDS, saved: 'Informations de l’employée enregistrées' },
  employer: { title: 'Employeur', fields: EMPLOYER_FIELDS, saved: 'Informations de l’employeur enregistrées' },
} as const

type Draft = Partial<Record<IdentityKey, string>>
type Errors = Partial<Record<IdentityKey, string>>

function toDraft(settings: Settings, fields: readonly FieldSpec[]): Draft {
  return Object.fromEntries(fields.map(({ key }) => [key, settings[key] ?? '']))
}

function sameDraft(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Réglages de référence et saisie en cours : un seul état, modifié d'un bloc. */
interface FormState {
  base: Settings
  draft: Draft
}

function validate(draft: Draft, fields: readonly FieldSpec[]): { values: SettingsPatch; errors: Errors } {
  const values: Record<string, string | null> = {}
  const errors: Errors = {}
  for (const { key, kind, maxLength, uppercase } of fields) {
    const trimmed = (draft[key] ?? '').trim()
    const value = uppercase ? trimmed.toLocaleUpperCase('fr') : trimmed
    if (kind === 'date' && value && !isIsoDate(value)) errors[key] = 'Date invalide.'
    else if (kind === 'email' && value && !isValidEmail(value)) errors[key] = 'Adresse email invalide.'
    else if (maxLength && value.length > maxLength) errors[key] = `${maxLength} caractères au maximum.`
    values[key] = kind === 'date' ? value || null : value
  }
  return { values: values as SettingsPatch, errors }
}

/** Informations imprimées sur la fiche de paie : employée ou employeur. */
export function IdentityForm({ kind, settings }: { kind: keyof typeof FORMS; settings: Settings }) {
  const { title, fields, saved } = FORMS[kind]
  const engine = useEngine()
  const toast = useToast()
  const id = useId()
  const [form, setForm] = useState<FormState>(() => ({ base: settings, draft: toDraft(settings, fields) }))
  const [submitted, setSubmitted] = useState(false)
  const { draft } = form
  const dirty = !sameDraft(draft, toDraft(form.base, fields))

  // Réglages reçus (autre téléphone, synchronisation, premier lancement) :
  // repris seulement si rien n'est en cours de saisie. La décision se prend
  // sur l'état courant, au moment où React applique la mise à jour : une
  // frappe arrivée en même temps n'est jamais effacée.
  useEffect(() => {
    setForm((current) =>
      sameDraft(current.draft, toDraft(current.base, fields)) ? { base: settings, draft: toDraft(settings, fields) } : current,
    )
  }, [settings, fields])

  const { values, errors } = validate(draft, fields)
  const shown = submitted ? errors : {}

  async function save() {
    setSubmitted(true)
    if (Object.keys(errors).length) return
    const sent = draft
    const patch: SettingsPatch = {}
    for (const { key } of fields) {
      if (values[key] !== settings[key]) (patch as Record<string, unknown>)[key] = values[key]
    }
    if (Object.keys(patch).length) await engine.commit({ kind: 'settings.patch', patch, at: nowIso() })
    // Valeurs normalisées (espaces, majuscules) : le formulaire n'est plus
    // modifié, sauf si la saisie a continué pendant l'enregistrement.
    const next = { ...settings, ...values }
    setForm((current) => ({ base: next, draft: sameDraft(current.draft, sent) ? toDraft(next, fields) : current.draft }))
    setSubmitted(false)
    toast({ message: saved })
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-4"
        aria-label={title}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
        noValidate
      >
        <h3 className="font-display text-base font-bold">{title}</h3>
        {fields.map((field) => {
          const fieldId = `${id}-${field.key}`
          const value = draft[field.key] ?? ''
          const error = shown[field.key]
          const set = (next: string) => setForm((current) => ({ ...current, draft: { ...current.draft, [field.key]: next } }))
          const common = {
            id: fieldId,
            value,
            'aria-invalid': Boolean(error),
            'aria-describedby': error ? `${fieldId}-error` : undefined,
          }
          let control
          if (field.kind === 'textarea') {
            control = (
              <textarea
                {...common}
                rows={3}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                autoComplete={field.autoComplete}
                onChange={(event) => set(event.target.value)}
                className={textareaClass}
              />
            )
          } else if (field.kind === 'select') {
            const options = value && !(PAYMENT_METHODS as readonly string[]).includes(value) ? [...PAYMENT_METHODS, value] : PAYMENT_METHODS
            control = (
              <Select {...common} onChange={(event) => set(event.target.value)}>
                <option value="">Non précisé</option>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            )
          } else {
            control = (
              <input
                {...common}
                type={field.kind === 'date' ? 'date' : field.kind === 'email' ? 'email' : field.kind === 'tel' ? 'tel' : 'text'}
                maxLength={field.maxLength}
                placeholder={field.placeholder}
                autoComplete={field.autoComplete}
                autoCapitalize={field.uppercase ? 'characters' : undefined}
                onChange={(event) => set(event.target.value)}
                className={`${inputClass} ${field.kind === 'date' ? 'px-3' : ''} ${field.uppercase ? 'uppercase placeholder:normal-case' : ''}`}
              />
            )
          }
          return (
            <Field key={field.key} label={field.label} htmlFor={fieldId} hint={field.hint}>
              {control}
              {error ? (
                <p id={`${fieldId}-error`} className="text-sm font-bold text-danger">
                  {error}
                </p>
              ) : null}
            </Field>
          )
        })}
        <SaveBar
          dirty={dirty}
          onCancel={() => {
            setForm({ base: settings, draft: toDraft(settings, fields) })
            setSubmitted(false)
          }}
        />
      </form>
    </Card>
  )
}
