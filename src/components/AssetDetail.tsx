import { useEffect, useState } from 'react'
import { BUCKET, supabase } from '../lib/supabase'
import type { Asset } from '../types'
import { formatBytes, parseTags } from '../types'

interface Props {
  asset: Asset
  url: string | undefined
  canEdit: boolean
  onClose: () => void
  onChanged: () => void
}

export default function AssetDetail({ asset, url, canEdit, onClose, onChanged }: Props) {
  const [title, setTitle] = useState(asset.title)
  const [description, setDescription] = useState(asset.description ?? '')
  const [tags, setTags] = useState(asset.tags.join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setBusy(true)
    setError(null)
    const { error } = await supabase
      .from('assets')
      .update({ title: title.trim() || asset.file_name, description: description.trim() || null, tags: parseTags(tags) })
      .eq('id', asset.id)
    setBusy(false)
    if (error) setError(error.message)
    else onChanged()
  }

  async function remove() {
    if (!confirm(`Supprimer définitivement « ${asset.title} » ?`)) return
    setBusy(true)
    const { error: dbErr } = await supabase.from('assets').delete().eq('id', asset.id)
    if (dbErr) {
      setBusy(false)
      return setError(dbErr.message)
    }
    await supabase.storage.from(BUCKET).remove([asset.file_path])
    onChanged()
    onClose()
  }

  async function download() {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(asset.file_path, 60, { download: asset.file_name })
    if (error) return setError(error.message)
    window.location.href = data.signedUrl
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={asset.title}>
        <div className="preview">
          {!url ? (
            <span className="muted">Chargement…</span>
          ) : asset.kind === 'image' ? (
            <img src={url} alt={asset.title} />
          ) : (
            <iframe src={url} title={asset.title} />
          )}
        </div>
        <aside className="meta">
          <button className="close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
          <label>
            Titre
            <input value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Description
            <textarea rows={4} value={description} disabled={!canEdit} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label>
            Tags (séparés par des virgules)
            <input value={tags} disabled={!canEdit} onChange={(e) => setTags(e.target.value)} />
          </label>
          <dl>
            <dt>Fichier</dt>
            <dd>{asset.file_name}</dd>
            <dt>Type</dt>
            <dd>{asset.mime_type}</dd>
            <dt>Taille</dt>
            <dd>{formatBytes(asset.size_bytes)}</dd>
            {asset.width && asset.height && (
              <>
                <dt>Dimensions</dt>
                <dd>
                  {asset.width} × {asset.height} px
                </dd>
              </>
            )}
            <dt>Ajouté le</dt>
            <dd>{new Date(asset.created_at).toLocaleString('fr-FR')}</dd>
          </dl>
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button onClick={download}>Télécharger</button>
            {canEdit && (
              <>
                <button className="primary" onClick={save} disabled={busy}>
                  Enregistrer
                </button>
                <button className="danger" onClick={remove} disabled={busy}>
                  Supprimer
                </button>
              </>
            )}
          </div>
          {!canEdit && <p className="muted small">Seul l'auteur de l'envoi peut modifier ce fichier.</p>}
        </aside>
      </div>
    </div>
  )
}
