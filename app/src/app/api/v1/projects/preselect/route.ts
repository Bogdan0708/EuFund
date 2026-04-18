import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth/helpers'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { enforceRateLimit } from '@/lib/middleware/rate-limit'
import {
  rankCandidates,
  decideSelection,
  initializeSession,
  MIN_DESCRIPTION_LENGTH,
} from '@/lib/ai/agent/services/preselect'
import { searchCalls } from '@/lib/ai/agent/services/evidence'
import { setSelectedCall } from '@/lib/ai/agent/services/application'
import { ConcurrencyError, ValidationError } from '@/lib/ai/agent/services/errors'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'preselect-route' })

const RequestSchema = z.object({
  // Caps are defensive: description is embedded by OpenAI (expensive) and
  // feeds Qdrant search; excludeCallIds becomes a Set. 10_000 chars is far
  // above any realistic project description, and 50 exclusions is ~10× any
  // sensible override UI. confirmCandidateId / callId strings use the same
  // 255 varchar cap the agent_sessions.selected_call_id column enforces.
  description: z.string().max(10_000),
  locale: z.enum(['ro', 'en']),
  sessionId: z.string().uuid().optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(),
  confirmCandidateId: z.string().min(1).max(255).optional(),
  excludeCallIds: z.array(z.string().min(1).max(255)).max(50).optional(),
})

const err = (status: number, code: string, message?: string) =>
  NextResponse.json({ error: { code, message: message ?? code } }, { status })

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth FIRST — we need user.id for the per-user rate-limit key.
  // Surfaces the auth class as 401 and any other throw as 500 (the catch-all
  // swallow here would mask infra failures).
  let user
  try {
    user = await requireAuth()
  } catch (e) {
    if (e instanceof Error && /unauthori[sz]ed/i.test(e.message)) {
      return err(401, 'UNAUTHORIZED')
    }
    log.error({ err: e }, 'requireAuth threw non-auth error')
    return err(500, 'AUTH_CHECK_FAILED')
  }

  // Per-user rate limit (not IP). NAT'd tenants mustn't share a bucket, and
  // a bad actor must not be able to exhaust another tenant's quota.
  const limit = await enforceRateLimit(req, {
    keyPrefix: 'preselect',
    maxRequests: 10,
    windowMs: 60_000,
    keySuffix: user.id,
  })
  if (!limit.ok) return limit.response as NextResponse

  // Feature flags (all required). bypassCache per CLAUDE.md rollout-flag rule.
  //
  // The bootstrap-block prompt that tells the agent "do not re-run search_calls"
  // lives in the MANAGED runtime prompt only. If preselect creates a session with
  // phase=structuring but /api/ai/agent routes to V3 (because
  // managed_agent_enabled is off or MANAGED_RUNTIME_ENABLED is unset on this
  // service), V3 has no bootstrap block and will happily re-run discovery —
  // silently defeating the whole cost-reduction goal. Gate on the full set so
  // a misconfigured env can never leak the user into that silent-failure mode.
  const managedRuntimeEnabled = process.env.MANAGED_RUNTIME_ENABLED === 'true'
  const [preselectFlag, writesFlag, managedFlag] = await Promise.all([
    isFeatureEnabled('deterministic_preselect_enabled', { userId: user.id, bypassCache: true }),
    isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id, bypassCache: true }),
    isFeatureEnabled('managed_agent_enabled', { userId: user.id, bypassCache: true }),
  ])
  if (!preselectFlag || !writesFlag || !managedFlag || !managedRuntimeEnabled) {
    return err(404, 'PRESELECT_DISABLED')
  }

  // Validate request body
  let parsed
  try {
    const body = await req.json()
    parsed = RequestSchema.parse(body)
  } catch (e) {
    return err(400, 'INVALID_REQUEST', e instanceof Error ? e.message : 'invalid body')
  }

  if (parsed.description.length < MIN_DESCRIPTION_LENGTH) {
    return err(400, 'DESCRIPTION_TOO_SHORT')
  }

  // Disallow conflicting modes
  if (parsed.sessionId && parsed.confirmCandidateId) {
    return err(400, 'CONFLICTING_MODE', 'sessionId and confirmCandidateId are mutually exclusive')
  }
  if (parsed.sessionId && parsed.expectedStateVersion === undefined) {
    return err(400, 'EXPECTED_STATE_VERSION_REQUIRED')
  }

  // Confirm mode: skip ranker, but verify the callId is a real indexed call
  // before creating a session (spec §Request contract; §Error mapping 400
  // INVALID_CALL_ID). Uses a FILTERED Qdrant lookup on callId — the embedding
  // of the query string is still computed (cheap) but the filter is the
  // authoritative discriminator. A prior semantic-similarity probe incorrectly
  // treated "callId in top-5 by cosine similarity" as the existence check,
  // which would reject valid IDs in any sufficiently large corpus.
  if (parsed.confirmCandidateId && !parsed.sessionId) {
    const ctx: ServiceContext = {
      userId: user.id,
      requestId: crypto.randomUUID(),
      now: new Date(),
    }
    try {
      const { matches } = await searchCalls(ctx, parsed.confirmCandidateId, {
        callId: parsed.confirmCandidateId,
        maxResults: 1,
      })
      if (matches.length === 0) {
        return err(400, 'INVALID_CALL_ID')
      }
    } catch (e) {
      log.error({ err: e, userId: user.id }, 'confirm-mode call existence check failed')
      return err(503, 'PRESELECT_UNAVAILABLE')
    }
    try {
      const result = await initializeSession({
        userId: user.id,
        description: parsed.description,
        locale: parsed.locale,
        selectedCallId: parsed.confirmCandidateId,
        selectedScore: 1,
        candidates: [{
          callId: parsed.confirmCandidateId,
          title: parsed.confirmCandidateId,
          score: 1,
        }],
        excludeCallIdsApplied: [],
      })
      return NextResponse.json({
        kind: 'selected',
        sessionId: result.sessionId,
        selectedCallId: parsed.confirmCandidateId,
        candidates: [{ callId: parsed.confirmCandidateId, title: parsed.confirmCandidateId, score: 1 }],
        blueprintKind: result.blueprintKind,
        phase: result.phase,
      })
    } catch (e) {
      log.error({ err: e, userId: user.id }, 'initializeSession failed (confirm mode)')
      return err(500, 'SESSION_INIT_FAILED')
    }
  }

  // Override mode: existing session, re-rank and mutate via setSelectedCall
  if (parsed.sessionId) {
    const overrideCtx: ServiceContext = {
      userId: user.id,
      sessionId: parsed.sessionId,
      requestId: crypto.randomUUID(),
      now: new Date(),
    }
    let candidates
    try {
      candidates = await rankCandidates(overrideCtx, parsed.description, parsed.excludeCallIds ?? [])
    } catch (e) {
      log.error({ err: e, userId: user.id }, 'rankCandidates failed (override)')
      return err(503, 'PRESELECT_UNAVAILABLE')
    }
    const decision = decideSelection(candidates)
    if (decision.kind === 'no_match') {
      return NextResponse.json({ kind: 'no_match', reason: decision.reason })
    }
    if (decision.kind === 'ambiguous') {
      return NextResponse.json({ kind: 'ambiguous', candidates: decision.candidates })
    }
    try {
      await setSelectedCall(overrideCtx, {
        sessionId: parsed.sessionId,
        callId: decision.callId,
        expectedStateVersion: parsed.expectedStateVersion!,
      })
    } catch (e) {
      // Prefer instanceof over duck-typing so a shape change in the service
      // error classes doesn't silently downgrade 409s to 500s.
      if (e instanceof ValidationError && e.policyCode === 'POLICY_OUTLINE_ALREADY_FROZEN') {
        return err(409, 'OUTLINE_FROZEN')
      }
      if (e instanceof ConcurrencyError) {
        return err(409, 'CONCURRENCY_CONFLICT')
      }
      log.error({ err: e, userId: user.id, sessionId: parsed.sessionId }, 'setSelectedCall failed')
      return err(500, 'OVERRIDE_FAILED')
    }
    // Override deliberately omits blueprintKind + phase: setSelectedCall does
    // not re-fetch the blueprint or change the session's currentPhase, and the
    // client already has those fields from the SSE resume path. Fabricating
    // them here would let a stale client render the wrong bootstrap state.
    // Spec §Response contract treats override as a reselection, not a full
    // session bootstrap.
    return NextResponse.json({
      kind: 'selected',
      sessionId: parsed.sessionId,
      selectedCallId: decision.callId,
      candidates: decision.candidates,
    })
  }

  const ctx: ServiceContext = {
    userId: user.id,
    requestId: crypto.randomUUID(),
    now: new Date(),
  }
  let candidates
  try {
    candidates = await rankCandidates(ctx, parsed.description, parsed.excludeCallIds ?? [])
  } catch (e) {
    log.error({ err: e, userId: user.id }, 'rankCandidates failed')
    return err(503, 'PRESELECT_UNAVAILABLE')
  }

  const decision = decideSelection(candidates)

  if (decision.kind === 'no_match') {
    return NextResponse.json({ kind: 'no_match', reason: decision.reason })
  }
  if (decision.kind === 'ambiguous') {
    return NextResponse.json({ kind: 'ambiguous', candidates: decision.candidates })
  }

  // kind === 'selected'
  try {
    const result = await initializeSession({
      userId: user.id,
      description: parsed.description,
      locale: parsed.locale,
      selectedCallId: decision.callId,
      selectedScore: decision.candidates[0].score,
      candidates: decision.candidates,
      excludeCallIdsApplied: parsed.excludeCallIds ?? [],
    })
    return NextResponse.json({
      kind: 'selected',
      sessionId: result.sessionId,
      selectedCallId: decision.callId,
      candidates: decision.candidates,
      blueprintKind: result.blueprintKind,
      phase: result.phase,
    })
  } catch (e) {
    log.error({ err: e, userId: user.id }, 'initializeSession failed')
    return err(500, 'SESSION_INIT_FAILED')
  }
}
