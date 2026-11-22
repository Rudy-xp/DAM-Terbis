import { useRef, useState, type DragEvent } from 'react'
import { BUCKET, supabase } from '../lib/supabase'
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

function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve(null)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })
}

export default function Uploader({ userId, onUploaded }: Props) {
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
    const path = `${userId}/${crypto.randomUUID()}.${ext}`
    const dims = kind === 'image' ? await imageSize(file) : null

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false })
    if (upErr) return update({ status: 'error', error: upErr.message })

    const { error: dbErr } = await supabase.from('assets').insert({
      title: file.name.replace(/\.[^.]+$/, ''),
      tags: parseTags(tags),
      kind,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    })
    if (dbErr) {
      await supabase.storage.from(BUCKET).remove([path])
      return update({ status: 'error', error: dbErr.message })
    }
    update({ status: 'done' })
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
