import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const redirect = window.location.origin + import.meta.env.BASE_URL
    const { error, data } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })
    setBusy(false)
    if (error) setMessage({ type: 'error', text: error.message })
    else if (mode === 'signup' && !data.session)
      setMessage({ type: 'info', text: 'Compte créé : vérifiez votre e-mail pour le confirmer.' })
  }

  return (
    <div className="login">
      <form className="card login-card" onSubmit={onSubmit}>
        <h1>DAM Terbis</h1>
        <p className="muted">Photothèque & documents PDF</p>
        <label>
          E-mail
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {message && <p className={message.type}>{message.text}</p>}
        <button className="primary" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Se connecter' : 'Créer un compte'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Pas de compte ? En créer un' : 'Déjà un compte ? Se connecter'}
        </button>
      </form>
    </div>
  )
}
