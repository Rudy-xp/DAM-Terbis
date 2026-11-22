// Connexion à Google Drive dans le navigateur (Google Identity Services, lecture seule).
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
const API = 'https://www.googleapis.com/drive/v3'

export const isDriveConfigured = Boolean(CLIENT_ID)

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string
            scope: string
            callback: (r: TokenResponse) => void
            error_callback?: (e: { type: string; message?: string }) => void
          }) => TokenClient
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error('Impossible de charger le service de connexion Google'))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

let token: { value: string; expiresAt: number } | null = null

/** Jeton valide encore au moins `marginMs` millisecondes ? */
export function hasToken(marginMs = 5 * 60_000): boolean {
  return Boolean(token && token.expiresAt - Date.now() > marginMs)
}

/** Ouvre la fenêtre Google (à appeler depuis un clic). */
export async function connectDrive(): Promise<void> {
  if (!CLIENT_ID) throw new Error('VITE_GOOGLE_CLIENT_ID non configuré')
  await loadScript()
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description ?? r.error ?? 'Accès refusé'))
        token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
        resolve()
      },
      error_callback: (e) =>
        reject(new Error(e.type === 'popup_closed' ? 'Fenêtre Google fermée' : (e.message ?? e.type))),
    })
    client.requestAccessToken({ prompt: token ? '' : 'consent' })
  })
}

export class DriveAuthError extends Error {}

async function driveFetch(url: string): Promise<Response> {
  if (!token) throw new DriveAuthError('Non connecté à Google Drive')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token.value}` } })
  if (res.status === 401) {
    token = null
    throw new DriveAuthError('Accès Google expiré')
  }
  return res
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  thumbnailLink?: string
  webViewLink?: string
  imageMediaMetadata?: { width?: number; height?: number }
}

export async function getDriveFile(id: string): Promise<DriveFile> {
  const fields = 'id,name,mimeType,size,thumbnailLink,webViewLink,imageMediaMetadata(width,height)'
  const res = await driveFetch(`${API}/files/${encodeURIComponent(id)}?fields=${fields}&supportsAllDrives=true`)
  if (res.status === 404) throw new Error('Introuvable dans Drive (supprimé ou non partagé)')
  if (!res.ok) throw new Error(`Drive : erreur ${res.status}`)
  return res.json()
}

export async function downloadDriveFile(id: string): Promise<Blob> {
  const res = await driveFetch(`${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`)
  if (!res.ok) throw new Error(`Téléchargement Drive : erreur ${res.status}`)
  return res.blob()
}

// La vignette Google peut être bloquée par le navigateur (CORS) : on ne réessaie plus après un échec.
let thumbnailsBlocked = false

/** Vignette fournie par Drive (rapide, fonctionne aussi pour PSD/AI…). Null si indisponible. */
export async function fetchDriveThumbnail(file: DriveFile, size = 1568): Promise<Blob | null> {
  if (!file.thumbnailLink || thumbnailsBlocked) return null
  const url = file.thumbnailLink.replace(/=s\d+(-[a-z]+)?$/, `=s${size}`)
  try {
    const res = await fetch(url, { credentials: 'omit' })
    if (!res.ok) return null
    const blob = await res.blob()
    return blob.type.startsWith('image/') ? blob : null
  } catch {
    thumbnailsBlocked = true
    return null
  }
}

/** Extrait l'identifiant d'un fichier depuis un lien Drive, ou renvoie la valeur si c'est déjà un identifiant. */
export function parseDriveId(value: string): string | null {
  const v = value.trim()
  const m = v.match(/\/d\/([\w-]{10,})/) ?? v.match(/[?&]id=([\w-]{10,})/)
  if (m) return m[1]
  return /^[\w-]{20,}$/.test(v) ? v : null
}
