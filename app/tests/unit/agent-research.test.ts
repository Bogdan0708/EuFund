import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

const baseCtx: WorkflowContext = {
  sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 4,
  enhancedIdea: { originalIdea: 'solar panels for schools', refinedDescription: 'Install solar panels on rural schools', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['reduce energy costs', 'green transition'] },
  matchedCalls: [{ callId: 'call-1', title: 'PNRR 4.2', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
  selectedCallId: null, callBlueprint: null, actionPlan: null, projectSections: null, uploadedFiles: [],
}

describe('Research Agent', () => {
  it('returns research results with parsed JSON', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const researchPayload = {
      requirements: ['Legal entity registration', 'Min 2 years active'],
      forms: [{ name: 'F1 Application', url: 'https://example.com/f1', description: 'Main application form' }],
      certificates: [{ name: 'Fiscal certificate', source: 'ANAF', estimatedTime: '5 days' }],
      deadlines: [{ item: 'Submission deadline', date: '2026-06-30' }],
      additionalSections: ['Environmental Impact'],
      rawFindings: 'Full research notes here',
    }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: JSON.stringify(researchPayload), tokensUsed: 800 }),
      embed: vi.fn(),
    }
    const { researchAgent } = await import('@/lib/ai/orchestrator/agents/research')
    const result = await researchAgent(baseCtx, '', mockStream, mockGateway)
    expect(result.data.researchResults).toBeDefined()
    expect(result.checkpoint).toBeNull()
    expect(result.tokensUsed).toBe(800)
    const res = result.data.researchResults as { requirements: string[]; forms: unknown[] }
    expect(res.requirements).toHaveLength(2)
    expect(res.forms).toHaveLength(1)
  })

  it('falls back gracefully when AI response is not valid JSON', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: 'Raw text findings instead of JSON', tokensUsed: 300 }),
      embed: vi.fn(),
    }
    const { researchAgent } = await import('@/lib/ai/orchestrator/agents/research')
    const result = await researchAgent(baseCtx, '', mockStream, mockGateway)
    const res = result.data.researchResults as { requirements: string[]; rawFindings: string }
    expect(res.requirements).toEqual([])
    expect(res.rawFindings).toBe('Raw text findings instead of JSON')
  })

  it('throws when no matched calls', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const ctx: WorkflowContext = { ...baseCtx, matchedCalls: null }
    const { researchAgent } = await import('@/lib/ai/orchestrator/agents/research')
    await expect(researchAgent(ctx, '', mockStream, mockGateway)).rejects.toThrow('No matched calls for research')
  })

  it('sends step_progress and ai_chunk events', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({ requirements: ['req1'], forms: [], certificates: [], deadlines: [], additionalSections: [], rawFindings: '' }),
        tokensUsed: 100,
      }),
      embed: vi.fn(),
    }
    const { researchAgent } = await import('@/lib/ai/orchestrator/agents/research')
    await researchAgent(baseCtx, '', mockStream, mockGateway)
    expect(mockStream.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'step_progress', step: 4 }))
    expect(mockStream.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'ai_chunk', step: 4 }))
  })
})
