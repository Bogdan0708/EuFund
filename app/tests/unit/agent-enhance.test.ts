import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

describe('Enhance Agent', () => {
  it('returns enhanced idea with required fields', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          refinedDescription: 'A solar panel installation project for rural schools',
          sector: 'Energy',
          region: 'Nord-Est',
          targetGroup: 'Rural schools',
          estimatedBudget: '500000 EUR',
          keyObjectives: ['Install solar panels', 'Reduce energy costs'],
        }),
        tokensUsed: 500,
      }),
      embed: vi.fn(),
    }

    const ctx: WorkflowContext = {
      sessionId: 'test',
      userId: 'user-1',
      locale: 'ro',
      tier: 'plus',
      step: 1,
      enhancedIdea: null,
      matchedCalls: null,
      validationResults: null,
      researchResults: null,
      actionPlan: null,
      projectSections: null,
      selectedCallId: null, uploadedFiles: [],
    }

    const { enhanceAgent } = await import('@/lib/ai/orchestrator/agents/enhance')
    const result = await enhanceAgent(ctx, 'I want to install solar panels on schools', mockStream, mockGateway)

    expect(result.data.enhancedIdea).toBeDefined()
    expect((result.data.enhancedIdea as any).refinedDescription).toContain('solar')
    expect(result.checkpoint).toBeNull()
  })
})
