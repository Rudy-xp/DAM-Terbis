-- Les nouveaux projets Supabase n'accordent plus automatiquement les droits
-- sur les tables aux rôles d'API : on donne l'accès aux utilisateurs connectés
-- (les règles RLS restent appliquées). Le rôle "anon" n'a aucun accès.
grant select, insert, update, delete on table public.assets to authenticated;
