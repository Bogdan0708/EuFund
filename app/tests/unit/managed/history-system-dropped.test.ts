/**
 * history-system-dropped.test.ts
 *
 * Verifies that system rows that are NOT system_summary are dropped
 * (classified as system_drop or unknown_drop) and do not appear in messages.
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

const SESSION = '33333333-3333-4333-8333-000000000006'

describe('loadManagedHistory — system rows dropped', () => {
  it('drops a system role text row (non system_summary)', async () => {
    rows.length = 0

    // A system role row with messageType='text' — classified as system_drop
    rows.push({
      id: '11111111-1111-4111-8111-600000000001',
      sessionId: SESSION,
      role: 'system',
      messageType: 'text',
      content: 'unrelated system message',
      toolName: null,
      toolCallId: null,
      sequenceNumber: 0,
      compactedAt: null,
      createdAt: new Date(),
      runtimeMode: 'v3',
      provider: null,
      model: null,
      turnId: null,
    })
    // A valid user message that should appear
    rows.push({
      id: '11111111-1111-4111-8111-600000000002',
      sessionId: SESSION,
      role: 'user',
      messageType: 'text',
      content: 'actual user message',
      toolName: null,
      toolCallId: null,
      sequenceNumber: 1,
      compactedAt: null,
      createdAt: new Date(),
      runtimeMode: 'managed',
      provider: null,
      model: null,
      turnId: null,
    })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    // system row should be dropped, only user message remains
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('user')
    expect(result.messages[0].content).toBe('actual user message')
  })

  it('drops user structured_action rows (V3 control-plane)', async () => {
    rows.length = 0

    rows.push({
      id: '11111111-1111-4111-8111-600000000003',
      sessionId: SESSION,
      role: 'user',
      messageType: 'structured_action',
      content: { action: 'SET_PHASE', phase: 'research' },
      toolName: null,
      toolCallId: null,
      sequenceNumber: 0,
      compactedAt: null,
      createdAt: new Date(),
      runtimeMode: 'v3',
      provider: null,
      model: null,
      turnId: null,
    })
    rows.push({
      id: '11111111-1111-4111-8111-600000000004',
      sessionId: SESSION,
      role: 'assistant',
      messageType: 'text',
      content: 'normal reply',
      toolName: null,
      toolCallId: null,
      sequenceNumber: 1,
      compactedAt: null,
      createdAt: new Date(),
      runtimeMode: 'managed',
      provider: null,
      model: null,
      turnId: null,
    })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    // structured_action should be dropped
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].role).toBe('assistant')
    expect(result.messages[0].content).toBe('normal reply')
  })
})
