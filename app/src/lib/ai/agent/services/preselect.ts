// ── Deterministic preselect service ──────────────────────────────
// Owns: rankCandidates, decideSelection, initializeSession.
// Spec: docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md

import type { CallMatch } from './types'

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
  | { kind: 'no_match'; reason: 'below_score_floor' | 'empty_results' }

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
