-- Métadonnées générées par l'IA + vignette JPEG (utilisée pour la grille et l'analyse)
alter table public.assets
  add column thumb_path      text,
  add column ai_status       text check (ai_status in ('pending', 'done', 'error')),
  add column ai_error        text,
  add column ai_generated_at timestamptz;
