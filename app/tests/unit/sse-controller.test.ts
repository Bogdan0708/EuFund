// Unit tests for the safe SSE controller wrapper.
//
// Background: prod incident 2026-05-18 logged "Invalid state: Controller is
// already closed" from the V3 agent runtime ~90s after Cloud Run cancelled
// the request at its 300s timeout. The runtime kept running on a worker
// thread, then tried to emit one more event onto a controller the consumer
// had already torn down — Web Streams throws TypeError on enqueue-after-close.
// This wrapper makes emit() and close() idempotent and quiet.

import { describe, it, expect, vi } from 'vitest'
import { createSafeSSEController } from '@/lib/ai/agent/sse-controller'

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) },
}))

function makeFakeController(opts: { closeMode?: 'silent' | 'throw'; enqueueAfterClose?: 'throw' | 'silent' } = {}) {
  const chunks: string[] = []
  let closed = false
  const decoder = new TextDecoder()
  const closeMode = opts.closeMode ?? 'silent'
  const enqueueAfterClose = opts.enqueueAfterClose ?? 'throw'

  const controller = {
    enqueue(chunk: Uint8Array) {
      if (closed) {
        if (enqueueAfterClose === 'throw') {
          throw new TypeError('Invalid state: Controller is already closed')
        }
        return
      }
      chunks.push(decoder.decode(chunk))
    },
    close() {
      if (closed) {
        if (closeMode === 'throw') {
          throw new TypeError('Invalid state: Controller is already closed')
        }
        return
      }
      closed = true
    },
    error(_e: unknown) { /* unused in these tests */ },
    get desiredSize() { return closed ? null : 1 },
  } as unknown as ReadableStreamDefaultController<Uint8Array>

  return {
    controller,
    chunks,
    isClosed: () => closed,
    forceClose: () => { closed = true },
  }
}

describe('createSafeSSEController', () => {
  it('serializes events as SSE frames and enqueues them on the controller', () => {
    const { controller, chunks } = makeFakeController()
    const sse = createSafeSSEController<{ type: string; payload?: string }>(controller)

    sse.emit({ type: 'hello' })
    sse.emit({ type: 'data', payload: 'world' })

    expect(chunks).toEqual([
      'data: {"type":"hello"}\n\n',
      'data: {"type":"data","payload":"world"}\n\n',
    ])
  })

  it('suppresses emits after explicit close() (idempotent close, silent emits)', () => {
    const { controller, chunks } = makeFakeController()
    const sse = createSafeSSEController(controller)

    sse.emit({ type: 'a' })
    sse.close()
    sse.emit({ type: 'b' })
    sse.close()
    sse.close()

    expect(chunks).toEqual(['data: {"type":"a"}\n\n'])
    expect(sse.isClosed()).toBe(true)
  })

  it('does not throw when the controller throws InvalidStateError on enqueue (consumer-canceled)', () => {
    const { controller, forceClose } = makeFakeController()
    const sse = createSafeSSEController(controller)

    sse.emit({ type: 'first' })
    forceClose() // simulate Cloud Run / browser cancellation

    expect(() => sse.emit({ type: 'second' })).not.toThrow()
    expect(() => sse.emit({ type: 'third' })).not.toThrow()
    expect(sse.isClosed()).toBe(true)
  })

  it('also swallows InvalidStateError shapes that carry code=ERR_INVALID_STATE', () => {
    const { controller } = makeFakeController()
    // Override enqueue to throw a Node-style ERR_INVALID_STATE
    let firstWriteDone = false
    Object.defineProperty(controller, 'enqueue', {
      value: (_chunk: Uint8Array) => {
        if (firstWriteDone) {
          const err = new Error('something went wrong')
          ;(err as Error & { code: string }).code = 'ERR_INVALID_STATE'
          throw err
        }
        firstWriteDone = true
      },
    })
    const sse = createSafeSSEController(controller)
    sse.emit({ type: 'ok' })
    expect(() => sse.emit({ type: 'after' })).not.toThrow()
    expect(sse.isClosed()).toBe(true)
  })

  it('rethrows enqueue errors that are NOT InvalidStateError', () => {
    const { controller } = makeFakeController()
    Object.defineProperty(controller, 'enqueue', {
      value: () => { throw new Error('disk full') },
    })
    const sse = createSafeSSEController(controller)
    expect(() => sse.emit({ type: 'x' })).toThrow(/disk full/)
  })

  it('markClosed() flips the closed flag without touching the controller (for ReadableStream cancel hook)', () => {
    const { controller, chunks } = makeFakeController()
    const sse = createSafeSSEController(controller)

    sse.emit({ type: 'before' })
    sse.markClosed()
    sse.emit({ type: 'after-cancel' })

    expect(chunks).toEqual(['data: {"type":"before"}\n\n'])
    expect(sse.isClosed()).toBe(true)
  })

  it('close() swallows InvalidStateError thrown by the underlying controller.close()', () => {
    const { controller } = makeFakeController({ closeMode: 'throw' })
    const sse = createSafeSSEController(controller)

    sse.emit({ type: 'ok' })
    // Simulate a concurrent close (consumer canceled then we call close)
    sse.markClosed()
    // Now isClosed=true, so our close() is a no-op (no controller.close call).
    expect(() => sse.close()).not.toThrow()
  })

  it('close() rethrows non-InvalidState errors from the underlying controller', () => {
    const { controller } = makeFakeController()
    Object.defineProperty(controller, 'close', {
      value: () => { throw new Error('quota exceeded') },
    })
    const sse = createSafeSSEController(controller)
    expect(() => sse.close()).toThrow(/quota exceeded/)
  })
})
