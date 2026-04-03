import type { ProviderClient, ProviderName, GenerateRequest, GenerateResult } from './types'
import { MODEL_CONFIGS } from './types'
import { openaiProvider } from './openai'
import { anthropicProvider } from './anthropic'
import { googleProvider } from './google'
import { perplexityProvider } from './perplexity'
import { withRetry } from './retry'

const PROVIDERS: Record<ProviderName, ProviderClient> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  perplexity: perplexityProvider,
}

export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  const config = MODEL_CONFIGS[req.model]
  if (!config) throw new Error(`Unknown model: ${req.model}`)

  const provider = PROVIDERS[config.provider]
  return withRetry(
    () => provider.generate({ ...req, provider: config.provider }),
    config,
    PROVIDERS,
  )
}

export async function embed(text: string): Promise<number[]> {
  return openaiProvider.embed!(text)
}
