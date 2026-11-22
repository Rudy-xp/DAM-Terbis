-- Table des fichiers (photos & PDF)
create table public.assets (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  description text,
  tags        text[] not null default '{}',
  kind        text not null check (kind in ('image', 'pdf')),
  file_path   text not null unique,
  file_name   text not null,
  mime_type   text not null,
  size_bytes  bigint not null check (size_bytes >= 0),
  width       integer,
  height      integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index assets_owner_id_idx   on public.assets (owner_id);
create index assets_created_at_idx on public.assets (created_at desc);
create index assets_tags_idx       on public.assets using gin (tags);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger assets_set_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

-- Sécurité : bibliothèque partagée entre utilisateurs connectés,
-- seul le propriétaire peut modifier / supprimer ses fichiers.
alter table public.assets enable row level security;

create policy "assets_select_authenticated" on public.assets
  for select to authenticated using (true);

create policy "assets_insert_own" on public.assets
  for insert to authenticated with check (owner_id = (select auth.uid()));

create policy "assets_update_own" on public.assets
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "assets_delete_own" on public.assets
  for delete to authenticated using (owner_id = (select auth.uid()));

-- Bucket de stockage privé (50 Mo max, images + PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'assets', 'assets', false, 52428800,
  array['image/jpeg','image/png','image/gif','image/webp','image/avif','image/svg+xml','image/heic','application/pdf']
)
on conflict (id) do nothing;

-- Les fichiers sont rangés sous <user_id>/<uuid>.<ext>
create policy "assets_storage_select_authenticated" on storage.objects
  for select to authenticated using (bucket_id = 'assets');

create policy "assets_storage_insert_own_folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "assets_storage_update_own_folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "assets_storage_delete_own_folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
