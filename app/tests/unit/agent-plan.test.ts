import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient, ResearchResult, ActionPlan } from '@/lib/ai/orchestrator/types'

const mockResearch: ResearchResult = {
  callId: 'call-1',
  requirements: ['Legal entity'],
  forms: [{ name: 'F1', description: 'Main form' }],
  certificates: [],
  deadlines: [{ item: 'Submission', date: '2026-06-30' }],
  additionalSections: [],
  rawFindings: 'Research findings.',
}

const mockActionPlan: ActionPlan = {
  matchedCall: { title: 'PNRR 4.2', program: 'PNRR', deadline: '2026-06-30', budget: { min: 100000, max: 5000000, currency: 'RON' }, sourceUrl: 'https://example.com' },
  steps: [
    { order: 1, title: 'Gather documents', description: 'Collect all required docs', category: 'document', dependencies: [] },
    { order: 2, title: 'Write proposal', description: 'Draft the project proposal', category: 'writing', dependencies: [1] },
  ],
  requiredDocuments: [{ name: 'Fiscal certificate', source: 'ANAF', estimatedTime: '5 days', mandatory: true }],
  estimatedTimeline: '8 weeks',
}

const baseCtx: WorkflowContext = {
  sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 6,
  enhancedIdea: { originalIdea: 'test', refinedDescription: 'Install solar panels', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['reduce costs'] },
  matchedCalls: [{ callId: 'call-1', title: 'PNRR 4.2', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
  validationResults: null, researchResults: mockResearch, actionPlan: null, projectSections: null, uploadedFiles: [],
}

describe('Plan Agent', () => {
  it('returns action plan and a confirm checkpoint', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(mockActionPlan), tokensUsed: 1200 }),
      embed: vi.fn(),
    }
    const { planAgent } = await import('@/lib/ai/orchestrator/agents/plan')
    const result = await planAgent(baseCtx, '', mockStream, mockGateway)
    expect(result.data.actionPlan).toBeDefined()
    expect(result.checkpoint).not.toBeNull()
    expect(result.checkpoint?.type).toBe('confirm')
    expect(result.tokensUsed).toBe(1200)
  })

  it('checkpoint question is in Romanian when locale is ro', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(mockActionPlan), tokensUsed: 500 }),
      embed: vi.fn(),
    }
    const { planAgent } = await import('@/lib/ai/orchestrator/agents/plan')
    const result = await planAgent({ ...baseCtx, locale: 'ro' }, '', mockStream, mockGateway)
    expect(result.checkpoint?.question).toContain('Ești de acord')
  })

  it('checkpoint question is in English when locale is en', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(mockActionPlan), tokensUsed: 500 }),
      embed: vi.fn(),
    }
    const { planAgent } = await import('@/lib/ai/orchestrator/agents/plan')
    const result = await planAgent({ ...baseCtx, locale: 'en' }, '', mockStream, mockGateway)
    expect(result.checkpoint?.question).toContain('Do you agree')
  })

  it('throws when AI response is not valid JSON', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: 'Invalid JSON response', tokensUsed: 100 }),
      embed: vi.fn(),
    }
    const { planAgent } = await import('@/lib/ai/orchestrator/agents/plan')
    await expect(planAgent(baseCtx, '', mockStream, mockGateway)).rejects.toThrow('Failed to parse action plan from AI response')
  })

  it('throws when matchedCalls or researchResults are missing', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const { planAgent } = await import('@/lib/ai/orchestrator/agents/plan')
    await expect(planAgent({ ...baseCtx, matchedCalls: null }, '', mockStream, mockGateway)).rejects.toThrow()
    await expect(planAgent({ ...baseCtx, researchResults: null }, '', mockStream, mockGateway)).rejects.toThrow()
  })
})
