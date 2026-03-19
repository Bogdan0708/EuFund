import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient, ActionPlan, ProjectSection } from '@/lib/ai/orchestrator/types'

const mockActionPlan: ActionPlan = {
  matchedCall: { title: 'PNRR 4.2', program: 'PNRR', deadline: '2026-06-30', budget: { min: 100000, max: 5000000, currency: 'RON' }, sourceUrl: 'https://example.com' },
  steps: [{ order: 1, title: 'Gather documents', description: 'Collect all required docs', category: 'document', dependencies: [] }],
  requiredDocuments: [],
  estimatedTimeline: '8 weeks',
}

const mockSections: ProjectSection[] = [
  { title: 'Rezumat', content: 'Project summary content', order: 1, source: 'generated' },
  { title: 'Context și justificare', content: 'Context and justification content', order: 2, source: 'generated' },
]

const baseCtx: WorkflowContext = {
  sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 7,
  enhancedIdea: { originalIdea: 'solar panels', refinedDescription: 'Install solar panels on rural schools', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['reduce costs', 'green transition'] },
  matchedCalls: [{ callId: 'call-1', title: 'PNRR 4.2', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
  validationResults: null,
  researchResults: { callId: 'call-1', requirements: ['Legal entity'], forms: [], certificates: [], deadlines: [], additionalSections: [], rawFindings: 'research' },
  actionPlan: mockActionPlan, projectSections: null, uploadedFiles: [],
}

describe('Build Agent', () => {
  it('returns project sections and no checkpoint', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(mockSections), tokensUsed: 3000 }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    const result = await buildAgent(baseCtx, '', mockStream, mockGateway)
    expect(result.data.projectSections).toBeDefined()
    expect(result.checkpoint).toBeNull()
    expect(result.tokensUsed).toBe(3000)
    const sections = result.data.projectSections as ProjectSection[]
    expect(sections).toHaveLength(2)
    expect(sections[0].title).toBe('Rezumat')
  })

  it('streams each section as an ai_chunk event', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(mockSections), tokensUsed: 2000 }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    await buildAgent(baseCtx, '', mockStream, mockGateway)
    const aiChunkCalls = (mockStream.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === 'ai_chunk'
    )
    // One ai_chunk per section
    expect(aiChunkCalls).toHaveLength(2)
    expect(aiChunkCalls[0][0].content).toContain('Rezumat')
  })

  it('uses claude for pro tier users', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(mockSections), tokensUsed: 2000 }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    await buildAgent({ ...baseCtx, tier: 'pro' }, '', mockStream, mockGateway)
    expect(mockGateway.generate).toHaveBeenCalledWith(expect.objectContaining({ provider: 'claude', model: 'claude-sonnet-4-6' }))
  })

  it('uses gemini for free tier users', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(mockSections), tokensUsed: 1500 }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    await buildAgent({ ...baseCtx, tier: 'free' }, '', mockStream, mockGateway)
    expect(mockGateway.generate).toHaveBeenCalledWith(expect.objectContaining({ provider: 'gemini' }))
  })

  it('throws when AI response is not valid JSON', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: 'Not valid JSON', tokensUsed: 100 }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    await expect(buildAgent(baseCtx, '', mockStream, mockGateway)).rejects.toThrow('Failed to parse project sections from AI response')
  })

  it('throws when actionPlan or enhancedIdea are missing', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    await expect(buildAgent({ ...baseCtx, actionPlan: null }, '', mockStream, mockGateway)).rejects.toThrow()
    await expect(buildAgent({ ...baseCtx, enhancedIdea: null }, '', mockStream, mockGateway)).rejects.toThrow()
  })
})
