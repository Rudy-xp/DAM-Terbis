import { useMemo, useState } from 'react'
import type { TagCount } from '../types'

interface Props {
  all: TagCount[]
  selected: string[]
  onChange: (tags: string[]) => void
}

/** Filtre sur plusieurs mots-clés (les fichiers doivent les avoir tous). */
export default function TagFilter({ all, selected, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((t) => !selected.includes(t.tag) && (!q || t.tag.includes(q)))
      .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
      .slice(0, q ? 30 : 15)
  }, [all, selected, query])

  const add = (tag: string) => {
    onChange([...selected, tag])
    setQuery('')
  }

  return (
    <div className="tag-filter">
      <div className="tag-filter-row">
        <span className="muted small">Mots-clés :</span>
        {selected.map((t) => (
          <span key={t} className="chip active">
            {t}
            <button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange(selected.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        <div className="tag-filter-input">
          <input
            value={query}
            placeholder={selected.length ? 'Ajouter un filtre…' : 'Filtrer par mot-clé…'}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions[0]) {
                e.preventDefault()
                add(suggestions[0].tag)
              } else if (e.key === 'Escape') setOpen(false)
            }}
          />
          {open && suggestions.length > 0 && (
            <ul className="suggestions" role="listbox">
              {suggestions.map((s) => (
                <li key={s.tag}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s.tag)}>
                    <span>{s.tag}</span>
                    <span className="muted small">{s.n}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {selected.length > 0 && (
          <button className="link small" onClick={() => onChange([])}>
            Tout effacer
          </button>
        )}
      </div>
    </div>
  )
}
