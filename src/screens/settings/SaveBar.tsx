import type { ReactNode } from 'react'
import { Button } from '../../ui/controls.tsx'

/**
 * Pied d'un formulaire de réglages : tant que des modifications ne sont pas
 * enregistrées, barre collée au-dessus de la navigation ; sinon `children`.
 */
export function SaveBar({ dirty, onCancel, children }: { dirty: boolean; onCancel: () => void; children?: ReactNode }) {
  if (!dirty && !children) return null
  return (
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
          <Button variant="quiet" onClick={onCancel}>
            Annuler
          </Button>
          <Button variant="primary" type="submit">
            Enregistrer
          </Button>
        </>
      ) : (
        children
      )}
    </div>
  )
}
