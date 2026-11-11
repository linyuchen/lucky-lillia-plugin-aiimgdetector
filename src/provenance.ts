import type { AiProvider } from '@luckylillia/plugin-aiprovider'
import type { Image } from './image.js'

// The answer of OpenAI's content_provenance_checks
export interface ProvenanceResult {
  type: 'c2pa' | 'synthid'
  outcome: 'detected' | 'not_detected'
  validation_state?: 'trusted' | 'valid' | 'invalid' | 'not_present'
  issuer?: string | null
  model?: string | null
  generated_at?: string | null
}

export interface ProvenanceResponse {
  object: string
  created_at: number
  results: ProvenanceResult[]
}

/** Keep implicit selection in sync with the filtered service selector: official default, then list order. */
export function provenanceService(ai: AiProvider, name?: string): string | undefined {
  if (name) {
    const explicit = ai.get(name)
    return explicit?.provider === 'openai' ? explicit.name : undefined
  }
  const fallback = ai.get()
  if (fallback?.provider === 'openai') return fallback.name
  return ai.list().find(service => service.provider === 'openai')?.name
}

/**
 * Whether OpenAI's own marks are in the image: its C2PA credentials and SynthID watermark. It knows nothing of other
 * makers' images, and only OpenAI's own API has the endpoint (relays answer 404).
 */
export async function checkProvenance(ai: AiProvider, name: string, image: Image): Promise<ProvenanceResponse> {
  const form = new FormData()
  form.append('file', new Blob([image.data], { type: image.type }), 'image')
  const response = await ai.request(name, '/content_provenance_checks', { method: 'POST', body: form })
  return await response.json() as ProvenanceResponse
}
