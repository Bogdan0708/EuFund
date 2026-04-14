import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  applicationAgentSessions: {
    id: 'id',
    sessionId: 'session_id',
    userId: 'user_id',
    runtimeMode: 'runtime_mode',
    createdWithFlag: 'created_with_flag',
    status: 'status',
    degradedAt: 'degraded_at',
    degradedReason: 'degraded_reason',
    lastTurnAt: 'last_turn_at',
    lastTurnModel: 'last_turn_model',
    lastTurnToolCount: 'last_turn_tool_count',
    updatedAt: 'updated_at',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => ({ and: args })),
}))

describe('session metadata helpers', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('ensureAppAgentSession', () => {
    it('inserts when no row exists', async () => {
      const { db } = await import('@/lib/db')
      const insertValues = vi.fn().mockResolvedValue(undefined)
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      })
      ;(db.insert as any).mockReturnValue({ values: insertValues })

      const { ensureAppAgentSession } = await import('@/lib/ai/agent/managed/session-metadata')
      await ensureAppAgentSession('sess-1', 'user-1', true)

      expect(insertValues).toHaveBeenCalledOnce()
      const arg = insertValues.mock.calls[0][0]
      expect(arg.sessionId).toBe('sess-1')
      expect(arg.userId).toBe('user-1')
      expect(arg.runtimeMode).toBe('managed')
      expect(arg.createdWithFlag).toBe(true)
      expect(arg.status).toBe('active')
    })

    it('updates updatedAt when row exists', async () => {
      const { db } = await import('@/lib/db')
      const updateSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'row-1' }]),
          }),
        }),
      })
      ;(db.update as any).mockReturnValue({ set: updateSet })

      const { ensureAppAgentSession } = await import('@/lib/ai/agent/managed/session-metadata')
      await ensureAppAgentSession('sess-1', 'user-1', true)

      expect(updateSet).toHaveBeenCalledOnce()
      const arg = updateSet.mock.calls[0][0]
      expect(arg.updatedAt).toBeInstanceOf(Date)
      expect(db.insert).not.toHaveBeenCalled()
    })
  })

  describe('markDegraded', () => {
    it('sets degradedAt and degradedReason', async () => {
      const { db } = await import('@/lib/db')
      const updateSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      ;(db.update as any).mockReturnValue({ set: updateSet })

      const { markDegraded } = await import('@/lib/ai/agent/managed/session-metadata')
      await markDegraded('sess-1', 'user-1', 'anthropic_unavailable')

      expect(updateSet).toHaveBeenCalledOnce()
      const arg = updateSet.mock.calls[0][0]
      expect(arg.degradedAt).toBeInstanceOf(Date)
      expect(arg.degradedReason).toBe('anthropic_unavailable')
      expect(arg.updatedAt).toBeInstanceOf(Date)
    })
  })

  describe('recordTurnSuccess', () => {
    it('updates lastTurnAt, lastTurnModel, lastTurnToolCount', async () => {
      const { db } = await import('@/lib/db')
      const updateSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      })
      ;(db.update as any).mockReturnValue({ set: updateSet })

      const { recordTurnSuccess } = await import('@/lib/ai/agent/managed/session-metadata')
      await recordTurnSuccess('sess-1', 'user-1', 'claude-sonnet-4-6', 3)

      expect(updateSet).toHaveBeenCalledOnce()
      const arg = updateSet.mock.calls[0][0]
      expect(arg.lastTurnAt).toBeInstanceOf(Date)
      expect(arg.lastTurnModel).toBe('claude-sonnet-4-6')
      expect(arg.lastTurnToolCount).toBe(3)
      expect(arg.updatedAt).toBeInstanceOf(Date)
    })
  })
})
