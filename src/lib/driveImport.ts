import { BUCKET, supabase } from './supabase'
import { downloadDriveFile, fetchDriveThumbnail, getDriveFile, parseDriveId } from './google'
import { fileKey, splitTags, type Columns } from './importMetadata'
import { imagePreview, pdfPreview, type Preview } from './preview'
import type { AssetKind } from '../types'

const DRIVE_ID = /^(id drive|drive id|id( du)? fichier|file ?id|id)$/i
const DRIVE_LINK = /^(lien( drive)?|url|link|drive)$/i
const SOURCE_PATH = /^(chemin( complet)?|path|full path|dossier( d[’']origine)?)$/i

export interface DriveColumns {
  id: number
  link: number
  path: number
}

export function guessDriveColumns(headers: string[]): DriveColumns {
  const find = (re: RegExp) => headers.findIndex((h) => re.test((h ?? '').trim()))
  const full = headers.findIndex((h) => /^chemin complet$/i.test((h ?? '').trim()))
  return { id: find(DRIVE_ID), link: find(DRIVE_LINK), path: full >= 0 ? full : find(SOURCE_PATH) }
}

/** Formats lisibles dans le navigateur ; les autres (PSD, AI, EPS…) sont ignorés. */
const READABLE_EXT = /\.(jpe?g|png|gif|webp|avif|heic|heif|bmp|svg|pdf)$/i
const HAS_EXT = /\.[a-z0-9]{1,10}$/i

export function isReadableName(name: string): boolean {
  // Sans extension (ex. « 207A_3 ») : le type sera vérifié auprès de Drive.
  return READABLE_EXT.test(name) || !HAS_EXT.test(name)
}

export class UnreadableFormatError extends Error {}

export interface DriveRow {
  driveId: string
  name: string
  size: number | null
  description: string | null
  tags: string[]
  sourcePath: string | null
  link: string | null
}

const TRUE = /^(true|vrai|oui|yes|x|1)$/i

export function buildDriveRows(
  headers: string[],
  rows: string[][],
  cols: Columns,
  driveCols: DriveColumns,
  flagCols: number[],
  skipCopies: boolean,
): { rows: DriveRow[]; unreadable: number } {
  let unreadable = 0
  const seenIds = new Set<string>()
  const seenCopies = new Set<string>()
  const out: DriveRow[] = []
  for (const r of rows) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
    const driveId = parseDriveId(cell(driveCols.id)) ?? parseDriveId(cell(driveCols.link))
    const name = cell(cols.file)
    if (!driveId || !name || seenIds.has(driveId)) continue
    seenIds.add(driveId)
    if (!isReadableName(name)) {
      unreadable++
      continue
    }
    const rawSize = Number(cell(cols.size).replace(/\s/g, ''))
    const size = Number.isFinite(rawSize) && rawSize > 0 ? Math.round(rawSize) : null
    if (skipCopies && size) {
      const copyKey = `${fileKey(name)}|${size}`
      if (seenCopies.has(copyKey)) continue
      seenCopies.add(copyKey)
    }
    const tags = new Set(splitTags(cell(cols.tags)))
    if (cell(cols.place)) tags.add(cell(cols.place).toLowerCase())
    for (const i of flagCols) if (TRUE.test(cell(i))) tags.add(headers[i].trim().toLowerCase())
    out.push({
      driveId,
      name,
      size,
      description: cell(cols.description) || null,
      tags: [...tags],
      sourcePath: cell(driveCols.path) || null,
      link: cell(driveCols.link) || null,
    })
  }
  return { rows: out, unreadable }
}

const PREVIEW_DOWNLOAD_MAX = 60_000_000 // au-delà, pas de téléchargement complet pour l'aperçu

const PHOTO_TYPES = /^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|svg\+xml)$/

function kindOf(mime: string): AssetKind | null {
  if (mime === 'application/pdf') return 'pdf'
  if (PHOTO_TYPES.test(mime)) return 'image'
  return null // PSD, AI, EPS, fichiers Affinity, dessins Google… : non lisibles
}

/** Catalogue un fichier Drive : aperçu JPEG dans Supabase, original laissé dans Drive. */
export async function importDriveRow(row: DriveRow, userId: string): Promise<void> {
  const file = await getDriveFile(row.driveId)
  const mime = file.mimeType
  const kind = kindOf(mime)
  if (!kind) throw new UnreadableFormatError(`Format non lisible (${mime})`)
  const size = Number(file.size ?? row.size ?? 0)

  // 1. Aperçu : vignette Google si possible, sinon génération à partir de l'original
  let preview: Preview | null = null
  const thumb = await fetchDriveThumbnail(file)
  if (thumb) preview = await imagePreview(thumb)
  if (!preview?.jpeg && size > 0 && size <= PREVIEW_DOWNLOAD_MAX) {
    const blob = await downloadDriveFile(row.driveId)
    preview = kind === 'pdf' ? await pdfPreview(blob) : await imagePreview(blob)
  }

  let thumbPath: string | null = null
  if (preview?.jpeg) {
    thumbPath = `${userId}/${crypto.randomUUID()}_thumb.jpg`
    const { error } = await supabase.storage.from(BUCKET).upload(thumbPath, preview.jpeg, { contentType: 'image/jpeg' })
    if (error) throw new Error(`Envoi de l'aperçu : ${error.message}`)
  }

  // Dimensions réelles de la photo (la vignette Google est réduite)
  const width = file.imageMediaMetadata?.width ?? (kind === 'image' && !thumb ? preview?.width : null) ?? null
  const height = file.imageMediaMetadata?.height ?? (kind === 'image' && !thumb ? preview?.height : null) ?? null

  const { error } = await supabase.from('assets').insert({
    title: row.name.replace(/\.[^.]+$/, ''),
    description: row.description,
    tags: row.tags,
    kind,
    file_path: null,
    file_name: row.name,
    mime_type: mime,
    size_bytes: size,
    width,
    height,
    thumb_path: thumbPath,
    drive_file_id: row.driveId,
    drive_url: file.webViewLink ?? row.link ?? `https://drive.google.com/file/d/${row.driveId}/view`,
    source_path: row.sourcePath,
  })
  if (error) {
    if (thumbPath) await supabase.storage.from(BUCKET).remove([thumbPath])
    throw new Error(error.message)
  }
}
