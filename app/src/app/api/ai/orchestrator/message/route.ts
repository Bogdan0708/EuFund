import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { users, workflowSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { processMessage, createSession } from '@/lib/ai/orchestrator/engine'
import { checkWorkflowLimit, incrementWorkflowCount } from '@/lib/billing/usage'
import { createGatewayClient } from '@/lib/ai/orchestrator/gateway'
import { createPubSubStream } from '@/lib/ai/orchestrator/pubsub'

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const { sessionId, message, locale } = body

    if (!message && !sessionId) {
      return NextResponse.json({ error: 'message or sessionId required' }, { status: 400 })
    }

    // Get user tier
    const [dbUser] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, user.id)).limit(1)
    const tier = dbUser?.tier || 'free'

    if (!sessionId) {
      // Create new session
      const limitCheck = await checkWorkflowLimit(user.id, tier)
      if (!limitCheck.allowed) {
        return NextResponse.json({ error: limitCheck.message }, { status: 429 })
      }
      await incrementWorkflowCount(user.id)
      const session = await createSession(user.id, locale || 'ro', tier)

      // Process first message asynchronously
      const stream = createPubSubStream(session.id)
      const gateway = createGatewayClient('fondeu')
      processMessage(session.id, message, stream, gateway).catch(() => {
        // Error already sent via SSE
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
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Process message asynchronously
    const sseStream = createPubSubStream(sessionId)
    const gateway = createGatewayClient('fondeu')
    processMessage(sessionId, message, sseStream, gateway).catch(() => {
      // Error already sent via SSE
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
