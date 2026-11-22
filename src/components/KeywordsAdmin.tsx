import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TagCount } from '../types'

/** Gestion des mots-clés (administrateur) : renommer, fusionner, supprimer. */
export default function KeywordsAdmin() {
  const [tags, setTags] = useState<TagCount[] | null>(null)
  const [filter, setFilter] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('tag_counts')
    if (error) return setMessage({ type: 'error', text: error.message })
    setTags(((data ?? []) as TagCount[]).map((t) => ({ tag: t.tag, n: Number(t.n) })))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (tags ?? []).filter((t) => !q || t.tag.includes(q))
  }, [tags, filter])

  async function rename(old: string) {
    const next = draft.trim().toLowerCase()
    if (!next || next === old) return setEditing(null)
    const exists = tags?.some((t) => t.tag === next)
    if (exists && !confirm(`« ${next} » existe déjà : fusionner « ${old} » dans « ${next} » ?`)) return
    setBusy(true)
    const { data, error } = await supabase.rpc('rename_tag', { old_tag: old, new_tag: next })
    setBusy(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'info', text: `« ${old} » → « ${next} » : ${data} fichier${Number(data) > 1 ? 's' : ''} mis à jour.` })
    setEditing(null)
    load()
  }

  async function remove(t: TagCount) {
    if (!confirm(`Supprimer le mot-clé « ${t.tag} » de ${t.n} fichier${t.n > 1 ? 's' : ''} ?`)) return
    setBusy(true)
    const { error } = await supabase.rpc('delete_tag', { old_tag: t.tag })
    setBusy(false)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'info', text: `« ${t.tag} » supprimé.` })
    load()
  }

  return (
    <>
      <div className="toolbar">
        <h2 className="section-title">Mots-clés</h2>
        <span className="grow" />
        <span className="muted small">{tags ? `${tags.length} mots-clés` : ''}</span>
      </div>
      <p className="muted small">
        Renommer un mot-clé le modifie sur tous les fichiers. Renommer vers un mot-clé existant fusionne les deux.
      </p>
      <input type="search" className="search" placeholder="Chercher un mot-clé…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {message && <p className={message.type}>{message.text}</p>}
      {tags === null ? (
        <p className="muted small">Chargement…</p>
      ) : (
        <div className="admin-table card">
          <table>
            <thead>
              <tr>
                <th>Mot-clé</th>
                <th className="num">Fichiers</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.tag}>
                  <td>
                    {editing === t.tag ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') rename(t.tag)
                          if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                    ) : (
                      t.tag
                    )}
                  </td>
                  <td className="num">{t.n}</td>
                  <td className="row-actions">
                    {editing === t.tag ? (
                      <>
                        <button className="small-btn primary" disabled={busy} onClick={() => rename(t.tag)}>
                          Enregistrer
                        </button>
                        <button className="small-btn" onClick={() => setEditing(null)}>
                          Annuler
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="small-btn"
                          disabled={busy}
                          onClick={() => {
                            setEditing(t.tag)
                            setDraft(t.tag)
                          }}
                        >
                          Renommer
                        </button>
                        <button className="small-btn danger" disabled={busy} onClick={() => remove(t)}>
                          Supprimer
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={3} className="muted small">
                    Aucun mot-clé.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
