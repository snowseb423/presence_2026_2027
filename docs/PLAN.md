# Plan — PWA « Présence »

Suivi de présence d'une employée de maison à Maurice, pour deux utilisateurs,
synchronisé en temps réel, utilisable hors ligne. Interface en français,
fuseau `Indian/Mauritius`, montants affichés « Rs 12 276 » (espace fine
insécable U+202F entre les milliers).

## 1. Décisions structurantes

| Sujet | Choix | Pourquoi |
| --- | --- | --- |
| Source de vérité de l'UI | IndexedDB (Dexie) lu via `useLiveQuery` | l'app s'ouvre et fonctionne hors ligne sans chemin de code spécial |
| Écritures | file `outbox` Dexie, rejouée dans l'ordre | mode avion : la saisie est acceptée puis remonte seule |
| État affiché | miroir serveur + opérations en attente appliquées par-dessus | la saisie locale est visible immédiatement, le serveur tranche ensuite |
| Conflits | last-write-wins sur `updated_at` (heure de la saisie sur le téléphone) | un rejeu hors ligne ancien n'écrase pas une saisie plus récente |
| Suppressions | RPC + table technique `attendance_tombstones` | sans pierre tombale, un rejeu ancien ressusciterait un jour remis au défaut |
| Jours par défaut | recalculés côté client, jamais stockés | base minuscule, un férié corrigé se propage tout seul |
| Montants | module pur `src/domain`, calcul en centimes entiers | pas d'erreur d'arrondi flottant, testable sans React |
| Temps réel | Supabase Realtime (Postgres Changes, RLS appliquée) | < 1 s en pratique |
| Auth | magic link + code à 6 chiffres du même email ; « Continuer avec Google » (OAuth Supabase, flux implicite) si le fournisseur est activé | sur iOS, le lien s'ouvre dans Safari et non dans l'app installée : le code règle ce cas ; Google évite d'attendre l'email |
| Service worker | `injectManifest` (Workbox) écrit à la main | precache du shell, SWR sur les GET Supabase, page de repli |
| Routage | 4 chemins (`/`, `/mois`, `/budget`, `/reglages`) sans dépendance | le hash reste libre pour le retour du magic link et de Google |
| Polices | Bricolage Grotesque (display) + Atkinson Hyperlegible Next (texte) auto-hébergées | offline garanti, chiffres tabulaires vérifiés dans les deux fontes |

### SWR sur les données sans données périmées

Workbox sert d'abord la réponse en cache puis revalide. Appliquer aveuglément la
réponse en cache ferait régresser l'état reçu en temps réel. Le SW marque donc
les réponses servies depuis le cache (`x-sw-cache: hit`) et, après
revalidation, envoie le corps frais à la page (`postMessage`). La page :

- n'applique une réponse « cache » que si la base locale est vide (premier
  lancement) ;
- applique le corps frais reçu du SW, puis rejoue par-dessus les événements
  temps réel reçus pendant la requête.

## 2. Arborescence

```
.
├── .env.example                 # VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY
├── README.md                    # installation, Supabase, variables, déploiement
├── docs/PLAN.md
├── index.html                   # métas iOS, theme-color clair/sombre, viewport-fit=cover
├── vite.config.ts               # React, Tailwind v4, vite-plugin-pwa (manifest)
├── vercel.json                  # réécriture SPA + en-têtes
├── public/
│   ├── _headers                 # en-têtes Cloudflare Pages
│   ├── offline.html             # page de repli hors ligne
│   ├── theme-init.js            # applique le thème avant le premier rendu
│   ├── favicon.svg
│   ├── pwa-192x192.png  pwa-512x512.png  maskable-icon-512x512.png
│   └── apple-touch-icon-180x180.png
├── scripts/
│   ├── icon.svg                 # sources des icônes
│   └── generate-icons.mjs       # rendu PNG (sharp)
├── tests/                       # tests SQL (PGlite), parité seed, contrastes
├── e2e/                         # Playwright : critères de validation à 375 px
├── playwright.config.ts
├── supabase/
│   ├── config.toml              # pour la CLI Supabase (optionnel)
│   ├── migrations/
│   │   ├── 20260928120000_schema.sql          # tables, RLS, RPC, triggers, realtime
│   │   ├── 20260928120100_reference_data.sql  # ligne settings + table des statuts
│   │   ├── 20260929120000_payslip.sql         # fiche de paie : identités, cotisations
│   │   └── 20260929130000_end_of_year_bonus.sql # bonus de fin d'année (décembre)
│   ├── seed.sql                 # jours fériés 2026–2027
│   └── templates/magic_link.html # email avec lien + code
└── src/
    ├── main.tsx  App.tsx  env.ts  sw.ts
    ├── styles/                  # tokens.css (clair/sombre), fonts.css, index.css
    ├── domain/                  # PUR, sans React
    │   ├── types.ts             # StatusCode, Settings, StatusRule, Holiday, Override
    │   ├── dates.ts             # dates ISO, jour ISO, « aujourd'hui » à Maurice
    │   ├── status.ts            # statut par défaut, métadonnées des statuts
    │   ├── pay.ts               # montant du jour, mois, année, période (centimes)
    │   ├── payslip.ts           # fiche de paie : rémunération, cotisations, net
    │   ├── format.ts            # « Rs 12 276 », « −Rs 1 674 », heures, dates FR
    │   └── defaults.ts          # valeurs par défaut (miroir du seed SQL)
    ├── data/
    │   ├── db.ts                # schéma Dexie
    │   ├── supabase.ts          # client (null si non configuré → mode local)
    │   ├── ops.ts               # opérations, fusion, application sur le miroir (pur)
    │   ├── remote.ts            # exécution d'une opération côté Supabase, pull REST
    │   ├── sync.ts              # moteur : outbox, rejeu ordonné, realtime, SW
    │   ├── commands.ts          # setDayStatus, clearDay, saveSettings, …
    │   └── hooks.ts             # useAppData, useSyncState, useToday
    ├── auth/                    # AuthProvider, LoginScreen
    ├── pwa/                     # installation, mise à jour, aide iOS
    ├── export/                  # csv.ts, xlsx.ts, pdf.ts + payslip-pdf.ts (chargés à la demande)
    ├── ui/                      # Sheet, Toast, StatusGlyph, Chip, Stepper, icônes…
    ├── layout/                  # AppShell, BottomNav, SyncPill
    └── screens/                 # Today, Month, DaySheet, Budget, Settings
```

## 3. Schéma SQL

```sql
allowed_emails (
  email text PK (minuscules), display_name text,
  user_id uuid → auth.users (renseigné par trigger), created_at timestamptz
)

settings (                         -- ligne unique : id = 1
  id smallint PK check (id = 1),
  hourly_rate numeric default 170, hours_per_day numeric default 3,
  transport_per_day numeric default 48,
  work_days smallint[] default '{1,2,3,4,5}',   -- ISO : 1 = lundi … 7 = dimanche
  period_start date default '2026-09-01', period_end date default '2027-12-31',
  employee_name text,
  -- fiche de paie : employée, employeur, paie
  employee_full_name, employee_address, employee_nic, employee_job_title text,
  employee_hire_date date, employee_payment_method, employee_bank_account text,
  employer_name, employer_address, employer_phone, employer_email,
  employer_registration text,
  pay_day smallint default 0,          -- 0 = dernier jour ouvré, 1…28 = mois suivant
  round_contributions boolean default true,
  contributions jsonb,                 -- CSG, NSF, PRGF, NPF… (tranches, plancher, plafond, mois, bonus)
  end_of_year_bonus boolean default true, end_of_year_bonus_base text default 'gross',
  updated_by uuid, updated_at timestamptz
)

status_rules (
  code text PK, label text, paid_hours numeric, transport_paid boolean,
  color_token text, sort_order int, updated_by uuid, updated_at timestamptz
)

holidays (
  date date PK, name text, note text, updated_by uuid, updated_at timestamptz
)

attendance_overrides (             -- uniquement les jours qui s'écartent du défaut
  date date PK, status_code text → status_rules(code),
  hours_override numeric null, comment text null,
  updated_by uuid → auth.users, updated_at timestamptz
)

attendance_tombstones (            -- technique : horodatage des remises au défaut
  date date PK, deleted_at timestamptz, deleted_by uuid
)
```

Fonctions et triggers :

- `is_allowed()` (security definer) : l'email du JWT est-il dans `allowed_emails` ?
- Policies RLS sur toutes les tables : lecture/écriture si `is_allowed()`.
  `settings` et `status_rules` : lecture + mise à jour seulement.
  `allowed_emails` : impossible de supprimer sa propre adresse.
- `set_attendance(date, status, hours, comment, updated_at)` et
  `clear_attendance(date, updated_at)` : upsert / suppression conditionnés par
  `updated_at` et les pierres tombales ; renvoient l'état final du jour.
- `stamp_row()` : `updated_by = auth.uid()`, `updated_at` plafonné à `now()`.
- `lww_guard()` sur `holidays` : une mise à jour plus ancienne est ignorée.
- `guard_signup()` sur `auth.users` : refuse la création d'un compte hors liste.
- `link_member()` : relie `allowed_emails.user_id` au compte créé.
- Publication `supabase_realtime` : settings, status_rules, holidays,
  attendance_overrides, allowed_emails.

## 4. Règles de calcul (module `src/domain`)

```
statut par défaut(d) =
  hors période                     → non_concerne
  jour non presté (sam., dim.)     → week_end   (non_concerne si jour de semaine exclu)
  d ∈ holidays                     → ferie_non_paye
  sinon                            → travaille

heures(d)  = forçage ?? paid_hours(statut)
total(d)   = heures × taux + (transport_paid(statut) ? transport : 0)
budget(m)  = Σ total(d) avec les statuts par défaut uniquement
écart(m)   = total(m) − budget(m)
jours prestés = jours en Travaillé, Demi-journée ou Jour supplémentaire
```

Tests Vitest : mois complet sans absence, octobre 2026 avec 3 congés non payés
(12 276 → 10 602, écart −1 674), demi-journée, forçage d'heures, férié en
semaine, férié un dimanche, période complète = Rs 187 488 pour 336 jours.

Fiche de paie (`src/domain/payslip.ts`) :

```
assiette(c)   = salaire de base (heures × taux) ou brut (+ transport)
tranche(c)    = première tranche dont la borne n'est pas dépassée par l'assiette
base(c)       = assiette bornée par plancher et plafond (0 si aucun salaire)
retenue(c)    = base × taux salarial   ; part patronale(c) = base × taux patronal
                (un seul arrondi : roupie par défaut, sinon centime)
net           = brut − Σ retenues      ; coût employeur = brut + Σ parts patronales
```

Une cotisation ne s'applique qu'aux mois compris entre son premier et son
dernier mois : la CSG et le PRGF s'arrêtent en juin 2027, le NPF prend le relais.

Bonus de fin d'année, sur la fiche de décembre :

```
bonus         = gains de l'année (mois de la période) / 12   (brut, ou salaire de base)
part de base  = salaire de base de l'année / 12
cotisations   = celles marquées « dues sur le bonus » (CSG), calculées à part
                sur la part de base, tranche choisie d'après elle
```

## 5. Composants

| Écran | Composants |
| --- | --- |
| Commun | `AppShell` (bandeau haut, zones sûres), `BottomNav`, `SyncPill` (en ligne / hors ligne / n en attente), `Sheet` (dialog natif en feuille basse), `Toaster` (avec « Annuler »), `StatusGlyph` (forme + couleur), `StatusChip`, `Stepper`, `UpdatePrompt` |
| Aujourd'hui | `TodayHero` (date, statut, montant, formule), `QuickStatusGrid` (4 statuts + « Autres »), `AllStatusesSheet`, `WeekStrip`, `MonthSnapshot` |
| Mois | `MonthNav` (bornée à la période), `CalendarGrid`, `Legend`, `MonthSummaryCard`, `DaySheet` (statut, forçage, commentaire, montant, dernier auteur) |
| Budget | `PeriodTotals`, `YearSection`, `MonthBlock` (+ `PayrollFigures` : retenues, net, cotisations patronales), `ExportButtons` (fiche de paie PDF, CSV, XLSX) |
| Réglages | `SettingsForm`, `WorkDaysPicker`, `IdentityForm` (employée, employeur), `ContributionsEditor` + `ContributionSheet`, `StatusRulesEditor`, `HolidaysEditor` + `HolidaySheet`, `AccountsSection`, `InstallSection` (+ aide iOS), `ThemePicker`, `SyncDiagnostics` |
| Auth | `LoginScreen` (« Continuer avec Google » si activé dans Supabase ; email → lien + saisie du code) |

## 6. Direction artistique

- Bandeau haut espresso (#2A211B, lueur terre de Sienne) sur toutes les pages :
  la barre d'état iOS `black-translucent` reste lisible dans les deux thèmes.
- Page crème #FDF7F1, surfaces blanches, bordures #EADDD0 ; sombre #1B1614 /
  #262019 / #3A2F27.
- Accent terre de Sienne #C2410C (texte clair : variante plus sombre ; mode
  sombre : variante éclaircie pour garder le contraste AA).
- Statuts : couleur **et** forme (disque, demi-disque, anneau, anneau barré,
  losange…) pour ne jamais dépendre de la couleur seule.
- Chiffres en `tabular-nums` ; test automatique des contrastes AA sur les tokens.
- `prefers-reduced-motion` coupe transitions et animations.

## 7. Ordre des commits

1. Plan (ce document) puis squelette Vite/React/TS/Tailwind.
2. Schéma et migrations Supabase + seed + tests SQL.
3. Domaine et calculs + tests.
4. Couche données (Dexie, outbox, sync, auth) + tests.
5. UI (tokens, shell, écrans).
6. PWA (manifest, icônes, SW, installation).
7. Export CSV / XLSX.
8. README, configuration de déploiement.
