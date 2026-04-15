import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: {
    sessionId: 'session_id',
    sequenceNumber: 'sequence_number',
  },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
}))

describe('history helpers', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('loadManagedHistory', () => {
    it('returns empty array when no messages', async () => {
      const { db } = await import('@/lib/db')
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory('sess-1')
      expect(result.messages).toEqual([])
      expect(result.summary).toBeNull()
    })

    it('converts user text message to MessageParam', async () => {
      const { db } = await import('@/lib/db')
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: 'msg-1', sessionId: 'sess-1', sequenceNumber: 0,
                role: 'user', messageType: 'text',
                content: 'Vreau fonduri',
                toolName: null, toolCallId: null,
                compactedAt: null,
                runtimeMode: 'managed', provider: null, model: null,
              },
            ]),
          }),
        }),
      })

      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory('sess-1')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
      expect(result.messages[0].content).toBe('Vreau fonduri')
    })

    it('converts assistant structured content to MessageParam', async () => {
      const { db } = await import('@/lib/db')
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: 'msg-2', sessionId: 'sess-1', sequenceNumber: 1,
                role: 'assistant', messageType: 'text',
                content: [{ type: 'text', text: 'Salut' }],
                toolName: null, toolCallId: null,
                compactedAt: null,
                runtimeMode: 'managed', provider: 'anthropic', model: 'claude-sonnet-4-6',
              },
            ]),
          }),
        }),
      })

      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory('sess-1')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('assistant')
      expect(Array.isArray(result.messages[0].content)).toBe(true)
    })

    it('skips compacted messages', async () => {
      const { db } = await import('@/lib/db')
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: 'msg-1', sessionId: 'sess-1', sequenceNumber: 0,
                role: 'user', messageType: 'text',
                content: 'Old message',
                toolName: null, toolCallId: null,
                compactedAt: new Date('2026-01-01'),
                runtimeMode: 'v3', provider: null, model: null,
              },
              {
                id: 'msg-2', sessionId: 'sess-1', sequenceNumber: 1,
                role: 'user', messageType: 'text',
                content: 'Current message',
                toolName: null, toolCallId: null,
                compactedAt: null,
                runtimeMode: 'managed', provider: null, model: null,
              },
            ]),
          }),
        }),
      })

      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory('sess-1')
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].content).toBe('Current message')
    })
  })

  describe('appendManagedMessage', () => {
    it('inserts with runtime_mode, provider, model tags', async () => {
      const { db } = await import('@/lib/db')
      const insertValues = vi.fn().mockResolvedValue(undefined)
      ;(db.insert as any).mockReturnValue({ values: insertValues })
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ sequenceNumber: 2 }]),
            }),
          }),
        }),
      })

      const { appendManagedMessage } = await import('@/lib/ai/agent/managed/history')
      await appendManagedMessage('sess-1', {
        role: 'user',
        messageType: 'text',
        content: 'Test',
      }, {
        runtimeMode: 'managed',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      })

      expect(insertValues).toHaveBeenCalledOnce()
      const arg = insertValues.mock.calls[0][0]
      expect(arg.runtimeMode).toBe('managed')
      expect(arg.provider).toBe('anthropic')
      expect(arg.model).toBe('claude-sonnet-4-6')
      expect(arg.sequenceNumber).toBe(3)
    })

    it('uses sequenceNumber 0 when session has no prior messages', async () => {
      const { db } = await import('@/lib/db')
      const insertValues = vi.fn().mockResolvedValue(undefined)
      ;(db.insert as any).mockReturnValue({ values: insertValues })
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      })

      const { appendManagedMessage } = await import('@/lib/ai/agent/managed/history')
      await appendManagedMessage('sess-1', {
        role: 'user',
        messageType: 'text',
        content: 'First',
      }, { runtimeMode: 'managed' })

      const arg = insertValues.mock.calls[0][0]
      expect(arg.sequenceNumber).toBe(0)
    })
  })
})
