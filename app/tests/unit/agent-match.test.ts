import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

vi.mock('@/lib/rag/pipeline', () => ({
  hybridSearch: vi.fn().mockResolvedValue([
    { content: 'PNRR Call 4.2 - Green Energy for public buildings', metadata: { program: 'PNRR', sourceId: 'call-1' }, score: 0.9 },
    { content: 'PEO Call 2.1 - Education infrastructure', metadata: { program: 'PEO', sourceId: 'call-2' }, score: 0.6 },
  ]),
}))

describe('Match Agent', () => {
  it('returns matched calls with scores', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify([
          { callId: 'call-1', title: 'PNRR Call 4.2', program: 'PNRR', score: 92, thematicFit: 95, eligibilityFit: 88, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'Strong match for green energy' },
        ]),
        tokensUsed: 800,
      }),
      embed: vi.fn(),
    }

    const ctx: WorkflowContext = {
      sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 2,
      enhancedIdea: { originalIdea: 'solar panels', refinedDescription: 'Solar panels for schools', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000 EUR', keyObjectives: ['Install panels'] },
      matchedCalls: null, validationResults: null, researchResults: null, actionPlan: null, projectSections: null, selectedCallId: null, uploadedFiles: [],
    }

    const { matchAgent } = await import('@/lib/ai/orchestrator/agents/match')
    const result = await matchAgent(ctx, '', mockStream, mockGateway)

    expect(result.data.matchedCalls).toBeDefined()
    expect((result.data.matchedCalls as any[]).length).toBeGreaterThan(0)
    expect(result.checkpoint).not.toBeNull()
  })
})
