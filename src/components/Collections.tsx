import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { downloadAssetsZip } from '../lib/zip'
import type { Asset, Collection, Role } from '../types'
import { canEditCollection } from '../types'
import Library from './Library'

interface Props {
  userId: string
  role: Role
}

type Row = Collection & { collection_items: { count: number }[] }

export default function Collections({ userId, role }: Props) {
  const [list, setList] = useState<Collection[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [zip, setZip] = useState<{ done: number; total: number } | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('collections')
      .select('*, collection_items(count)')
      .order('updated_at', { ascending: false })
    if (error) return setError(error.message)
    setList(((data ?? []) as Row[]).map(({ collection_items, ...c }) => ({ ...c, item_count: collection_items?.[0]?.count ?? 0 })))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const open = list?.find((c) => c.id === openId) ?? null
  const mine = list?.filter((c) => c.owner_id === userId) ?? []
  const shared = list?.filter((c) => c.owner_id !== userId) ?? []

  async function remove(c: Collection) {
    if (!confirm(`Supprimer la collection « ${c.name} » ? Les fichiers eux-mêmes ne sont pas supprimés.`)) return
    const { error } = await supabase.from('collections').delete().eq('id', c.id)
    if (error) return setError(error.message)
    setOpenId(null)
    load()
  }

  async function downloadAll(c: Collection) {
    setError(null)
    try {
      setZip({ done: 0, total: c.item_count ?? 0 })
      const assets: Asset[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('assets')
          .select('*, collection_items!inner(collection_id)')
          .eq('collection_items.collection_id', c.id)
          .order('created_at')
          .range(from, from + 999)
        if (error) throw error
        assets.push(...((data ?? []) as Asset[]))
        if (!data || data.length < 1000) break
      }
      await downloadAssetsZip(c.name, assets, (done, total) => setZip({ done, total }))
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setZip(null)
    }
  }

  if (open) {
    const canManage = canEditCollection(role, userId, open)
    return (
      <>
        <Library
          key={open.id}
          userId={userId}
          role={role}
          collection={open}
          onCollectionChanged={load}
          header={
            <div className="collection-head">
              <button className="link" onClick={() => setOpenId(null)}>
                ← Toutes les collections
              </button>
              <div className="collection-title">
                <h2>{open.name}</h2>
                <span className="badge">{open.visibility === 'public' ? 'Publique' : 'Personnelle'}</span>
                {open.owner_id !== userId && <span className="badge">Partagée</span>}
              </div>
              {open.description && <p className="muted">{open.description}</p>}
              <div className="actions">
                <button className="primary" disabled={!open.item_count || Boolean(zip)} onClick={() => downloadAll(open)}>
                  Télécharger toute la collection ({open.item_count ?? 0})
                </button>
                {canManage && <button onClick={() => setEditing(true)}>Modifier</button>}
                {canManage && (
                  <button className="danger" onClick={() => remove(open)}>
                    Supprimer
                  </button>
                )}
              </div>
              {error && <p className="error">{error}</p>}
            </div>
          }
        />
        {editing && (
          <CollectionForm
            role={role}
            initial={open}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setEditing(false)
              load()
            }}
          />
        )}
        {zip && (
          <div className="toast">
            Préparation du ZIP… {zip.done} / {zip.total}
          </div>
        )}
      </>
    )
  }

  const card = (c: Collection) => (
    <li key={c.id}>
      <button className="coll-card card" onClick={() => setOpenId(c.id)}>
        <strong>{c.name}</strong>
        {c.description && <span className="muted small tile-desc">{c.description}</span>}
        <span className="muted small">
          {c.item_count} fichier{(c.item_count ?? 0) > 1 ? 's' : ''} ·{' '}
          {c.visibility === 'public' ? 'Publique' : 'Personnelle'}
        </span>
      </button>
    </li>
  )

  return (
    <>
      <div className="toolbar">
        <h2 className="section-title">Collections</h2>
        <span className="grow" />
        <button className="primary" onClick={() => setCreating(true)}>
          + Nouvelle collection
        </button>
      </div>
      <p className="muted small">
        Pour remplir une collection : dans la bibliothèque, cliquez sur <strong>Sélectionner</strong>, choisissez des
        fichiers puis <strong>Ajouter à une collection</strong>.
      </p>
      {error && <p className="error">{error}</p>}
      {list === null ? (
        <p className="muted small">Chargement…</p>
      ) : (
        <>
          <h3 className="sub-title">Mes collections</h3>
          {mine.length ? <ul className="coll-grid">{mine.map(card)}</ul> : <p className="muted small">Aucune pour l'instant.</p>}
          <h3 className="sub-title">{role === 'admin' ? 'Collections des autres utilisateurs' : 'Collections publiques'}</h3>
          {shared.length ? <ul className="coll-grid">{shared.map(card)}</ul> : <p className="muted small">Aucune.</p>}
        </>
      )}
      {creating && (
        <CollectionForm
          role={role}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false)
            load().then(() => setOpenId(id))
          }}
        />
      )}
    </>
  )
}

function CollectionForm({
  role,
  initial,
  onClose,
  onSaved,
}: {
  role: Role
  initial?: Collection
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [visibility, setVisibility] = useState<'private' | 'public'>(initial?.visibility ?? 'private')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const values = { name: name.trim(), description: description.trim() || null, visibility }
    const res = initial
      ? await supabase.from('collections').update(values).eq('id', initial.id).select('id').single()
      : await supabase.from('collections').insert(values).select('id').single()
    setBusy(false)
    if (res.error) return setError(res.error.message)
    onSaved(res.data.id)
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="dialog card small-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Collection">
        <button className="close" onClick={onClose} aria-label="Fermer">
          ×
        </button>
        <h2>{initial ? 'Modifier la collection' : 'Nouvelle collection'}</h2>
        <label>
          Nom
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Description
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label>
          Visibilité
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'private' | 'public')}>
            <option value="private">Personnelle — visible par moi seul</option>
            <option value="public" disabled={role === 'reader'}>
              Publique — visible par tous les utilisateurs{role === 'reader' ? ' (contributeurs et admin)' : ''}
            </option>
          </select>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button className="primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? '…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
