// Mise en forme française, déterministe (indépendante de la version ICU
// du navigateur) : « Rs 12 276 », « −Rs 1 674 », « jeudi 1er octobre 2026 ».
import { MAURITIUS_TZ, isoWeekday } from './dates.ts'
import type { IsoDate, IsoMonth } from './types.ts'

/** Espace fine insécable : séparateur de milliers. */
export const THIN_SPACE = ' '
/** Espace insécable : entre « Rs » et le nombre, avant « h ». */
export const NBSP = ' '
/** Signe moins typographique. */
export const MINUS = '−'

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
const WEEKDAYS_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
export const WEEKDAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']
const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const MONTHS_SHORT = [
  'janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin',
  'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.',
]

/** « 12276 » → « 12 276 » (espace fine insécable). */
export function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE)
}

/** Nombre à la française : virgule décimale, milliers séparés, sans zéros inutiles. */
export function formatNumber(value: number, maxDecimals = 2): string {
  const factor = 10 ** maxDecimals
  const rounded = Math.round(Math.abs(value) * factor) / factor
  const [integer = '0', decimals] = rounded.toFixed(maxDecimals).split('.')
  const trimmed = decimals?.replace(/0+$/, '') ?? ''
  const sign = value < 0 && rounded !== 0 ? MINUS : ''
  return `${sign}${groupThousands(integer)}${trimmed ? `,${trimmed}` : ''}`
}

/**
 * Montant en roupies à partir de centimes : « Rs 12 276 », « Rs 1 234,50 ».
 * `signed` ajoute « + » devant un montant positif (écarts).
 */
export function formatRs(cents: number, options: { signed?: boolean } = {}): string {
  const rounded = Math.round(cents)
  const abs = Math.abs(rounded)
  const integer = groupThousands(String(Math.floor(abs / 100)))
  const fraction = abs % 100
  const amount = `Rs${NBSP}${integer}${fraction ? `,${String(fraction).padStart(2, '0')}` : ''}`
  if (rounded < 0) return `${MINUS}${amount}`
  if (rounded > 0 && options.signed) return `+${amount}`
  return amount
}

/** Montant en roupies (nombre décimal) : pour les taux saisis dans les réglages. */
export function formatRupees(rupees: number): string {
  return formatRs(Math.round(rupees * 100))
}

/** « 3 h », « 1,5 h ». */
export function formatHours(hours: number): string {
  return `${formatNumber(hours)}${NBSP}h`
}

export function capitalize(text: string): string {
  return text ? text[0]!.toLocaleUpperCase('fr') + text.slice(1) : text
}

function parts(date: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  return { year, month, day }
}

function dayNumber(day: number): string {
  return day === 1 ? '1er' : String(day)
}

export function weekdayName(date: IsoDate): string {
  return WEEKDAYS[isoWeekday(date) - 1]!
}

export function weekdayShort(date: IsoDate): string {
  return WEEKDAYS_SHORT[isoWeekday(date) - 1]!
}

/** « jeudi 1er octobre 2026 ». */
export function formatDateLong(date: IsoDate): string {
  const { year, month, day } = parts(date)
  return `${weekdayName(date)} ${dayNumber(day)} ${MONTHS[month - 1]} ${year}`
}

/** « 1er octobre ». */
export function formatDayMonth(date: IsoDate): string {
  const { month, day } = parts(date)
  return `${dayNumber(day)} ${MONTHS[month - 1]}`
}

/** « jeu. 1er oct. ». */
export function formatDateShort(date: IsoDate): string {
  const { month, day } = parts(date)
  return `${weekdayShort(date)} ${dayNumber(day)} ${MONTHS_SHORT[month - 1]}`
}

/** « 01/10/2026 ». */
export function formatDateNumeric(date: IsoDate): string {
  const { year, month, day } = parts(date)
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
}

/** « octobre 2026 ». */
export function formatMonth(month: IsoMonth): string {
  const [year, m] = month.split('-').map(Number) as [number, number]
  return `${MONTHS[m - 1]} ${year}`
}

export function monthName(month: IsoMonth): string {
  return MONTHS[Number(month.slice(5, 7)) - 1]!
}

/** Horodatage → « lun. 28/09 à 14:32 », à l'heure de Maurice. */
export function formatTimestamp(timestamp: string, timeZone: string = MAURITIUS_TZ): string {
  const moment = new Date(timestamp)
  if (Number.isNaN(moment.getTime())) return ''
  const values: Record<string, string> = {}
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(moment)) {
    values[part.type] = part.value
  }
  const date = `${values.year}-${values.month}-${values.day}`
  return `${weekdayShort(date)} ${values.day}/${values.month} à ${values.hour}:${values.minute}`
}

/** Saisie utilisateur → nombre : accepte « 1,5 », « 1.5 », espaces. */
export function parseDecimal(input: string): number | null {
  const normalized = input.replace(/[\s  ]/g, '').replace(',', '.')
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(normalized)) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}
