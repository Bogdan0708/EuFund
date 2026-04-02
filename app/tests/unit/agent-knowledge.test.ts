import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient, CallBlueprint } from '@/lib/ai/orchestrator/types'

const mockBlueprint: CallBlueprint = {
  callId: 'call-1',
  program: 'PNRR',
  isOpen: true,
  amendments: [],
  warnings: [],
  requiredSections: [{ title: 'Summary', description: 'Project summary' }],
  mandatoryAnnexes: [],
  eligibilityCriteria: ['Legal entity', 'Min 2 years active'],
  evaluationGrid: [],
  cofinancingRate: 0.85,
  eligibilityResult: { score: 90, passCount: 3, failCount: 0, failures: [], warnings: [] },
  sources: [],
  verifiedAt: '2026-04-02T00:00:00Z',
  raw: { notebookLmResponse: 'Detailed research findings about the funding call.', perplexityResponse: '', retrievedAt: '2026-04-02T00:00:00Z' },
  normalized: { requiredSections: [], mandatoryAnnexes: [], eligibilityCriteria: [], evaluationGrid: [], cofinancingRate: 0.85 },
  structureConfidence: 0.9,
}

const baseCtx: WorkflowContext = {
  sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 5,
  enhancedIdea: { originalIdea: 'test', refinedDescription: 'test', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['test'] },
  matchedCalls: [{ callId: 'call-1', title: 'PNRR 4.2', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
  selectedCallId: null, callBlueprint: mockBlueprint, actionPlan: null, projectSections: null, uploadedFiles: [],
}

describe('Knowledge Agent', () => {
  it('stores research and returns embedding dimensions', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockEmbedding = new Array(1536).fill(0.1)
    const mockGateway: GatewayClient = {
      generate: vi.fn(),
      embed: vi.fn().mockResolvedValue(mockEmbedding),
    }
    const { knowledgeAgent } = await import('@/lib/ai/orchestrator/agents/knowledge')
    const result = await knowledgeAgent(baseCtx, '', mockStream, mockGateway)
    expect(result.data.knowledgeStored).toBe(true)
    expect(result.data.embeddingDimensions).toBe(1536)
    expect(result.checkpoint).toBeNull()
  })

  it('falls back gracefully when embedding fails', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn(),
      embed: vi.fn().mockRejectedValue(new Error('Embedding service unavailable')),
    }
    const { knowledgeAgent } = await import('@/lib/ai/orchestrator/agents/knowledge')
    const result = await knowledgeAgent(baseCtx, '', mockStream, mockGateway)
    expect(result.data.knowledgeStored).toBe(false)
    expect(result.checkpoint).toBeNull()
  })

  it('throws when no call blueprint', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const ctx: WorkflowContext = { ...baseCtx, callBlueprint: null }
    const { knowledgeAgent } = await import('@/lib/ai/orchestrator/agents/knowledge')
    await expect(knowledgeAgent(ctx, '', mockStream, mockGateway)).rejects.toThrow()
  })

  it('uses rawFindings text for embedding', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn(),
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.5)),
    }
    const { knowledgeAgent } = await import('@/lib/ai/orchestrator/agents/knowledge')
    await knowledgeAgent(baseCtx, '', mockStream, mockGateway)
    expect(mockGateway.embed).toHaveBeenCalledWith(expect.stringContaining('Detailed research findings about the funding call.'))
  })
})
