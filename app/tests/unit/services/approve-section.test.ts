import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((fn) => fn({
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

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn(),
}))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  stateVersion: 0,
  selectedCallId: 'call-1',
  outlineFrozen: true,
  eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
}

describe('approveSection policy gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws POLICY_OUTLINE_NOT_FROZEN when outline is not frozen', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ ...baseSession, outlineFrozen: false }]),
        }),
      }),
    }).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'sec-1', status: 'draft', content: 'text' }]),
        }),
      }),
    })

    const { approveSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await approveSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    }
  })

  it('throws POLICY_SECTION_WRONG_STATE when section is in stale state', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([baseSession]),
        }),
      }),
    }).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'sec-1', status: 'stale', content: 'text' }]),
        }),
      }),
    })

    const { approveSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await approveSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })
})
