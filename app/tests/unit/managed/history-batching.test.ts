/**
 * history-batching.test.ts
 *
 * Tests that:
 *   1. Two consecutive V3 tool_call rows from the same assistant turn are
 *      batched into ONE assistant message with TWO tool_use content blocks.
 *   2. Their matching V3 tool_result rows are batched into ONE user message
 *      with TWO tool_result content blocks.
 */
import { describe, it, expect, vi } from 'vitest'

const rows: Array<Record<string, unknown>> = []
const sessionRow: Array<Record<string, unknown>> = [{ messageSummary: null }]

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => ({
        where: vi.fn().mockImplementation(() => ({
          orderBy: vi.fn().mockImplementation(() => Promise.resolve(rows)),
          limit: vi.fn().mockImplementation(() => Promise.resolve(sessionRow)),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number' },
  agentSessions: { id: 'id', messageSummary: 'message_summary' },
}))

const SESSION = '33333333-3333-4333-8333-000000000003'

function makeRow(id: string, seq: number, overrides: Record<string, unknown>) {
  return {
    id,
    sessionId: SESSION,
    role: 'user',
    messageType: 'text',
    content: 'x',
    toolName: null,
    toolCallId: null,
    sequenceNumber: seq,
    compactedAt: null,
    createdAt: new Date(),
    runtimeMode: 'v3',
    provider: null,
    model: null,
    turnId: null,
    ...overrides,
  }
}

describe('loadManagedHistory — batching', () => {
  it('batches two consecutive V3 tool_call rows into one assistant message with two tool_use blocks', async () => {
    rows.length = 0

    rows.push(makeRow('11111111-1111-4111-8111-300000000001', 0, {
      role: 'user', messageType: 'text', content: 'search for both',
    }))
    // Two consecutive tool_call rows from same assistant turn
    rows.push(makeRow('11111111-1111-4111-8111-300000000002', 1, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'pnrr' } },
      toolCallId: 'tu_batch_1', toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-300000000003', 2, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'peo' } },
      toolCallId: 'tu_batch_2', toolName: 'search_calls',
    }))
    // Two consecutive tool_result rows
    rows.push(makeRow('11111111-1111-4111-8111-300000000004', 3, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: [{ title: 'PNRR result' }] },
      toolCallId: 'tu_batch_1', toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-300000000005', 4, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: [{ title: 'PEO result' }] },
      toolCallId: 'tu_batch_2', toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-300000000006', 5, {
      role: 'assistant', messageType: 'text', content: 'here are the results',
      runtimeMode: 'managed',
    }))

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    // Expected shape: user, assistant(2x tool_use), user(2x tool_result), assistant text
    expect(result.messages).toHaveLength(4)

    // user text
    expect(result.messages[0].role).toBe('user')
    expect(result.messages[0].content).toBe('search for both')

    // ONE assistant message with TWO tool_use blocks
    const assistantMsg = result.messages[1]
    expect(assistantMsg.role).toBe('assistant')
    const assistantBlocks = assistantMsg.content as Array<Record<string, unknown>>
    expect(Array.isArray(assistantBlocks)).toBe(true)
    expect(assistantBlocks).toHaveLength(2)
    expect(assistantBlocks[0].type).toBe('tool_use')
    expect(assistantBlocks[0].id).toBe('tu_batch_1')
    expect(assistantBlocks[0].name).toBe('search_calls')
    expect((assistantBlocks[0].input as Record<string, unknown>).q).toBe('pnrr')
    expect(assistantBlocks[1].type).toBe('tool_use')
    expect(assistantBlocks[1].id).toBe('tu_batch_2')
    expect((assistantBlocks[1].input as Record<string, unknown>).q).toBe('peo')

    // ONE user message with TWO tool_result blocks (FIFO: tu_batch_1 first, tu_batch_2 second)
    const userResultMsg = result.messages[2]
    expect(userResultMsg.role).toBe('user')
    const resultBlocks = userResultMsg.content as Array<Record<string, unknown>>
    expect(Array.isArray(resultBlocks)).toBe(true)
    expect(resultBlocks).toHaveLength(2)
    expect(resultBlocks[0].type).toBe('tool_result')
    expect(resultBlocks[0].tool_use_id).toBe('tu_batch_1')
    expect(resultBlocks[1].type).toBe('tool_result')
    expect(resultBlocks[1].tool_use_id).toBe('tu_batch_2')

    // assistant text
    expect(result.messages[3].role).toBe('assistant')
    expect(result.messages[3].content).toBe('here are the results')
  })
})
