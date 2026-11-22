// Analyse une photo ou un PDF avec Google Gemini (offre gratuite) et enregistre
// une description et des mots-clés (fusionnés avec les tags existants, qui restent éditables).
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'

// Modèle modifiable sans redéployer via le secret GEMINI_MODEL.
// "gemini-flash-latest" suit automatiquement le dernier modèle Flash (offre gratuite).
const MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const MAX_INLINE_BYTES = 14_000_000 // requête Gemini limitée à ~20 Mo une fois encodée en base64

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM = `Tu catalogues les fichiers d'une photothèque professionnelle (photos et documents PDF).
Pour le fichier fourni, réponds en français :
- "description" : 1 à 3 phrases factuelles qui décrivent le contenu (sujet, lieu, éléments visibles, ambiance pour une photo ; type de document, objet, émetteur et dates clés pour un PDF). Pas de formule du type « Cette image montre ». N'invente rien qui ne soit pas visible.
- "tags" : 5 à 12 mots-clés utiles pour retrouver le fichier par recherche, en minuscules, au singulier, sans « # », un à trois mots chacun.`

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    description: { type: 'STRING' },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['description', 'tags'],
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => String(t).trim().toLowerCase().replace(/^#/, '')).filter(Boolean))]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  // Client agissant au nom de l'utilisateur : les règles RLS s'appliquent.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) return json({ error: 'Non authentifié' }, 401)

  let assetId: string | undefined
  try {
    assetId = (await req.json())?.asset_id
  } catch {
    // corps invalide
  }
  if (!assetId) return json({ error: 'asset_id manquant' }, 400)

  const { data: asset, error: assetErr } = await supabase.from('assets').select('*').eq('id', assetId).single()
  if (assetErr || !asset) return json({ error: 'Fichier introuvable' }, 404)
  if (asset.owner_id !== userData.user.id) return json({ error: 'Seul le propriétaire peut lancer l’analyse' }, 403)

  const fail = async (message: string, status = 500) => {
    await supabase.from('assets').update({ ai_status: 'error', ai_error: message }).eq('id', assetId)
    return json({ error: message }, status)
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) return fail('Clé GEMINI_API_KEY absente dans les secrets Supabase', 500)

  // Source : vignette JPEG pour les photos, fichier original pour les PDF.
  let path: string
  let mimeType: string
  if (asset.kind === 'pdf') {
    if (asset.size_bytes > MAX_INLINE_BYTES) return fail('PDF trop volumineux pour l’analyse (14 Mo max)', 422)
    path = asset.file_path
    mimeType = 'application/pdf'
  } else if (asset.thumb_path) {
    path = asset.thumb_path
    mimeType = 'image/jpeg'
  } else if (IMAGE_TYPES.has(asset.mime_type) && asset.size_bytes <= MAX_INLINE_BYTES) {
    path = asset.file_path
    mimeType = asset.mime_type
  } else {
    return fail('Format ou taille d’image non pris en charge pour l’analyse', 422)
  }

  const { data: blob, error: dlErr } = await supabase.storage.from('assets').download(path)
  if (dlErr || !blob) return fail('Téléchargement du fichier impossible')
  const data = toBase64(new Uint8Array(await blob.arrayBuffer()))

  let result: { description: string; tags: string[] }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType, data } },
                { text: `Nom du fichier : ${asset.file_name}` },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    )
    const body = await res.json().catch(() => null)
    if (!res.ok) {
      const msg = body?.error?.message ?? res.statusText
      if (res.status === 429) return fail('Quota gratuit Gemini atteint, réessayez dans une minute', 429)
      if (res.status === 400 && /api key/i.test(msg)) return fail('Clé GEMINI_API_KEY invalide')
      return fail(`Erreur Gemini (${res.status}) : ${msg}`)
    }
    if (body?.promptFeedback?.blockReason) return fail(`Analyse bloquée par Gemini (${body.promptFeedback.blockReason})`, 422)
    const candidate = body?.candidates?.[0]
    const text: string | undefined = candidate?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? '')
      .join('')
    if (!text) return fail(`Réponse Gemini vide (${candidate?.finishReason ?? 'inconnue'})`)
    result = JSON.parse(text)
    if (typeof result.description !== 'string' || !Array.isArray(result.tags)) throw new Error('format')
  } catch {
    return fail('Réponse de Gemini illisible ou service injoignable')
  }

  const description = result.description.trim()
  const tags = normalizeTags([...(asset.tags ?? []), ...result.tags])
  const { error: upErr } = await supabase
    .from('assets')
    .update({ description, tags, ai_status: 'done', ai_error: null, ai_generated_at: new Date().toISOString() })
    .eq('id', assetId)
  if (upErr) return json({ error: upErr.message }, 500)

  return json({ description, tags })
})
