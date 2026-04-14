import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: '{"isOpen": true, "amendments": ["Amendment 3 - deadline extended"], "warnings": [], "confidence": 0.85}',
    tokensUsed: { input: 100, output: 50 },
    model: 'sonar',
    provider: 'perplexity',
  }),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  resolveAgentModel: vi.fn(() => ({ provider: 'perplexity', model: 'sonar' })),
}))

vi.mock('@/lib/ai/agent/utils', () => ({
  parseAIJson: vi.fn((content: string) => JSON.parse(content)),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/refresh-call-freshness'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('refresh_call_freshness tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: {} as any,
    sections: [],
    stateVersion: 0,
    requestId: 'req-1',
    locale: 'ro' as const,
  }

  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'refresh_call_freshness')).toBeDefined()
  })

  it('returns freshness result from Perplexity', async () => {
    const tool = getToolRegistry().find(t => t.name === 'refresh_call_freshness')!
    const result = await tool.execute({
      callId: 'PNRR-C11',
      callTitle: 'Green Energy Transition',
      program: 'PNRR',
    }, mockCtx)

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.isOpen).toBe(true)
    expect(data.amendments).toContain('Amendment 3 - deadline extended')
    expect(data.freshnessConfidence).toBe(0.85)
  })

  it('includes latencyMs in telemetry', async () => {
    const tool = getToolRegistry().find(t => t.name === 'refresh_call_freshness')!
    const result = await tool.execute({
      callId: 'PNRR-C11',
      callTitle: 'Green Energy Transition',
      program: 'PNRR',
    }, mockCtx)

    expect(typeof result.telemetry.latencyMs).toBe('number')
  })
})
