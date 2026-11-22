import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROLE_LABELS, type Role } from '../types'

interface Profile {
  id: string
  email: string
  role: Role
  created_at: string
}

/** Gestion des accès (administrateur). */
export default function UsersAdmin({ userId }: { userId: string }) {
  const [users, setUsers] = useState<Profile[] | null>(null)
  const [message, setMessage] = useState<{ type: 'error' | 'info'; text: string } | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) return setMessage({ type: 'error', text: error.message })
    setUsers((data ?? []) as Profile[])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function setRole(u: Profile, role: Role) {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', u.id)
    if (error) return setMessage({ type: 'error', text: error.message })
    setMessage({ type: 'info', text: `${u.email} est maintenant ${ROLE_LABELS[role].toLowerCase()}.` })
    load()
  }

  return (
    <>
      <div className="toolbar">
        <h2 className="section-title">Utilisateurs et accès</h2>
      </div>
      <ul className="muted small roles-help">
        <li>
          <strong>Lecteur</strong> : consulte, télécharge, crée des collections personnelles.
        </li>
        <li>
          <strong>Contributeur</strong> : en plus, ajoute des fichiers, modifie les siens, crée des collections publiques.
        </li>
        <li>
          <strong>Administrateur</strong> : tout, y compris les fichiers des autres, les mots-clés et les accès.
        </li>
        <li>Les nouveaux comptes sont lecteurs par défaut : ils créent leur compte sur la page de connexion.</li>
      </ul>
      {message && <p className={message.type}>{message.text}</p>}
      {users === null ? (
        <p className="muted small">Chargement…</p>
      ) : (
        <div className="admin-table card">
          <table>
            <thead>
              <tr>
                <th>E-mail</th>
                <th>Rôle</th>
                <th>Inscrit le</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.email}</td>
                  <td>
                    {u.id === userId ? (
                      <span>
                        {ROLE_LABELS[u.role]} <span className="muted small">(vous)</span>
                      </span>
                    ) : (
                      <select value={u.role} onChange={(e) => setRole(u, e.target.value as Role)}>
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="muted small">{new Date(u.created_at).toLocaleDateString('fr-FR')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
