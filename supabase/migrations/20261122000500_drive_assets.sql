-- Fichiers catalogués depuis Google Drive : l'original reste dans Drive,
-- seul un aperçu JPEG est stocké (thumb_path).
alter table public.assets alter column file_path drop not null;
alter table public.assets
  add column drive_file_id text unique,
  add column drive_url     text,
  add column source_path   text;

alter table public.assets drop constraint assets_kind_check;
alter table public.assets add constraint assets_kind_check check (kind in ('image', 'pdf', 'other'));
alter table public.assets add constraint assets_has_source check (file_path is not null or drive_file_id is not null);
