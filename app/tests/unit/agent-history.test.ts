import { describe, it, expect, vi, beforeEach } from 'vitest'

// --- Shared mock state ---
let mockRows: any[] = []
let insertedValues: any[] = []
let updatedSets: any[] = []

// Build a chainable query object that resolves to mockRows
function makeSelectChain(rows: () => any[]) {
  const limitFn = vi.fn().mockImplementation(() => Promise.resolve(rows().slice(-1)))
  const orderByFn = vi.fn().mockImplementation(() => {
    const result = Promise.resolve(rows())
    return Object.assign(result, { limit: limitFn })
  })
  const whereFn = vi.fn().mockImplementation(() => {
    const result = Promise.resolve(rows())
    return Object.assign(result, { orderBy: orderByFn })
  })
  const fromFn = vi.fn().mockImplementation(() => ({ where: whereFn, orderBy: orderByFn }))
  return { from: fromFn, _where: whereFn, _orderBy: orderByFn, _limit: limitFn }
}

vi.mock('@/lib/db', () => {
  const selectImpl = () => {
    const limitFn = vi.fn().mockImplementation(() => Promise.resolve(mockRows.slice(-1)))
    const orderByFn = vi.fn().mockImplementation(() => {
      const p = Promise.resolve(mockRows)
      return Object.assign(p, { limit: limitFn })
    })
    const whereFn = vi.fn().mockImplementation(() => {
      const p = Promise.resolve(mockRows)
      return Object.assign(p, { orderBy: orderByFn })
    })
    const fromFn = vi.fn().mockImplementation(() => ({
      where: whereFn,
      orderBy: orderByFn,
    }))
    return { from: fromFn }
  }

  const insertImpl = () => ({
    values: vi.fn().mockImplementation((vals: any) => {
      insertedValues.push(vals)
      return Promise.resolve(undefined)
    }),
  })

  const updateImpl = () => ({
    set: vi.fn().mockImplementation((s: any) => ({
      where: vi.fn().mockImplementation(() => {
        updatedSets.push(s)
        return Promise.resolve(undefined)
      }),
    })),
  })

  return {
    db: {
      select: selectImpl,
      insert: insertImpl,
      update: updateImpl,
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))

import { loadContext, appendMessage, compactIfNeeded } from '@/lib/ai/agent/history'

describe('Message History Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRows = []
    insertedValues = []
    updatedSets = []
  })

  describe('loadContext', () => {
    it('returns empty messages for new session', async () => {
      const ctx = await loadContext('session-1')
      expect(ctx.messages).toEqual([])
      expect(ctx.summary).toBeNull()
      expect(ctx.totalCount).toBe(0)
    })

    it('maps rows to MessageForLLM format', async () => {
      mockRows = [
        { id: 'msg-1', role: 'user', content: 'Hello', messageType: 'text', sequenceNumber: 0, compactedAt: null },
        { id: 'msg-2', role: 'assistant', content: 'Hi there', messageType: 'text', sequenceNumber: 1, compactedAt: null },
      ]
      const ctx = await loadContext('session-1')
      expect(ctx.messages).toHaveLength(2)
      expect(ctx.messages[0].role).toBe('user')
      expect(ctx.messages[0].content).toBe('Hello')
      expect(ctx.messages[1].role).toBe('assistant')
      expect(ctx.messages[1].content).toBe('Hi there')
    })

    it('serializes non-string content to JSON', async () => {
      mockRows = [
        { id: 'msg-1', role: 'assistant', content: { tool_use: 'search_calls' }, messageType: 'tool_call', sequenceNumber: 0, compactedAt: null },
      ]
      const ctx = await loadContext('session-1')
      expect(ctx.messages[0].content).toBe('{"tool_use":"search_calls"}')
    })

    it('includes toolCallId and toolName when present', async () => {
      mockRows = [
        { id: 'msg-1', role: 'tool', content: 'result', messageType: 'tool_result', sequenceNumber: 0, compactedAt: null, toolCallId: 'call-abc', toolName: 'search_calls' },
      ]
      const ctx = await loadContext('session-1')
      expect(ctx.messages[0].toolCallId).toBe('call-abc')
      expect(ctx.messages[0].toolName).toBe('search_calls')
    })

    it('does not include toolCallId/toolName keys when absent', async () => {
      mockRows = [
        { id: 'msg-1', role: 'user', content: 'Hello', messageType: 'text', sequenceNumber: 0, compactedAt: null, toolCallId: null, toolName: null },
      ]
      const ctx = await loadContext('session-1')
      expect('toolCallId' in ctx.messages[0]).toBe(false)
      expect('toolName' in ctx.messages[0]).toBe(false)
    })

    it('extracts summary from system_summary row', async () => {
      mockRows = [
        { id: 'msg-1', role: 'user', content: 'Hello', messageType: 'text', sequenceNumber: 0, compactedAt: null },
        { id: 'msg-2', role: 'system', content: 'Summary text here', messageType: 'system_summary', sequenceNumber: 1, compactedAt: null },
      ]
      const ctx = await loadContext('session-1')
      expect(ctx.summary).toBe('Summary text here')
    })

    it('counts total rows including compacted', async () => {
      mockRows = [
        { id: 'msg-1', role: 'user', content: 'A', messageType: 'text', sequenceNumber: 0, compactedAt: new Date() },
        { id: 'msg-2', role: 'user', content: 'B', messageType: 'text', sequenceNumber: 1, compactedAt: null },
      ]
      const ctx = await loadContext('session-1')
      expect(ctx.totalCount).toBe(2)
    })
  })

  describe('appendMessage', () => {
    it('inserts a message with sequenceNumber 0 for empty session', async () => {
      mockRows = [] // no existing messages
      const seq = await appendMessage('session-1', {
        role: 'user',
        messageType: 'text',
        content: 'Hello agent',
      })
      expect(seq).toBe(0)
      expect(insertedValues).toHaveLength(1)
      expect(insertedValues[0].sequenceNumber).toBe(0)
      expect(insertedValues[0].role).toBe('user')
      expect(insertedValues[0].content).toBe('Hello agent')
    })

    it('increments sequenceNumber based on last row', async () => {
      mockRows = [{ sequenceNumber: 5 }]
      const seq = await appendMessage('session-1', {
        role: 'assistant',
        messageType: 'text',
        content: 'Response',
      })
      expect(seq).toBe(6)
      expect(insertedValues[0].sequenceNumber).toBe(6)
    })

    it('stores toolName and toolCallId when provided', async () => {
      mockRows = []
      await appendMessage('session-1', {
        role: 'tool',
        messageType: 'tool_result',
        content: { result: 'ok' },
        toolName: 'search_calls',
        toolCallId: 'call-xyz',
      })
      expect(insertedValues[0].toolName).toBe('search_calls')
      expect(insertedValues[0].toolCallId).toBe('call-xyz')
    })

    it('stores null for missing toolName and toolCallId', async () => {
      mockRows = []
      await appendMessage('session-1', {
        role: 'user',
        messageType: 'text',
        content: 'plain message',
      })
      expect(insertedValues[0].toolName).toBeNull()
      expect(insertedValues[0].toolCallId).toBeNull()
    })
  })

  describe('compactIfNeeded', () => {
    it('does not compact when below threshold (40)', async () => {
      mockRows = Array.from({ length: 10 }, (_, i) => ({
        id: `msg-${i}`,
        role: 'user',
        content: `Message ${i}`,
        messageType: 'text',
        sequenceNumber: i,
        compactedAt: null,
      }))
      const result = await compactIfNeeded('session-1', 'drafting')
      expect(result.compacted).toBe(false)
    })

    it('does not compact at exactly 39 messages', async () => {
      mockRows = Array.from({ length: 39 }, (_, i) => ({
        id: `msg-${i}`,
        role: 'user',
        content: `Message ${i}`,
        messageType: 'text',
        sequenceNumber: i,
        compactedAt: null,
      }))
      const result = await compactIfNeeded('session-1', 'research')
      expect(result.compacted).toBe(false)
    })

    it('returns compacted: false with no side effects below threshold', async () => {
      mockRows = Array.from({ length: 5 }, (_, i) => ({
        id: `msg-${i}`, role: 'assistant', content: `msg ${i}`, messageType: 'text', sequenceNumber: i, compactedAt: null,
      }))
      const result = await compactIfNeeded('session-2', 'discovery')
      expect(result.compacted).toBe(false)
      expect(result.summary).toBeUndefined()
    })

    it('compacts when at or above threshold (40)', async () => {
      mockRows = Array.from({ length: 40 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        messageType: 'text',
        sequenceNumber: i,
        compactedAt: null,
        toolName: null,
        toolCallId: null,
      }))
      const result = await compactIfNeeded('session-1', 'drafting')
      expect(result.compacted).toBe(true)
      expect(result.summary).toBeDefined()
      expect(result.summary).toContain('messages compacted')
    })

    it('summary includes tool result entries', async () => {
      mockRows = Array.from({ length: 40 }, (_, i) => ({
        id: `msg-${i}`,
        role: i === 5 ? 'tool' : 'user',
        content: i === 5 ? 'tool output data' : `Message ${i}`,
        messageType: i === 5 ? 'tool_result' : 'text',
        sequenceNumber: i,
        compactedAt: null,
        toolName: i === 5 ? 'search_calls' : null,
        toolCallId: null,
      }))
      const result = await compactIfNeeded('session-1', 'research')
      expect(result.compacted).toBe(true)
      expect(result.summary).toContain('[Tool: search_calls]')
    })

    // Managed runtime persists assistant tool_use blocks inside content[]
    // on messageType='text' rows, not as messageType='tool_call'. The
    // compactor must scan content[] for tool_use blocks to protect pairs
    // that straddle the PRESERVE_RECENT boundary. Without this, a
    // tool_result kept in the last-10 window loses its tool_use on
    // compaction, and ensurePairingInvariant drops the orphan on replay.
    it('protects managed tool_use/tool_result pairs across compaction boundary', async () => {
      const TOOL_ID = 'toolu_cross_boundary'
      mockRows = Array.from({ length: 41 }, (_, i) => {
        // Assistant tool_use row at seq 29 (outside last 10, so it would be
        // compacted without pairing protection).
        if (i === 29) {
          return {
            id: `msg-${i}`,
            role: 'assistant',
            content: [
              { type: 'text', text: 'searching for calls' },
              { type: 'tool_use', id: TOOL_ID, name: 'search_calls', input: {} },
            ],
            messageType: 'text',
            sequenceNumber: i,
            compactedAt: null,
            toolName: null,
            toolCallId: null,
          }
        }
        // Paired tool_result row at seq 35 (inside last 10, so it is kept).
        if (i === 35) {
          return {
            id: `msg-${i}`,
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: TOOL_ID, content: 'ok' }],
            messageType: 'tool_result',
            sequenceNumber: i,
            compactedAt: null,
            toolName: 'search_calls',
            toolCallId: TOOL_ID,
          }
        }
        return {
          id: `msg-${i}`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          messageType: 'text',
          sequenceNumber: i,
          compactedAt: null,
          toolName: null,
          toolCallId: null,
        }
      })

      const result = await compactIfNeeded('session-1', 'research')

      expect(result.compacted).toBe(true)
      // 41 total, last 10 preserved (seq 31-40), pair protection also
      // preserves seq 29, so 30 messages are compacted (seq 0-28 + seq 30).
      // Without the fix, 31 would be compacted.
      expect(result.summary).toContain('30 messages compacted')
      // Extra belt-and-suspenders: the tool_use row's JSON-stringified
      // content must NOT appear in the summary because it was kept, not compacted.
      expect(result.summary).not.toContain(TOOL_ID)
    })
  })
})
