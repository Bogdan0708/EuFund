import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: JSON.stringify([
      { id: 'context', title: 'Context', description: 'Desc', order: 1, generationOrder: 1, importance: 'critical', expectedLength: 'long', dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 0.9 },
      { id: 'obiective', title: 'Obiective', description: 'Goals', order: 2, generationOrder: 2, importance: 'critical', expectedLength: 'medium', dependsOn: ['context'], modelHint: 'heavy', mandatory: true, confidence: 0.85 },
    ]),
    tokensUsed: { input: 500, output: 300 },
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/extract-structure'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('extract_structure tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: {} as any, sections: [], stateVersion: 0, requestId: 'req-1', locale: 'ro' as const,
  }

  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'extract_structure')).toBeDefined()
  })

  it('extracts sections from evidence via LLM', async () => {
    const tool = getToolRegistry().find(t => t.name === 'extract_structure')!
    const result = await tool.execute({
      evidence: [{ content: 'Guide says need context and objectives', docType: 'ghid', source: 'guide.pdf' }],
    }, mockCtx)

    expect(result.success).toBe(true)
    const data = result.data as any[]
    expect(data).toHaveLength(2)
    expect(data[0].id).toBe('context')
  })

  it('emits SET_OUTLINE and SET_PHASE transitions', async () => {
    const tool = getToolRegistry().find(t => t.name === 'extract_structure')!
    const result = await tool.execute({
      evidence: [{ content: 'test', docType: 'ghid', source: 'test.pdf' }],
    }, mockCtx)

    expect(result.stateTransitions).toBeDefined()
    expect(result.stateTransitions!.find((t: any) => t.type === 'SET_OUTLINE')).toBeDefined()
    expect(result.stateTransitions!.find((t: any) => t.type === 'SET_PHASE')).toBeDefined()
  })

  it('falls back to defaults with empty evidence', async () => {
    const tool = getToolRegistry().find(t => t.name === 'extract_structure')!
    const result = await tool.execute({ evidence: [] }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.warnings).toBeDefined()
    expect((result.data as any[]).length).toBeGreaterThan(5) // DEFAULT_SECTIONS has 11
  })
})
