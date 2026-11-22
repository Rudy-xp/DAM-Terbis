import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Collection, Role } from '../types'

interface Props {
  userId: string
  role: Role
  assetIds: string[]
  onClose: () => void
  onDone: (collectionName: string) => void
}

/** Ajoute des fichiers à une collection existante ou nouvelle. */
export default function CollectionPicker({ userId, role, assetIds, onClose, onDone }: Props) {
  const [collections, setCollections] = useState<Collection[] | null>(null)
  const [choice, setChoice] = useState<string>('new')
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('collections')
      .select('*')
      .eq('owner_id', userId)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message)
        const list = (data ?? []) as Collection[]
        setCollections(list)
        if (list.length) setChoice(list[0].id)
      })
  }, [userId])

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      let target = collections?.find((c) => c.id === choice)
      if (choice === 'new') {
        const { data, error } = await supabase
          .from('collections')
          .insert({ name: name.trim(), visibility })
          .select('*')
          .single()
        if (error) throw error
        target = data as Collection
      }
      if (!target) throw new Error('Choisissez une collection')
      const rows = assetIds.map((asset_id) => ({ collection_id: target!.id, asset_id }))
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from('collection_items')
          .upsert(rows.slice(i, i + 500), { onConflict: 'collection_id,asset_id', ignoreDuplicates: true })
        if (error) throw error
      }
      // Met à jour la date de modification de la collection
      await supabase.from('collections').update({ name: target.name }).eq('id', target.id)
      onDone(target.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog card small-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Ajouter à une collection">
        <button className="close" onClick={onClose} disabled={busy} aria-label="Fermer">
          ×
        </button>
        <h2>Ajouter à une collection</h2>
        <p className="muted small">
          {assetIds.length} fichier{assetIds.length > 1 ? 's' : ''} sélectionné{assetIds.length > 1 ? 's' : ''}
        </p>
        {collections === null ? (
          <p className="muted small">Chargement…</p>
        ) : (
          <div className="choices">
            {collections.map((c) => (
              <label key={c.id} className="check">
                <input type="radio" name="coll" checked={choice === c.id} onChange={() => setChoice(c.id)} />
                {c.name}
                <span className="badge">{c.visibility === 'public' ? 'Publique' : 'Personnelle'}</span>
              </label>
            ))}
            <label className="check">
              <input type="radio" name="coll" checked={choice === 'new'} onChange={() => setChoice('new')} />
              Nouvelle collection
            </label>
            {choice === 'new' && (
              <div className="new-coll">
                <input autoFocus placeholder="Nom de la collection" value={name} onChange={(e) => setName(e.target.value)} />
                {role !== 'reader' && (
                  <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
                    <option value="private">Personnelle (visible par moi seul)</option>
                    <option value="public">Publique (visible par tous les utilisateurs)</option>
                  </select>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="primary" onClick={submit} disabled={busy || (choice === 'new' && !name.trim())}>
            {busy ? '…' : 'Ajouter'}
          </button>
        </div>
      </div>
    </div>
  )
}
