export type AssetKind = 'image' | 'pdf' | 'other'

export interface Asset {
  id: string
  owner_id: string
  title: string
  description: string | null
  tags: string[]
  kind: AssetKind
  file_path: string | null
  file_name: string
  mime_type: string
  size_bytes: number
  width: number | null
  height: number | null
  thumb_path: string | null
  ai_status: 'pending' | 'done' | 'error' | null
  ai_error: string | null
  ai_generated_at: string | null
  drive_file_id: string | null
  drive_url: string | null
  source_path: string | null
  created_at: string
  updated_at: string
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`
  const units = ['Ko', 'Mo', 'Go']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

/** Fonctions IA (Gemini) affichées seulement si VITE_AI_ENABLED=true. */
export const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === 'true'

export function extensionOf(name: string): string {
  const m = name.match(/\.([a-z0-9]{1,8})$/i)
  return m ? m[1].toUpperCase() : 'FICHIER'
}
