// app/tests/unit/agent-tool-validate-section.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/validate-section'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('validate_section tool', () => {
  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'validate_section')).toBeDefined()
  })

  it('detects placeholder patterns', async () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, {
      sessionId: '1', userId: '2',
      session: { outline: [{ id: 'context', expectedLength: 'medium' }] } as any,
      sections: [{ sectionKey: 'context', content: 'This project [insert company name] aims to [TBD] achieve goals.' } as any],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.issues.some((i: any) => i.code === 'PLACEHOLDER')).toBe(true)
    expect(data.score).toBeLessThan(80)
  })

  it('passes clean content with good length', async () => {
    const longContent = 'Proiectul vizează implementarea unui sistem de energie verde în regiunea Nord-Est. '.repeat(20)
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, {
      sessionId: '1', userId: '2',
      session: { outline: [{ id: 'context', expectedLength: 'medium' }] } as any,
      sections: [{ sectionKey: 'context', content: longContent } as any],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.issues.filter((i: any) => i.severity === 'error')).toHaveLength(0)
    expect(data.score).toBeGreaterThanOrEqual(90)
  })

  it('warns on too-short content', async () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'context' }, {
      sessionId: '1', userId: '2',
      session: { outline: [{ id: 'context', expectedLength: 'long' }] } as any,
      sections: [{ sectionKey: 'context', content: 'Very short content here.' } as any],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })

    const data = result.data as any
    expect(data.issues.some((i: any) => i.code === 'TOO_SHORT')).toBe(true)
  })

  it('fails when section not found', async () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_section')!
    const result = await tool.execute({ sectionKey: 'nonexistent' }, {
      sessionId: '1', userId: '2', session: { outline: [] } as any,
      sections: [], stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })
    expect(result.success).toBe(false)
  })
})
