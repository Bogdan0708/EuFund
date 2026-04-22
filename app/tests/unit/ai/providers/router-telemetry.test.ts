import { describe, it, expect, vi, beforeEach } from 'vitest'

const logInfoMock = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: logInfoMock, warn: vi.fn(), error: vi.fn() }) },
}))

const trackCall = vi.fn()
const trackReads = vi.fn()
const trackWrites = vi.fn()
const trackDisabled = vi.fn()
vi.mock('@/lib/monitoring/metrics', () => ({
  metrics: { counter: vi.fn(), inc: vi.fn() },
  trackAiCacheCall: trackCall,
  trackAiCacheReadTokens: trackReads,
  trackAiCacheWriteTokens: trackWrites,
  trackAiCacheDisabled: trackDisabled,
}))

vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => true) }))

vi.mock('@/lib/ai/providers/anthropic', () => ({
  anthropicProvider: {
    generate: vi.fn(async (req) => ({
      content: 'ok',
      tokensUsed: { input: 100, output: 20 },
      model: req.model,
      provider: 'anthropic',
      // Mirror the real adapter contract: emit cacheUsage only when the
      // router has resolved cache.enabled === true. On kill-switched or
      // request-disabled calls, the router (not the adapter) owns presence.
      ...(req.cache?.enabled === true ? {
        cacheUsage: {
          requested: true, enabled: true, disabledReason: 'none', identityKey: 'x'.repeat(64),
          supported: true, reads: 80, writes: 0, hit: 'read',
        },
      } : {}),
    })),
  },
}))

vi.mock('@/lib/ai/providers/openai', () => ({ openaiProvider: { generate: vi.fn() } }))
vi.mock('@/lib/ai/providers/google', () => ({ googleProvider: { generate: vi.fn() } }))
vi.mock('@/lib/ai/providers/perplexity', () => ({ perplexityProvider: { generate: vi.fn() } }))
vi.mock('@/lib/ai/providers/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))

describe('router telemetry', () => {
  beforeEach(() => {
    logInfoMock.mockReset()
    trackCall.mockReset()
    trackReads.mockReset()
    trackWrites.mockReset()
    trackDisabled.mockReset()
  })

  it('logs a cache object on every call, even when cache is omitted', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const logArg = logInfoMock.mock.calls[0][0]
    expect(logArg.cache).toMatchObject({
      requested: false,
      enabled: false,
      disabledReason: 'request_disabled',
      hit: 'disabled',
      supported: false,
      reads: 0,
      writes: 0,
    })
  })

  it('records the hit=read counter on a cache read', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(trackCall).toHaveBeenCalledWith('anthropic', 'claude-opus-4-6', 'read')
    expect(trackReads).toHaveBeenCalledWith('anthropic', 'claude-opus-4-6', 'unspecified', 80)
  })

  it('records the disabled counter with the correct reason', async () => {
    const ff = await import('@/lib/feature-flags')
    vi.mocked(ff.isFeatureEnabled).mockResolvedValueOnce(false)
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(trackDisabled).toHaveBeenCalledWith('global_kill_switch')
  })
})
