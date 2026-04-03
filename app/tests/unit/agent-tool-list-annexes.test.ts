import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/list-missing-annexes'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('list_missing_annexes tool', () => {
  it('is registered', () => {
    expect(getToolRegistry().find(t => t.name === 'list_missing_annexes')).toBeDefined()
  })

  it('returns empty when no blueprint', async () => {
    const tool = getToolRegistry().find(t => t.name === 'list_missing_annexes')!
    const result = await tool.execute({}, {
      sessionId: '1', userId: '2', session: { blueprint: null } as any,
      sections: [], stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })
    expect(result.data).toEqual([])
    expect(result.warnings).toBeDefined()
  })

  it('detects missing annexes', async () => {
    const tool = getToolRegistry().find(t => t.name === 'list_missing_annexes')!
    const result = await tool.execute({}, {
      sessionId: '1', userId: '2',
      session: { blueprint: { mandatoryAnnexes: ['Anexa 1 - Buget', 'Anexa 2 - CV'] } } as any,
      sections: [{ content: 'This section references Anexa 1 - Buget details', acceptedContent: null } as any],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })
    const data = result.data as any[]
    expect(data).toHaveLength(2)
    expect(data.find((a: any) => a.name === 'Anexa 1 - Buget').status).toBe('mentioned')
    expect(data.find((a: any) => a.name === 'Anexa 2 - CV').status).toBe('missing')
  })
})
