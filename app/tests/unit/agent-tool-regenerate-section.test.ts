import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: 'Proiectul nostru revizuit vizează o abordare complet nouă pentru tranziția verde, conform feedback-ului primit.',
    tokensUsed: { input: 600, output: 300 },
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
  }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'sec-1', retryCount: 0 }]),
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

import '@/lib/ai/agent/tools/regenerate-section'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('regenerate_section tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: {
      outline: [{ id: 'context', title: 'Context', description: 'Describe context', importance: 'critical', expectedLength: 'long' }],
    } as any,
    sections: [{ sectionKey: 'context', content: 'Original draft content here', retryCount: 0, status: 'draft' } as any],
    stateVersion: 0, requestId: 'req-1', locale: 'ro' as const,
  }

  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'regenerate_section')).toBeDefined()
  })

  it('regenerates with feedback and returns UPSERT_SECTION_DRAFT', async () => {
    const tool = getToolRegistry().find(t => t.name === 'regenerate_section')!
    const result = await tool.execute({ sectionKey: 'context', feedback: 'More specific budget numbers needed' }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.stateTransitions).toBeDefined()
    expect(result.stateTransitions![0].type).toBe('UPSERT_SECTION_DRAFT')
  })

  it('creates a checkpoint on regeneration', async () => {
    const tool = getToolRegistry().find(t => t.name === 'regenerate_section')!
    const result = await tool.execute({ sectionKey: 'context', feedback: 'fix it' }, mockCtx)

    expect(result.checkpoint).toBeDefined()
    expect(result.checkpoint!.type).toBe('section_regenerated')
  })

  it('fails when section not found', async () => {
    const tool = getToolRegistry().find(t => t.name === 'regenerate_section')!
    const result = await tool.execute({ sectionKey: 'nonexistent', feedback: 'fix' }, {
      ...mockCtx, sections: [],
    })
    expect(result.success).toBe(false)
  })

  it('does NOT expose qualityMode in the LLM tool input schema', async () => {
    // Security regression: the prior commit had qualityMode: z.enum([...])
    // inside inputSchema, which means the LLM could pass qualityMode='deep'
    // and self-escalate to Opus. The user-initiated deep mode must be plumbed
    // through a trusted server/UI channel only — never the tool surface.
    const tool = getToolRegistry().find(t => t.name === 'regenerate_section')!

    // Zod schema introspection: the keys of the shape are the LLM-callable
    // inputs. qualityMode must NOT be one of them.
    const shape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape
    const keys = Object.keys(shape)
    expect(keys).toEqual(expect.arrayContaining(['sectionKey', 'feedback']))
    expect(keys).not.toContain('qualityMode')

    // Defense in depth: parsing a payload that includes qualityMode either
    // strips it or fails — never accepts it as a usable input field.
    const parsed = (tool.inputSchema as { parse: (x: unknown) => Record<string, unknown> }).parse({
      sectionKey: 'context',
      feedback: 'rewrite please',
      qualityMode: 'deep',
    })
    expect(parsed.qualityMode).toBeUndefined()
  })
})
