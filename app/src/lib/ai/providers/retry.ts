import type { ProviderClient, GenerateRequest, GenerateResult, ModelConfig, ProviderName } from './types'

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
  originalRequest?: GenerateRequest,
): Promise<GenerateResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeout)

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Request timeout')))
      }),
    ])
    return result
  } catch (error) {
    if (shouldRetry(error)) {
      try { return await fn() } catch { /* fall through to fallback */ }
    }
    if (config.fallback && originalRequest) {
      const fallbackProvider = providers[config.fallback.provider]
      return fallbackProvider.generate({
        ...originalRequest,
        provider: config.fallback.provider,
        model: config.fallback.model,
      })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
