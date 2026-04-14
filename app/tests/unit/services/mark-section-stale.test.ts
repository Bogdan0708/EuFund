import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

const { mockDb } = vi.hoisted(() => ({
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
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

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

describe('markSectionStale', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path from draft', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'draft', content: 'text', acceptedContent: null }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    const result = await markSectionStale(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('demotes from accepted and clears acceptedContent', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'accepted', content: 'text', acceptedContent: 'accepted text' }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    const result = await markSectionStale(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('idempotent no-op when already stale', async () => {
    mockSelectChain({ ...baseSession, stateVersion: 7 }, [{ id: 'sec-1', status: 'stale', content: 'text', acceptedContent: null }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    const result = await markSectionStale(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 7 },
    )
    expect(result.newStateVersion).toBe(7)
  })

  it('throws POLICY_SECTION_WRONG_STATE from pending', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'pending', content: null, acceptedContent: null }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    try {
      await markSectionStale(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })
})
