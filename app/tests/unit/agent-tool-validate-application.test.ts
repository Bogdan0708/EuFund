// app/tests/unit/agent-tool-validate-application.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the application service before importing tool
vi.mock('@/lib/ai/agent/services/application', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ai/agent/services/application')>()
  return {
    ...original,
    validateApplication: vi.fn(),
    checkMissingAnnexes: vi.fn(),
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { validateApplication } from '@/lib/ai/agent/services/application'
import '@/lib/ai/agent/tools/validate-application'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const mockCtx = {
  sessionId: SESSION_ID,
  userId: USER_ID,
  session: {} as any,
  sections: [],
  stateVersion: 0,
  requestId: 'req-1',
  locale: 'ro' as const,
}

describe('validate_application tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is registered (replaces placeholder)', () => {
    const tool = getToolRegistry().find(t => t.name === 'validate_application')
    expect(tool).toBeDefined()
    expect(tool!.category).toBe('decision')
  })

  it('passes when all mandatory sections accepted', async () => {
    ;(validateApplication as ReturnType<typeof vi.fn>).mockResolvedValue({
      passed: true,
      issues: [],
      summary: {
        totalSections: 1,
        acceptedSections: 1,
        draftSections: 0,
        missingSections: 0,
        mandatoryAnnexesMissing: 0,
        eligibilityBlockers: 0,
      },
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, mockCtx)

    expect(result.success).toBe(true)
    const data = result.data as any
    expect(data.passed).toBe(true)
    expect(data.summary.acceptedSections).toBe(1)
  })

  it('blocks when mandatory section missing', async () => {
    ;(validateApplication as ReturnType<typeof vi.fn>).mockResolvedValue({
      passed: false,
      issues: [{ code: 'SECTION_MISSING', severity: 'error', message: 'Mandatory section "Buget" not generated', sectionKey: 'buget' }],
      summary: {
        totalSections: 2, acceptedSections: 1, draftSections: 0,
        missingSections: 1, mandatoryAnnexesMissing: 0, eligibilityBlockers: 0,
      },
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, mockCtx)

    const data = result.data as any
    expect(data.passed).toBe(false)
    expect(data.issues.some((i: any) => i.code === 'SECTION_MISSING')).toBe(true)
  })

  it('blocks when eligibility fails', async () => {
    ;(validateApplication as ReturnType<typeof vi.fn>).mockResolvedValue({
      passed: false,
      issues: [
        { code: 'ELIGIBILITY_FAIL', severity: 'error', message: '2 eligibility check(s) failed' },
        { code: 'ELIGIBILITY_WARN', severity: 'warning', message: '1 eligibility warning(s)' },
      ],
      summary: {
        totalSections: 0, acceptedSections: 0, draftSections: 0,
        missingSections: 0, mandatoryAnnexesMissing: 0, eligibilityBlockers: 2,
      },
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, mockCtx)

    const data = result.data as any
    expect(data.passed).toBe(false)
    expect(data.issues.some((i: any) => i.code === 'ELIGIBILITY_FAIL')).toBe(true)
  })

  it('warns on draft sections not yet accepted', async () => {
    ;(validateApplication as ReturnType<typeof vi.fn>).mockResolvedValue({
      passed: true,
      issues: [{ code: 'SECTION_NOT_ACCEPTED', severity: 'warning', message: 'Section is in draft', sectionKey: 'context' }],
      summary: {
        totalSections: 1, acceptedSections: 0, draftSections: 1,
        missingSections: 0, mandatoryAnnexesMissing: 0, eligibilityBlockers: 0,
      },
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, mockCtx)

    const data = result.data as any
    // Not a blocker, but a warning
    expect(data.issues.some((i: any) => i.code === 'SECTION_NOT_ACCEPTED')).toBe(true)
  })

  it('emits SET_PHASE review transition when passed', async () => {
    ;(validateApplication as ReturnType<typeof vi.fn>).mockResolvedValue({
      passed: true,
      issues: [],
      summary: {
        totalSections: 1, acceptedSections: 1, draftSections: 0,
        missingSections: 0, mandatoryAnnexesMissing: 0, eligibilityBlockers: 0,
      },
    })
    const tool = getToolRegistry().find(t => t.name === 'validate_application')!
    const result = await tool.execute({}, mockCtx)

    expect(result.stateTransitions).toHaveLength(1)
    expect(result.stateTransitions![0].type).toBe('SET_PHASE')
  })
})
