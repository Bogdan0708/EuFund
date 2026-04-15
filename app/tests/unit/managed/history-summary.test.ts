import { describe, it, expect, vi } from 'vitest'

const rows: Array<Record<string, unknown>> = []

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve(rows) }),
      }),
    }),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number' },
  agentSessions: { id: 'id' },
}))

describe('loadManagedHistory with summary', () => {
  it('returns summary from a system_summary row when present', async () => {
    rows.length = 0
    rows.push({ role: 'system', messageType: 'system_summary', content: 'earlier context summary', compactedAt: null, sequenceNumber: 0 })
    rows.push({ role: 'user', messageType: 'text', content: 'live msg', compactedAt: null, sequenceNumber: 3 })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('session-1')
    expect(result.summary).toBe('earlier context summary')
    expect(result.messages.map(m => m.role)).toEqual(['user'])
  })

  it('falls back to session.messageSummary when no system_summary row', async () => {
    rows.length = 0
    rows.push({ role: 'user', messageType: 'text', content: 'live msg', compactedAt: null, sequenceNumber: 0 })
    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('session-2', { fallbackSummary: 'session-durable-summary' })
    expect(result.summary).toBe('session-durable-summary')
  })

  it('returns summary null when neither source is present', async () => {
    rows.length = 0
    rows.push({ role: 'user', messageType: 'text', content: 'a', compactedAt: null, sequenceNumber: 0 })
    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('session-3')
    expect(result.summary).toBeNull()
  })
})
