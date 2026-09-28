// Point d'entrée des exports, chargé à la demande depuis l'écran Budget.
import type { CalcContext } from '../domain/types.ts'
import { isIos } from '../lib/platform.ts'
import { buildDailyCsv } from './csv.ts'
import { type ExportFormat, type ExportScope, fileBaseName } from './tables.ts'

export type { ExportFormat, ExportScope } from './tables.ts'

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** Génère le fichier et le propose à l'utilisateur ; renvoie son nom. */
export async function exportData(calc: CalcContext, scope: ExportScope, format: ExportFormat): Promise<string> {
  const name = `${fileBaseName(calc, scope)}.${format}`
  const blob =
    format === 'csv'
      ? new Blob([buildDailyCsv(calc, scope)], { type: MIME.csv })
      : new Blob([await (await import('./xlsx.ts')).buildXlsx(calc, scope)], { type: MIME.xlsx })
  await deliver(blob, name)
  return name
}

async function deliver(blob: Blob, name: string): Promise<void> {
  // Sur iPhone, l'app installée gère mal les téléchargements : la feuille de
  // partage permet d'enregistrer dans Fichiers ou d'envoyer le fichier.
  const file = new File([blob], name, { type: blob.type })
  if (isIos() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (error) {
      if ((error as DOMException).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
