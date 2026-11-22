import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined

export const isConfigured = Boolean(url && key)

// Lien « réinitialiser le mot de passe » reçu par e-mail : lu avant que le client
// Supabase ne consomme l'adresse de la page.
export const openedFromRecoveryLink = /[#&?]type=recovery\b/.test(window.location.hash + window.location.search)

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing')

export const BUCKET = 'assets'
