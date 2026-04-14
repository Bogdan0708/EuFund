import { describe, it, expect, vi } from 'vitest'
import type { WorkflowContext, SSEStream, GatewayClient, SectionResult } from '@/lib/ai/agent/types'
import { DEFAULT_SECTIONS } from '@/lib/ai/agent/section-specs'

const baseCtx: WorkflowContext = {
  sessionId: 'test', userId: 'user-1', locale: 'ro', tier: 'free', step: 5,
  enhancedIdea: { originalIdea: 'solar', refinedDescription: 'Solar panels on schools', sector: 'Energy', region: 'Nord-Est', targetGroup: 'Schools', estimatedBudget: '500000', keyObjectives: ['green'] },
  matchedCalls: [{ callId: 'c1', title: 'PNRR', program: 'PNRR', score: 90, thematicFit: 90, eligibilityFit: 90, budgetFit: 90, deadline: '2026-06-30', sourceUrl: 'https://example.com', reasoning: 'test' }],
  selectedCallId: 'c1',
  callBlueprint: null,
  actionPlan: {
    matchedCall: { title: 'PNRR', program: 'PNRR', deadline: '2026-06-30', budget: { min: 100000, max: 5000000, currency: 'EUR' }, sourceUrl: '' },
    steps: [{ order: 1, title: 'Write', description: 'Write it', category: 'writing', dependencies: [] }],
    requiredDocuments: [], estimatedTimeline: '8 weeks',
  },
  projectSections: null, uploadedFiles: [],
}

describe('Build Agent V2', () => {
  it('generates one section per call using default specs', async () => {
    let callCount = 0
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockImplementation(() => {
        callCount++
        return Promise.resolve({
          content: JSON.stringify({ title: `Section ${callCount}`, content: 'x'.repeat(300), order: callCount }),
          tokensUsed: 1000,
        })
      }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    const result = await buildAgent(baseCtx, '', mockStream, mockGateway)
    const sections = result.data.projectSections as SectionResult[]
    expect(sections.length).toBe(DEFAULT_SECTIONS.length)
    expect(callCount).toBe(DEFAULT_SECTIONS.length)
    expect(sections[0].metadata).toBeDefined()
  })

  it('routes heavy sections to opus and light to gpt', async () => {
    const calls: { provider: string; model: string }[] = []
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockImplementation((opts) => {
        calls.push({ provider: opts.provider, model: opts.model })
        return Promise.resolve({ content: JSON.stringify({ title: 'T', content: 'x'.repeat(300), order: 1 }), tokensUsed: 1000 })
      }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    await buildAgent(baseCtx, '', mockStream, mockGateway)
    // Heavy sections → critical tier (opus), light → standard tier (sonnet)
    expect(calls.some(c => c.model === 'claude-opus-4-6')).toBe(true)
    expect(calls.some(c => c.model === 'claude-sonnet-4-6')).toBe(true)
  })

  it('continues on section failure with placeholder', async () => {
    // Section 3 (index 2): primary call fails, fallback also fails → section becomes 'failed'
    // Calls 3 and 4 correspond to primary + fallback for section 3
    let callCount = 0
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = {
      generate: vi.fn().mockImplementation(() => {
        callCount++
        // Calls 3 and 4 are primary + fallback for section 3 — both fail
        if (callCount === 3 || callCount === 4) throw new Error('Model failed')
        return Promise.resolve({ content: JSON.stringify({ title: `S${callCount}`, content: 'x'.repeat(300), order: callCount }), tokensUsed: 1000 })
      }),
      embed: vi.fn(),
    }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    const result = await buildAgent(baseCtx, '', mockStream, mockGateway)
    const sections = result.data.projectSections as SectionResult[]
    expect(sections.some(s => s.source === 'failed')).toBe(true)
    expect(sections.length).toBe(DEFAULT_SECTIONS.length)
  })

  it('throws when actionPlan or enhancedIdea missing', async () => {
    const mockStream: SSEStream = { send: vi.fn(), close: vi.fn() }
    const mockGateway: GatewayClient = { generate: vi.fn(), embed: vi.fn() }
    const { buildAgent } = await import('@/lib/ai/orchestrator/agents/build')
    await expect(buildAgent({ ...baseCtx, actionPlan: null }, '', mockStream, mockGateway)).rejects.toThrow()
    await expect(buildAgent({ ...baseCtx, enhancedIdea: null }, '', mockStream, mockGateway)).rejects.toThrow()
  })
})
