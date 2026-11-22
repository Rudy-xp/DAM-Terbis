-- Plusieurs fichiers peuvent porter le même nom (dossiers différents) :
-- la taille en octets permet de les distinguer.
alter table public.imported_metadata drop constraint imported_metadata_pkey;
alter table public.imported_metadata add column id uuid primary key default gen_random_uuid();
alter table public.imported_metadata add column size_bytes bigint;
create unique index imported_metadata_owner_key_size_idx
  on public.imported_metadata (owner_id, file_key, size_bytes) nulls not distinct;
