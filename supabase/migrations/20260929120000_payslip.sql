-- =====================================================================
-- Présence — fiche de paie
--
-- Informations imprimées sur la fiche de paie (employée, employeur) et
-- cotisations sociales paramétrables (CSG, NSF, PRGF, NPF…). Colonnes
-- ajoutées à la ligne unique de réglages : elles se modifient champ par
-- champ, comme les autres réglages. La ligne existante reçoit les valeurs
-- par défaut.
-- =====================================================================

alter table public.settings
  add column employee_full_name      text not null default ''
                                     check (char_length(employee_full_name) <= 120),
  add column employee_address        text not null default ''
                                     check (char_length(employee_address) <= 300),
  add column employee_nic            text not null default ''
                                     check (char_length(employee_nic) <= 20),
  add column employee_job_title      text not null default 'Employée de maison'
                                     check (char_length(employee_job_title) <= 60),
  add column employee_hire_date      date,
  add column employee_payment_method text not null default ''
                                     check (char_length(employee_payment_method) <= 60),
  add column employee_bank_account   text not null default ''
                                     check (char_length(employee_bank_account) <= 60),
  add column employer_name           text not null default ''
                                     check (char_length(employer_name) <= 120),
  add column employer_address        text not null default ''
                                     check (char_length(employer_address) <= 300),
  add column employer_phone          text not null default ''
                                     check (char_length(employer_phone) <= 40),
  add column employer_email          text not null default ''
                                     check (char_length(employer_email) <= 120),
  add column employer_registration   text not null default ''
                                     check (char_length(employer_registration) <= 40),
  -- 0 = dernier jour ouvré du mois, 1…28 = ce jour du mois suivant.
  add column pay_day                 smallint not null default 0
                                     check (pay_day between 0 and 28),
  add column round_contributions     boolean not null default true,
  -- Liste ordonnée des cotisations (format : src/domain/types.ts, Contribution).
  -- Taux d'un employé de maison à Maurice ; détail dans src/domain/defaults.ts.
  add column contributions           jsonb not null default $json$[
    {"id": "csg", "label": "CSG", "description": "Contribution sociale généralisée",
     "enabled": true, "base": "basic", "floor": null, "ceiling": null,
     "brackets": [{"upTo": 3000, "employeeRate": 0, "employerRate": 3},
                  {"upTo": 50000, "employeeRate": 1.5, "employerRate": 3},
                  {"upTo": null, "employeeRate": 3, "employerRate": 6}],
     "from": null, "to": "2027-06"},
    {"id": "nsf", "label": "NSF", "description": "National Savings Fund",
     "enabled": true, "base": "basic", "floor": 2795, "ceiling": 28570,
     "brackets": [{"upTo": null, "employeeRate": 1, "employerRate": 2.5}],
     "from": null, "to": null},
    {"id": "prgf", "label": "PRGF", "description": "Portable Retirement Gratuity Fund",
     "enabled": true, "base": "basic", "floor": null, "ceiling": null,
     "brackets": [{"upTo": 200000, "employeeRate": 0, "employerRate": 4.5},
                  {"upTo": null, "employeeRate": 0, "employerRate": 0}],
     "from": null, "to": "2027-06"},
    {"id": "npf", "label": "NPF", "description": "National Pensions Fund (remplace CSG et PRGF)",
     "enabled": true, "base": "basic", "floor": null, "ceiling": null,
     "brackets": [{"upTo": 50000, "employeeRate": 1.5, "employerRate": 7.5},
                  {"upTo": null, "employeeRate": 3, "employerRate": 10.5}],
     "from": "2027-07", "to": null},
    {"id": "training_levy", "label": "Taxe de formation",
     "description": "Training Levy, non due pour un employé de maison",
     "enabled": false, "base": "basic", "floor": null, "ceiling": null,
     "brackets": [{"upTo": null, "employeeRate": 0, "employerRate": 1}],
     "from": null, "to": null}
  ]$json$::jsonb
                                     constraint settings_contributions_shape
                                     check (jsonb_typeof(contributions) = 'array'
                                            and jsonb_array_length(contributions) <= 20
                                            and octet_length(contributions::text) <= 20000);

comment on column public.settings.employee_nic is
  'Numéro de la carte d''identité nationale de l''employée (NIC).';
comment on column public.settings.employer_registration is
  'Numéro d''enregistrement de l''employeur auprès de la MRA (ERN).';
comment on column public.settings.contributions is
  'Cotisations de la fiche de paie : tranches de taux salarial et patronal, plancher, plafond, mois d''application.';

grant update (employee_full_name, employee_address, employee_nic, employee_job_title,
              employee_hire_date, employee_payment_method, employee_bank_account,
              employer_name, employer_address, employer_phone, employer_email,
              employer_registration, pay_day, round_contributions, contributions)
  on public.settings to authenticated;
