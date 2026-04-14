import type { SSEEvent, SSEStream } from './types'

export function getChannelName(sessionId: string): string {
  return `orchestrator:${sessionId}`
}

export async function publishEvent(sessionId: string, event: SSEEvent): Promise<void> {
  try {
    const { getRedis } = await import('@/lib/redis/client')
    const redis = getRedis()
    if (!redis) return
    await redis.publish(getChannelName(sessionId), JSON.stringify(event))
  } catch {
    // Non-fatal — SSE event lost but workflow continues
  }
}

export function createPubSubStream(sessionId: string): SSEStream {
  let eventId = 0
  return {
    send(event) {
      eventId++
      const fullEvent = { ...event, eventId } as SSEEvent
      publishEvent(sessionId, fullEvent)
    },
    close() {
      // Publish a close signal
      publishEvent(sessionId, { eventId: ++eventId, type: 'done' } as SSEEvent)
    },
  }
}
