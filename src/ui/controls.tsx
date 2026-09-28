import { Minus, Plus } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { formatHours } from '../domain/format.ts'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'quiet'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-on-accent shadow-sm hover:brightness-110',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-accent-strong hover:bg-accent-soft',
  danger: 'border border-danger/40 bg-surface text-danger hover:bg-danger-soft',
  quiet: 'bg-surface-2 text-ink hover:bg-surface-3',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'md' | 'lg' }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-full font-bold transition-[transform,background-color,filter] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 ${
        size === 'lg' ? 'min-h-13 px-6 text-base' : 'min-h-11 px-5 text-[0.9375rem]'
      } ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Card({ children, className = '', padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={`rounded-3xl border border-line bg-surface shadow-card ${padded ? 'p-4' : 'overflow-hidden'} ${className}`}>
      {children}
    </section>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2.5 mt-7 flex items-end justify-between gap-3 first:mt-0">
      <h2 className="font-display text-lg font-bold text-ink">{children}</h2>
      {action}
    </div>
  )
}

/** Réglage d'une quantité par pas (heures). Cibles de 44 px. */
export function Stepper({
  value,
  onChange,
  step = 0.5,
  min = 0,
  max = 12,
  label,
  format = formatHours,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  label: string
  format?: (value: number) => string
  disabled?: boolean
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, Math.round(next * 100) / 100))
  return (
    <div className="inline-flex items-center rounded-full border border-line-strong bg-surface" role="group" aria-label={label}>
      <button
        type="button"
        className="grid size-11 place-items-center rounded-full text-ink hover:bg-surface-2 disabled:opacity-40"
        onClick={() => onChange(clamp(value - step))}
        disabled={disabled || value <= min}
        aria-label={`Diminuer ${label.toLowerCase()}`}
      >
        <Minus size={18} aria-hidden="true" />
      </button>
      <output className="num min-w-16 text-center font-bold text-ink" aria-live="polite">
        {format(value)}
      </output>
      <button
        type="button"
        className="grid size-11 place-items-center rounded-full text-ink hover:bg-surface-2 disabled:opacity-40"
        onClick={() => onChange(clamp(value + step))}
        disabled={disabled || value >= max}
        aria-label={`Augmenter ${label.toLowerCase()}`}
      >
        <Plus size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group grid min-h-11 min-w-14 place-items-center disabled:opacity-45"
    >
      <span
        className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
          checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3'
        }`}
      >
        <span
          className={`absolute size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[1.4rem]' : 'left-0.5'}`}
        />
      </span>
    </button>
  )
}

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string
  hint?: ReactNode
  htmlFor: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[0.9375rem] font-bold text-ink">
        {label}
      </label>
      {children}
      {hint ? <p className="text-sm text-ink-2">{hint}</p> : null}
    </div>
  )
}

export const inputClass =
  'min-h-12 w-full rounded-2xl border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none focus-visible:outline-3 focus-visible:outline-offset-1'
