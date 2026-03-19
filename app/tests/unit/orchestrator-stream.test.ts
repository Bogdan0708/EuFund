import { describe, it, expect, vi } from 'vitest'

describe('SSE Stream Manager', () => {
  it('sends formatted SSE events', async () => {
    const { createSSEStream } = await import('@/lib/ai/orchestrator/stream')
    const mockWrite = vi.fn()
    const mockRes = { write: mockWrite, on: vi.fn() } as any
    const stream = createSSEStream(mockRes)

    stream.send({ type: 'step_start', step: 1, label: 'Testing...' })

    expect(mockWrite).toHaveBeenCalledTimes(1)
    const written = mockWrite.mock.calls[0][0] as string
    expect(written).toContain('id: 1')
    expect(written).toContain('"type":"step_start"')
    expect(written).toContain('"step":1')
  })

  it('increments eventId for each event', async () => {
    const { createSSEStream } = await import('@/lib/ai/orchestrator/stream')
    const mockWrite = vi.fn()
    const mockRes = { write: mockWrite, on: vi.fn() } as any
    const stream = createSSEStream(mockRes)

    stream.send({ type: 'step_start', step: 1, label: 'First' })
    stream.send({ type: 'step_complete', step: 1, summary: 'Done' })

    const first = mockWrite.mock.calls[0][0] as string
    const second = mockWrite.mock.calls[1][0] as string
    expect(first).toContain('id: 1')
    expect(second).toContain('id: 2')
  })
})
