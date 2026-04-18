import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth/helpers'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import {
  rankCandidates,
  decideSelection,
  initializeSession,
  MIN_DESCRIPTION_LENGTH,
} from '@/lib/ai/agent/services/preselect'
import { searchCalls } from '@/lib/ai/agent/services/evidence'
import { setSelectedCall } from '@/lib/ai/agent/services/application'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'preselect-route' })

const RequestSchema = z.object({
  description: z.string(),
  locale: z.enum(['ro', 'en']),
  sessionId: z.string().uuid().optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(),
  confirmCandidateId: z.string().optional(),
  excludeCallIds: z.array(z.string()).optional(),
})

const err = (status: number, code: string, message?: string) =>
  NextResponse.json({ error: { code, message: message ?? code } }, { status })

async function handler(req: NextRequest): Promise<NextResponse> {
  // Auth
  let user
  try {
    user = await requireAuth()
  } catch {
    return err(401, 'UNAUTHORIZED')
  }

  // Feature flags (both required). bypassCache per CLAUDE.md rollout-flag rule.
  const [preselect, writes] = await Promise.all([
    isFeatureEnabled('deterministic_preselect_enabled', { userId: user.id, bypassCache: true }),
    isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id, bypassCache: true }),
  ])
  if (!preselect || !writes) return err(404, 'PRESELECT_DISABLED')

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
  // INVALID_CALL_ID). A cheap searchCalls probe with query=callId is enough —
  // if the id exists in the vector store, at least one match will report the
  // same callId back.
  if (parsed.confirmCandidateId && !parsed.sessionId) {
    const ctx = { userId: user.id, sessionId: '', locale: parsed.locale }
    try {
      const { matches } = await searchCalls(ctx as any, parsed.confirmCandidateId, { maxResults: 5 })
      if (!matches.some(m => m.callId === parsed.confirmCandidateId)) {
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
    const overrideCtx = {
      userId: user.id,
      sessionId: parsed.sessionId,
      locale: parsed.locale,
    }
    let candidates
    try {
      candidates = await rankCandidates(overrideCtx as any, parsed.description, parsed.excludeCallIds ?? [])
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
      await setSelectedCall(overrideCtx as any, {
        sessionId: parsed.sessionId,
        callId: decision.callId,
        expectedStateVersion: parsed.expectedStateVersion!,
      })
    } catch (e) {
      const e_ = e as any
      if (e_?.policyCode === 'POLICY_OUTLINE_ALREADY_FROZEN') return err(409, 'OUTLINE_FROZEN')
      if (e_?.code === 'CONCURRENCY') return err(409, 'CONCURRENCY_CONFLICT')
      log.error({ err: e, userId: user.id, sessionId: parsed.sessionId }, 'setSelectedCall failed')
      return err(500, 'OVERRIDE_FAILED')
    }
    return NextResponse.json({
      kind: 'selected',
      sessionId: parsed.sessionId,
      selectedCallId: decision.callId,
      candidates: decision.candidates,
      // blueprintKind/phase not returned on override — client already has the
      // session state from the SSE resume path; placeholders kept for shape
      // consistency with rank/confirm responses in Phase 1.
      blueprintKind: 'structured',
      phase: 'structuring',
    })
  }

  const ctx = { userId: user.id, sessionId: '', locale: parsed.locale }
  let candidates
  try {
    candidates = await rankCandidates(ctx as any, parsed.description, parsed.excludeCallIds ?? [])
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

export const POST = withRateLimit(
  { keyPrefix: 'preselect', maxRequests: 30, windowMs: 60_000 },
  handler,
)
