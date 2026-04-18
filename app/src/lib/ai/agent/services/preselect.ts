// ── Deterministic preselect service ──────────────────────────────
// Owns: rankCandidates, decideSelection, initializeSession.
// Spec: docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md

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
