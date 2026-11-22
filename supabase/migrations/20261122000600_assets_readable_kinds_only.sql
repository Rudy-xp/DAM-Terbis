-- Seuls les formats lisibles dans le navigateur sont catalogués (photos et PDF) :
-- les fichiers PSD, AI, EPS, Affinity… sont ignorés.
alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'pdf'));
