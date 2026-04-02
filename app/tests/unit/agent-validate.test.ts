import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

describe('Validate Agent', () => {
  it('returns validation results', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({ isOpen: true, lastVerified: '2026-03-19', updates: [], warnings: [] }),
        tokensUsed: 200,
      }),
      embed: vi.fn(),
    }
    const ctx: WorkflowContext = {
      sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 3,
      enhancedIdea: { originalIdea: 'test', refinedDescription: 'test', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['test'] },
      matchedCalls: [{ callId: 'call-1', title: 'PNRR 4.2', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
      selectedCallId: null, callBlueprint: null, actionPlan: null, projectSections: null, uploadedFiles: [],
    }
    const { validateAgent } = await import('@/lib/ai/orchestrator/agents/validate')
    const result = await validateAgent(ctx, '', mockStream, mockGateway)
    expect(result.data.validationResults).toBeDefined()
    expect(result.checkpoint).toBeNull()
  })

  it('falls back gracefully when AI response is not valid JSON', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({ content: 'Not JSON', tokensUsed: 50 }),
      embed: vi.fn(),
    }
    const ctx: WorkflowContext = {
      sessionId: 'test', userId: 'user-1', locale: 'en', tier: 'free', step: 3,
      enhancedIdea: { originalIdea: 'test', refinedDescription: 'test', sector: 'Education', region: 'Sud', targetGroup: 'Students', estimatedBudget: '100000', keyObjectives: ['learn'] },
      matchedCalls: [{ callId: 'call-2', title: 'PEO 1.1', program: 'PEO', score: 80, thematicFit: 80, eligibilityFit: 80, budgetFit: 80, deadline: '2026-09-01', sourceUrl: 'https://example.com/peo', reasoning: 'good fit' }],
      selectedCallId: null, callBlueprint: null, actionPlan: null, projectSections: null, uploadedFiles: [],
    }
    const { validateAgent } = await import('@/lib/ai/orchestrator/agents/validate')
    const result = await validateAgent(ctx, '', mockStream, mockGateway)
    const results = result.data.validationResults as Array<{ callId: string; isOpen: boolean; warnings: string[] }>
    expect(results[0].isOpen).toBe(true)
    expect(results[0].warnings).toContain('Could not verify call status automatically')
  })

  it('selects call by input callId when provided', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({ isOpen: false, lastVerified: '2026-03-19', updates: ['Closed'], warnings: ['Deadline passed'] }),
        tokensUsed: 150,
      }),
      embed: vi.fn(),
    }
    const ctx: WorkflowContext = {
      sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'pro', step: 3,
      enhancedIdea: { originalIdea: 'test', refinedDescription: 'test', sector: 'Health', region: 'Vest', targetGroup: 'Hospitals', estimatedBudget: '2000000', keyObjectives: ['improve'] },
      matchedCalls: [
        { callId: 'call-1', title: 'PNRR 4.2', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' },
        { callId: 'call-2', title: 'PEO 2.3', program: 'PEO', score: 75, thematicFit: 75, eligibilityFit: 75, budgetFit: 75, deadline: '2025-12-01', sourceUrl: 'https://example.com/2', reasoning: 'ok fit' },
      ],
      selectedCallId: null, callBlueprint: null, actionPlan: null, projectSections: null, uploadedFiles: [],
    }
    const { validateAgent } = await import('@/lib/ai/orchestrator/agents/validate')
    const result = await validateAgent(ctx, 'call-2', mockStream, mockGateway)
    const results = result.data.validationResults as Array<{ callId: string }>
    expect(results[0].callId).toBe('call-2')
  })

  it('throws when no matched calls', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const ctx: WorkflowContext = {
      sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'free', step: 3,
      enhancedIdea: null, matchedCalls: null,
      selectedCallId: null, callBlueprint: null, actionPlan: null, projectSections: null, uploadedFiles: [],
    }
    const { validateAgent } = await import('@/lib/ai/orchestrator/agents/validate')
    await expect(validateAgent(ctx, '', mockStream, mockGateway)).rejects.toThrow('No matched calls to validate')
  })
})
