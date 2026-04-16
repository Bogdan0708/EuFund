/**
 * history-null-toolcallid.test.ts
 *
 * Three sub-tests for V3 rows where toolCallId was not persisted (null):
 *   1. Single null-toolCallId tool_call + tool_result → pair via synthetic tu_legacy_<id>
 *   2. Duplicate toolName FIFO case: two consecutive null-id tool_calls for the same
 *      tool name → FIFO pairing, not toolName matching
 *   3. Mixed: some rows have toolCallId, others null → pairing is still correct
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

const SESSION = '33333333-3333-4333-8333-000000000004'

// Short IDs are intentional here — tests deliberately assert tu_legacy_<id> output
function makeRow(id: string, seq: number, overrides: Record<string, unknown>) {
  return {
    id,
    sessionId: SESSION,
    role: 'user',
    messageType: 'text',
    content: 'x',
    toolName: null,
    toolCallId: null,  // null by default for these tests
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

describe('loadManagedHistory — null toolCallId pairing', () => {
  it('single null-toolCallId: pairs via synthetic tu_legacy_<id>', async () => {
    rows.length = 0

    // id 'm-0' used for synthetic ID — the test deliberately uses short IDs
    rows.push(makeRow('m-0', 0, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'test' } },
      toolCallId: null, toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-400000000002', 1, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: [] },
      toolCallId: null, toolName: 'search_calls',
    }))

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    expect(result.messages).toHaveLength(2)

    // assistant message with synthetic ID
    const assistantMsg = result.messages[0]
    expect(assistantMsg.role).toBe('assistant')
    const assistantBlocks = assistantMsg.content as unknown as Array<Record<string, unknown>>
    expect(assistantBlocks[0].type).toBe('tool_use')
    expect(assistantBlocks[0].id).toBe('tu_legacy_m-0')

    // user message: tool_use_id should match the synthetic assistant ID (FIFO shifted)
    const userMsg = result.messages[1]
    expect(userMsg.role).toBe('user')
    const resultBlocks = userMsg.content as unknown as Array<Record<string, unknown>>
    expect(resultBlocks[0].type).toBe('tool_result')
    expect(resultBlocks[0].tool_use_id).toBe('tu_legacy_m-0')
  })

  it('duplicate toolName FIFO case: two null-id calls for same tool pair in FIFO order', async () => {
    rows.length = 0

    // Two consecutive search_calls with null toolCallId — should pair by FIFO, not toolName
    rows.push(makeRow('m-1', 0, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'first' } },
      toolCallId: null, toolName: 'search_calls',
    }))
    rows.push(makeRow('m-2', 1, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'second' } },
      toolCallId: null, toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-400000000005', 2, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: [{ title: 'first result' }] },
      toolCallId: null, toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-400000000006', 3, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: [{ title: 'second result' }] },
      toolCallId: null, toolName: 'search_calls',
    }))

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    // ONE assistant message with TWO tool_use blocks
    expect(result.messages).toHaveLength(2)

    const assistantMsg = result.messages[0]
    expect(assistantMsg.role).toBe('assistant')
    const assistantBlocks = assistantMsg.content as unknown as Array<Record<string, unknown>>
    expect(assistantBlocks).toHaveLength(2)
    expect(assistantBlocks[0].id).toBe('tu_legacy_m-1')
    expect(assistantBlocks[1].id).toBe('tu_legacy_m-2')

    // ONE user message with TWO tool_result blocks — FIFO: m-1 first, m-2 second
    const userMsg = result.messages[1]
    expect(userMsg.role).toBe('user')
    const resultBlocks = userMsg.content as unknown as Array<Record<string, unknown>>
    expect(resultBlocks).toHaveLength(2)
    expect(resultBlocks[0].tool_use_id).toBe('tu_legacy_m-1')
    expect(resultBlocks[1].tool_use_id).toBe('tu_legacy_m-2')
  })

  it('mixed: some rows have toolCallId, others null — pairing is correct', async () => {
    rows.length = 0

    // First tool_call has explicit toolCallId
    rows.push(makeRow('11111111-1111-4111-8111-400000000007', 0, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'explicit' } },
      toolCallId: 'tu_explicit', toolName: 'search_calls',
    }))
    // Second tool_call has null toolCallId — short id intentional
    rows.push(makeRow('m-9', 1, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'get_call_blueprint', arguments: { callId: 'c1' } },
      toolCallId: null, toolName: 'get_call_blueprint',
    }))
    // Results in FIFO order: first result for tu_explicit, second for tu_legacy_m-9
    rows.push(makeRow('11111111-1111-4111-8111-400000000009', 2, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: ['explicit result'] },
      toolCallId: null, toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-400000000010', 3, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: ['null id result'] },
      toolCallId: null, toolName: 'get_call_blueprint',
    }))

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    expect(result.messages).toHaveLength(2)

    const assistantBlocks = result.messages[0].content as unknown as Array<Record<string, unknown>>
    expect(assistantBlocks).toHaveLength(2)
    expect(assistantBlocks[0].id).toBe('tu_explicit')
    expect(assistantBlocks[1].id).toBe('tu_legacy_m-9')

    const resultBlocks = result.messages[1].content as unknown as Array<Record<string, unknown>>
    expect(resultBlocks).toHaveLength(2)
    // FIFO: first shift gives tu_explicit, second shift gives tu_legacy_m-9
    expect(resultBlocks[0].tool_use_id).toBe('tu_explicit')
    expect(resultBlocks[1].tool_use_id).toBe('tu_legacy_m-9')
  })
})
