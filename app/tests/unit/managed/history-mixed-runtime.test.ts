/**
 * history-mixed-runtime.test.ts
 *
 * Verifies that a session containing both V3-era rows and managed-native
 * rows is handled correctly:
 *   - V3 tool_call/tool_result rows are normalized to tool_use / tool_result blocks
 *   - Managed-native rows with content block arrays pass through unchanged
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

const SESSION = '33333333-3333-4333-8333-000000000002'

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

describe('loadManagedHistory — mixed V3 + managed-native', () => {
  it('normalizes V3 rows and passes managed-native rows through unchanged', async () => {
    rows.length = 0

    // V3-era sequence: user text → tool_call → tool_result
    rows.push(makeRow('11111111-1111-4111-8111-200000000001', 0, {
      role: 'user', messageType: 'text', content: 'first question',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-200000000002', 1, {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'eu' } },
      toolCallId: 'tu_v3_1', toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-200000000003', 2, {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: [] },
      toolCallId: 'tu_v3_1', toolName: 'search_calls',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-200000000004', 3, {
      role: 'assistant', messageType: 'text', content: 'V3 reply',
    }))

    // Managed-native sequence: user text + assistant with content blocks
    rows.push(makeRow('11111111-1111-4111-8111-200000000005', 4, {
      role: 'user', messageType: 'text', content: 'follow-up', runtimeMode: 'managed',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-200000000006', 5, {
      role: 'assistant', messageType: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tu_managed_1', name: 'get_call_blueprint', input: {} },
      ],
      toolCallId: 'tu_managed_1', toolName: 'get_call_blueprint',
      runtimeMode: 'managed',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-200000000007', 6, {
      role: 'user', messageType: 'tool_result',
      content: [{ type: 'tool_result', tool_use_id: 'tu_managed_1', content: '{}', is_error: false }],
      runtimeMode: 'managed',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-200000000008', 7, {
      role: 'assistant', messageType: 'text', content: 'Managed reply', runtimeMode: 'managed',
    }))

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    // Expected: user, assistant(tool_use), user(tool_result), assistant, user, assistant(blocks), user(blocks), assistant
    expect(result.messages).toHaveLength(8)

    // V3 tool_call was converted to assistant with tool_use block
    const assistantWithV3Tool = result.messages[1]
    expect(assistantWithV3Tool.role).toBe('assistant')
    const v3Blocks = assistantWithV3Tool.content as unknown as Array<Record<string, unknown>>
    expect(Array.isArray(v3Blocks)).toBe(true)
    expect(v3Blocks[0].type).toBe('tool_use')
    expect(v3Blocks[0].id).toBe('tu_v3_1')

    // V3 tool_result was converted to user with tool_result block
    const userWithV3Result = result.messages[2]
    expect(userWithV3Result.role).toBe('user')
    const resultBlocks = userWithV3Result.content as unknown as Array<Record<string, unknown>>
    expect(Array.isArray(resultBlocks)).toBe(true)
    expect(resultBlocks[0].type).toBe('tool_result')
    expect(resultBlocks[0].tool_use_id).toBe('tu_v3_1')

    // Managed-native assistant tool_use passes through unchanged
    const managedAssistant = result.messages[5]
    expect(managedAssistant.role).toBe('assistant')
    const managedBlocks = managedAssistant.content as unknown as Array<Record<string, unknown>>
    expect(managedBlocks[0].type).toBe('tool_use')
    expect(managedBlocks[0].id).toBe('tu_managed_1')

    // Managed-native user tool_result passes through unchanged
    const managedUserResult = result.messages[6]
    expect(managedUserResult.role).toBe('user')
    const managedResultBlocks = managedUserResult.content as unknown as Array<Record<string, unknown>>
    expect(managedResultBlocks[0].type).toBe('tool_result')
    expect(managedResultBlocks[0].tool_use_id).toBe('tu_managed_1')
  })
})
