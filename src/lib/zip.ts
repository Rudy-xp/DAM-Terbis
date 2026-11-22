import { downloadZip } from 'client-zip'
import { BUCKET, supabase } from './supabase'
import type { Asset } from '../types'

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'fichier'
}

function uniqueName(name: string, used: Set<string>): string {
  let candidate = name
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base} (${i})${ext}`
  used.add(candidate.toLowerCase())
  return candidate
}

function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`
}

interface SaveFilePickerWindow {
  showSaveFilePicker?: (opts: {
    suggestedName: string
    types: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<{ createWritable: () => Promise<WritableStream> }>
}

/**
 * Télécharge des fichiers dans un ZIP (originaux, ou aperçu si l'original est dans Drive),
 * avec un fichier descriptions.csv. Écrit directement sur le disque quand le navigateur le permet.
 */
export async function downloadAssetsZip(
  zipName: string,
  assets: Asset[],
  onProgress: (done: number, total: number) => void,
): Promise<void> {
  const fileName = `${safeName(zipName)}.zip`
  const picker = (window as unknown as SaveFilePickerWindow).showSaveFilePicker
  // La fenêtre « Enregistrer sous » doit s'ouvrir tout de suite (geste utilisateur)
  const handle = picker
    ? await picker({ suggestedName: fileName, types: [{ description: 'Archive ZIP', accept: { 'application/zip': ['.zip'] } }] })
    : null

  const paths = assets.map((a) => a.file_path ?? a.thumb_path).filter((p): p is string => Boolean(p))
  const signed: Record<string, string> = {}
  for (let i = 0; i < paths.length; i += 200) {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(paths.slice(i, i + 200), 3600)
    if (error) throw error
    data?.forEach((s) => {
      if (s.path && s.signedUrl) signed[s.path] = s.signedUrl
    })
  }

  const used = new Set<string>()
  const rows: string[] = [['fichier', 'titre', 'description', 'mots-clés', 'remarque'].map(csvCell).join(';')]
  let done = 0
  onProgress(0, assets.length)

  async function* files() {
    for (const a of assets) {
      const path = a.file_path ?? a.thumb_path
      const url = path ? signed[path] : undefined
      let name = safeName(a.file_name)
      let note = ''
      if (!a.file_path) {
        name = `${name.replace(/\.[^.]+$/, '')}_apercu.jpg`
        note = a.drive_url ? `Original dans Google Drive : ${a.drive_url}` : 'Original indisponible'
      }
      if (url) {
        const res = await fetch(url)
        if (res.ok) {
          name = uniqueName(name, used)
          yield { name, input: res, lastModified: new Date(a.created_at) }
        } else note = `Téléchargement impossible (${res.status})`
      } else if (!note) note = 'Fichier introuvable'
      rows.push([name, a.title, a.description ?? '', a.tags.join(', '), note].map(csvCell).join(';'))
      onProgress(++done, assets.length)
    }
    yield { name: 'descriptions.csv', input: '﻿' + rows.join('\r\n'), lastModified: new Date() }
  }

  const response = downloadZip(files())
  if (handle) {
    await response.body!.pipeTo(await handle.createWritable())
  } else {
    const blob = await response.blob()
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = fileName
    link.click()
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000)
  }
}
