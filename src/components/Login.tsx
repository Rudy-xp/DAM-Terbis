import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null)

  function switchMode(m: 'signin' | 'signup' | 'reset') {
    setMode(m)
    setMessage(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    const redirect = window.location.origin + import.meta.env.BASE_URL
    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirect })
      setBusy(false)
      if (error) setMessage({ type: 'error', text: error.message })
      else setMessage({ type: 'info', text: 'Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d’être envoyé.' })
      return
    }
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
        <p className="muted">{mode === 'reset' ? 'Réinitialiser le mot de passe' : 'Photothèque & documents PDF'}</p>
        <label>
          E-mail
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode !== 'reset' && (
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
        )}
        {message && <p className={message.type}>{message.text}</p>}
        <button className="primary" disabled={busy}>
          {busy ? '…' : mode === 'signin' ? 'Se connecter' : mode === 'signup' ? 'Créer un compte' : 'Envoyer le lien'}
        </button>
        {mode === 'signin' && (
          <button type="button" className="link" onClick={() => switchMode('reset')}>
            Mot de passe oublié ?
          </button>
        )}
        <button type="button" className="link" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Pas de compte ? En créer un' : 'Retour à la connexion'}
        </button>
      </form>
    </div>
  )
}
