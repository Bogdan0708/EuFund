import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('checkCallFreshness', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns freshness results for top 3 calls', async () => {
    const gateway = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify([
          { callId: 'c1', status: 'open', deadline: '2026-12-31', amendments: [], evidence: 'Call confirmed open' },
          { callId: 'c2', status: 'closed', deadline: '2026-03-01', amendments: ['Closed on 2026-03-01'], evidence: 'Call closed' },
          { callId: 'c3', status: 'open', deadline: '2026-09-15', amendments: ['Deadline extended'], evidence: 'Deadline changed' },
        ]),
        tokensUsed: 500,
      }),
    }

    const { checkCallFreshness } = await import('@/lib/ai/orchestrator/freshness')
    const calls = [
      { callId: 'c1', title: 'Call 1', sourceUrl: 'https://example.com/c1', deadline: '2026-12-31' },
      { callId: 'c2', title: 'Call 2', sourceUrl: 'https://example.com/c2', deadline: '2026-06-30' },
      { callId: 'c3', title: 'Call 3', sourceUrl: 'https://example.com/c3', deadline: '2026-06-15' },
      { callId: 'c4', title: 'Call 4', sourceUrl: 'https://example.com/c4', deadline: '2026-12-31' },
    ]

    const result = await checkCallFreshness(calls as any, gateway as any)
    expect(result).toHaveLength(4)
    expect(result[0].freshness?.status).toBe('verified')
    expect(result[1].freshness?.status).toBe('stale')
    expect(result[1].freshness?.warnings).toContain('Closed on 2026-03-01')
    expect(result[2].freshness?.status).toBe('stale')
    // c4 was not in top 3, no freshness check
    expect(result[3].freshness).toBeUndefined()
  })

  it('falls back to gemini when perplexity fails', async () => {
    const gateway = {
      generate: vi.fn()
        .mockRejectedValueOnce(new Error('Perplexity down'))
        .mockResolvedValueOnce({
          content: JSON.stringify([
            { callId: 'c1', status: 'open', deadline: '2026-12-31', amendments: [], evidence: 'OK' },
          ]),
          tokensUsed: 300,
        }),
    }

    const { checkCallFreshness } = await import('@/lib/ai/orchestrator/freshness')
    const calls = [
      { callId: 'c1', title: 'Call 1', sourceUrl: 'https://example.com/c1', deadline: '2026-12-31' },
    ]

    const result = await checkCallFreshness(calls as any, gateway as any)
    expect(result[0].freshness?.status).toBe('verified')
    expect(result[0].freshness?.provenance.provider).toBe('gemini')
    expect(gateway.generate).toHaveBeenCalledTimes(2)
  })

  it('returns unknown when both providers fail', async () => {
    const gateway = {
      generate: vi.fn().mockRejectedValue(new Error('All down')),
    }

    const { checkCallFreshness } = await import('@/lib/ai/orchestrator/freshness')
    const calls = [
      { callId: 'c1', title: 'Call 1', sourceUrl: 'https://example.com/c1', deadline: '2026-12-31' },
    ]

    const result = await checkCallFreshness(calls as any, gateway as any)
    expect(result[0].freshness?.status).toBe('unknown')
    expect(result[0].freshness?.warnings).toContain('Freshness check failed')
  })
})
