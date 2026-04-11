# Phase 3 Policy Matrix

> **This doc is a mirror of `app/src/lib/ai/agent/policy/matrix.ts`.** The TypeScript file is the authoritative source of truth; this doc is kept in sync via a sync test (`app/tests/unit/policy/matrix-docs-sync.test.ts`). Do not edit one without updating the other.

**Date:** 2026-04-10
**Parent spec:** `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md` §4

## Rules

| # | Mutation | Session preconditions | Section preconditions | Audit action | Idempotent mode |
|---|---|---|---|---|---|
| 1 | `setSelectedCall` | `status=active`, `outlineFrozen=false` | — | `session.call_selected` | Same callId = no-op |
| 2 | `freezeOutline` | `status=active`, `selectedCallId != null`, `isEligibilityPassed(eligibility)`, `outlineFrozen=false` | — | `session.outline_frozen` | Already frozen = no-op |
| 3 | `saveSectionDraft` | `status=active`, `outlineFrozen=true`, `isEligibilityPassed(eligibility)` | any (creates if missing) | `project.version_save` (legacy) | Creates new version each call |
| 4 | `approveSection` | `outlineFrozen=true` | status ∈ {draft, needs_review} | `section.state_change` (legacy) | Already-accepted = no-op |
| 5 | `rollbackSection` | `outlineFrozen=true` | section + target version must exist | `section.rollback` (legacy, reused for hash-chain continuity) | Creates new rollback version each call |
| 6 | `markSectionStale` | `outlineFrozen=true` | status ∈ {draft, needs_review, accepted} | `section.marked_stale` | Already-stale = no-op. Demotion from accepted clears acceptedContent. |
| 7 | `rejectSection` | `outlineFrozen=true` | status ∈ {draft, needs_review, rejected} | `section.rejected` | Same reason = no-op; different reason = POLICY_SECTION_WRONG_STATE |
| 8 | `setApplicationStatus` | For 'completed': validate_application must pass. For 'paused': status=active | — | `session.status_change` | Same-status = no-op |

## Eligibility derivation

Eligibility passes iff `eligibility != null && eligibility.failCount === 0`. Warnings are advisory and do not block progression. Encapsulated in the helper `isEligibilityPassed(decision)`.

## Policy error codes

| Code | Raised by | Retryable |
|---|---|---|
| `POLICY_NO_CALL_SELECTED` | freezeOutline | No |
| `POLICY_OUTLINE_ALREADY_FROZEN` | setSelectedCall, freezeOutline | No |
| `POLICY_OUTLINE_NOT_FROZEN` | saveSectionDraft, approveSection, rollbackSection, markSectionStale, rejectSection | No |
| `POLICY_ELIGIBILITY_NOT_PASSED` | freezeOutline, saveSectionDraft | No |
| `POLICY_SECTION_WRONG_STATE` | approveSection, markSectionStale, rejectSection | No |
| `POLICY_SESSION_NOT_ACTIVE` | setSelectedCall, freezeOutline, saveSectionDraft | No |
| `POLICY_VALIDATION_NOT_PASSED` | setApplicationStatus('completed') | No |

## Idempotent no-op contract

A service function MUST treat an already-applied mutation as a no-op:
- Return the current `stateVersion` unchanged
- Do not bump `updatedAt`
- Do not emit an audit event
- Do not run policy checks (no state change, no policy to enforce)

## Legacy audit string reuse

Rules 3, 4, and 5 reuse legacy V3 audit actions (`project.version_save`, `section.state_change`, `section.rollback`) on purpose to preserve hash-chain continuity across the V3 → managed migration. Do not rename them without a coordinated audit migration.
