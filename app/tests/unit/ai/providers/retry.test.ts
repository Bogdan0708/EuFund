import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('withRetry — single attempt + fresh-controller fallback', () => {
  let providers: any
  let openaiMock: ReturnType<typeof vi.fn>
  let anthropicMock: ReturnType<typeof vi.fn>

  const config = {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    timeout: 1000,
    fallback: { provider: 'openai' as const, model: 'gpt-5.4' },
  }

  const originalRequest = {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user' as const, content: 'hi' }],
  }

  beforeEach(() => {
    openaiMock = vi.fn()
    anthropicMock = vi.fn()
    providers = {
      openai: { generate: openaiMock },
      anthropic: { generate: anthropicMock },
    }
  })

  it('503 from primary → fallback called with fresh signal', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const primary503 = Object.assign(new Error('Service Unavailable'), { status: 503 })
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    const result = await withRetry(
      async (_sig) => { throw primary503 },
      config,
      providers,
      originalRequest,
    )
    expect(result.content).toBe('fb')
    expect(openaiMock).toHaveBeenCalledTimes(1)
    const [reqArg, sigArg] = openaiMock.mock.calls[0]
    expect(reqArg.provider).toBe('openai')
    expect(reqArg.model).toBe('gpt-5.4')
    expect(sigArg).toBeInstanceOf(AbortSignal)
    expect(sigArg.aborted).toBe(false)
  })

  it.each([400, 401, 403])('non-retryable %d → no fallback, throws original', async (status) => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const err = Object.assign(new Error('bad'), { status })

    await expect(
      withRetry(async () => { throw err }, config, providers, originalRequest),
    ).rejects.toBe(err)
    expect(openaiMock).not.toHaveBeenCalled()
  })

  it.each([408, 429])('retryable %d → fallback called', async (status) => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const err = Object.assign(new Error('throttled'), { status })
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    await withRetry(async () => { throw err }, config, providers, originalRequest)
    expect(openaiMock).toHaveBeenCalledTimes(1)
  })

  it('500/502/504 → fallback called', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    for (const status of [500, 502, 504]) {
      openaiMock.mockClear()
      const err = Object.assign(new Error(String(status)), { status })
      await withRetry(async () => { throw err }, config, providers, originalRequest)
      expect(openaiMock).toHaveBeenCalledTimes(1)
    }
  })

  it('network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN) → fallback', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']) {
      openaiMock.mockClear()
      const err = Object.assign(new Error('net'), { code })
      await withRetry(async () => { throw err }, config, providers, originalRequest)
      expect(openaiMock).toHaveBeenCalledTimes(1)
    }
  })

  it('internal timeout fires → fallback called with fresh non-aborted signal', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    // Primary fn never returns; the timeout aborts its signal.
    const primaryFn = (sig: AbortSignal): Promise<never> =>
      new Promise((_, reject) => {
        sig.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })

    const fastConfig = { ...config, timeout: 10 }
    await withRetry(primaryFn, fastConfig, providers, originalRequest)

    expect(openaiMock).toHaveBeenCalledTimes(1)
    const sigArg = openaiMock.mock.calls[0][1]
    expect(sigArg.aborted).toBe(false)
  })

  it('external AbortError (not from internal timeout) → throws, no fallback', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')

    // Primary fn throws AbortError immediately (simulating an upstream
    // cancellation surfacing as AbortError before our timer fires).
    const externalAbort = Object.assign(new Error('aborted by caller'), { name: 'AbortError' })
    await expect(
      withRetry(async () => { throw externalAbort }, config, providers, originalRequest),
    ).rejects.toBe(externalAbort)
    expect(openaiMock).not.toHaveBeenCalled()
  })

  it('no fallback configured → re-throws even on retryable error', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const noFallbackConfig = { provider: 'anthropic' as const, model: 'claude-sonnet-4-6', timeout: 1000 }
    const err = Object.assign(new Error('503'), { status: 503 })
    await expect(
      withRetry(async () => { throw err }, noFallbackConfig, providers, originalRequest),
    ).rejects.toBe(err)
  })

  it('both primary and fallback timeout → fallback throws AbortError', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')

    const fastConfig = { ...config, timeout: 10 }
    const stubFn = (sig: AbortSignal): Promise<never> =>
      new Promise((_, reject) => {
        sig.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })

    openaiMock.mockImplementationOnce(async (_req: unknown, sig: AbortSignal) => stubFn(sig))

    await expect(
      withRetry(stubFn, fastConfig, providers, originalRequest),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('originalRequest.cache is preserved when calling fallback', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })
    const reqWithCache = { ...originalRequest, cache: { enabled: true as const } }

    await withRetry(
      async () => { throw Object.assign(new Error('503'), { status: 503 }) },
      config, providers, reqWithCache,
    )

    expect(openaiMock).toHaveBeenCalledTimes(1)
    expect(openaiMock.mock.calls[0][0].cache).toEqual({ enabled: true })
    expect(openaiMock.mock.calls[0][0].provider).toBe('openai')
    expect(openaiMock.mock.calls[0][0].model).toBe('gpt-5.4')
  })
})
