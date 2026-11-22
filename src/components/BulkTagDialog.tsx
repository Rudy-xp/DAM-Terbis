import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Asset } from '../types'
import TagEditor from './TagEditor'

interface Props {
  assets: Asset[] // fichiers modifiables uniquement
  skipped: number // fichiers sélectionnés mais non modifiables
  onClose: () => void
  onDone: () => void
}

/** Ajoute ou retire des mots-clés sur plusieurs fichiers à la fois. */
export default function BulkTagDialog({ assets, skipped, onClose, onDone }: Props) {
  const [add, setAdd] = useState<string[]>([])
  const [remove, setRemove] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      let next = 0
      const worker = async () => {
        while (next < assets.length) {
          const a = assets[next++]
          const tags = [...new Set([...a.tags.filter((t) => !remove.includes(t)), ...add])]
          const { error } = await supabase.from('assets').update({ tags }).eq('id', a.id)
          if (error) throw error
        }
      }
      await Promise.all(Array.from({ length: 5 }, worker))
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog card small-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Mots-clés">
        <button className="close" onClick={onClose} disabled={busy} aria-label="Fermer">
          ×
        </button>
        <h2>Mots-clés de {assets.length} fichier{assets.length > 1 ? 's' : ''}</h2>
        {skipped > 0 && (
          <p className="muted small">
            {skipped} fichier{skipped > 1 ? 's' : ''} de la sélection ne vous appartien{skipped > 1 ? 'nent' : 't'} pas et
            ne sera{skipped > 1 ? 'ont' : ''} pas modifié{skipped > 1 ? 's' : ''}.
          </p>
        )}
        <div className="field">
          <span className="field-label">Ajouter</span>
          <TagEditor tags={add} onChange={setAdd} />
        </div>
        <div className="field">
          <span className="field-label">Retirer</span>
          <TagEditor tags={remove} onChange={setRemove} />
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="primary" onClick={submit} disabled={busy || !assets.length || (!add.length && !remove.length)}>
            {busy ? '…' : 'Appliquer'}
          </button>
        </div>
      </div>
    </div>
  )
}
