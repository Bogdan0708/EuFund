import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn()
const selectChain = (lastSeq: number | null) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(lastSeq === null ? [] : [{ sequenceNumber: lastSeq }]),
      })),
    })),
  })),
})

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: insertMock })),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number' },
  agentSessions: {},
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), isNull: vi.fn(), asc: vi.fn(), desc: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

describe('appendMessage', () => {
  beforeEach(() => { insertMock.mockReset() })

  it('inserts with turn_id null when turnId omitted', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain(null) as never)

    insertMock.mockResolvedValueOnce(undefined)
    const { appendMessage } = await import('@/lib/ai/agent/history')

    await appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' })
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(insertMock.mock.calls[0][0].turnId).toBeNull()
  })

  it('inserts with provided turnId', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select).mockReturnValueOnce(selectChain(null) as never)
    insertMock.mockResolvedValueOnce(undefined)
    const { appendMessage } = await import('@/lib/ai/agent/history')

    await appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi', turnId: 'tu-9' })
    expect(insertMock.mock.calls[0][0].turnId).toBe('tu-9')
  })

  it('retries once on PG 23505', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain(0) as never)
      .mockReturnValueOnce(selectChain(1) as never)

    insertMock
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
      .mockResolvedValueOnce(undefined)

    const { appendMessage } = await import('@/lib/ai/agent/history')
    const seq = await appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' })
    expect(insertMock).toHaveBeenCalledTimes(2)
    expect(seq).toBe(2)
  })

  it('throws on second 23505', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain(0) as never)
      .mockReturnValueOnce(selectChain(1) as never)

    const dup = Object.assign(new Error('dup'), { code: '23505' })
    insertMock
      .mockRejectedValueOnce(dup)
      .mockRejectedValueOnce(dup)

    const { appendMessage } = await import('@/lib/ai/agent/history')
    await expect(appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' }))
      .rejects.toThrow(/sequence number conflict/)
  })

  it('rethrows non-23505 immediately', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select).mockReturnValueOnce(selectChain(0) as never)
    insertMock.mockRejectedValueOnce(new Error('connection lost'))
    const { appendMessage } = await import('@/lib/ai/agent/history')
    await expect(appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' }))
      .rejects.toThrow('connection lost')
    expect(insertMock).toHaveBeenCalledTimes(1)
  })
})
