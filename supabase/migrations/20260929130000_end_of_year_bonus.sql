-- =====================================================================
-- Présence — bonus de fin d'année
--
-- Workers' Rights Act 2019, art. 54 : 1/12 des gains de l'année, versé en
-- décembre (75 % au plus tard 5 jours ouvrés avant Noël, le solde avant la
-- fin de l'année). Le bonus s'ajoute à la fiche de paie de décembre.
--
-- Les cotisations dues aussi sur le bonus sont indiquées dans chaque
-- élément de `contributions` (champ onBonus) ; sans ce champ, l'app
-- reprend la valeur par défaut de la cotisation (CSG et NPF : oui).
-- =====================================================================

alter table public.settings
  add column end_of_year_bonus      boolean not null default true,
  -- Gains servant au calcul : brut (avec le transport) ou salaire de base.
  add column end_of_year_bonus_base text not null default 'gross'
                                    check (end_of_year_bonus_base in ('basic', 'gross'));

grant update (end_of_year_bonus, end_of_year_bonus_base) on public.settings to authenticated;
