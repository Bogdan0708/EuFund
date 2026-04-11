import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

describe('rollbackSection policy gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws POLICY_OUTLINE_NOT_FROZEN when outline is not frozen', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            id: '11111111-1111-4111-8111-111111111111',
            userId: '22222222-2222-4222-8222-222222222222',
            stateVersion: 0,
            outlineFrozen: false,
            status: 'active',
            selectedCallId: 'call-1',
            eligibility: null,
          }]),
        }),
      }),
    })

    const { rollbackSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await rollbackSection(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', sectionKey: 'obiective', targetVersion: 1, expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    }
  })
})
