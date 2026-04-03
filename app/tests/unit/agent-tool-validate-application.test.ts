// app/tests/unit/agent-tool-validate-application.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/validate-application'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('validate_application tool', () => {
  it('is registered (replaces placeholder)', () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_application')
    expect(tool).toBeDefined()
    expect(tool!.category).toBe('decision')
  })

  it('passes when all mandatory sections accepted', async () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, {
      sessionId: '1', userId: '2',
      session: {
        outline: [
          { id: 'context', title: 'Context', mandatory: true },
          { id: 'riscuri', title: 'Riscuri', mandatory: false },
        ],
        blueprint: { mandatoryAnnexes: [] },
        eligibility: { failCount: 0, warningCount: 0 },
      } as any,
      sections: [
        { sectionKey: 'context', status: 'accepted', content: 'Full content', acceptedContent: 'Full content' } as any,
      ],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.passed).toBe(true)
    expect(data.summary.acceptedSections).toBe(1)
  })

  it('blocks when mandatory section missing', async () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, {
      sessionId: '1', userId: '2',
      session: {
        outline: [
          { id: 'context', title: 'Context', mandatory: true },
          { id: 'buget', title: 'Buget', mandatory: true },
        ],
        blueprint: { mandatoryAnnexes: [] },
        eligibility: { failCount: 0, warningCount: 0 },
      } as any,
      sections: [
        { sectionKey: 'context', status: 'accepted' } as any,
        // buget is missing!
      ],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })

    const data = result.data as any
    expect(data.passed).toBe(false)
    expect(data.issues.some((i: any) => i.code === 'SECTION_MISSING')).toBe(true)
  })

  it('blocks when eligibility fails', async () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, {
      sessionId: '1', userId: '2',
      session: {
        outline: [],
        blueprint: { mandatoryAnnexes: [] },
        eligibility: { failCount: 2, warningCount: 1 },
      } as any,
      sections: [],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })

    const data = result.data as any
    expect(data.passed).toBe(false)
    expect(data.issues.some((i: any) => i.code === 'ELIGIBILITY_FAIL')).toBe(true)
  })

  it('warns on draft sections not yet accepted', async () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, {
      sessionId: '1', userId: '2',
      session: {
        outline: [{ id: 'context', title: 'Context', mandatory: true }],
        blueprint: { mandatoryAnnexes: [] },
        eligibility: { failCount: 0, warningCount: 0 },
      } as any,
      sections: [{ sectionKey: 'context', status: 'draft' } as any],
      stateVersion: 0, requestId: 'req-1', locale: 'ro',
    })

    const data = result.data as any
    // Not a blocker, but a warning
    expect(data.issues.some((i: any) => i.code === 'SECTION_NOT_ACCEPTED')).toBe(true)
  })
})
