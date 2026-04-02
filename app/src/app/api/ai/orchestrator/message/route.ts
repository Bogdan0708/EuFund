import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { processMessage, createSession } from '@/lib/ai/orchestrator/engine'
import { createGatewayClient } from '@/lib/ai/orchestrator/gateway'
import { createPubSubStream } from '@/lib/ai/orchestrator/pubsub'
import { logger } from '@/lib/logger'
import { getRedis } from '@/lib/redis/client'

const log = logger.child({ component: 'orchestrator-message' })

const LOCK_TTL_SECONDS = 300 // 5 minutes

async function acquireLock(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    if (!redis) return true // fail-open when Redis is not configured
    const result = await redis.set(`orchestrator:lock:${sessionId}`, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
    return result === 'OK'
  } catch {
    return true // fail-open for lock — if Redis is down, allow the request
  }
}

async function releaseLock(sessionId: string): Promise<void> {
  try {
    const redis = getRedis()
    if (!redis) return
    await redis.del(`orchestrator:lock:${sessionId}`)
  } catch {
    // Best-effort release — TTL handles cleanup
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const { sessionId, message, locale } = body

    if (!message && !sessionId) {
      return NextResponse.json({ error: 'message or sessionId required' }, { status: 400 })
    }

    if (!sessionId) {
      // Create new session (no billing gates — single-user dev mode)
      const session = await createSession(user.id, locale || 'ro', 'free')

      // Process first message asynchronously
      const stream = createPubSubStream(session.id)
      const gateway = createGatewayClient('fondeu')
      log.info({ sessionId: session.id, userId: user.id }, 'New session created, processing message')
      await acquireLock(session.id)
      processMessage(session.id, message, stream, gateway).then(() => {
        releaseLock(session.id)
      }).catch((err) => {
        releaseLock(session.id)
        log.error({ error: err instanceof Error ? err.message : String(err), sessionId: session.id }, 'processMessage failed')
      })

      return NextResponse.json({ sessionId: session.id }, { status: 202 })
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
      await releaseLock(sessionId)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const locked = await acquireLock(sessionId)
    if (!locked) {
      return NextResponse.json({ error: 'Session is already processing a message. Please wait.' }, { status: 409 })
    }

    // Process message asynchronously
    const sseStream = createPubSubStream(sessionId)
    const gateway = createGatewayClient('fondeu')
    log.info({ sessionId, userId: user.id }, 'Resuming session, processing message')
    processMessage(sessionId, message, sseStream, gateway).then(() => {
      releaseLock(sessionId)
    }).catch((err) => {
      releaseLock(sessionId)
      log.error({ error: err instanceof Error ? err.message : String(err), sessionId }, 'processMessage failed')
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, 'Orchestrator message handler failed')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
