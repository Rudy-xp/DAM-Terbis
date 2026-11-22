import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

export interface AiResult {
  description: string
  tags: string[]
}

/** Lance l'analyse IA d'un fichier (description + mots-clés) via l'Edge Function. */
export async function analyzeAsset(assetId: string): Promise<AiResult> {
  const { data, error } = await supabase.functions.invoke<AiResult>('analyze-asset', {
    body: { asset_id: assetId },
  })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null)
      throw new Error(body?.error ?? error.message)
    }
    throw new Error(error.message)
  }
  return data!
}

/** File d'attente simple : au plus 2 analyses en parallèle. */
const queue: Array<() => Promise<void>> = []
let running = 0
export function queueAnalysis(assetId: string, onDone: () => void) {
  queue.push(async () => {
    try {
      await analyzeAsset(assetId)
    } catch {
      // l'erreur est enregistrée côté serveur (ai_status = 'error')
    } finally {
      onDone()
    }
  })
  pump()
}
function pump() {
  while (running < 2 && queue.length) {
    const job = queue.shift()!
    running++
    job().finally(() => {
      running--
      pump()
    })
  }
}
