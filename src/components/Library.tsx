import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { BUCKET, supabase } from '../lib/supabase'
import { downloadAssetsZip } from '../lib/zip'
import type { Asset, AssetKind, Collection, Role, TagCount } from '../types'
import { canEditAsset, canEditCollection, extensionOf, formatBytes } from '../types'
import Uploader from './Uploader'
import AssetDetail from './AssetDetail'
import TagFilter from './TagFilter'
import CollectionPicker from './CollectionPicker'
import BulkTagDialog from './BulkTagDialog'

// Chargé à la demande (bibliothèques Excel/CSV)
const ImportDialog = lazy(() => import('./ImportDialog'))

const PAGE_SIZE = 48
const URL_TTL = 60 * 60 // URLs signées valables 1 h

interface Props {
  userId: string
  role: Role
  /** Affiche uniquement le contenu de cette collection */
  collection?: Collection | null
  onCollectionChanged?: () => void
  header?: ReactNode
}

export default function Library({ userId, role, collection, onCollectionChanged, header }: Props) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [total, setTotal] = useState(0)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [kind, setKind] = useState<AssetKind | 'all'>('all')
  const [tags, setTags] = useState<string[]>([])
  const [allTags, setAllTags] = useState<TagCount[]>([])
  const [mineOnly, setMineOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Asset | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showImport, setShowImport] = useState(false)
  // Sélection multiple (conservée d'une page à l'autre)
  const [selectMode, setSelectMode] = useState(false)
  const [picked, setPicked] = useState<Map<string, Asset>>(new Map())
  const [picker, setPicker] = useState<string[] | null>(null)
  const [bulkTags, setBulkTags] = useState(false)
  const [zip, setZip] = useState<{ done: number; total: number } | null>(null)

  const canContribute = role === 'admin' || role === 'contributor'
  const canManageCollection = collection ? canEditCollection(role, userId, collection) : false

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const loadTags = useCallback(async () => {
    const { data } = await supabase.rpc('tag_counts')
    setAllTags(((data ?? []) as TagCount[]).map((t) => ({ tag: t.tag, n: Number(t.n) })))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    let q = collection
      ? supabase
          .from('assets')
          .select('*, collection_items!inner(collection_id)', { count: 'exact' })
          .eq('collection_items.collection_id', collection.id)
      : supabase.from('assets').select('*', { count: 'exact' })
    q = q.order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (kind !== 'all') q = q.eq('kind', kind)
    if (tags.length) q = q.contains('tags', tags)
    if (mineOnly) q = q.eq('owner_id', userId)
    if (debounced) {
      // Échappe les caractères spéciaux du filtre PostgREST
      const s = debounced.replace(/[%_,(){}"\\]/g, ' ').trim()
      const clauses = [
        `title.ilike.%${s}%`,
        `description.ilike.%${s}%`,
        `file_name.ilike.%${s}%`,
        `source_path.ilike.%${s}%`,
      ]
      if (/^[\p{L}\p{N}_-]+$/u.test(s)) clauses.push(`tags.cs.{${s.toLowerCase()}}`)
      if (s) q = q.or(clauses.join(','))
    }
    const { data, error, count } = await q
    setLoading(false)
    if (error) return setError(error.message)
    const rows = (data ?? []) as Asset[]
    setAssets(rows)
    setTotal(count ?? 0)
    // Garde la fiche ouverte à jour
    setSelected((sel) => (sel ? (rows.find((r) => r.id === sel.id) ?? sel) : sel))
    setPicked((p) => {
      if (!p.size) return p
      const next = new Map(p)
      rows.forEach((r) => next.has(r.id) && next.set(r.id, r))
      return next
    })
    if (rows.length) {
      const paths = rows.flatMap((r) => [r.file_path, r.thumb_path].filter((p): p is string => Boolean(p)))
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, URL_TTL)
      const map: Record<string, string> = {}
      signed?.forEach((s) => {
        if (s.path && s.signedUrl) map[s.path] = s.signedUrl
      })
      setUrls((u) => ({ ...u, ...map }))
    }
  }, [page, kind, tags, mineOnly, debounced, userId, collection])

  const reload = useCallback(() => {
    load()
    loadTags()
  }, [load, loadTags])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    loadTags()
  }, [loadTags])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function toggle(a: Asset) {
    setPicked((p) => {
      const next = new Map(p)
      if (next.has(a.id)) next.delete(a.id)
      else next.set(a.id, a)
      return next
    })
  }
  const allOnPage = assets.length > 0 && assets.every((a) => picked.has(a.id))
  function togglePage() {
    setPicked((p) => {
      const next = new Map(p)
      assets.forEach((a) => (allOnPage ? next.delete(a.id) : next.set(a.id, a)))
      return next
    })
  }
  function endSelection() {
    setSelectMode(false)
    setPicked(new Map())
  }

  async function removeFromCollection() {
    if (!collection) return
    const ids = [...picked.keys()]
    if (!confirm(`Retirer ${ids.length} fichier${ids.length > 1 ? 's' : ''} de « ${collection.name} » ?`)) return
    const { error } = await supabase
      .from('collection_items')
      .delete()
      .eq('collection_id', collection.id)
      .in('asset_id', ids)
    if (error) return setError(error.message)
    endSelection()
    load()
    onCollectionChanged?.()
  }

  async function downloadSelection() {
    try {
      await downloadAssetsZip(collection ? `${collection.name} - sélection` : 'selection-dam-terbis', [...picked.values()], (done, total) =>
        setZip({ done, total }),
      )
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e))
    } finally {
      setZip(null)
    }
  }

  const pickedList = [...picked.values()]
  const editablePicked = pickedList.filter((a) => canEditAsset(role, userId, a))

  return (
    <>
      {header}

      {!collection && canContribute && (
        <div className="toolbar">
          <button className="primary" onClick={() => setShowUpload((v) => !v)}>
            {showUpload ? 'Fermer' : '+ Ajouter des fichiers'}
          </button>
          <button onClick={() => setShowImport(true)}>Importer descriptions</button>
        </div>
      )}

      {showUpload && <Uploader userId={userId} onUploaded={reload} />}

      <section className="filters">
        <input
          type="search"
          className="search"
          placeholder="Rechercher par titre, description, nom de fichier ou mot-clé…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="segmented">
          {(['all', 'image', 'pdf'] as const).map((k) => (
            <button
              key={k}
              className={kind === k ? 'active' : ''}
              onClick={() => {
                setKind(k)
                setPage(0)
              }}
            >
              {k === 'all' ? 'Tout' : k === 'image' ? 'Photos' : 'PDF'}
            </button>
          ))}
        </div>
        {canContribute && (
          <label className="check">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => {
                setMineOnly(e.target.checked)
                setPage(0)
              }}
            />
            Mes fichiers
          </label>
        )}
      </section>

      <TagFilter
        all={allTags}
        selected={tags}
        onChange={(t) => {
          setTags(t)
          setPage(0)
        }}
      />

      {error && <p className="error">{error}</p>}
      {notice && (
        <p className="info notice">
          {notice}{' '}
          <button className="link small" onClick={() => setNotice(null)}>
            OK
          </button>
        </p>
      )}

      <div className="count-row">
        <span className="muted small">{loading ? 'Chargement…' : `${total} fichier${total > 1 ? 's' : ''}`}</span>
        {!selectMode && total > 0 && (
          <button className="small-btn" onClick={() => setSelectMode(true)}>
            Sélectionner
          </button>
        )}
      </div>

      {selectMode && (
        <div className="selection-bar">
          <strong>
            {picked.size} sélectionné{picked.size > 1 ? 's' : ''}
          </strong>
          <button className="small-btn" onClick={togglePage}>
            {allOnPage ? 'Désélectionner la page' : 'Sélectionner la page'}
          </button>
          <span className="grow" />
          <button className="small-btn" disabled={!picked.size} onClick={() => setPicker([...picked.keys()])}>
            Ajouter à une collection
          </button>
          {canContribute && (
            <button className="small-btn" disabled={!editablePicked.length} onClick={() => setBulkTags(true)}>
              Mots-clés…
            </button>
          )}
          <button className="small-btn" disabled={!picked.size || Boolean(zip)} onClick={downloadSelection}>
            Télécharger (ZIP)
          </button>
          {collection && canManageCollection && (
            <button className="small-btn danger" disabled={!picked.size} onClick={removeFromCollection}>
              Retirer de la collection
            </button>
          )}
          <button className="small-btn" onClick={endSelection}>
            Terminer
          </button>
        </div>
      )}

      {!loading && assets.length === 0 ? (
        <div className="empty card">
          {collection ? (
            <p>
              Cette collection est vide. Dans la bibliothèque, cliquez sur <strong>Sélectionner</strong>, choisissez des
              fichiers puis <strong>Ajouter à une collection</strong>.
            </p>
          ) : tags.length || debounced || kind !== 'all' || mineOnly ? (
            <p>Aucun fichier ne correspond à ces filtres.</p>
          ) : (
            <>
              <p>Aucun fichier pour l'instant.</p>
              {canContribute && (
                <button className="primary" onClick={() => setShowUpload(true)}>
                  Ajouter des photos ou des PDF
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <ul className="grid">
          {assets.map((a) => {
            const isPicked = picked.has(a.id)
            return (
              <li key={a.id}>
                <button
                  className={`tile${isPicked ? ' picked' : ''}`}
                  onClick={() => (selectMode ? toggle(a) : setSelected(a))}
                  aria-pressed={selectMode ? isPicked : undefined}
                >
                  <div className="thumb">
                    {a.thumb_path && urls[a.thumb_path] ? (
                      <img src={urls[a.thumb_path]} alt={a.title} loading="lazy" />
                    ) : a.kind === 'image' && a.file_path && urls[a.file_path] ? (
                      <img src={urls[a.file_path]} alt={a.title} loading="lazy" />
                    ) : (
                      <span className="pdf-badge">{a.kind === 'pdf' ? 'PDF' : extensionOf(a.file_name)}</span>
                    )}
                    {selectMode && <span className={`pick${isPicked ? ' on' : ''}`}>{isPicked ? '✓' : ''}</span>}
                    {a.drive_file_id && <span className="drive-badge">Drive</span>}
                    {a.ai_status === 'pending' && <span className="ai-badge">✨ Analyse…</span>}
                  </div>
                  <div className="tile-body">
                    <strong title={a.title}>{a.title}</strong>
                    {a.description && <span className="tile-desc">{a.description}</span>}
                    <span className="muted small">
                      {formatBytes(a.size_bytes)} · {new Date(a.created_at).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="pager">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Précédent
          </button>
          <span>
            Page {page + 1} / {pages}
          </span>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Suivant →
          </button>
        </nav>
      )}

      {zip && (
        <div className="toast">
          Préparation du ZIP… {zip.done} / {zip.total}
        </div>
      )}

      {showImport && (
        <Suspense fallback={null}>
          <ImportDialog userId={userId} onClose={() => setShowImport(false)} onDone={reload} />
        </Suspense>
      )}

      {picker && (
        <CollectionPicker
          userId={userId}
          role={role}
          assetIds={picker}
          onClose={() => setPicker(null)}
          onDone={(name) => {
            setPicker(null)
            setNotice(`${picker.length} fichier${picker.length > 1 ? 's' : ''} ajouté${picker.length > 1 ? 's' : ''} à « ${name} ».`)
            if (selectMode) endSelection()
            onCollectionChanged?.()
          }}
        />
      )}

      {bulkTags && (
        <BulkTagDialog
          assets={editablePicked}
          skipped={pickedList.length - editablePicked.length}
          onClose={() => setBulkTags(false)}
          onDone={() => {
            setBulkTags(false)
            reload()
          }}
        />
      )}

      {selected && (
        <AssetDetail
          key={`${selected.id}-${selected.ai_generated_at ?? ''}`}
          asset={selected}
          url={selected.file_path ? urls[selected.file_path] : undefined}
          thumbUrl={selected.thumb_path ? urls[selected.thumb_path] : undefined}
          canEdit={canEditAsset(role, userId, selected)}
          allTags={allTags}
          userId={userId}
          role={role}
          onClose={() => setSelected(null)}
          onChanged={reload}
          onTagClick={(t) => {
            setSelected(null)
            if (!tags.includes(t)) setTags([...tags, t])
            setPage(0)
          }}
        />
      )}
    </>
  )
}
