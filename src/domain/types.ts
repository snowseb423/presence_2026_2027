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
  /** Nom usuel, affiché dans l'app. */
  employeeName: string

  // Fiche de paie : employée
  /** Nom complet, tel que sur la carte d'identité. */
  employeeFullName: string
  employeeAddress: string
  /** Numéro de la carte d'identité nationale (NIC). */
  employeeNic: string
  employeeJobTitle: string
  employeeHireDate: IsoDate | null
  employeePaymentMethod: string
  employeeBankAccount: string

  // Fiche de paie : employeur
  employerName: string
  employerAddress: string
  employerPhone: string
  employerEmail: string
  /** Numéro d'enregistrement de l'employeur auprès de la MRA (ERN). */
  employerRegistration: string

  // Paie
  /** Date de paiement : 0 = dernier jour ouvré du mois, 1…28 = ce jour du mois suivant. */
  payDay: number
  /** Cotisations arrondies à la roupie, comme dans les déclarations à la MRA. */
  roundContributions: boolean
  contributions: Contribution[]
  /** Bonus de fin d'année (1/12 des gains de l'année) sur la fiche de décembre. */
  endOfYearBonus: boolean
  /** Gains servant au calcul du bonus : brut (avec le transport) ou salaire de base. */
  endOfYearBonusBase: ContributionBase

  updatedAt: string | null
  updatedBy: string | null
}

/**
 * Tranche d'une cotisation : les taux de la première tranche dont la borne
 * n'est pas dépassée s'appliquent à toute l'assiette (pas de calcul marginal).
 */
export interface ContributionBracket {
  /** Assiette mensuelle maximale de la tranche (Rs) ; null = sans limite. */
  upTo: number | null
  /** Part salariale (%), retenue sur le salaire. */
  employeeRate: number
  /** Part patronale (%), à la charge de l'employeur. */
  employerRate: number
}

/** Assiette : salaire de base (heures payées) ou brut (avec le transport). */
export type ContributionBase = 'basic' | 'gross'

/** Cotisation sociale prélevée sur la fiche de paie (CSG, NSF, PRGF…). */
export interface Contribution {
  /** Identifiant stable : « csg », « nsf »… */
  id: string
  /** Libellé court imprimé sur la fiche : « CSG ». */
  label: string
  /** Intitulé complet, facultatif. */
  description: string
  enabled: boolean
  base: ContributionBase
  /** Assiette minimale et maximale (Rs par mois) ; null = aucune. */
  floor: number | null
  ceiling: number | null
  /** Par bornes croissantes ; la dernière est sans limite. */
  brackets: ContributionBracket[]
  /** Premier et dernier mois d'application ; null = sans limite. */
  from: IsoMonth | null
  to: IsoMonth | null
  /** Due aussi sur le bonus de fin d'année, calculée à part (CSG). */
  onBonus: boolean
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
