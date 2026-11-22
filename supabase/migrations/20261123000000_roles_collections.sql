-- =====================================================================
-- Rôles : admin / contributor / reader
-- =====================================================================
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  role       text not null default 'reader' check (role in ('admin', 'contributor', 'reader')),
  created_at timestamptz not null default now()
);

-- Rôle de l'utilisateur connecté (security definer : évite la récursion RLS)
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid())
$$;

-- Profil créé à l'inscription ; rudy@dots.lu est administrateur
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, case when lower(new.email) = 'rudy@dots.lu' then 'admin' else 'reader' end)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, email, role)
select id, email, case when lower(email) = 'rudy@dots.lu' then 'admin' else 'reader' end
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;

create policy "profiles_select_self_or_admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.my_role()) = 'admin');

-- Seul un admin change les rôles, et jamais le sien (évite de perdre le dernier admin)
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using ((select public.my_role()) = 'admin' and id <> (select auth.uid()))
  with check ((select public.my_role()) = 'admin');

grant select, update (role) on table public.profiles to authenticated;

-- =====================================================================
-- Fichiers : lecteurs = lecture ; contributeurs = ajout + leurs fichiers ; admin = tout
-- =====================================================================
drop policy "assets_insert_own" on public.assets;
drop policy "assets_update_own" on public.assets;
drop policy "assets_delete_own" on public.assets;

create policy "assets_insert_contributor" on public.assets
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.my_role()) in ('admin', 'contributor'));

create policy "assets_update_owner_or_admin" on public.assets
  for update to authenticated
  using (
    (select public.my_role()) = 'admin'
    or (owner_id = (select auth.uid()) and (select public.my_role()) = 'contributor')
  )
  with check (
    (select public.my_role()) = 'admin'
    or (owner_id = (select auth.uid()) and (select public.my_role()) = 'contributor')
  );

create policy "assets_delete_owner_or_admin" on public.assets
  for delete to authenticated
  using (
    (select public.my_role()) = 'admin'
    or (owner_id = (select auth.uid()) and (select public.my_role()) = 'contributor')
  );

drop policy "assets_storage_insert_own_folder" on storage.objects;
drop policy "assets_storage_update_own_folder" on storage.objects;
drop policy "assets_storage_delete_own_folder" on storage.objects;

create policy "assets_storage_insert_contributor" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.my_role()) in ('admin', 'contributor')
  );

create policy "assets_storage_update_contributor" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select public.my_role()) in ('admin', 'contributor')
  );

create policy "assets_storage_delete_owner_or_admin" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'assets'
    and (
      (select public.my_role()) = 'admin'
      or ((storage.foldername(name))[1] = (select auth.uid())::text and (select public.my_role()) = 'contributor')
    )
  );

drop policy "imported_metadata_own" on public.imported_metadata;
create policy "imported_metadata_own_contributor" on public.imported_metadata
  for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.my_role()) in ('admin', 'contributor'))
  with check (owner_id = (select auth.uid()) and (select public.my_role()) in ('admin', 'contributor'));

-- =====================================================================
-- Mots-clés : liste avec compteurs, renommage et suppression (admin)
-- =====================================================================
create or replace function public.tag_counts()
returns table (tag text, n bigint)
language sql
stable
set search_path = ''
as $$
  select t, count(*) from public.assets, unnest(tags) as t group by t order by t
$$;

create or replace function public.rename_tag(old_tag text, new_tag text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  cleaned text := lower(btrim(new_tag));
  changed integer;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  if cleaned = '' then
    raise exception 'Mot-clé vide';
  end if;
  update public.assets
     set tags = (select array_agg(distinct x order by x)
                 from unnest(array_replace(tags, old_tag, cleaned)) as x)
   where old_tag = any (tags);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

create or replace function public.delete_tag(old_tag text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if public.my_role() is distinct from 'admin' then
    raise exception 'Réservé aux administrateurs';
  end if;
  update public.assets set tags = array_remove(tags, old_tag) where old_tag = any (tags);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.rename_tag(text, text) from public, anon;
revoke execute on function public.delete_tag(text) from public, anon;
revoke execute on function public.tag_counts() from public, anon;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.rename_tag(text, text), public.delete_tag(text), public.tag_counts(), public.my_role() to authenticated;

-- =====================================================================
-- Collections personnelles ou publiques
-- =====================================================================
create table public.collections (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  description text,
  visibility  text not null default 'private' check (visibility in ('private', 'public')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index collections_owner_idx on public.collections (owner_id);

create trigger collections_set_updated_at
before update on public.collections
for each row execute function public.set_updated_at();

create table public.collection_items (
  collection_id uuid not null references public.collections (id) on delete cascade,
  asset_id      uuid not null references public.assets (id) on delete cascade,
  added_at      timestamptz not null default now(),
  primary key (collection_id, asset_id)
);
create index collection_items_asset_idx on public.collection_items (asset_id);

alter table public.collections enable row level security;
alter table public.collection_items enable row level security;

create policy "collections_select" on public.collections
  for select to authenticated
  using (visibility = 'public' or owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');

-- Tout le monde peut créer des collections privées ; publiques = contributeurs et admin
create policy "collections_insert" on public.collections
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (visibility = 'private' or (select public.my_role()) in ('admin', 'contributor'))
  );

create policy "collections_update" on public.collections
  for update to authenticated
  using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin')
  with check (
    (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin')
    and (visibility = 'private' or (select public.my_role()) in ('admin', 'contributor'))
  );

create policy "collections_delete" on public.collections
  for delete to authenticated
  using (owner_id = (select auth.uid()) or (select public.my_role()) = 'admin');

create policy "collection_items_select" on public.collection_items
  for select to authenticated
  using (exists (select 1 from public.collections c where c.id = collection_id));

create policy "collection_items_insert" on public.collection_items
  for insert to authenticated
  with check (exists (
    select 1 from public.collections c
    where c.id = collection_id and (c.owner_id = (select auth.uid()) or (select public.my_role()) = 'admin')
  ));

create policy "collection_items_delete" on public.collection_items
  for delete to authenticated
  using (exists (
    select 1 from public.collections c
    where c.id = collection_id and (c.owner_id = (select auth.uid()) or (select public.my_role()) = 'admin')
  ));

grant select, insert, update, delete on table public.collections to authenticated;
grant select, insert, delete on table public.collection_items to authenticated;
