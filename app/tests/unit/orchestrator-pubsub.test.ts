import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('Orchestrator PubSub', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('getChannelName returns correct channel', async () => {
    const { getChannelName } = await import('@/lib/ai/orchestrator/pubsub')
    expect(getChannelName('session-123')).toBe('orchestrator:session-123')
  })

  it('persists replayable workflow events with durable event ids', async () => {
    const insertedRows: unknown[] = []
    const publishSpy = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/lib/db', () => ({
      db: {
        transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            select: vi.fn().mockImplementation(() => ({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                  for: vi.fn().mockResolvedValue([{ id: 'session-123' }]),
                  orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([{ eventId: 4 }]),
                  }),
                }),
              }),
            })),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockImplementation((row: unknown) => {
                insertedRows.push(row)
                return Promise.resolve()
              }),
            }),
          }
          return fn(tx)
        }),
      },
    }))

    vi.doMock('@/lib/redis/client', () => ({
      getRedis: () => ({ publish: publishSpy }),
    }))

    const { persistAndPublishReplayableEvent } = await import('@/lib/ai/orchestrator/pubsub')
    const result = await persistAndPublishReplayableEvent('session-123', {
      type: 'step_complete',
      step: 5,
      summary: 'Done',
    })

    expect(result.eventId).toBe(5)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).toMatchObject({
      sessionId: 'session-123',
      eventId: 5,
      role: 'system',
      eventType: 'step_complete',
      step: 5,
    })
    expect(publishSpy).toHaveBeenCalledTimes(1)
    expect(publishSpy.mock.calls[0][0]).toBe('orchestrator:session-123')
    expect(publishSpy.mock.calls[0][1]).toContain('"eventId":5')
    expect(publishSpy.mock.calls[0][1]).toContain('"type":"step_complete"')
  })
})
