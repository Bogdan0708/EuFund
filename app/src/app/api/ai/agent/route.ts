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
import {
  ensureAppAgentSession,
  markDegraded,
  recordTurnSuccess,
} from '@/lib/ai/agent/managed/session-metadata'
import { claimTurn, deleteEmptyTurn } from '@/lib/ai/agent/managed/history'

const log = logger.child({ component: 'api-agent' })

async function claimV3OrConflict(
  sessionId: string,
  userId: string,
  requestId: string,
): Promise<{ kind: 'claimed'; turnId: string } | { kind: 'conflict'; response: NextResponse }> {
  const claim = await claimTurn({ sessionId, userId, requestId, runtimeMode: 'v3' })
  if (claim.kind === 'conflict') {
    return {
      kind: 'conflict',
      response: NextResponse.json({
        error: {
          code: 'conflict_request_id',
          messageRo:
            'Cerere deja înregistrată. Dacă ai reîncercat, operațiunea a fost deja salvată.',
          messageEn:
            'Request already recorded. If this was a retry, the operation has already been saved.',
        },
      }, { status: 409 }),
    }
  }
  return { kind: 'claimed', turnId: claim.turnId }
}

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

  // Decide which runtime to dispatch to.
  //
  // Phase 2 compatibility guard: the managed runtime only consumes
  // `request.message` — it does not yet handle structured `request.action`
  // payloads that the frontend emits via useAgent.sendAction() (e.g.
  // select_call, approve_outline, accept_section). Any request with an
  // action MUST go through V3 to preserve the "zero frontend changes"
  // contract the plan promised. Without this guard, allowlisted pilot
  // users clicking action-driven UI would hit the managed path and get
  // a no-op turn.
  //
  // Explicit action support in the managed runtime is a follow-up.
  const hasStructuredAction = body.action !== undefined && body.action !== null

  // Service-local hard gate. Main production service leaves this env
  // unset and therefore never dynamically imports managed-side runtime,
  // circuit-breaker, or anthropic-client modules. Only `fondeu-pilot`
  // sets MANAGED_RUNTIME_ENABLED=true. A flag widening mistake in the
  // shared DB cannot leak managed traffic into production.
  const managedRuntimeEnabled = process.env.MANAGED_RUNTIME_ENABLED === 'true'

  const managedEnabled =
    managedRuntimeEnabled &&
    !hasStructuredAction &&
    (await isFeatureEnabled('managed_agent_enabled', {
      userId: user.id,
      bypassCache: true,
    }))

  if (hasStructuredAction) {
    log.info(
      { sessionId: session.id, userId: user.id, actionType: body.action?.type },
      'structured action request — routing to V3 (managed runtime does not yet handle actions)',
    )
  }

  // Optimistic concurrency. The managed path REQUIRES stateVersion (and
  // returns bilingual error envelopes); the V3 path keeps the historical
  // optional check with the legacy single-string error format. Only
  // existing-session requests carry a comparable stateVersion.
  if (body.sessionId) {
    if (managedEnabled) {
      if (typeof body.stateVersion !== 'number') {
        return NextResponse.json(
          {
            error: {
              code: 'missing_state_version',
              messageRo:
                'Lipsește versiunea de stare. Reîncarcă pagina și reîncearcă.',
              messageEn: 'Missing state version. Reload and retry.',
            },
          },
          { status: 400 },
        )
      }
      if (body.stateVersion !== session.stateVersion) {
        return NextResponse.json(
          {
            error: {
              code: 'stale_state_version',
              messageRo:
                'Versiunea de stare este expirată. Reîncarcă și reîncearcă.',
              messageEn: 'State version is stale. Reload and retry.',
            },
            currentVersion: session.stateVersion,
          },
          { status: 409 },
        )
      }
    } else if (typeof body.stateVersion === 'number') {
      if (body.stateVersion !== session.stateVersion) {
        return NextResponse.json(
          { error: 'Stale state — reload and retry', currentVersion: session.stateVersion },
          { status: 409 },
        )
      }
    }
  }

  // Managed path only: defensive requestId presence check. The DTO
  // already marks it required, but a misbehaving client could POST an
  // empty string.
  if (managedEnabled) {
    if (typeof body.requestId !== 'string' || body.requestId.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: 'missing_request_id',
            messageRo: 'Cerere fără identificator. Reîncearcă.',
            messageEn: 'Request is missing requestId. Retry.',
          },
        },
        { status: 400 },
      )
    }
  }

  // Preselected sessions (those created via /api/v1/projects/preselect) carry
  // a `planning_artifact.preselect.version` marker. Such sessions were seeded
  // with phase=structuring/research and a selectedCallId on the assumption
  // that the managed runtime's bootstrap block will steer the agent past
  // discovery. V3 has no such block and would call search_calls on its first
  // turn, silently reintroducing the cost the preselect feature was meant to
  // eliminate. So preselected sessions must NEVER degrade to V3 — they fail
  // closed with 503, the user retries, and if managed stays unavailable the
  // feature remains broken in a visible way (vs. silently expensive).
  const preselectMarker =
    (session.planningArtifact as { preselect?: { version?: number } } | null)?.preselect
  // Structured actions (approve_outline, accept_section, select_call, etc.)
  // ALWAYS run through V3 — managed doesn't handle them yet (see
  // hasStructuredAction above). Actions are post-discovery operations
  // triggered by explicit UI clicks; some of them (e.g. select_call,
  // approve_outline) do continue into an LLM turn, but the user has already
  // authored intent, so the "no silent re-run of discovery" invariant that
  // the bootstrap-block guards is not at risk. Without this exception,
  // every preselected session would 503 the moment the user clicks an
  // action button.
  const isPreselected = preselectMarker?.version === 1 && !hasStructuredAction

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
            isPreselected,
          },
          'managed setup failed',
        )
        // Lazy-create the app_agent_sessions row and mark it degraded
        // BEFORE falling back to V3, so the DB reflects that a managed
        // attempt was made and immediately degraded pre-stream.
        try {
          await ensureAppAgentSession(session.id, user.id, true)
        } catch (metaErr) {
          log.warn(
            {
              sessionId: session.id,
              err: metaErr instanceof Error ? metaErr.message : String(metaErr),
            },
            'ensureAppAgentSession failed (pre-stream fallback)',
          )
        }
        try {
          await markDegraded(session.id, user.id, 'auth_setup_failure')
        } catch (metaErr) {
          log.warn(
            {
              sessionId: session.id,
              err: metaErr instanceof Error ? metaErr.message : String(metaErr),
            },
            'markDegraded failed (pre-stream fallback)',
          )
        }
        if (isPreselected) {
          return NextResponse.json(
            {
              error: {
                code: 'MANAGED_UNAVAILABLE',
                messageRo: 'Asistentul gestionat este temporar indisponibil. Reîncearcă în câteva momente.',
                messageEn: 'The managed assistant is temporarily unavailable. Please retry in a moment.',
              },
            },
            { status: 503 },
          )
        }
        const v3Claim1 = await claimV3OrConflict(session.id, user.id, body.requestId)
        if (v3Claim1.kind === 'conflict') return v3Claim1.response
        return runV3WithSSE(session, sections, body, user, v3Claim1.turnId)
      }

      // Pre-stream turn-claim. The INSERT either succeeds atomically
      // or raises PG 23505 via the UNIQUE(session_id, request_id)
      // constraint — which maps to a clean JSON 409 here, before any
      // SSE Response is constructed. No inline reclaim: see claimTurn
      // comment in history.ts for the race-safety argument.
      const claim = await claimTurn({
        sessionId: session.id,
        userId: user.id,
        requestId: body.requestId,
        runtimeMode: 'managed',
      })
      if (claim.kind === 'conflict') {
        return NextResponse.json(
          {
            error: {
              code: 'conflict_request_id',
              messageRo:
                'Cerere deja înregistrată. Dacă ai reîncercat, operațiunea a fost deja salvată.',
              messageEn:
                'Request already recorded. If this was a retry, the operation has already been saved.',
            },
          },
          { status: 409 },
        )
      }
      return runManagedWithSSE(session, sections, body, user, claim.turnId)
    }
    // Breaker is open — degrade to V3 (unless this is a preselected session,
    // in which case V3 would ignore the bootstrap context and re-run discovery).
    log.warn(
      { sessionId: session.id, userId: user.id, isPreselected, breakerOpen: true },
      'managed circuit breaker open',
    )
    if (isPreselected) {
      return NextResponse.json(
        {
          error: {
            code: 'MANAGED_UNAVAILABLE',
            messageRo: 'Asistentul gestionat este temporar indisponibil. Reîncearcă în câteva momente.',
            messageEn: 'The managed assistant is temporarily unavailable. Please retry in a moment.',
          },
        },
        { status: 503 },
      )
    }
  }

  // Final fallback to V3. If the session was preselected but we ended up
  // here (e.g. managedEnabled was false), fail closed — the bootstrap context
  // assumes the managed runtime.
  if (isPreselected) {
    log.warn(
      { sessionId: session.id, userId: user.id },
      'preselected session would fall through to V3 — refusing',
    )
    return NextResponse.json(
      {
        error: {
          code: 'MANAGED_UNAVAILABLE',
          messageRo: 'Asistentul gestionat este temporar indisponibil. Reîncearcă în câteva momente.',
          messageEn: 'The managed assistant is temporarily unavailable. Please retry in a moment.',
        },
      },
      { status: 503 },
    )
  }

  const v3Claim2 = await claimV3OrConflict(session.id, user.id, body.requestId)
  if (v3Claim2.kind === 'conflict') return v3Claim2.response
  return runV3WithSSE(session, sections, body, user, v3Claim2.turnId)
}

function runV3WithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
  turnId: string,
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
        await runAgentTurn({ session, sections, request: body, emit, routingCtx, turnId })
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
  turnId: string,
): Response {
  const encoder = new TextEncoder()
  let firstByteFlushed = false

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        firstByteFlushed = true
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      // Lazy-create the app_agent_sessions row on first managed attempt.
      // Failure to write metadata must NOT crash the turn.
      try {
        await ensureAppAgentSession(session.id, user.id, true)
      } catch (metaErr) {
        log.warn(
          {
            sessionId: session.id,
            err: metaErr instanceof Error ? metaErr.message : String(metaErr),
          },
          'ensureAppAgentSession failed',
        )
      }

      // Tracked locally so the catch branch can decide whether to call
      // deleteEmptyTurn. If runManagedTurn throws, this stays false (it
      // only flips when the runtime returns a non-throw result AND that
      // result reports firstOutputPersisted=true).
      let firstOutputPersisted = false
      try {
        const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
        // bypassCache: true — managed_agent_writes_enabled is a rollout
        // control for a mutating surface. If we need to disable writes in
        // an emergency, the 60s cache TTL must not delay the shutoff on
        // warm instances. Matches the feature-flags service pattern for
        // kill-switch-style flags.
        const allowWrites = await isFeatureEnabled('managed_agent_writes_enabled', {
          userId: user.id,
          bypassCache: true,
        })
        const serviceCtx = {
          userId: user.id,
          sessionId: session.id,
          projectId: session.projectId ?? undefined,
          requestId: body.requestId,
          now: new Date(),
          allowWrites,
        }
        const result = await runManagedTurn({
          session,
          sections,
          request: body,
          emit,
          serviceCtx,
          turnId,
        })
        firstOutputPersisted = result.firstOutputPersisted

        if (firstOutputPersisted) {
          // Only count the turn as a success when it actually produced a
          // durable output. A no_output turn gets its claim row deleted
          // below and must NOT be recorded as a successful managed turn
          // in application_agent_sessions — the row would falsely claim
          // lastTurn metadata for a turn with no persisted history.
          const { recordManagedSuccess } = await import('@/lib/ai/agent/managed/circuit-breaker')
          recordManagedSuccess()

          try {
            await recordTurnSuccess(
              session.id,
              user.id,
              result.model,
              result.toolCount,
            )
          } catch (metaErr) {
            log.warn(
              {
                sessionId: session.id,
                err: metaErr instanceof Error ? metaErr.message : String(metaErr),
              },
              'recordTurnSuccess failed',
            )
          }
        } else {
          // No durable output — the claim row will be deleted below, so
          // the turn leaves no DB trace. Treat as a pre-output failure
          // for metadata purposes (no success recorded) while allowing
          // the SSE response to close normally for the client.
          log.warn(
            { sessionId: session.id, turnId },
            'managed turn returned with no durable output — cleaning claim',
          )
          try {
            await deleteEmptyTurn(turnId)
          } catch (cleanupErr) {
            log.warn(
              {
                sessionId: session.id,
                turnId,
                err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
              },
              'deleteEmptyTurn failed (post-success, no output)',
            )
          }
        }
      } catch (err) {
        // Pre-output failure: clean the empty claim row so a
        // fresh-requestId retry succeeds. deleteEmptyTurn is a no-op if
        // any child message exists (post-output failure path).
        if (!firstOutputPersisted) {
          try {
            await deleteEmptyTurn(turnId)
          } catch (cleanupErr) {
            log.warn(
              {
                sessionId: session.id,
                turnId,
                err: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
              },
              'deleteEmptyTurn failed (catch branch)',
            )
          }
        }

        const { recordManagedFailure } = await import('@/lib/ai/agent/managed/circuit-breaker')
        const reason = classifyManagedError(err)
        recordManagedFailure(reason)

        try {
          await markDegraded(session.id, user.id, reason)
        } catch (metaErr) {
          log.warn(
            {
              sessionId: session.id,
              err: metaErr instanceof Error ? metaErr.message : String(metaErr),
            },
            'markDegraded failed',
          )
        }

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
    rejectionReason: row.rejectionReason as string | null,
    updatedAt: row.updatedAt as Date,
  }
}

export const POST = withRateLimit(
  { keyPrefix: 'agent-turn', maxRequests: 30, windowMs: 60_000 },
  handler,
)
