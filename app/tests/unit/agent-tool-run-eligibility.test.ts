import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/rules/eligibility', () => ({
  runEligibilityRules: vi.fn().mockReturnValue({
    results: [
      { ruleId: 'ORG-TYPE', ruleName: 'Organization Type', status: 'pass', messageRo: 'Tipul organizației este eligibil', messageEn: 'Org type eligible' },
      { ruleId: 'BUDGET-RANGE', ruleName: 'Budget Range', status: 'warning', messageRo: 'Buget la limita maximă', messageEn: 'Budget at max limit' },
    ],
    score: 75,
    passCount: 1,
    failCount: 0,
    warningCount: 1,
  }),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import '@/lib/ai/agent/tools/run-eligibility'
import { getToolRegistry } from '@/lib/ai/agent/tools/registry'

describe('run_eligibility tool', () => {
  const mockCtx = {
    sessionId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    session: { blueprint: { cofinancingRate: 0.85, eligibilityCriteria: ['srl', 'sa'] } } as any,
    sections: [],
    stateVersion: 0,
    requestId: 'req-1',
    locale: 'ro' as const,
  }

  it('is registered in the tool registry', () => {
    const tools = getToolRegistry()
    expect(tools.find(t => t.name === 'run_eligibility')).toBeDefined()
  })

  it('returns EligibilityResult with correct counts', async () => {
    const tool = getToolRegistry().find(t => t.name === 'run_eligibility')!
    const result = await tool.execute({
      organization: { orgType: 'srl' },
      project: { totalBudget: 500000 },
    }, mockCtx)

    expect(result.success).toBe(true)
    expect(result.data!.score).toBe(75)
    expect(result.data!.passCount).toBe(1)
    expect(result.data!.warningCount).toBe(1)
    expect(result.data!.failCount).toBe(0)
  })

  it('emits SET_ELIGIBILITY state transition', async () => {
    const tool = getToolRegistry().find(t => t.name === 'run_eligibility')!
    const result = await tool.execute({
      organization: { orgType: 'srl' },
      project: {},
    }, mockCtx)

    expect(result.stateTransitions).toHaveLength(1)
    expect(result.stateTransitions![0].type).toBe('SET_ELIGIBILITY')
  })

  it('includes warning message when warnings present', async () => {
    const tool = getToolRegistry().find(t => t.name === 'run_eligibility')!
    const result = await tool.execute({
      organization: { orgType: 'srl' },
      project: {},
    }, mockCtx)

    expect(result.warnings).toBeDefined()
    expect(result.warnings![0]).toContain('warning')
  })
})
