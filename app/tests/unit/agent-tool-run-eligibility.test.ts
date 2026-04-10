import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the eligibility service before importing tool
vi.mock('@/lib/ai/agent/services/eligibility', () => ({
  runEligibility: vi.fn(),
  scoreFit: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { runEligibility } from '@/lib/ai/agent/services/eligibility'
import '@/lib/ai/agent/tools/run-eligibility'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

const SESSION_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'

const mockCtx = {
  sessionId: SESSION_ID,
  userId: USER_ID,
  session: {
    selectedCallId: 'PNRR-C11',
    blueprint: { cofinancingRate: 0.85, eligibilityCriteria: ['srl', 'sa'] },
  } as any,
  sections: [],
  stateVersion: 0,
  requestId: 'req-1',
  locale: 'ro' as const,
}

const eligibilityDecision = {
  results: [
    { ruleId: 'ORG-TYPE', ruleName: 'Organization Type', status: 'pass' as const, messageRo: 'Tipul organizației este eligibil', messageEn: 'Org type eligible' },
    { ruleId: 'BUDGET-RANGE', ruleName: 'Budget Range', status: 'warning' as const, messageRo: 'Buget la limita maximă', messageEn: 'Budget at max limit' },
  ],
  score: 75,
  passCount: 1,
  failCount: 0,
  warningCount: 1,
}

describe('run_eligibility tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is registered in the tool registry', () => {
    const tools = getToolRegistry()
    expect(tools.find(t => t.name === 'run_eligibility')).toBeDefined()
  })

  it('returns EligibilityResult with correct counts', async () => {
    ;(runEligibility as ReturnType<typeof vi.fn>).mockResolvedValue(eligibilityDecision)
    const tool = getToolRegistry().find(t => t.name === 'run_eligibility')!
    const result = await tool.execute({
      organization: { orgType: 'srl' },
      project: { totalBudget: 500000 },
    }, mockCtx)

    expect(result.success).toBe(true)
    expect((result.data as any).score).toBe(75)
    expect((result.data as any).passCount).toBe(1)
    expect((result.data as any).warningCount).toBe(1)
    expect((result.data as any).failCount).toBe(0)
  })

  it('emits SET_ELIGIBILITY state transition', async () => {
    ;(runEligibility as ReturnType<typeof vi.fn>).mockResolvedValue(eligibilityDecision)
    const tool = getToolRegistry().find(t => t.name === 'run_eligibility')!
    const result = await tool.execute({
      organization: { orgType: 'srl' },
      project: {},
    }, mockCtx)

    expect(result.stateTransitions).toHaveLength(1)
    expect(result.stateTransitions![0].type).toBe('SET_ELIGIBILITY')
  })

  it('includes warning message when warnings present', async () => {
    ;(runEligibility as ReturnType<typeof vi.fn>).mockResolvedValue(eligibilityDecision)
    const tool = getToolRegistry().find(t => t.name === 'run_eligibility')!
    const result = await tool.execute({
      organization: { orgType: 'srl' },
      project: {},
    }, mockCtx)

    expect(result.warnings).toBeDefined()
    expect(result.warnings![0]).toContain('warning')
  })

  it('returns failure when no call is selected in session', async () => {
    const tool = getToolRegistry().find(t => t.name === 'run_eligibility')!
    const noCallCtx = { ...mockCtx, session: { selectedCallId: null } as any }
    const result = await tool.execute({ organization: { orgType: 'srl' }, project: {} }, noCallCtx)

    expect(result.success).toBe(false)
    expect(result.error).toContain('No call selected')
  })
})
