/** Date calendaire « AAAA-MM-JJ », sans heure ni fuseau. */
export type IsoDate = string

/** Mois « AAAA-MM ». */
export type IsoMonth = string

/** Code d'un statut (clé de status_rules). */
export type StatusCode = string

export interface Settings {
  hourlyRate: number
  hoursPerDay: number
  transportPerDay: number
  /** Jours de prestation, numérotation ISO : 1 = lundi … 7 = dimanche. */
  workDays: number[]
  periodStart: IsoDate
  periodEnd: IsoDate
  employeeName: string
  updatedAt: string | null
  updatedBy: string | null
}

export interface StatusRule {
  code: StatusCode
  label: string
  paidHours: number
  transportPaid: boolean
  colorToken: string
  sortOrder: number
  updatedAt: string | null
}

export interface Holiday {
  date: IsoDate
  name: string
  note: string | null
  updatedAt: string | null
  updatedBy: string | null
}

/** Journée qui s'écarte du statut par défaut. */
export interface Override {
  date: IsoDate
  statusCode: StatusCode
  /** Remplace les heures du statut, sans toucher au transport. */
  hoursOverride: number | null
  comment: string | null
  /** Heure de la saisie sur le téléphone (last-write-wins). */
  updatedAt: string
  updatedBy: string | null
}

export interface Member {
  email: string
  displayName: string | null
  userId: string | null
}

/** Tout ce qu'il faut pour calculer un montant : données pures, sans I/O. */
export interface CalcContext {
  settings: Settings
  rules: ReadonlyMap<StatusCode, StatusRule>
  holidays: ReadonlyMap<IsoDate, Holiday>
  overrides: ReadonlyMap<IsoDate, Override>
}
