// Valeurs par défaut, identiques au seed SQL (vérifié par
// tests/sql/parity.test.ts). Servent au premier lancement hors ligne et au
// mode local, avant toute synchronisation.
import type { Contribution, Holiday, Settings, StatusRule } from './types.ts'

// Cotisations d'un employé de maison à Maurice (taux de la MRA, révisés
// chaque 1er juillet : à vérifier) :
// - CSG : 1,5 % salarié et 3 % employeur jusqu'à Rs 50 000 par mois, 3 % et
//   6 % au-delà ; employé de maison payé au plus Rs 3 000 : part patronale seule ;
// - NSF : 1 % salarié et 2,5 % employeur sur le salaire de base, entre un
//   plancher (employé de maison) et un plafond, montants de juillet 2025 ;
// - PRGF : 4,5 % à la charge de l'employeur, sauf au-delà de Rs 200 000 ;
// - NPF (budget 2026-2027) : remplace CSG et PRGF au 1er juillet 2027 ;
// - taxe de formation (Training Levy) : non due pour un employé de maison.
export const DEFAULT_CONTRIBUTIONS: Contribution[] = [
  {
    id: 'csg',
    label: 'CSG',
    description: 'Contribution sociale généralisée',
    enabled: true,
    base: 'basic',
    floor: null,
    ceiling: null,
    brackets: [
      { upTo: 3000, employeeRate: 0, employerRate: 3 },
      { upTo: 50000, employeeRate: 1.5, employerRate: 3 },
      { upTo: null, employeeRate: 3, employerRate: 6 },
    ],
    from: null,
    to: '2027-06',
  },
  {
    id: 'nsf',
    label: 'NSF',
    description: 'National Savings Fund',
    enabled: true,
    base: 'basic',
    floor: 2795,
    ceiling: 28570,
    brackets: [{ upTo: null, employeeRate: 1, employerRate: 2.5 }],
    from: null,
    to: null,
  },
  {
    id: 'prgf',
    label: 'PRGF',
    description: 'Portable Retirement Gratuity Fund',
    enabled: true,
    base: 'basic',
    floor: null,
    ceiling: null,
    brackets: [
      { upTo: 200000, employeeRate: 0, employerRate: 4.5 },
      { upTo: null, employeeRate: 0, employerRate: 0 },
    ],
    from: null,
    to: '2027-06',
  },
  {
    id: 'npf',
    label: 'NPF',
    description: 'National Pensions Fund (remplace CSG et PRGF)',
    enabled: true,
    base: 'basic',
    floor: null,
    ceiling: null,
    brackets: [
      { upTo: 50000, employeeRate: 1.5, employerRate: 7.5 },
      { upTo: null, employeeRate: 3, employerRate: 10.5 },
    ],
    from: '2027-07',
    to: null,
  },
  {
    id: 'training_levy',
    label: 'Taxe de formation',
    description: 'Training Levy, non due pour un employé de maison',
    enabled: false,
    base: 'basic',
    floor: null,
    ceiling: null,
    brackets: [{ upTo: null, employeeRate: 0, employerRate: 1 }],
    from: null,
    to: null,
  },
]

export const DEFAULT_SETTINGS: Settings = {
  hourlyRate: 170,
  hoursPerDay: 3,
  transportPerDay: 48,
  workDays: [1, 2, 3, 4, 5],
  periodStart: '2026-09-01',
  periodEnd: '2027-12-31',
  employeeName: '',
  employeeFullName: '',
  employeeAddress: '',
  employeeNic: '',
  employeeJobTitle: 'Employée de maison',
  employeeHireDate: null,
  employeePaymentMethod: '',
  employeeBankAccount: '',
  employerName: '',
  employerAddress: '',
  employerPhone: '',
  employerEmail: '',
  employerRegistration: '',
  payDay: 0,
  roundContributions: true,
  contributions: DEFAULT_CONTRIBUTIONS,
  updatedAt: null,
  updatedBy: null,
}

type RuleSeed = Omit<StatusRule, 'updatedAt'>

const RULES: RuleSeed[] = [
  { code: 'travaille', label: 'Travaillé', paidHours: 3, transportPaid: true, colorToken: 'olive', sortOrder: 10 },
  { code: 'demi_journee', label: 'Demi-journée', paidHours: 1.5, transportPaid: true, colorToken: 'amber', sortOrder: 20 },
  { code: 'conge_non_paye', label: 'Congé non payé', paidHours: 0, transportPaid: false, colorToken: 'coral', sortOrder: 30 },
  { code: 'absence_non_payee', label: 'Absence non payée', paidHours: 0, transportPaid: false, colorToken: 'brick', sortOrder: 40 },
  { code: 'jour_supplementaire', label: 'Jour supplémentaire', paidHours: 3, transportPaid: true, colorToken: 'lagoon', sortOrder: 50 },
  { code: 'conge_paye', label: 'Congé payé', paidHours: 3, transportPaid: false, colorToken: 'plum', sortOrder: 60 },
  { code: 'ferie_non_paye', label: 'Férié (non payé)', paidHours: 0, transportPaid: false, colorToken: 'slate', sortOrder: 70 },
  { code: 'ferie_paye', label: 'Férié (payé)', paidHours: 3, transportPaid: false, colorToken: 'steel', sortOrder: 80 },
  { code: 'week_end', label: 'Week-end', paidHours: 0, transportPaid: false, colorToken: 'stone', sortOrder: 90 },
  { code: 'non_concerne', label: 'Non concerné', paidHours: 0, transportPaid: false, colorToken: 'mist', sortOrder: 100 },
]

export const DEFAULT_STATUS_RULES: StatusRule[] = RULES.map((rule) => ({ ...rule, updatedAt: null }))

const GN_2026 = 'General Notice No. 1195 of 2025'
const CM_2027 = 'Conseil des ministres, août 2026'

const HOLIDAYS: [date: string, name: string, note: string][] = [
  ['2026-09-16', 'Ganesh Chaturthi', GN_2026],
  ['2026-11-02', 'Arrivée des travailleurs engagés', GN_2026],
  ['2026-11-08', 'Divali', GN_2026],
  ['2026-12-25', 'Noël', GN_2026],
  ['2027-01-01', 'Nouvel An', CM_2027],
  ['2027-01-02', 'Nouvel An (2e jour)', CM_2027],
  ['2027-01-22', 'Thaipoosam Cavadee', CM_2027],
  ['2027-02-01', "Abolition de l'esclavage", CM_2027],
  ['2027-02-06', 'Nouvel An chinois', CM_2027],
  ['2027-03-06', 'Maha Shivaratree', CM_2027],
  ['2027-03-10', 'Eid-Ul-Fitr', "À confirmer : dépend de l'observation de la lune"],
  ['2027-03-12', "Fête de l'Indépendance et de la République", CM_2027],
  ['2027-04-07', 'Ougadi', CM_2027],
  ['2027-05-01', 'Fête du Travail', CM_2027],
  ['2027-09-05', 'Ganesh Chaturthi', CM_2027],
  ['2027-09-06', 'Jour férié accordé', 'Art. 3(3) Public Holidays Act'],
  ['2027-10-29', 'Divali', CM_2027],
  ['2027-11-01', 'Toussaint', CM_2027],
  ['2027-11-02', 'Arrivée des travailleurs engagés', CM_2027],
  ['2027-12-25', 'Noël', CM_2027],
]

export const DEFAULT_HOLIDAYS: Holiday[] = HOLIDAYS.map(([date, name, note]) => ({
  date,
  name,
  note,
  updatedAt: null,
  updatedBy: null,
}))
