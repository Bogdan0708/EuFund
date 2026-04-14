import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError, ConcurrencyError, NotFoundError } from '@/lib/ai/agent/services/errors'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active' as const,
  stateVersion: 0,
  selectedCallId: null,
  outlineFrozen: false,
  eligibility: null,
}

function mockSelect(session: any) {
  ;(mockDb.select as any).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([session]),
      }),
    }),
  })
  ;(mockDb.update as any).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: baseSession.id }]),
      }),
    }),
  })
}

describe('setSelectedCall', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: sets call on an unfrozen active session', async () => {
    mockSelect(baseSession)
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    const result = await setSelectedCall(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('throws ConcurrencyError on stateVersion mismatch', async () => {
    mockSelect({ ...baseSession, stateVersion: 5 })
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    try {
      await setSelectedCall(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConcurrencyError)
    }
  })

  it('throws POLICY_OUTLINE_ALREADY_FROZEN when outline is frozen', async () => {
    mockSelect({ ...baseSession, outlineFrozen: true })
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    try {
      await setSelectedCall(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_ALREADY_FROZEN')
    }
  })

  it('throws NotFoundError when session does not exist', async () => {
    ;(mockDb.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    try {
      await setSelectedCall(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError)
    }
  })
})
