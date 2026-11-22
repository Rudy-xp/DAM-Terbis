export type AssetKind = 'image' | 'pdf'

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

export type Role = 'admin' | 'contributor' | 'reader'

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrateur',
  contributor: 'Contributeur',
  reader: 'Lecteur',
}

export interface Collection {
  id: string
  owner_id: string
  name: string
  description: string | null
  visibility: 'private' | 'public'
  created_at: string
  updated_at: string
  item_count?: number
}

export interface TagCount {
  tag: string
  n: number
}

/** Peut modifier / supprimer ce fichier ? */
export function canEditAsset(role: Role, userId: string, asset: { owner_id: string }): boolean {
  return role === 'admin' || (role === 'contributor' && asset.owner_id === userId)
}

export function canEditCollection(role: Role, userId: string, c: Collection): boolean {
  return role === 'admin' || c.owner_id === userId
}
