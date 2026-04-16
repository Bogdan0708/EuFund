import { describe, it, expect, vi } from 'vitest'

// Shared fixture arrays that tests mutate
const rows: Array<Record<string, unknown>> = []
let sessionRow: Array<Record<string, unknown>> = []

vi.mock('@/lib/db', () => ({
  db: {
    // The new loader calls db.select() twice in Promise.all:
    //   call 1 → agentMessages rows (via .from().where().orderBy())
    //   call 2 → agentSessions row  (via .from().where().limit())
    select: vi.fn()
      .mockImplementation(() => ({
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

describe('loadManagedHistory with summary (Task 3 real behavior)', () => {
  it('returns systemSummary from a system_summary row and excludes it from messages', async () => {
    rows.length = 0
    sessionRow = [{ messageSummary: null }]
    rows.push({
      id: '11111111-1111-4111-8111-000000000001',
      role: 'system',
      messageType: 'system_summary',
      content: 'earlier context summary',
      compactedAt: null,
      sequenceNumber: 0,
      toolName: null, toolCallId: null,
      runtimeMode: 'managed', provider: null, model: null,
      createdAt: new Date(), turnId: null,
      sessionId: '22222222-2222-4222-8222-000000000001',
    })
    rows.push({
      id: '11111111-1111-4111-8111-000000000002',
      role: 'user',
      messageType: 'text',
      content: 'live msg',
      compactedAt: null,
      sequenceNumber: 3,
      toolName: null, toolCallId: null,
      runtimeMode: 'managed', provider: null, model: null,
      createdAt: new Date(), turnId: null,
      sessionId: '22222222-2222-4222-8222-000000000001',
    })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('22222222-2222-4222-8222-000000000001')
    // system_summary row should be extracted into systemSummary, not in messages
    expect(result.systemSummary).toBe('earlier context summary')
    expect(result.messages.map(m => m.role)).toEqual(['user'])
    expect(result.messages).toHaveLength(1)
  })

  it('falls back to session.messageSummary when no system_summary row exists', async () => {
    rows.length = 0
    sessionRow = [{ messageSummary: 'session-durable-summary' }]
    rows.push({
      id: '11111111-1111-4111-8111-000000000003',
      role: 'user',
      messageType: 'text',
      content: 'live msg',
      compactedAt: null,
      sequenceNumber: 0,
      toolName: null, toolCallId: null,
      runtimeMode: 'managed', provider: null, model: null,
      createdAt: new Date(), turnId: null,
      sessionId: '22222222-2222-4222-8222-000000000002',
    })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('22222222-2222-4222-8222-000000000002')
    // Should use session.messageSummary as fallback
    expect(result.systemSummary).toBe('session-durable-summary')
  })

  it('returns systemSummary null when neither system_summary row nor session.messageSummary is present', async () => {
    rows.length = 0
    sessionRow = [{ messageSummary: null }]
    rows.push({
      id: '11111111-1111-4111-8111-000000000004',
      role: 'user',
      messageType: 'text',
      content: 'a',
      compactedAt: null,
      sequenceNumber: 0,
      toolName: null, toolCallId: null,
      runtimeMode: 'managed', provider: null, model: null,
      createdAt: new Date(), turnId: null,
      sessionId: '22222222-2222-4222-8222-000000000003',
    })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('22222222-2222-4222-8222-000000000003')
    expect(result.systemSummary).toBeNull()
  })
})
