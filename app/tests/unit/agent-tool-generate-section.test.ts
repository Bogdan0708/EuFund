// app/tests/unit/agent-tool-generate-section.test.ts
import { describe, it, expect, vi } from 'vitest'

const isFeatureEnabledMock = vi.hoisted(() => vi.fn().mockResolvedValue(false))
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: 'Proiectul nostru vizează tranziția verde prin implementarea unui sistem de panouri solare în comuna X, cu un buget estimat de 500.000 EUR și o durată de 24 de luni.',
    tokensUsed: { input: 800, output: 400 },
    model: 'claude-opus-4-6',
    provider: 'anthropic',
  }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

vi.mock('@/lib/ai/knowledge/proposal-patterns', () => ({
  findPatterns: vi.fn().mockResolvedValue([
    {
      id: 'pp-1', program: 'PNRR', sectionType: 'context', title: 'Strong context',
      contentMd: 'A'.repeat(3000), // Longer than 1500 char budget
      timesUsed: 10, timesAccepted: 8, avgRegenCount: 0.5,
    },
  ]),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({
  getSessionKnowledgeByKind: vi.fn().mockResolvedValue([
    { id: 'sk-1', kind: 'brief', contentMd: 'B'.repeat(2000), title: 'Brief' }, // Longer than 800 char budget
  ]),
}))

import '@/lib/ai/agent/tools/generate-section'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('generate_section tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: {
      outline: [
        { id: 'context', title: 'Context și justificare', description: 'Describe context', order: 1, generationOrder: 1, importance: 'critical', expectedLength: 'long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 1 },
        { id: 'buget', title: 'Buget', description: 'Budget plan', order: 7, generationOrder: 7, importance: 'critical', expectedLength: 'long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 1 },
      ],
      outlineFrozen: true, // Required for generate_section (V3 guard)
      blueprint: { program: 'PNRR', cofinancingRate: 0.85 },
      planningArtifact: { projectSummary: 'Green energy project' },
    } as any,
    sections: [],
    stateVersion: 0,
    requestId: 'req-1',
    locale: 'ro' as const,
  }

  it('is registered (replaces placeholder)', () => {
    const tool = getToolRegistry().find(t => t.name === 'generate_section')
    expect(tool).toBeDefined()
    expect(tool!.category).toBe('generation')
  })

  it('generates section and returns UPSERT_SECTION_DRAFT', async () => {
    const tool = getToolRegistry().find(t => t.name === 'generate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.stateTransitions).toBeDefined()
    expect(result.stateTransitions![0].type).toBe('UPSERT_SECTION_DRAFT')
    expect((result.stateTransitions![0] as any).sectionKey).toBe('context')
  })

  it('fails when section not in outline', async () => {
    const tool = getToolRegistry().find(t => t.name === 'generate_section')!
    const result = await tool.execute({ sectionKey: 'nonexistent' }, mockCtx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found in outline')
  })

  it('includes model telemetry', async () => {
    const tool = getToolRegistry().find(t => t.name === 'generate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, mockCtx)

    expect(result.telemetry.model).toBeDefined()
    expect(result.telemetry.provider).toBe('anthropic')
  })

  it('routes critical-importance sections to Sonnet when interactive_section_sonnet_default is on', async () => {
    // Regression: prod was burning Opus on every critical section even
    // though the SSE turn is 270s-bounded. With the flag on, the resolver
    // must downgrade to Sonnet regardless of importance.
    isFeatureEnabledMock.mockImplementation(async (key: string) =>
      key === 'interactive_section_sonnet_default',
    )
    const { generate } = await import('@/lib/ai/providers/router')
    ;(generate as any).mockClear()

    const tool = getToolRegistry().find(t => t.name === 'generate_section')!
    await tool.execute({ sectionKey: 'context' }, mockCtx)

    const call = (generate as any).mock.calls.at(-1)[0]
    expect(call.model).toBe('claude-sonnet-4-6')
    expect(call.provider).toBe('anthropic')
    // maxTokens for a 'long' section under new caps
    expect(call.maxTokens).toBe(12_000)

    isFeatureEnabledMock.mockResolvedValue(false)
  })

  it('keeps Opus for critical-importance when interactive flag is OFF (legacy back-compat)', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    const { generate } = await import('@/lib/ai/providers/router')
    ;(generate as any).mockClear()

    const tool = getToolRegistry().find(t => t.name === 'generate_section')!
    await tool.execute({ sectionKey: 'context' }, mockCtx)

    const call = (generate as any).mock.calls.at(-1)[0]
    expect(call.model).toBe('claude-opus-4-6')
  })

  it('uses extra_long token cap only when section_extra_long_enabled is on', async () => {
    const ctxWithExtraLong = {
      ...mockCtx,
      session: {
        ...mockCtx.session,
        outline: [
          { id: 'ctx', title: 'Context', description: 'x', order: 1, generationOrder: 1, importance: 'critical', expectedLength: 'extra_long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 1 },
        ],
        outlineFrozen: true,
      } as any,
    }
    const { generate } = await import('@/lib/ai/providers/router')

    // Flag OFF: extra_long falls back to long (12k)
    isFeatureEnabledMock.mockResolvedValue(false)
    ;(generate as any).mockClear()
    await getToolRegistry().find(t => t.name === 'generate_section')!.execute({ sectionKey: 'ctx' }, ctxWithExtraLong)
    expect((generate as any).mock.calls.at(-1)[0].maxTokens).toBe(12_000)

    // Flag ON for the extra_long flag specifically: 20k
    isFeatureEnabledMock.mockImplementation(async (key: string) =>
      key === 'section_extra_long_enabled',
    )
    ;(generate as any).mockClear()
    await getToolRegistry().find(t => t.name === 'generate_section')!.execute({ sectionKey: 'ctx' }, ctxWithExtraLong)
    expect((generate as any).mock.calls.at(-1)[0].maxTokens).toBe(20_000)

    isFeatureEnabledMock.mockResolvedValue(false)
  })

  it('injects pattern and brief with total knowledge context under 2500 chars', async () => {
    const { findPatterns } = await import('@/lib/ai/knowledge/proposal-patterns')
    const { generate } = await import('@/lib/ai/providers/router')
    const tool = getToolRegistry().find(t => t.name === 'generate_section')!

    await tool.execute({ sectionKey: 'context' }, mockCtx)

    const call = (generate as any).mock.calls.at(-1)[0]
    const system: string = call.system

    // Both injected
    expect(system).toContain('REFERENCE PATTERN')
    expect(system).toContain('PROJECT BRIEF')
    expect(findPatterns).toHaveBeenCalledWith('PNRR', 'context')

    // Extract knowledge block and verify total cap
    const knowledgeStart = system.indexOf('PROJECT BRIEF')
    const rulesStart = system.indexOf('RULES:')
    if (knowledgeStart !== -1 && rulesStart !== -1) {
      const knowledgeBlock = system.slice(knowledgeStart, rulesStart)
      // Total must be under MAX_KNOWLEDGE_CONTEXT_CHARS (2500) + some header overhead
      expect(knowledgeBlock.length).toBeLessThan(2700)
    }
  })
})
