import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { BUCKET, isConfigured, supabase } from './lib/supabase'
import type { Asset, AssetKind } from './types'
import { formatBytes } from './types'
import Login from './components/Login'
import Uploader from './components/Uploader'
import AssetDetail from './components/AssetDetail'

const PAGE_SIZE = 48
const URL_TTL = 60 * 60 // URLs signées valables 1 h

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!isConfigured)
    return (
      <div className="login">
        <div className="card login-card">
          <h1>Configuration manquante</h1>
          <p>
            Définissez <code>VITE_SUPABASE_URL</code> et <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (voir{' '}
            <code>.env.example</code>).
          </p>
        </div>
      </div>
    )
  if (!ready) return null
  if (!session) return <Login />
  return <Library session={session} />
}

function Library({ session }: { session: Session }) {
  const userId = session.user.id
  const [assets, setAssets] = useState<Asset[]>([])
  const [total, setTotal] = useState(0)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [kind, setKind] = useState<AssetKind | 'all'>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Asset | null>(null)
  const [showUpload, setShowUpload] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim())
      setPage(0)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    let q = supabase
      .from('assets')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (kind !== 'all') q = q.eq('kind', kind)
    if (tag) q = q.contains('tags', [tag])
    if (mineOnly) q = q.eq('owner_id', userId)
    if (debounced) {
      // Échappe les caractères spéciaux du filtre PostgREST
      const s = debounced.replace(/[%_,(){}"\\]/g, ' ').trim()
      const clauses = [`title.ilike.%${s}%`, `description.ilike.%${s}%`, `file_name.ilike.%${s}%`]
      if (/^[\p{L}\p{N}_-]+$/u.test(s)) clauses.push(`tags.cs.{${s.toLowerCase()}}`)
      if (s) q = q.or(clauses.join(','))
    }
    const { data, error, count } = await q
    setLoading(false)
    if (error) return setError(error.message)
    const rows = (data ?? []) as Asset[]
    setAssets(rows)
    setTotal(count ?? 0)
    if (rows.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(
        rows.map((r) => r.file_path),
        URL_TTL,
      )
      const map: Record<string, string> = {}
      signed?.forEach((s) => {
        if (s.path && s.signedUrl) map[s.path] = s.signedUrl
      })
      setUrls((u) => ({ ...u, ...map }))
    }
  }, [page, kind, tag, mineOnly, debounced, userId])

  useEffect(() => {
    load()
  }, [load])

  const allTags = useMemo(() => {
    const set = new Set<string>()
    assets.forEach((a) => a.tags.forEach((t) => set.add(t)))
    if (tag) set.add(tag)
    return [...set].sort()
  }, [assets, tag])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="app">
      <header className="topbar">
        <h1>DAM Terbis</h1>
        <div className="grow" />
        <button className="primary" onClick={() => setShowUpload((v) => !v)}>
          {showUpload ? 'Fermer' : '+ Ajouter'}
        </button>
        <span className="muted small user">{session.user.email}</span>
        <button onClick={() => supabase.auth.signOut()}>Déconnexion</button>
      </header>

      {showUpload && <Uploader userId={userId} onUploaded={load} />}

      <section className="filters">
        <input
          type="search"
          className="search"
          placeholder="Rechercher par titre, description, nom de fichier ou tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="segmented">
          {(['all', 'image', 'pdf'] as const).map((k) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => {
                setKind(k)
                setPage(0)
              }}>
              {k === 'all' ? 'Tout' : k === 'image' ? 'Photos' : 'PDF'}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={mineOnly} onChange={(e) => {
              setMineOnly(e.target.checked)
              setPage(0)
            }} />
          Mes fichiers
        </label>
      </section>

      {allTags.length > 0 && (
        <div className="tags">
          {allTags.map((t) => (
            <button key={t} className={`tag${tag === t ? ' active' : ''}`} onClick={() => {
                setTag(tag === t ? null : t)
                setPage(0)
              }}>
              #{t}
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <p className="muted small count">
        {loading ? 'Chargement…' : `${total} fichier${total > 1 ? 's' : ''}`}
      </p>

      {!loading && assets.length === 0 ? (
        <div className="empty card">
          <p>Aucun fichier pour l'instant.</p>
          <button className="primary" onClick={() => setShowUpload(true)}>
            Ajouter des photos ou des PDF
          </button>
        </div>
      ) : (
        <ul className="grid">
          {assets.map((a) => (
            <li key={a.id}>
              <button className="tile" onClick={() => setSelected(a)}>
                <div className="thumb">
                  {a.kind === 'image' && urls[a.file_path] ? (
                    <img src={urls[a.file_path]} alt={a.title} loading="lazy" />
                  ) : (
                    <span className="pdf-badge">{a.kind === 'pdf' ? 'PDF' : '…'}</span>
                  )}
                </div>
                <div className="tile-body">
                  <strong title={a.title}>{a.title}</strong>
                  <span className="muted small">
                    {formatBytes(a.size_bytes)} · {new Date(a.created_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>
              </button>
            </li>
          ))}
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

      {selected && (
        <AssetDetail
          key={selected.id}
          asset={selected}
          url={urls[selected.file_path]}
          canEdit={selected.owner_id === userId}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  )
}
