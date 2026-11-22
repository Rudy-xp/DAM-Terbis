import { supabase } from './supabase'

/** Nom de fichier normalisé : sans dossier, sans extension, en minuscules. */
export function fileKey(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? ''
  return base.replace(/\.[a-z0-9]{1,5}$/i, '').trim().toLowerCase()
}

export function splitTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[,;|\n]/)
        .map((t) => t.trim().toLowerCase().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ]
}

const PATTERNS = {
  file: /^(nom( du)? fichier|fichier|file ?name|filename|file|nom|image|photo|name)$/i,
  description: /^(description|desc|légende|legende|caption|texte|alt)$/i,
  tags: /^(mots?[- ]cl[ée]s?|tags?|keywords?|étiquettes?|etiquettes?)$/i,
}

/** Devine les colonnes à partir des en-têtes. */
export function guessColumns(headers: string[]) {
  const find = (re: RegExp) => headers.findIndex((h) => re.test(h.trim()))
  return { file: find(PATTERNS.file), description: find(PATTERNS.description), tags: find(PATTERNS.tags) }
}

export interface ImportRow {
  file_key: string
  description: string | null
  tags: string[]
}

export function buildRows(
  rows: string[][],
  cols: { file: number; description: number; tags: number },
): ImportRow[] {
  const byKey = new Map<string, ImportRow>()
  for (const r of rows) {
    const key = fileKey(r[cols.file] ?? '')
    if (!key) continue
    const description = cols.description >= 0 ? (r[cols.description] ?? '').trim() || null : null
    const tags = cols.tags >= 0 ? splitTags(r[cols.tags] ?? '') : []
    if (!description && !tags.length) continue
    byKey.set(key, { file_key: key, description, tags })
  }
  return [...byKey.values()]
}

/** Cherche une description importée pour ce nom de fichier (utilisé à l'envoi). */
export async function lookupImported(fileName: string): Promise<ImportRow | null> {
  const { data } = await supabase
    .from('imported_metadata')
    .select('file_key, description, tags')
    .eq('file_key', fileKey(fileName))
    .maybeSingle()
  return (data as ImportRow | null) ?? null
}
