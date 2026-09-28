-- =====================================================================
-- Présence — données de référence indispensables au fonctionnement
--
-- Ligne unique de réglages et table des statuts. Idempotent : ne
-- remplace jamais une valeur déjà modifiée depuis l'app.
-- =====================================================================

insert into public.settings (
  id, hourly_rate, hours_per_day, transport_per_day, work_days,
  period_start, period_end, employee_name
) values (
  1, 170, 3, 48, '{1,2,3,4,5}', '2026-09-01', '2027-12-31', ''
)
on conflict (id) do nothing;

-- sort_order : les quatre premiers statuts sont proposés en accès direct
-- sur l'écran « Aujourd'hui ».
insert into public.status_rules (code, label, paid_hours, transport_paid, color_token, sort_order) values
  ('travaille',           'Travaillé',           3,   true,  'olive',  10),
  ('demi_journee',        'Demi-journée',        1.5, true,  'amber',  20),
  ('conge_non_paye',      'Congé non payé',      0,   false, 'coral',  30),
  ('absence_non_payee',   'Absence non payée',   0,   false, 'brick',  40),
  ('jour_supplementaire', 'Jour supplémentaire', 3,   true,  'lagoon', 50),
  ('conge_paye',          'Congé payé',          3,   false, 'plum',   60),
  ('ferie_non_paye',      'Férié (non payé)',    0,   false, 'slate',  70),
  ('ferie_paye',          'Férié (payé)',        3,   false, 'steel',  80),
  ('week_end',            'Week-end',            0,   false, 'stone',  90),
  ('non_concerne',        'Non concerné',        0,   false, 'mist',  100)
on conflict (code) do nothing;
