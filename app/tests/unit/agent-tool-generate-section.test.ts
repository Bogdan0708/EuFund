// app/tests/unit/agent-tool-generate-section.test.ts
import { describe, it, expect, vi } from 'vitest'

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
})
