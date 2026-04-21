import type { ProviderClient, ProviderName, GenerateRequest, GenerateResult, CacheUsage } from './types'
import { MODEL_CONFIGS } from './types'
import { openaiProvider } from './openai'
import { anthropicProvider } from './anthropic'
import { googleProvider } from './google'
import { perplexityProvider } from './perplexity'
import { withRetry } from './retry'
import { deriveIdentityKey } from './cache-key'
import { isFeatureEnabled } from '@/lib/feature-flags'

const PROVIDERS: Record<ProviderName, ProviderClient> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  perplexity: perplexityProvider,
}

async function resolveCacheState(req: GenerateRequest): Promise<{
  resolvedCache: GenerateRequest['cache']
  presence: CacheUsage | null
}> {
  const identityKey = deriveIdentityKey(req)

  if (!req.cache) {
    return { resolvedCache: undefined, presence: null }
  }

  if (req.cache.enabled !== true) {
    return {
      resolvedCache: { ...req.cache, enabled: false },
      presence: {
        requested: false,
        enabled: false,
        disabledReason: 'request_disabled',
        identityKey,
        supported: false,
        reads: 0,
        writes: 0,
        hit: 'disabled',
        ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
      },
    }
  }

  const flagEnabled = await isFeatureEnabled('prompt_cache_enabled', { bypassCache: true })
  if (!flagEnabled) {
    return {
      resolvedCache: { ...req.cache, enabled: false },
      presence: {
        requested: true,
        enabled: false,
        disabledReason: 'global_kill_switch',
        identityKey,
        supported: false,
        reads: 0,
        writes: 0,
        hit: 'disabled',
        ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
      },
    }
  }

  return { resolvedCache: { ...req.cache, enabled: true }, presence: null }
}

export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  const config = MODEL_CONFIGS[req.model]
  if (!config) throw new Error(`Unknown model: ${req.model}`)

  const { resolvedCache, presence } = await resolveCacheState(req)
  const effectiveReq: GenerateRequest = { ...req, cache: resolvedCache }

  const provider = PROVIDERS[config.provider]
  const result = await withRetry(
    () => provider.generate({ ...effectiveReq, provider: config.provider }),
    config,
    PROVIDERS,
    effectiveReq,
  )

  // Router owns disabled cases by contract (§5.2). When resolveCacheState
  // returned a presence object, it wins over any cacheUsage the adapter may
  // have emitted — this prevents a misbehaving adapter from reporting
  // disabledReason: 'none' on a kill-switched call.
  if (req.cache !== undefined && presence !== null) {
    result.cacheUsage = presence
  }

  if (req.cache === undefined) {
    delete result.cacheUsage
  }

  return result
}

export async function embed(text: string): Promise<number[]> {
  return openaiProvider.embed!(text)
}
