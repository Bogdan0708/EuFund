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
import { bridgeStructuredAction } from '@/lib/ai/agent/managed/bridge'

const log = logger.child({ component: 'api-agent' })

type RouteErrorEvent = AgentEvent & {
  error?: {
    code: string
    messageRo: string
    messageEn: string
  }
}

function sseEvent(event: RouteErrorEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function bridgeErrorEnvelope(code: string | undefined): {
  code: string
  messageRo: string
  messageEn: string
} {
  if (code === 'MANAGED_WRITES_DISABLED') {
    return {
      code,
      messageRo: 'Scrierile gestionate nu sunt activate pentru contul tău.',
      messageEn: 'Managed writes are not enabled for your account.',
    }
  }
  if (code === 'CONCURRENCY') {
    return {
      code,
      messageRo: 'Starea s-a schimbat între timp. Reîncarcă și reîncearcă.',
      messageEn: 'State changed while you were working. Reload and retry.',
    }
  }
  if (code === 'NOT_FOUND') {
    return {
      code,
      messageRo: 'Resursa cerută nu mai există sau nu poate fi accesată.',
      messageEn: 'The requested resource no longer exists or cannot be accessed.',
    }
  }
  if (code === 'REGENERATE_ENDPOINT_REQUIRED') {
    return {
      code,
      messageRo: 'Regenerarea secțiunilor trebuie pornită din fluxul dedicat de generare.',
      messageEn: 'Section regeneration must use the dedicated generation flow.',
    }
  }
  if (code?.startsWith('POLICY_')) {
    return {
      code,
      messageRo: 'Acțiunea nu poate fi aplicată în starea curentă.',
      messageEn: 'This action cannot be applied in the current state.',
    }
  }
  return {
    code: code ?? 'BRIDGE_FAILED',
    messageRo: 'Acțiunea nu a putut fi aplicată. Reîncearcă.',
    messageEn: 'The action could not be applied. Retry.',
  }
}

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

  // If the request specifies focusedSectionKey, verify it belongs to this session's outline.
  // Sessions with no outline (e.g. fresh discovery) fail closed — UI must only set focus
  // once an outline exists.
  if (body.focusedSectionKey) {
    const outline = (session.outline ?? []) as { id: string }[]
    const found = outline.some((s) => s.id === body.focusedSectionKey)
    if (!found) {
      return NextResponse.json(
        {
          error: {
            code: 'INVALID_FOCUSED_SECTION',
            messageRo: 'Secțiune invalidă pentru această sesiune.',
            messageEn: 'Invalid section for this session.',
          },
        },
        { status: 400 },
      )
    }
  }

  // Decide which runtime to dispatch to.
  //
  // Phase 3: Structured actions carry deterministic intent that we bridge
  // directly to service mutations. V3 fallback is only for circuit-breaker
  // scenarios or users without the flag.
  const hasStructuredAction = body.action !== undefined && body.action !== null

  // Service-local hard gate. Production deploys can set this through the
  // Cloud Build `_MANAGED_RUNTIME_ENABLED` substitution, but traffic still
  // requires the DB rollout flags below. Set the substitution/env to false
  // when the service-level kill switch must block managed imports entirely.
  const managedRuntimeEnabled = process.env.MANAGED_RUNTIME_ENABLED === 'true'

  const managedEnabled =
    managedRuntimeEnabled &&
    (await isFeatureEnabled('managed_agent_enabled', {
      userId: user.id,
      bypassCache: true,
    }))

  if (hasStructuredAction && managedEnabled) {
    const allowWrites = await isFeatureEnabled('managed_agent_writes_enabled', {
      userId: user.id,
      bypassCache: true,
    })

    if (!allowWrites) {
      log.warn({ sessionId: session.id, userId: user.id }, 'action bridge blocked — writes disabled')
      const error = bridgeErrorEnvelope('MANAGED_WRITES_DISABLED')
      return new Response(
        sseEvent({
          type: 'error',
          message: body.locale === 'en' ? error.messageEn : error.messageRo,
          retryable: false,
          error,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }

    const serviceCtx = {
      userId: user.id,
      sessionId: session.id,
      projectId: session.projectId ?? undefined,
      requestId: body.requestId,
      now: new Date(),
      allowWrites: true,
    }

    const bridgeResult = await bridgeStructuredAction(
      serviceCtx,
      body.action!,
      body.stateVersion ?? session.stateVersion,
    )

    if (bridgeResult.outcome !== 'success' && bridgeResult.outcome !== 'no_op') {
      const error = bridgeErrorEnvelope(bridgeResult.errorCode)
      log.error(
        { sessionId: session.id, outcome: bridgeResult.outcome, error: bridgeResult.errorMessage },
        'action bridge failed',
      )
      return new Response(
        sseEvent({
          type: 'error',
          message: body.locale === 'en' ? error.messageEn : error.messageRo,
          retryable: bridgeResult.outcome === 'concurrency',
          error,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }

    // Reload session/sections after mutation
    const [row] = await db
      .select()
      .from(agentSessions)
      .where(eq(agentSessions.id, session.id))
      .limit(1)
    if (!row) return NextResponse.json({ error: 'Session lost during bridge' }, { status: 404 })
    session = mapSessionRow(row)

    const sectionRows = await db
      .select()
      .from(agentSections)
      .where(eq(agentSections.sessionId, session.id))
    sections = sectionRows.map(mapSectionRow)

    log.info(
      { sessionId: session.id, actionType: body.action?.type, outcome: bridgeResult.outcome },
      bridgeResult.continueToManaged
        ? 'action bridge successful — proceeding to managed turn'
        : 'action bridge successful — returning updated state',
    )

    if (!bridgeResult.continueToManaged) {
      return new Response(
        sseEvent({ type: 'done', finalState: buildRouteUISnapshot(session, sections) }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }
  }

  // Optimistic concurrency. The V3 path keeps the historical optional
  // check with the legacy single-string error format.
  //
  // Desk Audit Fix #16: Managed path no longer intercepts stateVersion
  // at the route level. Stale requests are allowed to enter the
  // runtime, where any attempted write will hit a ConcurrencyError in
  // the service layer. This allows the model to see the error and
  // report it via the bilingual envelopes defined in ro.json, vs.
  // being intercepted by this early JSON guard.
  if (body.sessionId && !managedEnabled) {
    if (typeof body.stateVersion === 'number') {
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
  // Structured actions are bridged into managed writes when managed is
  // enabled. If managed is disabled, they still use the V3 fallback below.
  // They are post-discovery operations triggered by explicit UI clicks, so
  // the "no silent re-run of discovery" preselect invariant is only enforced
  // for plain text turns.
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
        await runAgentTurn({ session, sections, request: body, emit, routingCtx, turnId, focusedSectionKey: body.focusedSectionKey })
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
          focusedSectionKey: body.focusedSectionKey,
        })
        firstOutputPersisted = result.firstOutputPersisted

        if (firstOutputPersisted && !result.reloadFailed) {
          // Only count the turn as a success when it actually produced a
          // durable output AND the post-write reload landed. A no_output
          // turn gets its claim row deleted below; a reload-failed turn
          // emitted a terminal error in place of done — neither should be
          // recorded as a successful managed turn in
          // application_agent_sessions, the row would falsely claim
          // lastTurn metadata for a turn the user couldn't actually use.
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
        } else if (firstOutputPersisted && result.reloadFailed) {
          // Output landed but UI snapshot is stale — turn is durable on
          // the server, the client got a terminal error in place of done.
          // Don't bump the success counter or write the lastTurn metadata.
          // The agent_turns row stays as markTurnCompleted left it; the
          // failure is observable via outcome=completed_reload_failed in
          // the structured log.
          log.warn(
            { sessionId: session.id, turnId },
            'managed turn persisted output but reload failed — skipping success accounting',
          )
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

function buildRouteUISnapshot(
  session: AgentSession,
  sections: AgentSection[],
): import('@/lib/ai/agent/types').UIStateSnapshot {
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    warnings: session.warnings,
    sections: sections.map(s => ({
      sectionKey: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
      content: s.acceptedContent ?? s.content,
    })),
    blueprint: session.blueprint,
    eligibility: session.eligibility,
  }
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
  {
    keyPrefix: 'agent-turn',
    maxRequests: 30,
    windowMs: 60_000,
    failOpenOnError: true,
  },
  handler,
)
