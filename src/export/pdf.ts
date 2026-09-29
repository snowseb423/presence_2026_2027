// Écriture PDF minimale et sans dépendance : pages A4, texte en Helvetica
// (police standard de tous les lecteurs PDF, non incorporée, codage
// WinAnsi), traits et rectangles. Suffisant pour une fiche de paie.
//
// Coordonnées en points (1/72 de pouce), origine en haut à gauche : `y` est
// la distance depuis le haut de la page (ligne de base pour le texte).

export const A4 = { width: 595.28, height: 841.89 } as const

export type Font = 'regular' | 'bold'

/** Couleur « #rrggbb ». */
export type Color = string

// Largeurs des caractères 32 à 255 du codage WinAnsi, en millièmes du corps,
// relevées dans les métriques AFM d'Adobe (Helvetica, Helvetica-Bold).
const WIDTHS: Record<Font, readonly number[]> = {
  regular: [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0,
    556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
    0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 500,
    278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
  ],
  bold: [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 0,
    556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
    0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 556,
    278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
    400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
    722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
    722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
    556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
    611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
  ],
}

const FONT_RESOURCES: Record<Font, { name: string; base: string }> = {
  regular: { name: 'F1', base: 'Helvetica' },
  bold: { name: 'F2', base: 'Helvetica-Bold' },
}

// Caractères hors Latin-1 présents dans WinAnsi (octets 0x80 à 0x9F).
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
}

// Signes typographiques de l'app sans équivalent WinAnsi.
const SUBSTITUTES: Record<number, number> = {
  0x202f: 0xa0, // espace fine insécable → espace insécable
  0x2009: 0x20, // espace fine
  0x2212: 0x96, // signe moins → tiret demi-cadratin
  0x2011: 0x2d, // trait d'union insécable
  0x09: 0x20,
  0x0a: 0x20,
  0x0d: 0x20,
}

function winAnsiByte(code: number): number | null {
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return code
  return WIN_ANSI_EXTRA[code] ?? SUBSTITUTES[code] ?? null
}

/**
 * Texte → octets WinAnsi. Une lettre accentuée absente du codage perd son
 * accent (« ő » → « o ») ; tout autre caractère devient « ? ».
 */
export function encodeWinAnsi(text: string): number[] {
  const bytes: number[] = []
  for (const char of text) {
    const byte = winAnsiByte(char.codePointAt(0)!)
    if (byte !== null) {
      bytes.push(byte)
      continue
    }
    const base = char.normalize('NFD').replace(/\p{M}/gu, '')
    const fallback = base && base !== char ? [...base].map((c) => winAnsiByte(c.codePointAt(0)!)) : [null]
    for (const b of fallback) bytes.push(b ?? 0x3f)
  }
  return bytes
}

/** Largeur d'un texte, en points. */
export function textWidth(text: string, font: Font, size: number, spacing = 0): number {
  const widths = WIDTHS[font]
  const bytes = encodeWinAnsi(text)
  let units = 0
  for (const byte of bytes) units += widths[byte - 32] ?? 0
  return (units * size) / 1000 + spacing * bytes.length
}

/** Coupe un texte avec « … » pour qu'il tienne dans `maxWidth`. */
export function fitText(text: string, font: Font, size: number, maxWidth: number): string {
  if (textWidth(text, font, size) <= maxWidth) return text
  const chars = [...text]
  while (chars.length && textWidth(`${chars.join('').trimEnd()}…`, font, size) > maxWidth) chars.pop()
  return chars.length ? `${chars.join('').trimEnd()}…` : ''
}

/**
 * Découpe un texte en lignes d'au plus `maxWidth`, retours à la ligne
 * conservés ; un mot trop long (adresse email…) est coupé où il faut.
 */
export function wrapText(text: string, font: Font, size: number, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (textWidth(candidate, font, size) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      line = ''
      for (const char of word) {
        if (line && textWidth(line + char, font, size) > maxWidth) {
          lines.push(line)
          line = ''
        }
        line += char
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

const num = (value: number) => String(Math.round(value * 100) / 100)

function rgb(color: Color): string {
  const hex = color.replace('#', '')
  return [0, 2, 4].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ')
}

/** Chaîne littérale PDF (octets WinAnsi, parenthèses et barres obliques échappées). */
function pdfString(text: string): string {
  let out = '('
  for (const byte of encodeWinAnsi(text)) {
    const char = String.fromCharCode(byte)
    out += char === '(' || char === ')' || char === '\\' ? `\\${char}` : char
  }
  return `${out})`
}

/** Chaîne de texte PDF en UTF-16BE (métadonnées). */
function pdfTextString(text: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  return `<${hex}>`
}

export interface TextOptions {
  font?: Font
  size?: number
  color?: Color
  align?: 'left' | 'center' | 'right'
  /** Espacement supplémentaire entre les caractères, en points. */
  spacing?: number
}

export interface ShapeOptions {
  fill?: Color
  stroke?: Color
  lineWidth?: number
  /** Rayon des coins arrondis. */
  radius?: number
}

export class PdfPage {
  readonly width: number
  readonly height: number
  /** Flux de contenu : chaîne « binaire » (un caractère = un octet). */
  private content: string[] = []

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  /** Écrit un texte sur une ligne ; renvoie sa largeur. */
  text(x: number, y: number, value: string, options: TextOptions = {}): number {
    const { font = 'regular', size = 10, color = '#000000', align = 'left', spacing = 0 } = options
    const width = textWidth(value, font, size, spacing)
    const left = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x
    const tracking = spacing ? `${num(spacing)} Tc ` : ''
    this.content.push(
      `q ${rgb(color)} rg BT /${FONT_RESOURCES[font].name} ${num(size)} Tf ${tracking}${num(left)} ${num(this.height - y)} Td ${pdfString(value)} Tj ET Q`,
    )
    return width
  }

  /** Rectangle de coin haut gauche (x, y). */
  rect(x: number, y: number, width: number, height: number, options: ShapeOptions): void {
    const { fill, stroke, lineWidth = 1, radius = 0 } = options
    if (!fill && !stroke) return
    const bottom = this.height - y - height
    let path: string
    if (radius > 0) {
      const r = Math.min(radius, width / 2, height / 2)
      const k = r * 0.5523 // approximation d'un quart de cercle par une courbe de Bézier
      const [l, b, rt, t] = [x, bottom, x + width, bottom + height]
      path = [
        `${num(l + r)} ${num(b)} m`,
        `${num(rt - r)} ${num(b)} l`,
        `${num(rt - r + k)} ${num(b)} ${num(rt)} ${num(b + r - k)} ${num(rt)} ${num(b + r)} c`,
        `${num(rt)} ${num(t - r)} l`,
        `${num(rt)} ${num(t - r + k)} ${num(rt - r + k)} ${num(t)} ${num(rt - r)} ${num(t)} c`,
        `${num(l + r)} ${num(t)} l`,
        `${num(l + r - k)} ${num(t)} ${num(l)} ${num(t - r + k)} ${num(l)} ${num(t - r)} c`,
        `${num(l)} ${num(b + r)} l`,
        `${num(l)} ${num(b + r - k)} ${num(l + r - k)} ${num(b)} ${num(l + r)} ${num(b)} c h`,
      ].join(' ')
    } else {
      path = `${num(x)} ${num(bottom)} ${num(width)} ${num(height)} re`
    }
    const paint = fill && stroke ? 'B' : fill ? 'f' : 'S'
    this.content.push(
      `q ${fill ? `${rgb(fill)} rg ` : ''}${stroke ? `${rgb(stroke)} RG ${num(lineWidth)} w ` : ''}${path} ${paint} Q`,
    )
  }

  line(x1: number, y1: number, x2: number, y2: number, options: { color?: Color; width?: number; dash?: number } = {}): void {
    const { color = '#000000', width = 1, dash } = options
    this.content.push(
      `q ${rgb(color)} RG ${num(width)} w ${dash ? `[${num(dash)} ${num(dash)}] 0 d ` : ''}${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S Q`,
    )
  }

  /** Flux de contenu de la page. */
  stream(): string {
    return this.content.join('\n')
  }
}

export interface DocumentInfo {
  title: string
  author?: string
  subject?: string
  /** Date de création (métadonnées). */
  createdAt?: Date
}

/** Date au format PDF : « D:20261030120000Z ». */
function pdfDate(date: Date): string {
  return `D:${date.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`
}

export class PdfDocument {
  private readonly pages: PdfPage[] = []
  private readonly info: DocumentInfo

  constructor(info: DocumentInfo) {
    this.info = info
  }

  get pageCount(): number {
    return this.pages.length
  }

  addPage(width: number = A4.width, height: number = A4.height): PdfPage {
    const page = new PdfPage(width, height)
    this.pages.push(page)
    return page
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    // Objets : 1 catalogue, 2 arbre des pages, 3 et 4 polices, 5 métadonnées,
    // puis une page et son contenu (6 et 7, 8 et 9…).
    const pageRef = (index: number) => `${6 + index * 2} 0 R`
    const { title, author, subject, createdAt = new Date() } = this.info
    const objects: string[] = [
      `<< /Type /Catalog /Pages 2 0 R /Lang (fr-FR) /ViewerPreferences << /DisplayDocTitle true >> >>`,
      `<< /Type /Pages /Kids [${this.pages.map((_, i) => pageRef(i)).join(' ')}] /Count ${this.pages.length} >>`,
      ...(['regular', 'bold'] as const).map(
        (font) => `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_RESOURCES[font].base} /Encoding /WinAnsiEncoding >>`,
      ),
      [
        `<< /Title ${pdfTextString(title)}`,
        author ? ` /Author ${pdfTextString(author)}` : '',
        subject ? ` /Subject ${pdfTextString(subject)}` : '',
        ` /Creator ${pdfTextString('Présence')} /Producer ${pdfTextString('Présence')} /CreationDate (${pdfDate(createdAt)}) >>`,
      ].join(''),
    ]
    this.pages.forEach((page, index) => {
      const fonts = Object.values(FONT_RESOURCES)
        .map((font, i) => `/${font.name} ${3 + i} 0 R`)
        .join(' ')
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << ${fonts} >> >> /Contents ${7 + index * 2} 0 R >>`,
      )
      const stream = page.stream()
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    })

    // En-tête avec quatre octets > 127 : signale un fichier binaire.
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
    const offsets: number[] = []
    objects.forEach((body, index) => {
      offsets.push(out.length)
      out += `${index + 1} 0 obj\n${body}\nendobj\n`
    })
    const xref = out.length
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`

    const bytes = new Uint8Array(out.length)
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i)
    return bytes
  }
}
