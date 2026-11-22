import { useMemo, useState, type KeyboardEvent } from 'react'
import { parseTags } from '../types'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
  disabled?: boolean
  /** Mots-clés existants proposés pendant la saisie */
  suggestions?: string[]
  /** En lecture seule : clic sur un mot-clé (ex. pour filtrer) */
  onTagClick?: (tag: string) => void
  placeholder?: string
}

export default function TagEditor({ tags, onChange, disabled, suggestions, onTagClick, placeholder }: Props) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    if (!suggestions?.length) return []
    const q = draft.trim().toLowerCase()
    return suggestions.filter((s) => !tags.includes(s) && (!q || s.includes(q))).slice(0, 12)
  }, [suggestions, tags, draft])

  function add(values: string[]) {
    const added = values.filter((v) => !tags.includes(v))
    if (added.length) onChange([...tags, ...added])
    setDraft('')
  }

  function commit() {
    add(parseTags(draft))
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1))
    } else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className={`tag-editor${disabled ? ' disabled' : ''}`}>
      {tags.map((t) => (
        <span key={t} className="chip">
          {disabled && onTagClick ? (
            <button type="button" className="chip-link" title="Filtrer sur ce mot-clé" onClick={() => onTagClick(t)}>
              {t}
            </button>
          ) : (
            t
          )}
          {!disabled && (
            <button type="button" aria-label={`Retirer ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))}>
              ×
            </button>
          )}
        </span>
      ))}
      {disabled && !tags.length && <span className="muted small">Aucun</span>}
      {!disabled && (
        <div className="tag-input">
          <input
            value={draft}
            placeholder={placeholder ?? (tags.length ? 'Ajouter…' : 'Ajouter un mot-clé puis Entrée')}
            onChange={(e) => {
              setDraft(e.target.value)
              setOpen(true)
            }}
            onKeyDown={onKey}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setOpen(false)
              commit()
            }}
          />
          {open && matches.length > 0 && (
            <ul className="suggestions" role="listbox">
              {matches.map((s) => (
                <li key={s}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add([s])}>
                    <span>{s}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
