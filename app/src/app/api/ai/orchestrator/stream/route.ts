import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowSessions, workflowMessages } from '@/lib/db/schema'
import { eq, and, asc, gt } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const user = await requireAuth()
  const sessionId = req.nextUrl.searchParams.get('sessionId')

  if (!sessionId) {
    return new Response('Missing sessionId', { status: 400 })
  }

  // Verify session belongs to user
  const [session] = await db
    .select()
    .from(workflowSessions)
    .where(and(
      eq(workflowSessions.id, sessionId),
      eq(workflowSessions.userId, user.id)
    ))
    .limit(1)

  if (!session) {
    return new Response('Session not found', { status: 404 })
  }

  const lastEventId = req.headers.get('Last-Event-ID')

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder()

      // Replay missed events if client reconnected with Last-Event-ID
      if (lastEventId) {
        ;(async () => {
          try {
            const parsedId = parseInt(lastEventId, 10)
            const replayMessages = await db
              .select()
              .from(workflowMessages)
              .where(and(
                eq(workflowMessages.sessionId, sessionId),
                gt(workflowMessages.eventId, isNaN(parsedId) ? 0 : parsedId)
              ))
              .orderBy(asc(workflowMessages.createdAt))

            for (const msg of replayMessages) {
              const replayEvent = {
                type: msg.role === 'user' ? 'replay_user' : 'replay_assistant',
                content: msg.content,
                step: msg.step,
                eventType: msg.eventType,
                metadata: msg.metadata,
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(replayEvent)}\n\n`))
            }
          } catch { /* replay is best-effort */ }
        })()
      }

      // Heartbeat
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(':keepalive\n\n'))
        } catch {
          clearInterval(heartbeat)
        }
      }, 30_000)

      // Subscribe to Redis pub/sub for this session
      let subscribed = true
      ;(async () => {
        try {
          const Redis = (await import('ioredis')).default
          const sub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
          const channel = `orchestrator:${sessionId}`

          await sub.subscribe(channel)
          sub.on('message', (_ch: string, message: string) => {
            if (!subscribed) return
            try {
              const event = JSON.parse(message)
              controller.enqueue(encoder.encode(`id: ${event.eventId}\ndata: ${message}\n\n`))

              if (event.type === 'done' || event.type === 'error') {
                subscribed = false
                sub.unsubscribe(channel)
                sub.disconnect()
                clearInterval(heartbeat)
                controller.close()
              }
            } catch { /* ignore parse errors */ }
          })

          req.signal.addEventListener('abort', () => {
            subscribed = false
            sub.unsubscribe(channel)
            sub.disconnect()
            clearInterval(heartbeat)
          })
        } catch {
          clearInterval(heartbeat)
          controller.enqueue(encoder.encode('data: {"type":"error","message":"Redis unavailable"}\n\n'))
          controller.close()
        }
      })()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
