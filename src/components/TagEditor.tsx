import { useState, type KeyboardEvent } from 'react'
import { parseTags } from '../types'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
  disabled?: boolean
}

export default function TagEditor({ tags, onChange, disabled }: Props) {
  const [draft, setDraft] = useState('')

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
          {t}
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
        />
      )}
    </div>
  )
}
