// Thème choisi sur cet appareil : système, clair ou sombre. Préférence
// personnelle, gardée en localStorage (appliquée avant rendu par
// public/theme-init.js).
import { useCallback, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'presence:theme'

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    /* stockage indisponible : le choix vaut pour la session */
  }
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [theme, setTheme] = useState(readTheme)
  const update = useCallback((choice: ThemeChoice) => {
    applyTheme(choice)
    setTheme(choice)
  }, [])
  return [theme, update]
}
