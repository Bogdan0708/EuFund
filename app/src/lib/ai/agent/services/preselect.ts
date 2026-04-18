// ── Deterministic preselect service ──────────────────────────────
// Owns: rankCandidates, decideSelection, initializeSession.
// Spec: docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md

import { db, withUserRLS } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { logAudit } from '@/lib/legal/audit'
import { logger } from '@/lib/logger'
import { lookupBlueprint } from './blueprint'
import { searchCalls } from './evidence'
import type { CallMatch, ServiceContext } from './types'

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
  // Overfetch slightly so exclusions don't leave us short.
  const { matches } = await searchCalls(ctx, description, { maxResults: 10 })
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

  try {
    const ctx = { userId, sessionId: '', locale } as const
    const result = await lookupBlueprint(ctx as unknown as ServiceContext, selectedCallId)
    if (result.cached) {
      blueprintKind = 'structured'
      blueprintPayload = result.blueprint
    } else {
      blueprintKind = 'raw_evidence'
      // raw evidence chunks are not a structured blueprint — leave blueprint column null
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

  return { sessionId: row.id, phase, blueprintKind }
}

