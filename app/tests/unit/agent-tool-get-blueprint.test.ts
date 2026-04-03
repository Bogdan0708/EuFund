import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DB before importing tool
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { db } from '@/lib/db'
import '@/lib/ai/agent/tools/get-call-blueprint'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('get_call_blueprint tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: {} as any,
    sections: [],
    stateVersion: 0,
    requestId: 'req-1',
    locale: 'ro' as const,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is registered in the tool registry', () => {
    const tools = getToolRegistry()
    expect(tools.find(t => t.name === 'get_call_blueprint')).toBeDefined()
  })

  it('returns null when no cached data exists', async () => {
    (db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([])

    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    const result = await tool.execute({ callId: 'UNKNOWN-123' }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.data).toBeNull()
  })

  it('returns blueprint from cached call_knowledge row', async () => {
    (db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([{
      callId: 'PNRR-C11',
      program: 'PNRR',
      callTitle: 'Green Energy',
      normalized: {
        requiredSections: [{ title: 'Context', description: 'Describe context' }],
        mandatoryAnnexes: ['Anexa 1'],
        eligibilityCriteria: ['Must be SME'],
        evaluationGrid: [{ criterion: 'Relevance', maxPoints: 30 }],
        cofinancingRate: 0.85,
      },
      status: 'primed',
      structureConfidence: 0.8,
      freshnessConfidence: 0.7,
      sourceDocs: ['doc-1'],
      contentExtractedAt: new Date('2026-03-01'),
      createdAt: new Date(),
      updatedAt: new Date(),
    }])

    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    const result = await tool.execute({ callId: 'PNRR-C11' }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.data).toBeTruthy()
    expect(result.data!.callId).toBe('PNRR-C11')
    expect(result.data!.program).toBe('PNRR')
    expect(result.data!.structureConfidence).toBe(0.8)
    expect(result.data!.cofinancingRate).toBe(0.85)
  })

  it('returns error result on DB failure', async () => {
    (db.select().from({} as any).where({} as any).limit as any).mockRejectedValue(new Error('DB connection timeout'))

    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    const result = await tool.execute({ callId: 'PNRR-C11' }, mockCtx)

    expect(result.success).toBe(false)
    expect(result.error).toBe('DB connection timeout')
    expect(result.retryable).toBe(true)
  })

  it('includes telemetry with latency', async () => {
    (db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([])

    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    const result = await tool.execute({ callId: 'TEST-1' }, mockCtx)

    expect(result.telemetry).toBeDefined()
    expect(result.telemetry.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('has read category', () => {
    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    expect(tool.category).toBe('read')
  })

  it('populates blueprint fields from normalized data', async () => {
    (db.select().from({} as any).where({} as any).limit as any).mockResolvedValue([{
      callId: 'PEO-001',
      program: 'PEO',
      callTitle: 'Digital Romania',
      normalized: {
        requiredSections: [
          { title: 'Project Description', description: 'Describe the project' },
          { title: 'Budget', description: 'Itemize the budget' },
        ],
        mandatoryAnnexes: ['Annexa 1', 'Annexa 2'],
        eligibilityCriteria: ['NGO only', 'Romania-based'],
        evaluationGrid: [
          { criterion: 'Impact', maxPoints: 40 },
          { criterion: 'Feasibility', maxPoints: 30 },
        ],
        cofinancingRate: 0.9,
      },
      status: 'verified',
      structureConfidence: 0.95,
      freshnessConfidence: 0.9,
      sourceDocs: ['doc-a', 'doc-b'],
      contentExtractedAt: new Date('2026-02-15'),
      createdAt: new Date(),
      updatedAt: new Date(),
    }])

    const tool = getToolRegistry().find(t => t.name === 'get_call_blueprint')!
    const result = await tool.execute({ callId: 'PEO-001' }, mockCtx)

    expect(result.success).toBe(true)
    const bp = result.data!
    expect(bp.requiredSections).toHaveLength(2)
    expect(bp.mandatoryAnnexes).toEqual(['Annexa 1', 'Annexa 2'])
    expect(bp.eligibilityCriteria).toEqual(['NGO only', 'Romania-based'])
    expect(bp.evaluationGrid).toHaveLength(2)
    expect(bp.sources).toEqual(['doc-a', 'doc-b'])
    expect(bp.verifiedAt).toBe('2026-02-15T00:00:00.000Z')
  })
})
