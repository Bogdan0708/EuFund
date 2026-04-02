import { describe, it, expect } from 'vitest'
import type { WorkflowContext, AgentResult, SSEEvent, AgentFn } from '@/lib/ai/orchestrator/types'

describe('Orchestrator types', () => {
  it('WorkflowContext has required fields', () => {
    const ctx: WorkflowContext = {
      sessionId: '123',
      userId: '456',
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
    expect(ctx.sessionId).toBe('123')
  })

  it('AgentFn type is callable', () => {
    const fn: AgentFn = async (ctx, input, stream, gateway) => ({
      data: {},
      checkpoint: null,
    })
    expect(typeof fn).toBe('function')
  })
})
