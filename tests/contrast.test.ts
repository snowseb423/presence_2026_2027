// Contraste AA garanti par construction : chaque paire texte/fond utilisée
// dans l'interface est vérifiée dans les deux thèmes.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, '..', 'src/styles/tokens.css'), 'utf8')

function block(selector: RegExp): Record<string, string> {
  const start = css.search(selector)
  if (start < 0) throw new Error(`Bloc introuvable : ${selector}`)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) {
      end = i
      break
    }
  }
  const tokens: Record<string, string> = {}
  for (const match of css.slice(open, end).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[match[1]!] = match[2]!.toLowerCase()
  }
  return tokens
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const light = block(/^:root\s*\{/m)
const dark = block(/:root:not\(\[data-theme='light'\]\)\s*\{/)
const darkExplicit = block(/:root\[data-theme='dark'\]\s*\{/)

const STATUS_TOKENS = ['olive', 'amber', 'coral', 'brick', 'lagoon', 'plum', 'slate', 'steel', 'stone', 'mist']

const TEXT_PAIRS: [string, string][] = [
  ['ink', 'bg'], ['ink', 'surface'], ['ink', 'surface-2'], ['ink', 'surface-3'],
  ['ink-2', 'bg'], ['ink-2', 'surface'], ['ink-2', 'surface-2'], ['ink-2', 'surface-3'],
  ['ink-3', 'bg'], ['ink-3', 'surface'], ['ink-3', 'surface-2'],
  ['accent-strong', 'bg'], ['accent-strong', 'surface'], ['accent-strong', 'surface-2'], ['accent-strong', 'accent-soft'],
  ['on-accent', 'accent'],
  ['danger', 'surface'], ['danger', 'danger-soft'], ['danger', 'bg'],
  ['positive', 'surface'], ['positive', 'positive-soft'], ['positive', 'bg'],
  ['header-ink', 'header-bg'], ['header-ink-2', 'header-bg'], ['header-accent', 'header-bg'],
  ...STATUS_TOKENS.flatMap((t): [string, string][] => [
    [`st-${t}-ink`, `st-${t}-soft`], [`st-${t}-ink`, 'surface'], [`st-${t}-ink`, 'bg'], [`st-${t}-ink`, 'surface-2'],
  ]),
]

describe.each([
  ['clair', light],
  ['sombre', dark],
])('thème %s', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s sur %s ≥ 4,5:1', (fg, bg) => {
    expect(tokens[fg], fg).toBeDefined()
    expect(tokens[bg], bg).toBeDefined()
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5)
  })

  it.each(STATUS_TOKENS)('pastille %s ≥ 3:1 sur la surface et le fond', (token) => {
    expect(contrast(tokens[`st-${token}`]!, tokens.surface!)).toBeGreaterThanOrEqual(3)
    expect(contrast(tokens[`st-${token}`]!, tokens.bg!)).toBeGreaterThanOrEqual(3)
  })
})

it('le thème sombre choisi explicitement est identique au thème sombre système', () => {
  expect(darkExplicit).toEqual(dark)
})
