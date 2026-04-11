import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError, ConcurrencyError } from '@/lib/ai/agent/services/errors'

const { mockDb } = vi.hoisted(() => ({
  mockDb: { select: vi.fn(), update: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const eligiblePassing = { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 2 }

function mockSessionSelect(overrides: any) {
  const session = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active' as const,
    stateVersion: 0,
    selectedCallId: 'CALL-42',
    outlineFrozen: false,
    eligibility: eligiblePassing,
    currentPhase: 'research' as const,
    ...overrides,
  }
  ;(mockDb.select as any).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([session]),
      }),
    }),
  })
  ;(mockDb.update as any).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })
  return session
}

describe('freezeOutline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: freezes outline, advances phase to drafting', async () => {
    mockSessionSelect({})
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    const result = await freezeOutline(
      { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
      { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('idempotent no-op when outline already frozen', async () => {
    mockSessionSelect({ outlineFrozen: true, stateVersion: 3 })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    const result = await freezeOutline(
      { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
      { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 3 },
    )
    expect(result.newStateVersion).toBe(3)  // unchanged
  })

  it('throws POLICY_NO_CALL_SELECTED when no call', async () => {
    mockSessionSelect({ selectedCallId: null })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    try {
      await freezeOutline(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_NO_CALL_SELECTED')
    }
  })

  it('throws POLICY_ELIGIBILITY_NOT_PASSED when eligibility has failures', async () => {
    mockSessionSelect({ eligibility: { ...eligiblePassing, failCount: 2 } })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    try {
      await freezeOutline(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
    }
  })

  it('throws POLICY_ELIGIBILITY_NOT_PASSED when eligibility is null', async () => {
    mockSessionSelect({ eligibility: null })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    try {
      await freezeOutline(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
    }
  })
})
