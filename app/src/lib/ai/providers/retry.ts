import type { ProviderClient, GenerateResult, ModelConfig, ProviderName } from './types'

function shouldRetry(error: unknown): boolean {
  if (error instanceof Error && 'status' in error) {
    const status = (error as { status: number }).status
    return [429, 500, 502, 503].includes(status)
  }
  return false
}

export async function withRetry(
  fn: () => Promise<GenerateResult>,
  config: ModelConfig,
  providers: Record<ProviderName, ProviderClient>,
): Promise<GenerateResult> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeout)
    try {
      return await fn()
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    if (shouldRetry(error)) {
      try { return await fn() } catch { /* fall through to fallback */ }
    }
    if (config.fallback) {
      const fallbackProvider = providers[config.fallback.provider]
      return fallbackProvider.generate({
        provider: config.fallback.provider,
        model: config.fallback.model,
        messages: [],
      } as Parameters<ProviderClient['generate']>[0])
    }
    throw error
  }
}
