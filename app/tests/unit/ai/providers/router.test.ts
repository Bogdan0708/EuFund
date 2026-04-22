import { describe, it, expect, vi, beforeEach } from 'vitest'

const isFeatureEnabledMock = vi.fn()
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: isFeatureEnabledMock }))

const anthropicMock = vi.fn()
vi.mock('@/lib/ai/providers/anthropic', () => ({ anthropicProvider: { generate: anthropicMock } }))

const openaiMock = vi.fn()
vi.mock('@/lib/ai/providers/openai', () => ({ openaiProvider: { generate: openaiMock } }))

const googleMock = vi.fn()
vi.mock('@/lib/ai/providers/google', () => ({ googleProvider: { generate: googleMock } }))

const perplexityMock = vi.fn()
vi.mock('@/lib/ai/providers/perplexity', () => ({ perplexityProvider: { generate: perplexityMock } }))

vi.mock('@/lib/ai/providers/retry', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

describe('router.generate — cache resolution + presence', () => {
  beforeEach(() => {
    isFeatureEnabledMock.mockReset()
    anthropicMock.mockReset()
    openaiMock.mockReset()
    anthropicMock.mockResolvedValue({
      content: 'ok', tokensUsed: { input: 10, output: 5 }, model: 'claude-opus-4-6', provider: 'anthropic',
      cacheUsage: { requested: true, enabled: true, disabledReason: 'none', identityKey: 'k', supported: true, reads: 100, writes: 0, hit: 'read' },
    })
  })

  it('does NOT read the feature flag when req.cache is omitted', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ provider: 'anthropic', model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(isFeatureEnabledMock).not.toHaveBeenCalled()
  })

  it('does NOT read the feature flag when req.cache.enabled=false', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(isFeatureEnabledMock).not.toHaveBeenCalled()
  })

  it('reads the flag (with bypassCache) only when req.cache.enabled=true', async () => {
    isFeatureEnabledMock.mockResolvedValue(true)
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(isFeatureEnabledMock).toHaveBeenCalledWith('prompt_cache_enabled', { bypassCache: true })
  })

  it('forces enabled=false with disabledReason=global_kill_switch when flag is off', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    anthropicMock.mockResolvedValueOnce({
      content: 'ok', tokensUsed: { input: 10, output: 5 }, model: 'claude-opus-4-6', provider: 'anthropic',
    })
    const { generate } = await import('@/lib/ai/providers/router')
    const result = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(anthropicMock.mock.calls[0][0].cache).toMatchObject({ enabled: false })
    expect(result.cacheUsage!.enabled).toBe(false)
    expect(result.cacheUsage!.disabledReason).toBe('global_kill_switch')
    expect(result.cacheUsage!.requested).toBe(true)
  })

  it('populates GenerateResult.cacheUsage when req.cache was provided (presence rule §5.4)', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    const withCacheFalse = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(withCacheFalse.cacheUsage).toBeDefined()
    expect(withCacheFalse.cacheUsage!.requested).toBe(false)
    expect(withCacheFalse.cacheUsage!.enabled).toBe(false)
    expect(withCacheFalse.cacheUsage!.disabledReason).toBe('request_disabled')
  })

  it('leaves GenerateResult.cacheUsage undefined when req.cache was omitted', async () => {
    anthropicMock.mockResolvedValueOnce({
      content: 'ok', tokensUsed: { input: 10, output: 5 }, model: 'claude-opus-4-6', provider: 'anthropic',
    })
    const { generate } = await import('@/lib/ai/providers/router')
    const result = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.cacheUsage).toBeUndefined()
  })

  it('router presence OVERRIDES a misbehaving adapter cacheUsage on kill-switched calls', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    anthropicMock.mockResolvedValueOnce({
      content: 'ok',
      tokensUsed: { input: 10, output: 5 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      cacheUsage: {
        requested: true,
        enabled: true,
        disabledReason: 'none',
        identityKey: 'bogus',
        supported: true,
        reads: 999,
        writes: 0,
        hit: 'read',
      },
    })
    const { generate } = await import('@/lib/ai/providers/router')
    const result = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(result.cacheUsage!.enabled).toBe(false)
    expect(result.cacheUsage!.disabledReason).toBe('global_kill_switch')
    expect(result.cacheUsage!.hit).toBe('disabled')
    expect(result.cacheUsage!.reads).toBe(0)
  })

  it('router presence OVERRIDES a misbehaving adapter cacheUsage on request-disabled calls', async () => {
    anthropicMock.mockResolvedValueOnce({
      content: 'ok',
      tokensUsed: { input: 10, output: 5 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
      cacheUsage: {
        requested: true, enabled: true, disabledReason: 'none',
        identityKey: 'bogus', supported: true, reads: 42, writes: 0, hit: 'read',
      },
    })
    const { generate } = await import('@/lib/ai/providers/router')
    const result = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(result.cacheUsage!.disabledReason).toBe('request_disabled')
    expect(result.cacheUsage!.reads).toBe(0)
  })
})
