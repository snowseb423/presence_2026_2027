-- =====================================================================
-- Présence — jours fériés de Maurice couvrant la période
-- 01/09/2026 → 31/12/2027. Éditables ensuite depuis l'app (Réglages).
-- Idempotent : une date déjà présente n'est pas modifiée.
-- =====================================================================

insert into public.holidays (date, name, note) values
  -- 2026 — General Notice No. 1195 of 2025, Prime Minister's Office
  -- (seuls les fériés à partir du 01/09/2026 sont utiles)
  ('2026-09-16', 'Ganesh Chaturthi',                      'General Notice No. 1195 of 2025'),
  ('2026-11-02', 'Arrivée des travailleurs engagés',      'General Notice No. 1195 of 2025'),
  ('2026-11-08', 'Divali',                                'General Notice No. 1195 of 2025'),
  ('2026-12-25', 'Noël',                                  'General Notice No. 1195 of 2025'),

  -- 2027 — liste officielle du Conseil des ministres, août 2026
  ('2027-01-01', 'Nouvel An',                             'Conseil des ministres, août 2026'),
  ('2027-01-02', 'Nouvel An (2e jour)',                   'Conseil des ministres, août 2026'),
  ('2027-01-22', 'Thaipoosam Cavadee',                    'Conseil des ministres, août 2026'),
  ('2027-02-01', 'Abolition de l''esclavage',             'Conseil des ministres, août 2026'),
  ('2027-02-06', 'Nouvel An chinois',                     'Conseil des ministres, août 2026'),
  ('2027-03-06', 'Maha Shivaratree',                      'Conseil des ministres, août 2026'),
  ('2027-03-10', 'Eid-Ul-Fitr',                           'À confirmer : dépend de l''observation de la lune'),
  ('2027-03-12', 'Fête de l''Indépendance et de la République', 'Conseil des ministres, août 2026'),
  ('2027-04-07', 'Ougadi',                                'Conseil des ministres, août 2026'),
  ('2027-05-01', 'Fête du Travail',                       'Conseil des ministres, août 2026'),
  ('2027-09-05', 'Ganesh Chaturthi',                      'Conseil des ministres, août 2026'),
  ('2027-09-06', 'Jour férié accordé',                    'Art. 3(3) Public Holidays Act'),
  ('2027-10-29', 'Divali',                                'Conseil des ministres, août 2026'),
  ('2027-11-01', 'Toussaint',                             'Conseil des ministres, août 2026'),
  ('2027-11-02', 'Arrivée des travailleurs engagés',      'Conseil des ministres, août 2026'),
  ('2027-12-25', 'Noël',                                  'Conseil des ministres, août 2026')
on conflict (date) do nothing;

-- ---------------------------------------------------------------------
-- Comptes autorisés : à adapter avec vos deux adresses, puis exécuter
-- (SQL Editor de Supabase). Sans cette étape, personne ne peut se
-- connecter.
-- ---------------------------------------------------------------------
-- insert into public.allowed_emails (email, display_name) values
--   ('vous@example.com',       'Vous'),
--   ('conjointe@example.com',  'Conjointe')
-- on conflict (email) do update set display_name = excluded.display_name;
