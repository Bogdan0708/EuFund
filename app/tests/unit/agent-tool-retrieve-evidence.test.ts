// app/tests/unit/agent-tool-retrieve-evidence.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([
      { id: 'c1', content: 'Guide section about eligibility', score: 0.9, metadata: { documentType: 'ghid', source: 'guide.pdf', callId: 'PNRR-C11' } },
      { id: 'c2', content: 'Annex template for budget', score: 0.85, metadata: { documentType: 'anexa', source: 'annex.pdf', callId: 'PNRR-C11' } },
      { id: 'c3', content: 'Summary of call requirements', score: 0.95, metadata: { documentType: 'summary', source: 'summary.pdf', callId: 'PNRR-C11' } },
    ]),
  })),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/retrieve-call-evidence'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('retrieve_call_evidence tool', () => {
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
    const tools = getToolRegistry()
    expect(tools.find(t => t.name === 'retrieve_call_evidence')).toBeDefined()
  })

  it('returns evidence sorted by doc type priority', async () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_call_evidence')!
    const result = await tool.execute({ callId: 'PNRR-C11', maxChunks: 15 }, mockCtx)

    expect(result.success).toBe(true)
    const data = result.data as any[]
    expect(data).toHaveLength(3)
    // ghid (priority 1) should come first, then anexa (2), then summary (5)
    expect(data[0].docType).toBe('ghid')
    expect(data[1].docType).toBe('anexa')
    expect(data[2].docType).toBe('summary')
  })

  it('includes telemetry with sources', async () => {
    const tool = getToolRegistry().find(t => t.name === 'retrieve_call_evidence')!
    const result = await tool.execute({ callId: 'PNRR-C11', maxChunks: 15 }, mockCtx)

    expect(result.telemetry.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.telemetry.sources).toBeDefined()
  })
})
