/**
 * history-compacted.test.ts
 *
 * Verifies that rows with compactedAt set are dropped from the output messages.
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

const SESSION = '33333333-3333-4333-8333-000000000005'

describe('loadManagedHistory — compacted rows', () => {
  it('drops rows with compactedAt set', async () => {
    rows.length = 0

    rows.push({
      id: '11111111-1111-4111-8111-500000000001',
      sessionId: SESSION,
      role: 'user',
      messageType: 'text',
      content: 'old compacted message',
      toolName: null,
      toolCallId: null,
      sequenceNumber: 0,
      compactedAt: new Date('2026-01-01T00:00:00Z'),  // compacted — should be dropped
      createdAt: new Date(),
      runtimeMode: 'v3',
      provider: null,
      model: null,
      turnId: null,
    })
    rows.push({
      id: '11111111-1111-4111-8111-500000000002',
      sessionId: SESSION,
      role: 'user',
      messageType: 'text',
      content: 'live message',
      toolName: null,
      toolCallId: null,
      sequenceNumber: 1,
      compactedAt: null,  // not compacted — should appear in messages
      createdAt: new Date(),
      runtimeMode: 'managed',
      provider: null,
      model: null,
      turnId: null,
    })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    // Only the non-compacted row should appear
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].content).toBe('live message')
  })

  it('drops ALL rows when all are compacted', async () => {
    rows.length = 0

    rows.push({
      id: '11111111-1111-4111-8111-500000000003',
      sessionId: SESSION,
      role: 'user',
      messageType: 'text',
      content: 'old message 1',
      toolName: null,
      toolCallId: null,
      sequenceNumber: 0,
      compactedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date(),
      runtimeMode: 'v3',
      provider: null,
      model: null,
      turnId: null,
    })
    rows.push({
      id: '11111111-1111-4111-8111-500000000004',
      sessionId: SESSION,
      role: 'assistant',
      messageType: 'text',
      content: 'old message 2',
      toolName: null,
      toolCallId: null,
      sequenceNumber: 1,
      compactedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date(),
      runtimeMode: 'v3',
      provider: null,
      model: null,
      turnId: null,
    })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory(SESSION)

    expect(result.messages).toHaveLength(0)
    expect(result.systemSummary).toBeNull()
  })
})
