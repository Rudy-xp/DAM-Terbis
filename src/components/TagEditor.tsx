import { useId, useState, type KeyboardEvent } from 'react'
import { parseTags } from '../types'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
  disabled?: boolean
  /** Mots-clés existants proposés pendant la saisie */
  suggestions?: string[]
  /** En lecture seule : clic sur un mot-clé (ex. pour filtrer) */
  onTagClick?: (tag: string) => void
}

export default function TagEditor({ tags, onChange, disabled, suggestions, onTagClick }: Props) {
  const [draft, setDraft] = useState('')
  const listId = useId()

  function commit() {
    const added = parseTags(draft)
    if (added.length) onChange([...new Set([...tags, ...added])])
    setDraft('')
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Backspace' && !draft && tags.length) {
      onChange(tags.slice(0, -1))
    }
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
      {!disabled && (
        <input
          value={draft}
          placeholder={tags.length ? 'Ajouter…' : 'Ajouter un mot-clé puis Entrée'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={commit}
          list={suggestions?.length ? listId : undefined}
        />
      )}
      {!disabled && suggestions && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !tags.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  )
}
