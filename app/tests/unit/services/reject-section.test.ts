import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

const { mockDb, mockLogAudit } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    transaction: vi.fn((fn: any) => fn({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: '11111111-1111-4111-8111-111111111111' }]),
          }),
        }),
      }),
    })),
  },
  mockLogAudit: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: mockLogAudit }))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  stateVersion: 0,
  selectedCallId: 'CALL-42',
  outlineFrozen: true,
  eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
}

function mockSelectChain(session: any, sectionRows: any[]) {
  let call = 0
  ;(mockDb.select as any).mockImplementation(() => {
    call += 1
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(call === 1 ? [session] : sectionRows),
        }),
      }),
    }
  })
}

describe('rejectSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: rejects a draft section with a reason', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'draft', rejectionReason: null, content: 'text' }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    const result = await rejectSection(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'not specific enough', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('idempotent: same-reason re-reject returns current state', async () => {
    mockSelectChain({ ...baseSession, stateVersion: 4 }, [{
      id: 'sec-1',
      status: 'rejected',
      rejectionReason: 'not specific enough',
      content: 'text',
    }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    mockLogAudit.mockClear()  // explicit — we want to verify zero calls below

    const result = await rejectSection(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'not specific enough', expectedStateVersion: 4 },
    )
    expect(result.newStateVersion).toBe(4)  // unchanged

    // Idempotent no-op invariant: no audit event emitted
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it('throws POLICY_SECTION_WRONG_STATE on different-reason re-reject', async () => {
    mockSelectChain(baseSession, [{
      id: 'sec-1',
      status: 'rejected',
      rejectionReason: 'not specific enough',
      content: 'text',
    }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await rejectSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'wrong tone', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })

  it('throws POLICY_SECTION_WRONG_STATE from accepted', async () => {
    mockSelectChain(baseSession, [{
      id: 'sec-1',
      status: 'accepted',
      rejectionReason: null,
      content: 'text',
    }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await rejectSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'x', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })
})
