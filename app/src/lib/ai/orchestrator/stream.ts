import type { SSEStream, SSEEvent } from './types'
import type { ServerResponse } from 'http'

export function createSSEStream(res: ServerResponse): SSEStream & { eventId: number } {
  let eventId = 0

  res.on('close', () => {
    // Client disconnected — cleanup handled by caller
  })

  return {
    get eventId() { return eventId },

    send(event: Omit<SSEEvent, 'eventId'>) {
      eventId++
      const fullEvent: SSEEvent = { ...event, eventId } as SSEEvent
      const data = JSON.stringify(fullEvent)
      res.write(`id: ${eventId}\ndata: ${data}\n\n`)
    },

    close() {
      res.end()
    },
  }
}

export function writeSSEHeaders(res: ServerResponse) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
}

export function startHeartbeat(res: ServerResponse, intervalMs = 15_000): NodeJS.Timeout {
  return setInterval(() => {
    res.write(':keepalive\n\n')
  }, intervalMs)
}
