import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

// Mock DB — no actual database calls
vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]) // No cache hit
        })
      })
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined)
      })
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      })
    }),
  }
}))

vi.mock('@/lib/db/schema', () => ({
  callKnowledge: { callId: 'call_id' }
}))

const baseCtx: WorkflowContext = {
  sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'free', step: 3,
  enhancedIdea: { originalIdea: 'solar', refinedDescription: 'Solar panels on schools', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['green'] },
  matchedCalls: [{ callId: 'PNRR-C11', title: 'PNRR Tourism', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
  selectedCallId: 'PNRR-C11',
  callBlueprint: null, actionPlan: null, projectSections: null, uploadedFiles: [],
}

describe('Research Agent V2', () => {
  it('produces a CallBlueprint with structureConfidence', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          requiredSections: [
            { title: 'Rezumat', description: 'Summary' },
            { title: 'Context', description: 'Background' },
            { title: 'Obiective', description: 'Goals' },
            { title: 'Metodologie', description: 'Method' },
            { title: 'Buget', description: 'Budget' },
          ],
          mandatoryAnnexes: ['Certificat fiscal', 'Statut ONG'],
          eligibilityCriteria: ['SRL', 'ONG', 'UAT'],
          evaluationGrid: [
            { criterion: 'Relevanta', maxPoints: 20 },
            { criterion: 'Metodologie', maxPoints: 30 },
            { criterion: 'Buget', maxPoints: 25 },
          ],
          cofinancingRate: 0.02,
          isOpen: true,
          amendments: [],
          warnings: [],
        }),
        tokensUsed: 500,
      }),
      embed: vi.fn(),
    }

    const { researchAgent } = await import('@/lib/ai/orchestrator/agents/research')
    const result = await researchAgent(baseCtx, 'PNRR-C11', mockStream, mockGateway)
    const blueprint = result.data.callBlueprint as Record<string, unknown>

    expect(blueprint).toBeDefined()
    expect(blueprint.callId).toBe('PNRR-C11')
    expect(blueprint.structureConfidence).toBeGreaterThan(0.5)
    expect(blueprint.isOpen).toBe(true)
    expect(result.checkpoint).toBeNull()
  })

  it('throws when no matched calls', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const { researchAgent } = await import('@/lib/ai/orchestrator/agents/research')
    await expect(researchAgent({ ...baseCtx, matchedCalls: null }, '', mockStream, mockGateway)).rejects.toThrow()
  })

  it('uses selectedCallId when available', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({ requiredSections: [], mandatoryAnnexes: [], eligibilityCriteria: [], evaluationGrid: [], cofinancingRate: 0, isOpen: true, amendments: [], warnings: [] }),
        tokensUsed: 100,
      }),
      embed: vi.fn(),
    }
    const { researchAgent } = await import('@/lib/ai/orchestrator/agents/research')
    const result = await researchAgent(baseCtx, '', mockStream, mockGateway)
    expect((result.data.callBlueprint as Record<string, unknown>).callId).toBe('PNRR-C11')
  })
})
