// app/src/app/api/ai/agent/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentEvent, AgentSession, AgentSection } from '@/lib/ai/agent/types'
import type { AgentRequest } from '@/lib/ai/agent/types'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'api-agent' })

async function handler(req: NextRequest) {
  const user = await requireAuth()

  // Feature flag check
  const enabled = await isFeatureEnabled('agent_v3_enabled', { userId: user.id })
  if (!enabled) {
    return NextResponse.json(
      { error: 'Agent V3 is not enabled for your account' },
      { status: 403 },
    )
  }

  const body = (await req.json()) as AgentRequest
  if (!body.requestId || !body.locale) {
    return NextResponse.json({ error: 'Missing requestId or locale' }, { status: 400 })
  }

  // Load or create session
  let session: AgentSession
  let sections: AgentSection[]

  if (body.sessionId) {
    // Load existing session
    const [row] = await db
      .select()
      .from(agentSessions)
      .where(and(eq(agentSessions.id, body.sessionId), eq(agentSessions.userId, user.id)))
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Optimistic concurrency: reject stale writes
    if (typeof body.stateVersion === 'number') {
      if (body.stateVersion !== (row.stateVersion as number)) {
        return NextResponse.json(
          { error: 'Stale state — reload and retry', currentVersion: row.stateVersion },
          { status: 409 },
        )
      }
    }

    session = mapSessionRow(row)

    const sectionRows = await db
      .select()
      .from(agentSections)
      .where(eq(agentSections.sessionId, body.sessionId))

    sections = sectionRows.map(mapSectionRow)
  } else {
    // Create new session
    const [newRow] = await db
      .insert(agentSessions)
      .values({
        userId: user.id,
        locale: body.locale,
        status: 'active',
        currentPhase: 'discovery',
      })
      .returning()

    session = mapSessionRow(newRow)
    sections = []
    log.info({ sessionId: session.id, userId: user.id }, 'New agent session created')
  }

  // Stream response via SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      try {
        await runAgentTurn({ session, sections, request: body, emit })
      } catch (error) {
        const errorEvent: AgentEvent = {
          type: 'error',
          message: error instanceof Error ? error.message : 'Internal error',
          retryable: true,
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function mapSessionRow(row: Record<string, unknown>): AgentSession {
  return {
    id: row.id as string,
    userId: row.userId as string,
    status: row.status as AgentSession['status'],
    locale: row.locale as 'ro' | 'en',
    selectedCallId: row.selectedCallId as string | null,
    currentPhase: row.currentPhase as AgentSession['currentPhase'],
    blueprint: row.blueprint as AgentSession['blueprint'],
    eligibility: row.eligibility as AgentSession['eligibility'],
    outline: row.outline as AgentSession['outline'],
    warnings: (row.warnings as AgentSession['warnings']) || [],
    planningArtifact: row.planningArtifact as AgentSession['planningArtifact'],
    outlineFrozen: (row.outlineFrozen as boolean) || false,
    messageSummary: row.messageSummary as string | null,
    stateVersion: row.stateVersion as number,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

function mapSectionRow(row: Record<string, unknown>): AgentSection {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    sectionKey: row.sectionKey as string,
    title: row.title as string,
    documentOrder: row.documentOrder as number,
    generationOrder: row.generationOrder as number,
    status: row.status as AgentSection['status'],
    content: row.content as string | null,
    acceptedContent: row.acceptedContent as string | null,
    modelUsed: row.modelUsed as string | null,
    retryCount: row.retryCount as number,
    sourcesUsed: row.sourcesUsed as string[] | null,
    promptVersion: row.promptVersion as string | null,
    latencyMs: row.latencyMs as number | null,
    tokenUsage: row.tokenUsage as AgentSection['tokenUsage'],
    errorClass: row.errorClass as string | null,
    updatedAt: row.updatedAt as Date,
  }
}

export const POST = withRateLimit(
  { keyPrefix: 'agent-turn', maxRequests: 30, windowMs: 60_000 },
  handler,
)
