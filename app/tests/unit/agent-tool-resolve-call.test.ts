// app/tests/unit/agent-tool-resolve-call.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(() => ({
    search: vi.fn().mockResolvedValue([
      { id: 'c1', content: 'Guide section about structure', score: 0.9, metadata: { documentType: 'ghid', source: 'guide.pdf', callId: 'PNRR-C11' } },
    ]),
  })),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: JSON.stringify([
      { id: 'context', title: 'Context', description: 'Describe context', order: 1, generationOrder: 1, importance: 'critical', expectedLength: 'long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 0.9 },
    ]),
    tokensUsed: { input: 200, output: 150 },
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { db } from '@/lib/db'
import '@/lib/ai/agent/tools/resolve-call'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('resolve_call tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: {} as any, sections: [], stateVersion: 0, requestId: 'req-1', locale: 'ro' as const,
  }

  beforeEach(() => { vi.clearAllMocks() })

  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'resolve_call')).toBeDefined()
  })

  it('resolves from cache when available', async () => {
    (db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([{
      callId: 'PNRR-C11', program: 'PNRR', callTitle: 'Test',
      normalized: { requiredSections: [{ title: 'Context', description: 'Desc' }] },
      status: 'primed', structureConfidence: 0.8, freshnessConfidence: 0.7,
      sourceDocs: [], contentExtractedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    }])

    const tool = getToolRegistry().find(t => t.name === 'resolve_call')!
    const result = await tool.execute({ callId: 'PNRR-C11' }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.checkpoint).toBeDefined()
    expect(result.checkpoint!.type).toBe('call_selected')
    expect(result.stateTransitions).toBeDefined()
    expect(result.stateTransitions!.find((t: any) => t.type === 'SET_SELECTED_CALL')).toBeDefined()
    expect(result.stateTransitions!.find((t: any) => t.type === 'SET_BLUEPRINT')).toBeDefined()
  })

  it('resolves via evidence + LLM when no cache', async () => {
    (db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([])

    const tool = getToolRegistry().find(t => t.name === 'resolve_call')!
    const result = await tool.execute({ callId: 'PNRR-C11', callTitle: 'Green Energy', program: 'PNRR' }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.stateTransitions).toBeDefined()
    expect(result.stateTransitions!.find((t: any) => t.type === 'SET_OUTLINE')).toBeDefined()
  })
})
