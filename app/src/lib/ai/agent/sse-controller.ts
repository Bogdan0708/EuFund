// Safe wrapper around a ReadableStreamDefaultController for SSE.
//
// Web Streams throw TypeError("Invalid state: Controller is already closed")
// if any code calls .enqueue() or .close() on a controller whose stream the
// consumer has cancelled. Cloud Run cancels the consumer when its 300s request
// timeout fires; the runtime keeps running on a worker thread until it tries
// to emit the next event, at which point we get a noisy stdout error and lose
// any in-flight work cleanly.
//
// This helper makes emit() and close() idempotent and resilient: after the
// first sign of cancellation (catching the InvalidStateError once, or an
// explicit markClosed() from a cancel() hook), all further writes are
// silently suppressed and counted. close() is also idempotent.
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'sse-controller' })

export interface SafeSSEController<T> {
  emit: (event: T) => void
  close: () => void
  isClosed: () => boolean
  // Call from ReadableStream({ cancel }) so consumer-side cancellation flips
  // the flag before the next emit instead of letting the first emit eat an
  // InvalidStateError to discover it.
  markClosed: () => void
}

function isInvalidStateError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if ((err as Error & { code?: string }).code === 'ERR_INVALID_STATE') return true
  const msg = err.message
  return msg.includes('Controller is already closed') || msg.includes('Invalid state')
}

export function createSafeSSEController<T>(
  controller: ReadableStreamDefaultController<Uint8Array>,
  ctx: { sessionId?: string } = {},
): SafeSSEController<T> {
  const encoder = new TextEncoder()
  let closed = false
  let suppressed = 0

  return {
    emit(event) {
      if (closed) {
        suppressed++
        return
      }
      try {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      } catch (err) {
        if (isInvalidStateError(err)) {
          closed = true
          suppressed++
          return
        }
        throw err
      }
    },
    close() {
      if (closed) {
        if (suppressed > 0) {
          log.debug({ ...ctx, suppressed }, 'SSE writes suppressed after consumer disconnect')
        }
        return
      }
      closed = true
      try {
        controller.close()
      } catch (err) {
        if (!isInvalidStateError(err)) throw err
      } finally {
        if (suppressed > 0) {
          log.debug({ ...ctx, suppressed }, 'SSE writes suppressed after consumer disconnect')
        }
      }
    },
    isClosed: () => closed,
    markClosed: () => { closed = true },
  }
}
