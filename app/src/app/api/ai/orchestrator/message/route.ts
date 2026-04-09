import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { workflowSessions, userPreferences } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { processMessage, createSession } from '@/lib/ai/orchestrator/engine'
import { createGatewayClient } from '@/lib/ai/orchestrator/gateway'
import { createPubSubStream } from '@/lib/ai/orchestrator/pubsub'
import { logger } from '@/lib/logger'
import { getRedis } from '@/lib/redis/client'
import { getAIModelRoutingContext } from '@/lib/ai/model-routing'

interface UserAIPrefs {
  modelPreference?: string
  responseStyle?: 'concise' | 'detailed' | 'technical'
  autoApprove?: boolean
}

async function getUserAIPreferences(userId: string): Promise<UserAIPrefs> {
  try {
    const [prefs] = await db
      .select({
        defaultModel: userPreferences.defaultModel,
        responseStyle: userPreferences.responseStyle,
        autoApprove: userPreferences.autoApprove,
      })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1)
    if (!prefs) return {}
    return {
      modelPreference: prefs.defaultModel,
      responseStyle: prefs.responseStyle as 'concise' | 'detailed' | 'technical' | undefined,
      autoApprove: prefs.autoApprove,
    }
  } catch {
    return {}
  }
}

const log = logger.child({ component: 'orchestrator-message' })

const LOCK_TTL_SECONDS = 300 // 5 minutes

async function acquireLock(sessionId: string): Promise<'acquired' | 'busy' | 'unavailable'> {
  try {
    const redis = getRedis()
    if (!redis) return 'unavailable'
    const result = await redis.set(`orchestrator:lock:${sessionId}`, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
    return result === 'OK' ? 'acquired' : 'busy'
  } catch {
    return 'unavailable'
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

    // Load user's AI preferences and routing context once per request
    const aiPrefs = await getUserAIPreferences(user.id)
    const { modelPreference, responseStyle, autoApprove } = aiPrefs
    const routingCtx = await getAIModelRoutingContext(user.id)

    if (!sessionId) {
      // Create new session (no billing gates — single-user dev mode)
      const session = await createSession(user.id, locale || 'ro', 'free', responseStyle)

      // Process first message asynchronously
      const stream = createPubSubStream(session.id)
      const gateway = createGatewayClient('fondeu')
      log.info({ sessionId: session.id, userId: user.id, modelPreference, responseStyle, autoApprove }, 'New session created, processing message')
      const lockStatus = await acquireLock(session.id)
      if (lockStatus === 'unavailable') {
        return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
      }
      processMessage(session.id, message, stream, gateway, false, { responseStyle, autoApprove, routingCtx }).then(() => {
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

    const lockStatus = await acquireLock(sessionId)
    if (lockStatus === 'unavailable') {
      return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 })
    }
    if (lockStatus === 'busy') {
      return NextResponse.json({ error: 'Session is already processing a message. Please wait.' }, { status: 409 })
    }

    // Process message asynchronously
    const sseStream = createPubSubStream(sessionId)
    const gateway = createGatewayClient('fondeu')
    log.info({ sessionId, userId: user.id, modelPreference, responseStyle, autoApprove }, 'Resuming session, processing message')
    processMessage(sessionId, message, sseStream, gateway, false, { responseStyle, autoApprove, routingCtx }).then(() => {
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
