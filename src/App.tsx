import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isConfigured, openedFromRecoveryLink, supabase } from './lib/supabase'
import { ROLE_LABELS, type Role } from './types'
import Login from './components/Login'
import NewPassword from './components/NewPassword'
import Library from './components/Library'
import Collections from './components/Collections'
import KeywordsAdmin from './components/KeywordsAdmin'
import UsersAdmin from './components/UsersAdmin'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [recovery, setRecovery] = useState(openedFromRecoveryLink)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
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
  if (recovery && session) return <NewPassword onDone={() => setRecovery(false)} />
  if (!session) return <Login />
  return <Shell session={session} />
}

type View = 'library' | 'collections' | 'keywords' | 'users'

function Shell({ session }: { session: Session }) {
  const userId = session.user.id
  const [role, setRole] = useState<Role | null>(null)
  const [view, setView] = useState<View>('library')

  useEffect(() => {
    supabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => setRole((data?.role as Role | undefined) ?? 'reader'))
  }, [userId])

  if (!role) return null

  const tabs: { id: View; label: string }[] = [
    { id: 'library', label: 'Bibliothèque' },
    { id: 'collections', label: 'Collections' },
    ...(role === 'admin'
      ? [
          { id: 'keywords' as const, label: 'Mots-clés' },
          { id: 'users' as const, label: 'Utilisateurs' },
        ]
      : []),
  ]

  return (
    <div className="app">
      <header className="topbar">
        <h1>DAM Terbis</h1>
        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={view === t.id ? 'active' : ''}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="grow" />
        <span className="muted small user">
          {session.user.email} · {ROLE_LABELS[role]}
        </span>
        <button onClick={() => supabase.auth.signOut()}>Déconnexion</button>
      </header>

      {view === 'library' && <Library userId={userId} role={role} />}
      {view === 'collections' && <Collections userId={userId} role={role} />}
      {view === 'keywords' && role === 'admin' && <KeywordsAdmin />}
      {view === 'users' && role === 'admin' && <UsersAdmin userId={userId} />}
    </div>
  )
}
