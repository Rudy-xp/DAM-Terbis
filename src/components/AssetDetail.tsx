import { useEffect, useState } from 'react'
import { BUCKET, supabase } from '../lib/supabase'
import { analyzeAsset } from '../lib/ai'
import type { Asset } from '../types'
import { formatBytes } from '../types'
import TagEditor from './TagEditor'

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
  const [tags, setTags] = useState<string[]>(asset.tags)
  const [busy, setBusy] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [saved, setSaved] = useState(false)
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
      .update({ title: title.trim() || asset.file_name, description: description.trim() || null, tags })
      .eq('id', asset.id)
    setBusy(false)
    if (error) return setError(error.message)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onChanged()
  }

  async function generate() {
    if (description.trim() && !confirm('Remplacer la description actuelle par une description générée ?')) return
    setAnalyzing(true)
    setError(null)
    try {
      const result = await analyzeAsset(asset.id)
      setDescription(result.description)
      setTags(result.tags)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyzing(false)
    }
  }

  async function remove() {
    if (!confirm(`Supprimer définitivement « ${asset.title} » ?`)) return
    setBusy(true)
    const { error: dbErr } = await supabase.from('assets').delete().eq('id', asset.id)
    if (dbErr) {
      setBusy(false)
      return setError(dbErr.message)
    }
    await supabase.storage.from(BUCKET).remove(asset.thumb_path ? [asset.file_path, asset.thumb_path] : [asset.file_path])
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
            <textarea
              rows={5}
              value={description}
              disabled={!canEdit || analyzing}
              placeholder={asset.ai_status === 'pending' ? 'Génération en cours…' : ''}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="field">
            <span className="field-label">Mots-clés</span>
            <TagEditor tags={tags} onChange={setTags} disabled={!canEdit || analyzing} />
          </div>
          {canEdit && (
            <div className="ai-row">
              <button className="ai" onClick={generate} disabled={analyzing || busy}>
                {analyzing ? '✨ Analyse en cours…' : asset.ai_generated_at ? '✨ Régénérer avec l’IA' : '✨ Générer avec l’IA'}
              </button>
              {asset.ai_status === 'error' && !analyzing && (
                <span className="error small">Dernière analyse échouée : {asset.ai_error}</span>
              )}
            </div>
          )}
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
                <button className="primary" onClick={save} disabled={busy || analyzing}>
                  {saved ? 'Enregistré ✓' : 'Enregistrer'}
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
