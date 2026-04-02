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
      enhancedIdea: null, matchedCalls: null, selectedCallId: null, callBlueprint: null, actionPlan: null,
      projectSections: [
        { id: 'sec-1', title: 'Summary', content: 'Original summary', order: 1, source: 'generated', metadata: { model: 'gpt-4o', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-02T00:00:00Z', checksum: 'abc' } },
        { id: 'sec-2', title: 'Context', content: 'Original context', order: 2, source: 'generated', metadata: { model: 'gpt-4o', provider: 'openai', tokensIn: 100, tokensOut: 200, latencyMs: 500, retryCount: 0, fallbackUsed: false, generatedAt: '2026-04-02T00:00:00Z', checksum: 'def' } },
      ],
      uploadedFiles: [],
    }
    const { editAgent } = await import('@/lib/ai/orchestrator/agents/edit')
    const result = await editAgent(ctx, 'Make the summary more detailed', mockStream, mockGateway)
    const sections = result.data.projectSections as any[]
    expect(sections[0].source).toBe('edited')
    expect(sections[1].source).toBe('generated') // unchanged
  })
})
