import { supabase } from './supabase'

/** Nom de fichier normalisé : sans dossier, sans extension, en minuscules. */
export function fileKey(name: string): string {
  const base = name.trim().split(/[\\/]/).pop() ?? ''
  return base.replace(/\.[a-z0-9]{1,8}$/i, '').trim().toLowerCase()
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
  size: /^(taille|size|poids)( \((octets|bytes|o)\))?$/i,
  place: /^(lieu|localité|localite|commune|village|place|location)$/i,
}

export interface Columns {
  file: number
  description: number
  tags: number
  size: number
  place: number
}

/** Devine les colonnes à partir des en-têtes. */
export function guessColumns(headers: string[]): Columns {
  const find = (re: RegExp) => headers.findIndex((h) => re.test((h ?? '').trim()))
  return {
    file: find(PATTERNS.file),
    description: find(PATTERNS.description),
    tags: find(PATTERNS.tags),
    size: find(PATTERNS.size),
    place: find(PATTERNS.place),
  }
}

const TRUE = /^(true|vrai|oui|yes|x|1)$/i
const FALSE = /^(false|faux|non|no|0)?$/i

/** Colonnes ne contenant que des valeurs Vrai/Faux (ex. « Carte postale »). */
export function booleanColumns(headers: string[], rows: string[][]): number[] {
  return headers.flatMap((_, i) => {
    const values = rows.map((r) => (r[i] ?? '').trim())
    const hasTrue = values.some((v) => TRUE.test(v))
    return hasTrue && values.every((v) => TRUE.test(v) || FALSE.test(v)) ? [i] : []
  })
}

export interface ImportRow {
  file_key: string
  size_bytes: number | null
  description: string | null
  tags: string[]
}

export function buildRows(
  headers: string[],
  rows: string[][],
  cols: Columns,
  flagCols: number[],
): ImportRow[] {
  const byKey = new Map<string, ImportRow>()
  for (const r of rows) {
    const key = fileKey(r[cols.file] ?? '')
    if (!key) continue
    const description = cols.description >= 0 ? (r[cols.description] ?? '').trim() || null : null
    const tags = new Set(cols.tags >= 0 ? splitTags(r[cols.tags] ?? '') : [])
    if (cols.place >= 0 && (r[cols.place] ?? '').trim()) tags.add(r[cols.place].trim().toLowerCase())
    for (const i of flagCols) if (TRUE.test((r[i] ?? '').trim())) tags.add(headers[i].trim().toLowerCase())
    if (!description && !tags.size) continue
    const rawSize = cols.size >= 0 ? Number(String(r[cols.size] ?? '').replace(/\s/g, '')) : NaN
    const size_bytes = Number.isFinite(rawSize) && rawSize > 0 ? Math.round(rawSize) : null
    byKey.set(`${key}|${size_bytes ?? ''}`, { file_key: key, size_bytes, description, tags: [...tags] })
  }
  return [...byKey.values()]
}

/**
 * Choisit la ligne correspondant à un fichier : même nom et même taille en priorité ;
 * sinon le nom seul, à condition qu'il ne soit pas ambigu.
 */
export function pickRow(candidates: ImportRow[], sizeBytes: number): ImportRow | null | 'ambiguous' {
  if (!candidates.length) return null
  const exact = candidates.find((c) => c.size_bytes === sizeBytes)
  if (exact) return exact
  if (candidates.length === 1) return candidates[0]
  const first = candidates[0]
  const same = candidates.every((c) => c.description === first.description && c.tags.join() === first.tags.join())
  return same ? first : 'ambiguous'
}

/** Cherche une description importée pour ce fichier (utilisé à l'envoi). */
export async function lookupImported(fileName: string, sizeBytes: number): Promise<ImportRow | null> {
  const { data } = await supabase
    .from('imported_metadata')
    .select('file_key, size_bytes, description, tags')
    .eq('file_key', fileKey(fileName))
  const row = pickRow((data as ImportRow[] | null) ?? [], sizeBytes)
  return row === 'ambiguous' ? null : row
}
