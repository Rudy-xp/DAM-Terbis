import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

/** Affiché après un clic sur le lien « réinitialiser le mot de passe » reçu par e-mail. */
export default function NewPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>DAM Terbis</h1>
        <p className="muted">Choisissez un nouveau mot de passe</p>
        <label>
          Nouveau mot de passe
          <input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          Confirmer
          <input type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? '…' : 'Enregistrer le mot de passe'}
        </button>
      </form>
    </div>
  )
}
