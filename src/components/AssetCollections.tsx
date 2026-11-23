import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Collection, Role } from '../types'
import { canEditCollection } from '../types'

interface Props {
  assetId: string
  userId: string
  role: Role
}

/** Collections contenant ce fichier, avec ajout / retrait immédiats. */
export default function AssetCollections({ assetId, userId, role }: Props) {
  const [inside, setInside] = useState<Collection[] | null>(null)
  const [mine, setMine] = useState<Collection[]>([])
  const [choice, setChoice] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [items, own] = await Promise.all([
      supabase.from('collection_items').select('collections(*)').eq('asset_id', assetId),
      supabase.from('collections').select('*').order('name'),
    ])
    if (items.error || own.error) return setError((items.error ?? own.error)!.message)
    const list = (items.data ?? [])
      .map((r) => (r as unknown as { collections: Collection | null }).collections)
      .filter((c): c is Collection => Boolean(c))
      .sort((a, b) => a.name.localeCompare(b.name))
    setInside(list)
    // Collections où l'on peut ajouter : les siennes (toutes pour l'admin)
    setMine(((own.data ?? []) as Collection[]).filter((c) => canEditCollection(role, userId, c)))
  }, [assetId, userId, role])

  useEffect(() => {
    load()
  }, [load])

  async function add() {
    setBusy(true)
    setError(null)
    try {
      let id = choice
      if (choice === 'new') {
        const { data, error } = await supabase.from('collections').insert({ name: newName.trim() }).select('id').single()
        if (error) throw error
        id = data.id
      }
      const { error } = await supabase.from('collection_items').insert({ collection_id: id, asset_id: assetId })
      if (error) throw error
      setChoice('')
      setNewName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: Collection) {
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('collection_items').delete().eq('collection_id', c.id).eq('asset_id', assetId)
    setBusy(false)
    if (error) return setError(error.message)
    load()
  }

  const available = mine.filter((c) => !inside?.some((i) => i.id === c.id))

  return (
    <div className="field">
      <span className="field-label">Collections</span>
      <div className="tag-editor">
        {inside === null ? (
          <span className="muted small">Chargement…</span>
        ) : inside.length ? (
          inside.map((c) => (
            <span key={c.id} className="chip coll-chip">
              {c.name}
              {c.visibility === 'public' && <span className="muted small"> · publique</span>}
              {canEditCollection(role, userId, c) && (
                <button type="button" aria-label={`Retirer de ${c.name}`} disabled={busy} onClick={() => remove(c)}>
                  ×
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="muted small">Dans aucune collection</span>
        )}
      </div>
      <div className="coll-add">
        <select value={choice} disabled={busy} onChange={(e) => setChoice(e.target.value)}>
          <option value="">Ajouter à une collection…</option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.owner_id !== userId ? ' (autre utilisateur)' : ''}
            </option>
          ))}
          <option value="new">+ Nouvelle collection…</option>
        </select>
        {choice === 'new' && (
          <input
            autoFocus
            placeholder="Nom de la nouvelle collection"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newName.trim() && add()}
          />
        )}
        {choice && (
          <button className="small-btn primary" disabled={busy || (choice === 'new' && !newName.trim())} onClick={add}>
            Ajouter
          </button>
        )}
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  )
}
