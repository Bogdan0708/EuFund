// ── Deterministic preselect service ──────────────────────────────
// Owns: rankCandidates, decideSelection, initializeSession.
// Spec: docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md

import { withUserRLS } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { logAudit } from '@/lib/legal/audit'
import { ensureProjectForSession } from '@/lib/projects/promotion'
import { logger } from '@/lib/logger'
import { lookupBlueprint } from './blueprint'
import { searchCalls } from './evidence'
import type { CallMatch, ServiceContext, EvidenceChunk } from './types'

// Rollout-tunable defaults; tune against real traces after 20-50 sessions.
export const SCORE_FLOOR = 0.35
export const AMBIGUITY_EPSILON = 0.05
export const MIN_DESCRIPTION_LENGTH = 40

export interface Candidate {
  callId: string
  title: string
  score: number
  program?: string
  sourceUrl?: string
  // NOTE: no blueprintKind here in Phase 1 — see spec section "Response contract".
}

export type BlueprintKind = 'structured' | 'raw_evidence' | 'none'

export type SelectionDecision =
  | { kind: 'selected'; callId: string; candidates: Candidate[] }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'no_match'; reason: 'below_score_floor' }

export interface PreselectArtifactV1 {
  version: 1
  rankedAt: string
  description: string
  selectedCallId: string
  selectedScore: number
  candidates: Candidate[]
  selectionKind: 'selected'
  blueprintKind: BlueprintKind
  excludeCallIdsApplied: string[]
  // Top-15 evidence chunks stashed on cache miss so the managed runtime
  // can synthetically inject them on the first turn — avoids the model
  // re-running retrieve_evidence on Qdrant. Present iff blueprintKind ===
  // 'raw_evidence'. Absent (undefined) for 'structured' and 'none'.
  rawEvidence?: EvidenceChunk[]
}

// Re-export type for convenience in tests
export type { CallMatch }

export function decideSelection(candidates: Candidate[]): SelectionDecision {
  if (candidates.length === 0 || candidates[0].score < SCORE_FLOOR) {
    return { kind: 'no_match', reason: 'below_score_floor' }
  }
  const top = candidates[0]
  const runner = candidates[1]
  if (runner && top.score - runner.score < AMBIGUITY_EPSILON) {
    return { kind: 'ambiguous', candidates: candidates.slice(0, 3) }
  }
  return { kind: 'selected', callId: top.callId, candidates: candidates.slice(0, 3) }
}

/**
 * Deterministic per-call ranker. searchCalls() already dedupes by callId
 * (Qdrant returns chunks score-descending; the seen Set keeps the first =
 * highest-scoring per call). rankCandidates is a thin filter + slice.
 */
export async function rankCandidates(
  ctx: ServiceContext,
  description: string,
  excludeCallIds: string[] = [],
): Promise<Candidate[]> {
  // Overfetch must clear the exclusion list AND leave headroom for the
  // top-5 slice. RequestSchema caps excludeCallIds at 50, so at the worst
  // case we need >50 candidates after filtering — fetch
  // excludeCallIds.length + 15 (5 desired + 10 margin) so even all 50
  // exclusions matching the top of the index leaves a usable pool.
  // Earlier revisions capped maxResults at 50, which silently false-no_match'd
  // any user with a near-max exclusion list. Codex flagged it 2026-04-30.
  const maxResults = excludeCallIds.length + 15
  const { matches } = await searchCalls(ctx, description, { maxResults })
  const excluded = new Set(excludeCallIds)
  return matches
    .filter(m => !excluded.has(m.callId))
    .slice(0, 5)
    .map(m => ({
      callId: m.callId,
      title: m.title,
      score: m.score,
      program: m.program === 'unknown' ? undefined : m.program,
      sourceUrl: m.sourceUrl,
    }))
}

const log = logger.child({ component: 'preselect-service' })

export interface InitializeSessionParams {
  userId: string
  description: string
  locale: 'ro' | 'en'
  selectedCallId: string
  selectedScore: number
  candidates: Candidate[]
  excludeCallIdsApplied: string[]
}

export interface InitializeSessionResult {
  sessionId: string
  phase: 'structuring' | 'research'
  blueprintKind: BlueprintKind
}

export async function initializeSession(
  params: InitializeSessionParams,
): Promise<InitializeSessionResult> {
  const {
    userId, description, locale, selectedCallId, selectedScore,
    candidates, excludeCallIdsApplied,
  } = params

  // Blueprint prefetch (best-effort). Match the real BlueprintLookupResult shape:
  //   cached=true  → structured, payload = result.blueprint
  //   cached=false → raw_evidence, payload = null (agent will extract later)
  //   throws       → none, payload = null, flag audit
  let blueprintKind: BlueprintKind
  let blueprintPayload: unknown = null
  let blueprintLookupFailed = false
  let rawEvidenceForArtifact: EvidenceChunk[] | undefined = undefined

  try {
    const ctx = { userId, sessionId: '', locale } as const
    const result = await lookupBlueprint(ctx as unknown as ServiceContext, selectedCallId)
    if (result.cached) {
      blueprintKind = 'structured'
      blueprintPayload = result.blueprint
    } else {
      blueprintKind = 'raw_evidence'
      // Top-15 cap matches retrieve_evidence's default maxChunks. Slicing
      // here keeps the invariant local: no other caller needs to know.
      rawEvidenceForArtifact = (result.rawEvidence ?? []).slice(0, 15)
    }
  } catch (err) {
    blueprintLookupFailed = true
    blueprintKind = 'none'
    log.warn(
      { userId, selectedCallId, error: err instanceof Error ? err.message : String(err) },
      'blueprint_lookup_failed',
    )
  }

  const phase: 'structuring' | 'research' =
    blueprintKind === 'structured' ? 'structuring' : 'research'

  const artifact: PreselectArtifactV1 = {
    version: 1,
    rankedAt: new Date().toISOString(),
    description,
    selectedCallId,
    selectedScore,
    candidates,
    selectionKind: 'selected',
    blueprintKind,
    excludeCallIdsApplied,
    ...(rawEvidenceForArtifact !== undefined ? { rawEvidence: rawEvidenceForArtifact } : {}),
  }

  const [row] = await withUserRLS(userId, (tx) =>
    tx.insert(agentSessions).values({
      userId,
      locale,
      selectedCallId,
      currentPhase: phase,
      blueprint: blueprintPayload,
      planningArtifact: { preselect: artifact },
    }).returning({ id: agentSessions.id }),
  )

  await logAudit({
    userId,
    action: 'session.preselect_completed',
    resourceType: 'agent_session',
    resourceId: row.id,
    metadata: {
      selectedCallId,
      selectedScore,
      candidateCount: candidates.length,
      blueprintKind,
      phase,
      blueprintLookupFailed,
    },
  })

  // Early validation of project promotion (dry-run).
  // Confirms that the newly created session shell can successfully link to a
  // projects row. Outcome is recorded in project_promotion_total metrics.
  const ctx = { userId, sessionId: row.id, locale, now: new Date() } as unknown as ServiceContext
  await ensureProjectForSession(ctx, row.id, { dryRun: true }).catch((error) => {
    log.error({ sessionId: row.id, error }, 'dry-run promotion failed in preselect')
  })

  return { sessionId: row.id, phase, blueprintKind }
}

