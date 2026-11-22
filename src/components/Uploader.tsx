import { useRef, useState, type DragEvent } from 'react'
import { BUCKET, supabase } from '../lib/supabase'
import { queueAnalysis } from '../lib/ai'
import { lookupImported } from '../lib/importMetadata'
import type { AssetKind } from '../types'
import { parseTags } from '../types'

const MAX_BYTES = 50 * 1024 * 1024

interface Props {
  userId: string
  onUploaded: () => void
}

interface Job {
  name: string
  status: 'pending' | 'done' | 'error'
  error?: string
}

function kindOf(file: File): AssetKind | null {
  if (file.type === 'application/pdf') return 'pdf'
  if (file.type.startsWith('image/')) return 'image'
  return null
}

const THUMB_MAX = 1568

/** Lit les dimensions et produit une vignette JPEG (grille + analyse IA). */
function makeThumbnail(file: File): Promise<{ width: number; height: number; thumb: Blob | null } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: width, naturalHeight: height } = img
      const scale = Math.min(1, THUMB_MAX / Math.max(width, height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(width * scale))
      canvas.height = Math.max(1, Math.round(height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        return resolve({ width, height, thumb: null })
      }
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url)
          resolve({ width, height, thumb: blob })
        },
        'image/jpeg',
        0.85,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}

export default function Uploader({ userId, onUploaded }: Props) {
  const [autoAnalyze, setAutoAnalyze] = useState(true)
  const input = useRef<HTMLInputElement>(null)
  const [tags, setTags] = useState('')
  const [jobs, setJobs] = useState<Job[]>([])
  const [dragging, setDragging] = useState(false)

  async function uploadOne(file: File, index: number) {
    const update = (patch: Partial<Job>) =>
      setJobs((js) => js.map((j, i) => (i === index ? { ...j, ...patch } : j)))

    const kind = kindOf(file)
    if (!kind) return update({ status: 'error', error: 'Type non supporté' })
    if (file.size > MAX_BYTES) return update({ status: 'error', error: 'Fichier > 50 Mo' })

    const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : kind === 'pdf' ? 'pdf' : 'bin'
    const id = crypto.randomUUID()
    const path = `${userId}/${id}.${ext}`
    const meta = kind === 'image' ? await makeThumbnail(file) : null

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) return update({ status: 'error', error: upErr.message })

    let thumbPath: string | null = null
    if (meta?.thumb) {
      const tp = `${userId}/${id}_thumb.jpg`
      const { error } = await supabase.storage.from(BUCKET).upload(tp, meta.thumb, { contentType: 'image/jpeg' })
      if (!error) thumbPath = tp
    }

    // Description importée (fichier Excel / CSV) prioritaire sur l'IA
    const imported = await lookupImported(file.name)
    const analyze = autoAnalyze && !imported?.description

    const { data: inserted, error: dbErr } = await supabase.from('assets').insert({
      title: file.name.replace(/\.[^.]+$/, ''),
      description: imported?.description ?? null,
      tags: [...new Set([...parseTags(tags), ...(imported?.tags ?? [])])],
      kind,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      thumb_path: thumbPath,
      ai_status: analyze ? 'pending' : null,
    }).select('id').single()
    if (dbErr) {
      await supabase.storage.from(BUCKET).remove(thumbPath ? [path, thumbPath] : [path])
      return update({ status: 'error', error: dbErr.message })
    }
    update({ status: 'done' })
    if (analyze) queueAnalysis(inserted.id, onUploaded)
  }

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return
    const files = Array.from(list)
    const offset = jobs.length
    setJobs((js) => [...js, ...files.map((f) => ({ name: f.name, status: 'pending' as const }))])
    // 3 envois en parallèle maximum
    let next = 0
    const worker = async () => {
      while (next < files.length) {
        const i = next++
        await uploadOne(files[i], offset + i)
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, worker))
    onUploaded()
    if (input.current) input.current.value = ''
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }

  const pending = jobs.filter((j) => j.status === 'pending').length

  return (
    <section className="card uploader">
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      >
        <strong>Déposez vos photos et PDF ici</strong>
        <span className="muted">ou cliquez pour choisir (50 Mo max par fichier)</span>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      <label className="check">
        <input type="checkbox" checked={autoAnalyze} onChange={(e) => setAutoAnalyze(e.target.checked)} />
        ✨ Générer automatiquement la description et les mots-clés (IA)
      </label>
      <label className="inline">
        Tags appliqués à l'envoi
        <input placeholder="ex. chantier, 2026, client-x" value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      {jobs.length > 0 && (
        <div className="jobs">
          <div className="jobs-head">
            <span>{pending ? `Envoi en cours… (${pending} restant${pending > 1 ? 's' : ''})` : 'Envois terminés'}</span>
            {!pending && (
              <button className="link" onClick={() => setJobs([])}>
                Effacer
              </button>
            )}
          </div>
          <ul>
            {jobs.map((j, i) => (
              <li key={i} className={j.status}>
                <span>{j.name}</span>
                <span>{j.status === 'pending' ? '…' : j.status === 'done' ? '✓' : j.error}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
