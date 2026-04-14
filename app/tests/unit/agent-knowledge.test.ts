import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient, ResearchResult } from '@/lib/ai/orchestrator/types'

const mockResearch: ResearchResult = {
  callId: 'call-1',
  requirements: ['Legal entity', 'Min 2 years active'],
  forms: [{ name: 'F1', description: 'Main form' }],
  certificates: [{ name: 'Fiscal cert', source: 'ANAF', estimatedTime: '5 days' }],
  deadlines: [{ item: 'Submission', date: '2026-06-30' }],
  additionalSections: [],
  rawFindings: 'Detailed research findings about the funding call.',
}

const baseCtx: WorkflowContext = {
  sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 5,
  enhancedIdea: { originalIdea: 'test', refinedDescription: 'test', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['test'] },
  matchedCalls: [{ callId: 'call-1', title: 'PNRR 4.2', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
  validationResults: null, researchResults: mockResearch, actionPlan: null, projectSections: null, uploadedFiles: [],
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

  it('throws when no research results', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const ctx: WorkflowContext = { ...baseCtx, researchResults: null }
    const { knowledgeAgent } = await import('@/lib/ai/orchestrator/agents/knowledge')
    await expect(knowledgeAgent(ctx, '', mockStream, mockGateway)).rejects.toThrow('No research results to store')
  })

  it('uses rawFindings text for embedding', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn(),
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.5)),
    }
    const { knowledgeAgent } = await import('@/lib/ai/orchestrator/agents/knowledge')
    await knowledgeAgent(baseCtx, '', mockStream, mockGateway)
    expect(mockGateway.embed).toHaveBeenCalledWith(expect.stringContaining('Detailed research findings'))
  })
})
