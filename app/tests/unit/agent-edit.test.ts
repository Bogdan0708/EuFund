import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient } from '@/lib/ai/orchestrator/types'

describe('Edit Agent', () => {
  it('regenerates a single section when requested', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify([{ title: 'Summary', content: 'Updated summary', order: 1, source: 'edited' }]),
        tokensUsed: 300,
      }),
      embed: vi.fn(),
    }
    const ctx: WorkflowContext = {
      sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'plus', step: 7,
      enhancedIdea: null, matchedCalls: null, validationResults: null, researchResults: null, actionPlan: null,
      projectSections: [
        { title: 'Summary', content: 'Original summary', order: 1, source: 'generated' },
        { title: 'Context', content: 'Original context', order: 2, source: 'generated' },
      ],
      selectedCallId: null, uploadedFiles: [],
    }
    const { editAgent } = await import('@/lib/ai/orchestrator/agents/edit')
    const result = await editAgent(ctx, 'Make the summary more detailed', mockStream, mockGateway)
    const sections = result.data.projectSections as any[]
    expect(sections[0].source).toBe('edited')
    expect(sections[1].source).toBe('generated') // unchanged
  })
})
