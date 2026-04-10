// ── Eligibility derivation helper ──────────────────────────────────────────
// Single source of definitional truth for "eligibility passed" in Phase 3.
//
// The existing EligibilityResult / EligibilityDecision types do NOT carry
// an explicit `eligible: boolean` field; they expose passCount, failCount,
// and warningCount. Phase 3 derives pass/fail from these without any
// schema migration: eligibility passes iff it has been run and produced
// zero hard failures. Warnings are advisory, not blockers.

import type { EligibilityResult } from '../types'

export function isEligibilityPassed(
  eligibility: EligibilityResult | null | undefined,
): boolean {
  return eligibility != null && eligibility.failCount === 0
}
