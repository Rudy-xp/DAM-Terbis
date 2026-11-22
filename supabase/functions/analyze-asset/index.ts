// Analyse une photo ou un PDF avec Claude et enregistre une description
// et des mots-clés (fusionnés avec les tags existants, qui restent éditables).
import Anthropic from 'npm:@anthropic-ai/sdk@1.12.0'
import { createClient } from 'npm:@supabase/supabase-js@2.119.2'

const MODEL = 'claude-opus-5-5'
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
const MAX_IMAGE_BYTES = 3_700_000 // ~5 Mo une fois encodé en base64
const MAX_PDF_BYTES = 23_000_000 // ~32 Mo une fois encodé en base64

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SYSTEM = `Tu catalogues les fichiers d'une photothèque professionnelle (photos et documents PDF).
Pour le fichier fourni, réponds en français :
- "description" : 1 à 3 phrases factuelles qui décrivent le contenu (sujet, lieu, éléments visibles, ambiance pour une photo ; type de document, objet, émetteur et dates clés pour un PDF). Pas de formule du type « Cette image montre ». N'invente rien qui ne soit pas visible.
- "tags" : 5 à 12 mots-clés utiles pour retrouver le fichier par recherche, en minuscules, au singulier, sans « # », un à trois mots chacun.`

const SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['description', 'tags'],
  additionalProperties: false,
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
  return [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))]
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

  // Choix de la source : vignette JPEG pour les images, fichier original pour les PDF.
  let path: string
  let mediaType: string
  if (asset.kind === 'pdf') {
    if (asset.size_bytes > MAX_PDF_BYTES) return fail('PDF trop volumineux pour l’analyse (23 Mo max)', 422)
    path = asset.file_path
    mediaType = 'application/pdf'
  } else if (asset.thumb_path) {
    path = asset.thumb_path
    mediaType = 'image/jpeg'
  } else if (IMAGE_TYPES.has(asset.mime_type) && asset.size_bytes <= MAX_IMAGE_BYTES) {
    path = asset.file_path
    mediaType = asset.mime_type
  } else {
    return fail('Format ou taille d’image non pris en charge pour l’analyse', 422)
  }

  const { data: blob, error: dlErr } = await supabase.storage.from('assets').download(path)
  if (dlErr || !blob) return fail('Téléchargement du fichier impossible')
  const data = toBase64(new Uint8Array(await blob.arrayBuffer()))

  const fileBlock: Anthropic.Beta.BetaContentBlockParam =
    mediaType === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : {
          type: 'image',
          source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp', data },
        }

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') })
  let result: { description: string; tags: string[] }
  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [fileBlock, { type: 'text', text: `Nom du fichier : ${asset.file_name}` }],
        },
      ],
    })
    if (response.stop_reason === 'refusal') return fail('L’IA a refusé d’analyser ce fichier', 422)
    if (response.stop_reason === 'max_tokens') return fail('Réponse de l’IA incomplète')
    const text = response.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text') return fail('Réponse de l’IA vide')
    result = JSON.parse(text.text)
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return fail('Clé API Anthropic invalide ou absente')
    if (err instanceof Anthropic.RateLimitError) return fail('Limite de requêtes IA atteinte, réessayez plus tard', 429)
    if (err instanceof Anthropic.APIError) return fail(`Erreur IA (${err.status ?? '?'}) : ${err.message}`)
    return fail('Erreur lors de l’analyse IA')
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
