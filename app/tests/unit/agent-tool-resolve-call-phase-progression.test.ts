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
      { id: 'c1', content: 'Section guidance', score: 0.9, metadata: { documentType: 'ghid', source: 'guide.pdf', callId: 'PNRR-C11' } },
    ]),
  })),
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: JSON.stringify([
      { id: 'context', title: 'Context', description: 'desc', order: 1, generationOrder: 1, importance: 'critical', expectedLength: 'long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 0.9 },
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
import { getToolRegistry, getToolsForPhase } from '@/lib/ai/agent/tools/registry'

interface StateTransitionLike {
  type: string
  phase?: string
  outline?: unknown[]
}

const mockCtx = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  session: {} as never,
  sections: [],
  stateVersion: 0,
  requestId: 'req-1',
  locale: 'ro' as const,
}

describe('V3 phase progression: resolve_call', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('cache hit with non-empty requiredSections advances to structuring with outline', async () => {
    (db.select().from({} as never).where({} as never).limit as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([{
      callId: 'PNRR-C11',
      program: 'PNRR',
      callTitle: 'Test',
      normalized: {
        requiredSections: [
          { title: 'Context', description: 'desc', order: 1 },
          { title: 'Objectives', description: 'desc', order: 2 },
        ],
      },
      status: 'primed',
      structureConfidence: 0.8,
      freshnessConfidence: 0.7,
      sourceDocs: [],
      contentExtractedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }])

    const tool = getToolRegistry().find(t => t.name === 'resolve_call')!
    const result = await tool.execute({ callId: 'PNRR-C11' }, mockCtx)

    expect(result.success).toBe(true)
    const transitions = (result.stateTransitions ?? []) as StateTransitionLike[]
    const phaseT = transitions.find(t => t.type === 'SET_PHASE')
    const outlineT = transitions.find(t => t.type === 'SET_OUTLINE')

    expect(phaseT?.phase).toBe('structuring')
    expect(outlineT).toBeDefined()
    expect(outlineT?.outline).toHaveLength(2)
  })

  it('cache hit with empty requiredSections stays in research', async () => {
    (db.select().from({} as never).where({} as never).limit as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([{
      callId: 'PNRR-C11',
      program: 'PNRR',
      callTitle: 'Test',
      normalized: { requiredSections: [] },
      status: 'primed',
      structureConfidence: 0.8,
      freshnessConfidence: 0.7,
      sourceDocs: [],
      contentExtractedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }])

    const tool = getToolRegistry().find(t => t.name === 'resolve_call')!
    const result = await tool.execute({ callId: 'PNRR-C11' }, mockCtx)

    expect(result.success).toBe(true)
    const transitions = (result.stateTransitions ?? []) as StateTransitionLike[]
    const phaseT = transitions.find(t => t.type === 'SET_PHASE')
    const outlineT = transitions.find(t => t.type === 'SET_OUTLINE')

    expect(phaseT?.phase).toBe('research')
    expect(outlineT).toBeUndefined()
  })

  it('cache miss with extracted outline advances to structuring', async () => {
    (db.select().from({} as never).where({} as never).limit as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([])

    const tool = getToolRegistry().find(t => t.name === 'resolve_call')!
    const result = await tool.execute({ callId: 'PNRR-C11', callTitle: 'Green Energy', program: 'PNRR' }, mockCtx)

    expect(result.success).toBe(true)
    const transitions = (result.stateTransitions ?? []) as StateTransitionLike[]
    const phaseT = transitions.find(t => t.type === 'SET_PHASE')
    const outlineT = transitions.find(t => t.type === 'SET_OUTLINE')

    expect(phaseT?.phase).toBe('structuring')
    expect(outlineT).toBeDefined()
  })
})

describe('V3 phase progression: tool registry', () => {
  it('extract_structure is available in research phase (safety net for empty-cache hits)', async () => {
    await import('@/lib/ai/agent/tools/extract-structure')
    const tools = getToolsForPhase('research')
    expect(tools.find(t => t.name === 'extract_structure')).toBeDefined()
  })

  it('extract_structure remains available in structuring phase', async () => {
    await import('@/lib/ai/agent/tools/extract-structure')
    const tools = getToolsForPhase('structuring')
    expect(tools.find(t => t.name === 'extract_structure')).toBeDefined()
  })
})
