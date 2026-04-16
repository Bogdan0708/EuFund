/**
 * history-v3-replay.test.ts
 *
 * Tests the Task 3 FIFO-paired loader with a canonical V3-era replay:
 * user text → V3 tool_call → V3 tool_result → assistant text
 *
 * Expected messages shape:
 *   [user text, assistant(tool_use), user(tool_result), assistant text]
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

const SESSION = '33333333-3333-4333-8333-000000000001'

function makeRow(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    sessionId: SESSION,
    role: 'user',
    messageType: 'text',
    content: 'x',
    toolName: null,
    toolCallId: null,
    sequenceNumber: 0,
    compactedAt: null,
    createdAt: new Date(),
    runtimeMode: 'managed',
    provider: null,
    model: null,
    turnId: null,
    ...overrides,
  }
}

describe('loadManagedHistory — V3 replay', () => {
  it('produces 4 messages: user text, assistant tool_use, user tool_result, assistant text', async () => {
    rows.length = 0
    rows.push(makeRow('11111111-1111-4111-8111-100000000001', {
      role: 'user', messageType: 'text', content: 'hello', sequenceNumber: 0,
    }))
    rows.push(makeRow('11111111-1111-4111-8111-100000000002', {
      role: 'assistant', messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { q: 'pnrr' } },
      toolCallId: 'tu_1', toolName: 'search_calls', sequenceNumber: 1,
      runtimeMode: 'v3',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-100000000003', {
      role: 'tool', messageType: 'tool_result',
      content: { success: true, data: [{ title: 'PNRR call' }] },
      toolCallId: 'tu_1', toolName: 'search_calls', sequenceNumber: 2,
      runtimeMode: 'v3',
    }))
    rows.push(makeRow('11111111-1111-4111-8111-100000000004', {
      role: 'assistant', messageType: 'text', content: 'done', sequenceNumber: 3,
      runtimeMode: 'managed',
    }))

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    expect(result.messages).toHaveLength(4)

    // msg 0: user text
    const [m0, m1, m2, m3] = result.messages
    expect(m0.role).toBe('user')
    expect(m0.content).toBe('hello')

    // msg 1: assistant with one tool_use block
    expect(m1.role).toBe('assistant')
    expect(Array.isArray(m1.content)).toBe(true)
    const blocks1 = m1.content as Array<Record<string, unknown>>
    expect(blocks1).toHaveLength(1)
    expect(blocks1[0].type).toBe('tool_use')
    expect(blocks1[0].id).toBe('tu_1')
    expect(blocks1[0].name).toBe('search_calls')
    expect((blocks1[0].input as Record<string, unknown>).q).toBe('pnrr')

    // msg 2: user with one tool_result block
    expect(m2.role).toBe('user')
    expect(Array.isArray(m2.content)).toBe(true)
    const blocks2 = m2.content as Array<Record<string, unknown>>
    expect(blocks2).toHaveLength(1)
    expect(blocks2[0].type).toBe('tool_result')
    expect(blocks2[0].tool_use_id).toBe('tu_1')

    // msg 3: assistant text
    expect(m3.role).toBe('assistant')
    expect(m3.content).toBe('done')
  })
})
