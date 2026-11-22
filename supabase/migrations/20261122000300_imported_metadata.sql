-- Descriptions importées depuis un fichier (Excel / CSV), indexées par nom de fichier.
-- Elles s'appliquent aux fichiers déjà envoyés et à ceux envoyés plus tard.
create table public.imported_metadata (
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  file_key    text not null, -- nom de fichier normalisé : minuscules, sans dossier ni extension
  description text,
  tags        text[] not null default '{}',
  created_at  timestamptz not null default now(),
  primary key (owner_id, file_key)
);

alter table public.imported_metadata enable row level security;

create policy "imported_metadata_own" on public.imported_metadata
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

grant select, insert, update, delete on table public.imported_metadata to authenticated;
