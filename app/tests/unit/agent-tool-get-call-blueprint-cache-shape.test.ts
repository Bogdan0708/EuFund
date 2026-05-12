// Regression: get_call_blueprint used to have its own partial-cast hydration
// path, which diverged from buildBlueprintFromCache after PR5. The two cache
// readers now share the same materializer, so a row that already carries
// full SectionSpec fields surfaces them through either tool.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  callKnowledge: { callId: 'call_id' },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/vectors/store', () => ({
  getVectorStore: vi.fn(),
}))

import { db } from '@/lib/db'
import '@/lib/ai/agent/tools/get-call-blueprint'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'
import type { SectionSpec } from '@/lib/ai/agent/types'

const ctx = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  session: {} as never,
  sections: [],
  stateVersion: 0,
  requestId: 'req-1',
  locale: 'ro' as const,
}

describe('get_call_blueprint — cache shape parity with lookupBlueprint', () => {
  beforeEach(() => vi.clearAllMocks())

  it('hydrates full SectionSpec rows without overwriting LLM-derived fields', async () => {
    const fullSection: SectionSpec = {
      id: 'metodologia-de-implementare',
      title: 'Metodologia de implementare',
      description: 'd',
      order: 2,
      generationOrder: 4,
      importance: 'critical',
      expectedLength: 'long',
      dependsOn: ['context-si-justificare'],
      modelHint: 'heavy',
      evaluationWeight: 25,
      mandatory: true,
      confidence: 0.93,
    }

    ;(db.select().from({} as never).where({} as never).limit as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([{
      callId: 'CALL-1',
      program: 'PNRR',
      callTitle: 'T',
      normalized: { requiredSections: [fullSection] },
      status: 'primed',
      structureConfidence: 0.7,
      freshnessConfidence: 0.7,
      sourceDocs: [],
      contentExtractedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    }])

    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    const result = await tool.execute({ callId: 'CALL-1' }, ctx)

    expect(result.success).toBe(true)
    const sections = (result.data as { normalized: { requiredSections: SectionSpec[] } }).normalized.requiredSections
    expect(sections[0]).toEqual(fullSection)
  })

  it('synthesizes defaults for partial cached rows (matches lookupBlueprint behavior)', async () => {
    ;(db.select().from({} as never).where({} as never).limit as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([{
      callId: 'CALL-2',
      program: 'PNRR',
      callTitle: 'T',
      normalized: {
        requiredSections: [{ title: 'Buget', description: 'd', evaluationWeight: 15 }],
      },
      status: 'primed',
      structureConfidence: 0.8,
      freshnessConfidence: 0.8,
      sourceDocs: [],
      contentExtractedAt: new Date('2026-05-01T00:00:00Z'),
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    }])

    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    const result = await tool.execute({ callId: 'CALL-2' }, ctx)

    const sections = (result.data as { normalized: { requiredSections: SectionSpec[] } }).normalized.requiredSections
    expect(sections[0].id).toBe('buget')
    expect(sections[0].order).toBe(1)
    expect(sections[0].modelHint).toBe('heavy')
  })
})
