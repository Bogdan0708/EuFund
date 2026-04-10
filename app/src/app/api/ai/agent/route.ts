// app/src/app/api/ai/agent/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentEvent, AgentSession, AgentSection } from '@/lib/ai/agent/types'
import type { AgentRequest } from '@/lib/ai/agent/types'
import type { DegradedReason } from '@/lib/ai/agent/managed/circuit-breaker'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { getAIModelRoutingContext } from '@/lib/ai/model-routing'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'api-agent' })

async function handler(req: NextRequest) {
  const user = await requireAuth()

  // Feature flag check — V3 enrolment gate
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

  // Decide which runtime to dispatch to
  const managedEnabled = await isFeatureEnabled('managed_agent_enabled', { userId: user.id })
  if (managedEnabled) {
    const { managedCircuitBreaker, recordManagedFailure } = await import(
      '@/lib/ai/agent/managed/circuit-breaker'
    )
    if (!managedCircuitBreaker.isOpen()) {
      // Pre-construction setup — synchronous throw still allows V3 fallback
      try {
        const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
        getAnthropicClient()
      } catch (err) {
        recordManagedFailure('auth_setup_failure')
        log.warn(
          {
            sessionId: session.id,
            userId: user.id,
            error: err instanceof Error ? err.message : String(err),
          },
          'managed setup failed, degrading to V3',
        )
        return runV3WithSSE(session, sections, body, user)
      }
      return runManagedWithSSE(session, sections, body, user)
    }
    // Breaker is open — degrade to V3
    log.warn(
      { sessionId: session.id, userId: user.id },
      'managed circuit breaker open, routing to V3',
    )
  }

  return runV3WithSSE(session, sections, body, user)
}

function runV3WithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
): Response {
  // Stream response via SSE
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        const data = `data: ${JSON.stringify(event)}\n\n`
        controller.enqueue(encoder.encode(data))
      }

      try {
        const routingCtx = await getAIModelRoutingContext(user.id)
        await runAgentTurn({ session, sections, request: body, emit, routingCtx })
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

function runManagedWithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
): Response {
  const encoder = new TextEncoder()
  let firstByteFlushed = false

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        firstByteFlushed = true
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
        const serviceCtx = {
          userId: user.id,
          sessionId: session.id,
          projectId: session.projectId ?? undefined,
          requestId: body.requestId,
          now: new Date(),
        }
        await runManagedTurn({ session, sections, request: body, emit, serviceCtx })

        const { recordManagedSuccess } = await import('@/lib/ai/agent/managed/circuit-breaker')
        recordManagedSuccess()
      } catch (err) {
        const { recordManagedFailure } = await import('@/lib/ai/agent/managed/circuit-breaker')
        const reason = classifyManagedError(err)
        recordManagedFailure(reason)

        if (!firstByteFlushed) {
          log.warn(
            { sessionId: session.id, reason },
            'managed turn failed pre-first-byte',
          )
        } else {
          log.error(
            { sessionId: session.id, reason },
            'managed turn failed mid-stream',
          )
        }

        const msg = firstByteFlushed
          ? 'Agent encountered a problem mid-response. Please retry.'
          : 'Agent temporarily unavailable, please retry.'
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              type: 'error',
              message: msg,
              retryable: true,
            })}\n\n`,
          ),
        )
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

function classifyManagedError(err: unknown): DegradedReason {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout')) return 'anthropic_timeout'
    if (msg.includes('401') || msg.includes('429') || /\b5\d\d\b/.test(msg)) {
      return 'anthropic_unavailable'
    }
    if (msg.includes('stream') || msg.includes('disconnect') || msg.includes('abort')) {
      return 'stream_disconnect'
    }
  }
  return 'stream_disconnect'
}

function mapSessionRow(row: Record<string, unknown>): AgentSession {
  return {
    id: row.id as string,
    userId: row.userId as string,
    projectId: (row.projectId as string) ?? null,
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
