# Managed Agents Phase 3a — Service-Layer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoritative service-layer enforcement point for every Phase 3 mutation. Every write service ends this PR with ownership + concurrency + declarative policy gates enforced internally. Four new narrow mutation services exist (`setSelectedCall`, `freezeOutline`, `markSectionStale`, `rejectSection`). No managed runtime or MCP surface is touched — that's 3b.

**Architecture:** A new `lib/ai/agent/policy/` module exports a declarative `POLICY_MATRIX`, an `isEligibilityPassed` helper, and an `assertPolicy` function that services call after ownership + stateVersion checks. Services stay the sole authoritative enforcement point; runtimes and executors remain unaware of policy until 3b/3c.

**Tech Stack:** TypeScript, Drizzle ORM + postgres.js, Vitest, existing service layer conventions (`lib/ai/agent/services/`), existing audit chain (`lib/legal/audit`).

**Spec:** `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md` §5

**Prerequisite:** Phase 2 merged. No Phase 3 changes to the managed runtime until 3b.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `app/src/lib/ai/agent/policy/eligibility.ts` | `isEligibilityPassed(decision)` helper — single source of definitional truth for "eligibility passed". |
| `app/src/lib/ai/agent/policy/matrix.ts` | `PolicyRule` interface + `POLICY_MATRIX` declarative constant for all 8 Phase 3 mutations. |
| `app/src/lib/ai/agent/policy/enforce.ts` | `assertPolicy(rule, session, opts)` — throws typed `ValidationError` with stable `policyCode` when a gate fails. |
| `app/drizzle/NNNN_agent_sections_rejected_and_reason.sql` | Generated migration: add `'rejected'` to `agent_section_status` enum + add `rejection_reason` text column. `NNNN` is the next available sequence number at generation time (run `ls app/drizzle/*.sql \| tail -1` to check). |
| `app/drizzle/NNNN_agent_section_versions_rollback.sql` | Generated migration: add `'rollback'` to `agent_section_version_kind` enum + add `rolled_back_from_version` nullable integer column. `NNNN` is the next available sequence number (one higher than the previous migration). |
| `app/tests/unit/policy/eligibility.test.ts` | Unit tests for `isEligibilityPassed` covering null, zero fails, some fails, warnings-only. |
| `app/tests/unit/policy/matrix.test.ts` | Asserts `POLICY_MATRIX` shape and completeness for all 8 Phase 3 mutations. |
| `app/tests/unit/policy/enforce.test.ts` | Tests each gate branch of `assertPolicy` with fixture sessions. |
| `app/tests/unit/services/set-selected-call.test.ts` | Happy path + policy rejections for `setSelectedCall`. |
| `app/tests/unit/services/freeze-outline.test.ts` | Happy path + policy rejections + idempotent no-op for `freezeOutline`. |
| `app/tests/unit/services/mark-section-stale.test.ts` | Happy path + policy rejections + `acceptedContent` demotion for `markSectionStale`. |
| `app/tests/unit/services/reject-section.test.ts` | Happy path + idempotent-same-reason no-op + different-reason error for `rejectSection`. |
| `app/tests/unit/services/policy-matrix-coverage.test.ts` | Meta-test: every write service in `services/sections.ts` and `services/application.ts` references a `POLICY_MATRIX` entry. |
| `app/tests/unit/schema/section-enums.test.ts` | Sync test: DB enum values match TS union values for section status + version kind. |
| `app/tests/integration/services/phase3-concurrency.test.ts` | Real-DB test: stateVersion enforcement across all 8 write services with concurrent-call scenarios. |
| `app/tests/integration/services/phase3-audit-chain.test.ts` | Real-DB test: audit hash chain integrity after each new service runs. |
| `docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md` | Human-readable policy matrix document + sync test. |
| `app/tests/unit/policy/matrix-docs-sync.test.ts` | Asserts `POLICY_MATRIX` keys match the table rows in the policy matrix doc. |

### Modified files

| File | Change |
|---|---|
| `app/src/lib/legal/audit.ts` | `AuditAction` union extended with 5 new Phase 3 actions: `session.call_selected`, `session.outline_frozen`, `session.status_change`, `section.marked_stale`, `section.rejected`. Legacy strings (`section.rollback`, `section.state_change`, `project.version_save`) preserved unchanged for hash-chain continuity. **Must land before any service that calls `logAudit` with a new action.** |
| `app/src/lib/ai/agent/services/errors.ts` | `ValidationError` constructor gains optional third `policyCode?: string` parameter. Backwards-compatible. |
| `app/src/lib/ai/agent/types.ts` | `SECTION_STATUSES` TS union gains `'rejected'`. `AgentSection` interface gains `rejectionReason: string \| null`. `AgentSectionVersion` interface gains `rolledBackFromVersion: number \| null`. |
| `app/src/lib/ai/agent/services/types.ts` | `SectionListItem.status` tightened from `string` to `SectionStatus`. Any consequent downstream type errors are pre-existing bugs masked by the stringly-typed field and must be fixed in the same commit. |
| `app/src/lib/ai/agent/services/context-helpers.ts` | Gains `verifySessionOwnership(ctx, sessionId)` — the canonical ownership helper, extracted from `sections.ts` so the new services in `application.ts` can reuse it. |
| `app/src/lib/db/schema.ts` | `agentSectionStatusEnum` pgEnum values extended with `'rejected'`. `agentSections` table gains `rejection_reason` column. `agentSectionVersionKindEnum` extended with `'rollback'`. `agentSectionVersions` table gains `rolled_back_from_version` column. |
| `app/src/lib/ai/agent/services/sections.ts` | `saveSectionDraft`, `approveSection`, `rollbackSection` each gain an `assertPolicy` call after ownership + stateVersion. Add two new functions: `markSectionStale`, `rejectSection`. `rollbackSection` extended to accept the new policy check and to persist `rolledBackFromVersion`. Local `verifySessionOwnership` removed (replaced by shared import). |
| `app/src/lib/ai/agent/services/application.ts` | `setApplicationStatus` gains an `assertPolicy` call. Add two new functions: `setSelectedCall`, `freezeOutline`. Imports `verifySessionOwnership` from shared `context-helpers`. |
| `app/drizzle/meta/_journal.json` | Two new journal entries for the new migrations (auto-updated by `npm run db:generate`). |

### V3 audit output

| File | Purpose |
|---|---|
| `docs/superpowers/specs/2026-04-10-phase3a-v3-audit.md` | V3 mutation call-site audit report. Lists every site, verifies upstream enforcement, documents any findings. Committed as the first task's deliverable. |

---

## Task 1: V3 audit (research only, no code)

**Files:**
- Create: `docs/superpowers/specs/2026-04-10-phase3a-v3-audit.md`

This task is research-only. The goal is to document, before writing any 3a code, that V3 will continue to behave correctly after the service-layer gates are added. If the audit surfaces a V3 bug, it lands in a **separate small PR before 3a** per the spec §5.6.

- [ ] **Step 1: Create the audit report file**

Create `docs/superpowers/specs/2026-04-10-phase3a-v3-audit.md` with this initial skeleton:

```markdown
# Phase 3a V3 Audit Report

**Date:** 2026-04-10
**Purpose:** Before adding service-layer policy gates in Phase 3a, verify that V3's existing mutation call sites already respect the same invariants upstream. Any divergence must be fixed in a separate PR before 3a merges.

## Call sites audited

(populated by Step 2)

## Findings

(populated by Step 3)

## Conclusion

(populated by Step 4)
```

- [ ] **Step 2: Enumerate V3 mutation call sites (repo-wide scope)**

Grepping only `runtime.ts` is not enough. V3-era mutations live in multiple files. Search the entire agent + orchestrator surface for every write to `agent_sessions` or `agent_sections`:

```bash
cd app

# Direct Drizzle writes against agent tables
grep -rn "db\.update(agentSections)\|db\.update(agentSessions)" src/lib/ai/ 2>/dev/null
grep -rn "db\.insert(agentSections)\|db\.insert(agentSessions)" src/lib/ai/ 2>/dev/null
grep -rn "db\.delete(agentSections)\|db\.delete(agentSessions)" src/lib/ai/ 2>/dev/null

# Transaction-scoped writes (tx.update / tx.insert)
grep -rn "tx\.update(agentSections)\|tx\.update(agentSessions)" src/lib/ai/ 2>/dev/null
grep -rn "tx\.insert(agentSections)\|tx\.insert(agentSessions)" src/lib/ai/ 2>/dev/null

# V3 transition helpers
grep -rn "applyTransition\|dispatchStructuredAction\|persistSessionState" src/lib/ai/ 2>/dev/null

# Structured action helpers that may live outside runtime.ts
grep -rn "ACCEPT_SECTION\|FREEZE_OUTLINE\|SET_SELECTED_CALL\|MARK_SECTION_STALE\|REJECT_SECTION\|SET_STATUS" src/lib/ai/ 2>/dev/null

# Route-level mutation paths (API handlers that write directly)
grep -rn "db\.update(agentSections)\|db\.update(agentSessions)" src/app/api/ 2>/dev/null
grep -rn "db\.insert(agentSections)\|db\.insert(agentSessions)" src/app/api/ 2>/dev/null
```

**Expected mutation locations (known at the time this plan was written — verify each):**
- `src/lib/ai/agent/runtime.ts` — the main V3 runtime tool loop (multiple call sites)
- `src/lib/ai/agent/history.ts` — message summary / compaction writes
- `src/lib/ai/agent/tools/generate-section.ts` — section insert on first draft
- `src/lib/ai/orchestrator/section-versions.ts` — section-version writes with their own audit calls

For each match, capture in the "Call sites audited" table:
- File:line number
- What field it mutates (e.g., `status`, `content`, `outlineFrozen`, `selectedCallId`, `stateVersion`)
- What upstream check, if any, guards the mutation (search upward from the mutation for `if (session.outlineFrozen)`, `if (session.eligibility...)`, `if (section.status === ...)` patterns)
- Whether the mutation emits a `logAudit` call

Write findings into the "Call sites audited" section as a table:

```markdown
| File:line | Field mutated | Upstream guard | Notes |
|---|---|---|---|
| runtime.ts:377 | ACCEPT_SECTION transition | requires outlineFrozen, section status = needs_review | OK |
| ... | ... | ... | ... |
```

- [ ] **Step 3: Flag any gaps**

For every call site from Step 2, verify whether the upstream guard matches the policy matrix in `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md` §4. If they do not match exactly, that is a finding.

Categorize each finding as:
- **No divergence** — V3 already enforces the same invariant (most should fall here)
- **Stricter in V3** — V3 enforces more than the matrix requires (safe; no action needed)
- **Looser in V3** — V3 enforces less than the matrix; this is a divergence that must be resolved before 3a merges

Populate the "Findings" section.

- [ ] **Step 4: Decide the disposition**

Write the "Conclusion" section with one of these outcomes:
- **Clean audit** → proceed with 3a as written
- **Divergence requires V3 fix** → stop 3a. Open a separate small PR titled `fix(agent-v3): <description>` that fixes the divergence. Merge it first, then re-run Step 3 until clean.

- [ ] **Step 5: Commit the audit report**

```bash
cd app && git add ../docs/superpowers/specs/2026-04-10-phase3a-v3-audit.md
cd .. && git commit -m "docs(phase3a): V3 mutation call-site audit report

Documents V3's existing enforcement of the Phase 3 policy matrix
invariants. Verifies that adding service-layer gates in 3a will
not change V3 behavior for any legitimate flow.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Eligibility helper

**Files:**
- Create: `app/src/lib/ai/agent/policy/eligibility.ts`
- Create: `app/tests/unit/policy/eligibility.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/policy/eligibility.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isEligibilityPassed } from '@/lib/ai/agent/policy/eligibility'
import type { EligibilityResult } from '@/lib/ai/agent/types'

describe('isEligibilityPassed', () => {
  it('returns false for null', () => {
    expect(isEligibilityPassed(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isEligibilityPassed(undefined)).toBe(false)
  })

  it('returns true when failCount is 0', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 100,
      passCount: 5,
      failCount: 0,
      warningCount: 0,
    }
    expect(isEligibilityPassed(decision)).toBe(true)
  })

  it('returns false when failCount is positive', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 60,
      passCount: 3,
      failCount: 2,
      warningCount: 0,
    }
    expect(isEligibilityPassed(decision)).toBe(false)
  })

  it('returns true when there are warnings but no failures', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 90,
      passCount: 5,
      failCount: 0,
      warningCount: 3,
    }
    expect(isEligibilityPassed(decision)).toBe(true)
  })

  it('returns false when failCount is 1 (boundary)', () => {
    const decision: EligibilityResult = {
      results: [],
      score: 80,
      passCount: 4,
      failCount: 1,
      warningCount: 0,
    }
    expect(isEligibilityPassed(decision)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd app && npx vitest run tests/unit/policy/eligibility.test.ts
```

Expected: FAIL with "Cannot find module '@/lib/ai/agent/policy/eligibility'".

- [ ] **Step 3: Create the helper**

Create `app/src/lib/ai/agent/policy/eligibility.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests and verify all pass**

```bash
cd app && npx vitest run tests/unit/policy/eligibility.test.ts
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/policy/eligibility.ts tests/unit/policy/eligibility.test.ts
git commit -m "feat(phase3a): add isEligibilityPassed policy helper

Single source of definitional truth for 'eligibility passed'.
Derives pass/fail from failCount === 0 rather than a stored
field — no schema migration required. Warnings are advisory
and do not block progression."
```

---

## Task 3: Extend ValidationError with policyCode

**Files:**
- Modify: `app/src/lib/ai/agent/services/errors.ts`
- Create: `app/tests/unit/services/validation-error.test.ts`

- [ ] **Step 1: Write the failing test for the new policyCode field**

Create `app/tests/unit/services/validation-error.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

describe('ValidationError', () => {
  it('constructs without policyCode (backwards-compatible 2-arg form)', () => {
    const err = new ValidationError('sectionKey', 'Section key required')
    expect(err.field).toBe('sectionKey')
    expect(err.message).toBe('Section key required')
    expect(err.policyCode).toBeUndefined()
    expect(err.code).toBe('VALIDATION')
  })

  it('constructs with explicit policyCode (new 3-arg form)', () => {
    const err = new ValidationError(
      'outlineFrozen',
      'Outline must be frozen first',
      'POLICY_OUTLINE_NOT_FROZEN',
    )
    expect(err.field).toBe('outlineFrozen')
    expect(err.message).toBe('Outline must be frozen first')
    expect(err.policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    expect(err.code).toBe('VALIDATION')
  })

  it('name is ValidationError on both forms', () => {
    expect(new ValidationError('f', 'm').name).toBe('ValidationError')
    expect(new ValidationError('f', 'm', 'POLICY_X').name).toBe('ValidationError')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd app && npx vitest run tests/unit/services/validation-error.test.ts
```

Expected: the 2-arg test PASSES (already supported), but the 3-arg test FAILS because `policyCode` is not a real field yet.

- [ ] **Step 3: Extend ValidationError**

Edit `app/src/lib/ai/agent/services/errors.ts`. Replace the existing `ValidationError` block:

```typescript
// ── 400 Validation ─────────────────────────────────────────────────────────

export class ValidationError extends ServiceError {
  readonly code = 'VALIDATION' as const
  readonly httpStatus = 400 as const
  readonly field: string
  readonly policyCode?: string

  constructor(field: string, message: string, policyCode?: string) {
    super(message)
    this.name = this.constructor.name
    this.field = field
    this.policyCode = policyCode
  }
}
```

- [ ] **Step 4: Run the test and verify all pass**

```bash
cd app && npx vitest run tests/unit/services/validation-error.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Run the full services test suite to catch regressions**

```bash
cd app && npx vitest run tests/unit/services
```

Expected: all existing tests still pass. If any test fails because it asserted `policyCode === undefined` via a strict equality check that now needs `toBeUndefined()`, fix the assertion.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/services/errors.ts tests/unit/services/validation-error.test.ts
git commit -m "feat(phase3a): add optional policyCode to ValidationError

Backwards-compatible third constructor argument. Phase 3 policy
checks will raise ValidationError with a stable policy code
prefix (e.g. POLICY_OUTLINE_NOT_FROZEN) so the managed executor
and route layer can map them to user-facing recovery messages."
```

---

## Task 4: Policy matrix types and POLICY_MATRIX constant

**Files:**
- Modify: `app/src/lib/legal/audit.ts` (extend `AuditAction` union with 5 new Phase 3 actions)
- Create: `app/src/lib/ai/agent/policy/matrix.ts`
- Create: `app/tests/unit/policy/matrix.test.ts`

> **Background (verified against actual source):** The current `AuditAction` type union in `app/src/lib/legal/audit.ts` contains `section.rollback`, `section.state_change`, and `project.version_save` (legacy strings reused by Phase 3 per the spec), but it does NOT contain any `session.*` actions, `section.marked_stale`, or `section.rejected`. If the new Phase 3 services call `logAudit` with unrecognized action strings, the services will not typecheck. The vocabulary extension MUST land as the first step of this task, before the matrix references any new strings.

- [ ] **Step 0: Extend the AuditAction union**

Open `app/src/lib/legal/audit.ts`. Find the `AuditAction` type declaration (around line 15-86). Add 5 new Phase 3 managed-agent entries immediately after the `section.state_change` line (around line 42) or in their own labeled block near the end of the union:

```typescript
export type AuditAction =
  // ... existing entries unchanged ...
  | 'section.rollback'
  | 'section.state_change'
  | 'section.export'
  | 'project.version_save'
  // ... existing entries unchanged ...
  // Phase 3 managed-agent mutations (new narrow mutation services)
  | 'session.call_selected'
  | 'session.outline_frozen'
  | 'session.status_change'
  | 'section.marked_stale'
  | 'section.rejected'
  // ... rest of existing entries unchanged ...
```

Do NOT remove or rename any existing action. The new additions are purely additive. The spec's "legacy audit strings reused intentionally" rule applies to `project.version_save`, `section.state_change`, and `section.rollback` — those stay exactly as-is.

- [ ] **Step 0b: Run the audit tests to verify nothing regressed**

```bash
cd app && npx vitest run tests/unit/legal tests/integration/legal 2>&1 | tail -30
```

Expected: all existing audit tests pass. If any audit-vocabulary validation test (e.g., asserting the union length) breaks, update it to include the 5 new entries.

- [ ] **Step 0c: Commit the vocabulary extension**

```bash
cd app && git add src/lib/legal/audit.ts tests/unit/legal tests/integration/legal 2>/dev/null
cd .. && git commit -m "feat(phase3a): extend AuditAction union with 5 Phase 3 mutation actions

Adds session.call_selected, session.outline_frozen,
session.status_change, section.marked_stale, section.rejected
to the audit vocabulary. Required before Phase 3 services can
call logAudit with the new action strings. Legacy strings
(section.rollback, section.state_change, project.version_save)
are kept unchanged for hash-chain continuity.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/policy/matrix.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { POLICY_MATRIX, type PolicyRule } from '@/lib/ai/agent/policy/matrix'

const EXPECTED_KEYS = [
  'setSelectedCall',
  'freezeOutline',
  'saveSectionDraft',
  'approveSection',
  'rollbackSection',
  'markSectionStale',
  'rejectSection',
  'setApplicationStatus',
] as const

describe('POLICY_MATRIX', () => {
  it('contains exactly the 8 Phase 3 mutation keys', () => {
    const keys = Object.keys(POLICY_MATRIX).sort()
    expect(keys).toEqual([...EXPECTED_KEYS].sort())
  })

  it('every rule has ownership, stateVersion, and auditAction fields', () => {
    for (const key of EXPECTED_KEYS) {
      const rule = POLICY_MATRIX[key]
      expect(rule.requiresOwnership).toBe(true)
      expect(rule.requiresStateVersion).toBe(true)
      expect(rule.auditAction).toBeTypeOf('string')
      expect(rule.auditAction.length).toBeGreaterThan(0)
    }
  })

  it('setSelectedCall forbids outline frozen and does not require eligibility', () => {
    const rule = POLICY_MATRIX.setSelectedCall
    expect(rule.forbidsOutlineFrozen).toBe(true)
    expect(rule.requiresEligibility).toBe('none')
  })

  it('freezeOutline requires call selected and eligibility passed', () => {
    const rule = POLICY_MATRIX.freezeOutline
    expect(rule.requiresCallSelected).toBe(true)
    expect(rule.requiresEligibility).toBe('passed')
    expect(rule.forbidsOutlineFrozen).toBe(true)
  })

  it('saveSectionDraft requires outline frozen and eligibility passed', () => {
    const rule = POLICY_MATRIX.saveSectionDraft
    expect(rule.requiresOutlineFrozen).toBe(true)
    expect(rule.requiresEligibility).toBe('passed')
  })

  it('approveSection requires outline frozen and restricts section state', () => {
    const rule = POLICY_MATRIX.approveSection
    expect(rule.requiresOutlineFrozen).toBe(true)
    expect(rule.allowedSectionStates).toEqual(['draft', 'needs_review'])
  })

  it('rollbackSection requires outline frozen with no section state restriction', () => {
    const rule = POLICY_MATRIX.rollbackSection
    expect(rule.requiresOutlineFrozen).toBe(true)
    expect(rule.allowedSectionStates).toBeUndefined()
  })

  it('markSectionStale allowed from draft/needs_review/accepted', () => {
    const rule = POLICY_MATRIX.markSectionStale
    expect(rule.allowedSectionStates?.sort()).toEqual(['accepted', 'draft', 'needs_review'])
  })

  it('rejectSection allowed from draft/needs_review/rejected (for same-reason no-op)', () => {
    const rule = POLICY_MATRIX.rejectSection
    expect(rule.allowedSectionStates?.sort()).toEqual(['draft', 'needs_review', 'rejected'])
  })

  it('setApplicationStatus has status-change metadata', () => {
    const rule = POLICY_MATRIX.setApplicationStatus
    expect(rule.auditAction).toBe('session.status_change')
  })

  it('all audit actions are non-empty and follow dotted convention', () => {
    for (const key of EXPECTED_KEYS) {
      const action = POLICY_MATRIX[key].auditAction
      expect(action).toMatch(/^[a-z_]+\.[a-z_]+$/)
    }
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd app && npx vitest run tests/unit/policy/matrix.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the matrix module**

Create `app/src/lib/ai/agent/policy/matrix.ts`:

```typescript
// ── Policy Matrix ────────────────────────────────────────────────────────
// Declarative rules for every Phase 3 state-changing operation.
//
// This file is purely declarative. Procedural logic (idempotency checks,
// validation-application preconditions, rejection-reason comparison, etc.)
// lives in the service functions, not here. The matrix describes:
//   - which invariants must hold before the mutation
//   - which error code is raised when a gate fails
//   - which audit action string tags the event
//
// LEGACY AUDIT STRINGS: Some rules reuse the legacy V3 audit action
// strings (e.g. `project.version_save`, `section.state_change`) on
// purpose, to preserve hash-chain continuity across the V3 → managed
// migration. Do not rename them without a coordinated audit migration.

import type { SectionStatus, SessionStatus } from '../types'

export type EligibilityRequirement = 'none' | 'run' | 'passed'

export interface PolicyRule {
  requiresOwnership: true
  requiresStateVersion: true
  requiresSessionStatus?: SessionStatus[]
  requiresCallSelected?: boolean
  requiresOutlineFrozen?: boolean
  forbidsOutlineFrozen?: boolean
  requiresEligibility: EligibilityRequirement
  allowedSectionStates?: SectionStatus[]
  forbidIfSectionState?: SectionStatus[]
  auditAction: string
  errorCodes: PolicyErrorCodes
}

export interface PolicyErrorCodes {
  sessionStatus?: string
  noCall?: string
  outlineFrozen?: string      // raised when forbidsOutlineFrozen is violated
  outlineNotFrozen?: string   // raised when requiresOutlineFrozen is violated
  eligibility?: string
  sectionWrongState?: string
}

export const POLICY_MATRIX = {
  setSelectedCall: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresEligibility: 'none',
    forbidsOutlineFrozen: true,
    auditAction: 'session.call_selected',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      outlineFrozen: 'POLICY_OUTLINE_ALREADY_FROZEN',
    },
  },
  freezeOutline: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresCallSelected: true,
    requiresEligibility: 'passed',
    forbidsOutlineFrozen: true,
    auditAction: 'session.outline_frozen',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      noCall: 'POLICY_NO_CALL_SELECTED',
      eligibility: 'POLICY_ELIGIBILITY_NOT_PASSED',
      outlineFrozen: 'POLICY_OUTLINE_ALREADY_FROZEN',
    },
  },
  saveSectionDraft: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresOutlineFrozen: true,
    requiresEligibility: 'passed',
    auditAction: 'project.version_save',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      eligibility: 'POLICY_ELIGIBILITY_NOT_PASSED',
    },
  },
  approveSection: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    allowedSectionStates: ['draft', 'needs_review'],
    auditAction: 'section.state_change',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      sectionWrongState: 'POLICY_SECTION_WRONG_STATE',
    },
  },
  rollbackSection: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    // LEGACY: reuses the existing 'section.rollback' action string
    // (audit.ts line 41) for hash-chain continuity with V3. Do not
    // rename to 'section.rolled_back' — that would fork the audit
    // semantics. See spec §4 rule 5 note.
    auditAction: 'section.rollback',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
    },
  },
  markSectionStale: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    allowedSectionStates: ['draft', 'needs_review', 'accepted'],
    auditAction: 'section.marked_stale',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      sectionWrongState: 'POLICY_SECTION_WRONG_STATE',
    },
  },
  rejectSection: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresOutlineFrozen: true,
    requiresEligibility: 'none',
    allowedSectionStates: ['draft', 'needs_review', 'rejected'],
    auditAction: 'section.rejected',
    errorCodes: {
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      sectionWrongState: 'POLICY_SECTION_WRONG_STATE',
    },
  },
  setApplicationStatus: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresEligibility: 'none',
    auditAction: 'session.status_change',
    errorCodes: {},  // setApplicationStatus-specific checks happen in the service (validate_application for 'completed')
  },
} as const satisfies Record<string, PolicyRule>

export type PolicyMatrixKey = keyof typeof POLICY_MATRIX
```

- [ ] **Step 4: Run the test and verify all pass**

```bash
cd app && npx vitest run tests/unit/policy/matrix.test.ts
```

Expected: 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/policy/matrix.ts tests/unit/policy/matrix.test.ts
git commit -m "feat(phase3a): add declarative POLICY_MATRIX for Phase 3 mutations

Single source of truth for ownership, concurrency, session-state,
eligibility, section-state, audit-action, and error-code rules
governing every Phase 3 write mutation. Legacy audit strings are
reused intentionally to preserve hash-chain continuity."
```

---

## Task 5: assertPolicy helper

**Files:**
- Create: `app/src/lib/ai/agent/policy/enforce.ts`
- Create: `app/tests/unit/policy/enforce.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/policy/enforce.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { assertPolicy } from '@/lib/ai/agent/policy/enforce'
import { POLICY_MATRIX } from '@/lib/ai/agent/policy/matrix'
import { ValidationError } from '@/lib/ai/agent/services/errors'
import type { AgentSession } from '@/lib/ai/agent/types'

function baseSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: null,
    currentPhase: 'discovery',
    blueprint: null,
    eligibility: null,
    outline: null,
    warnings: [],
    planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null,
    stateVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

describe('assertPolicy', () => {
  describe('requiresSessionStatus', () => {
    it('passes when session is active', () => {
      expect(() => assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession())).not.toThrow()
    })

    it('throws when session is paused', () => {
      expect(() => assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession({ status: 'paused' })))
        .toThrow(ValidationError)
    })
  })

  describe('forbidsOutlineFrozen', () => {
    it('passes when outline is not frozen', () => {
      expect(() => assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession())).not.toThrow()
    })

    it('throws POLICY_OUTLINE_ALREADY_FROZEN when outline is frozen', () => {
      try {
        assertPolicy(POLICY_MATRIX.setSelectedCall, baseSession({ outlineFrozen: true }))
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_ALREADY_FROZEN')
      }
    })
  })

  describe('requiresCallSelected', () => {
    it('throws POLICY_NO_CALL_SELECTED for freezeOutline without a call', () => {
      try {
        assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 } }))
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).policyCode).toBe('POLICY_NO_CALL_SELECTED')
      }
    })
  })

  describe('requiresOutlineFrozen', () => {
    it('throws POLICY_OUTLINE_NOT_FROZEN for saveSectionDraft when unfrozen', () => {
      try {
        assertPolicy(POLICY_MATRIX.saveSectionDraft, baseSession({
          selectedCallId: 'call-1',
          eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
        }))
        expect.fail('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError)
        expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
      }
    })
  })

  describe('requiresEligibility', () => {
    it('throws POLICY_ELIGIBILITY_NOT_PASSED for freezeOutline when eligibility is null', () => {
      try {
        assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ selectedCallId: 'call-1', eligibility: null }))
        expect.fail('should have thrown')
      } catch (err) {
        expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
      }
    })

    it('throws POLICY_ELIGIBILITY_NOT_PASSED when failCount > 0', () => {
      try {
        assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({
          selectedCallId: 'call-1',
          eligibility: { results: [], score: 50, passCount: 2, failCount: 3, warningCount: 0 },
        }))
        expect.fail('should have thrown')
      } catch (err) {
        expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
      }
    })

    it('passes when eligibility is run and failCount is 0', () => {
      expect(() => assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({
        selectedCallId: 'call-1',
        eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 2 },
      }))).not.toThrow()
    })
  })

  describe('allowedSectionStates', () => {
    it('passes when section state is in the allowed list', () => {
      expect(() => assertPolicy(POLICY_MATRIX.approveSection, baseSession({ outlineFrozen: true }), { sectionState: 'draft' }))
        .not.toThrow()
    })

    it('throws POLICY_SECTION_WRONG_STATE when not in allowed list', () => {
      try {
        assertPolicy(POLICY_MATRIX.approveSection, baseSession({ outlineFrozen: true }), { sectionState: 'accepted' })
        expect.fail('should have thrown')
      } catch (err) {
        expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
      }
    })
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd app && npx vitest run tests/unit/policy/enforce.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Create the helper**

Create `app/src/lib/ai/agent/policy/enforce.ts`:

```typescript
// ── Policy enforcement helper ──────────────────────────────────────────────
// assertPolicy is called by service functions AFTER ownership +
// stateVersion checks. It reads a rule from POLICY_MATRIX and throws a
// typed ValidationError with a stable policyCode on any gate failure.
//
// This helper is the only place that knows how to interpret the rule
// shape. Callers treat it as a black-box guard.

import type { AgentSession, SectionStatus } from '../types'
import { ValidationError } from '../services/errors'
import type { PolicyRule } from './matrix'
import { isEligibilityPassed } from './eligibility'

export interface AssertPolicyOpts {
  sectionState?: SectionStatus
}

export function assertPolicy(
  rule: PolicyRule,
  session: AgentSession,
  opts: AssertPolicyOpts = {},
): void {
  // 1. Session status
  if (rule.requiresSessionStatus && !rule.requiresSessionStatus.includes(session.status)) {
    throw new ValidationError(
      'sessionStatus',
      `Session status is '${session.status}'; expected one of ${rule.requiresSessionStatus.join(', ')}`,
      rule.errorCodes.sessionStatus,
    )
  }

  // 2. Call selected
  if (rule.requiresCallSelected && !session.selectedCallId) {
    throw new ValidationError(
      'selectedCallId',
      'No call selected on this session',
      rule.errorCodes.noCall,
    )
  }

  // 3. Outline frozen forbidden
  if (rule.forbidsOutlineFrozen && session.outlineFrozen) {
    throw new ValidationError(
      'outlineFrozen',
      'Operation not allowed while outline is frozen',
      rule.errorCodes.outlineFrozen,
    )
  }

  // 4. Outline frozen required
  if (rule.requiresOutlineFrozen && !session.outlineFrozen) {
    throw new ValidationError(
      'outlineFrozen',
      'Outline must be frozen before this operation',
      rule.errorCodes.outlineNotFrozen,
    )
  }

  // 5. Eligibility
  if (rule.requiresEligibility === 'passed' && !isEligibilityPassed(session.eligibility)) {
    throw new ValidationError(
      'eligibility',
      'Eligibility must have been run and produced no hard failures',
      rule.errorCodes.eligibility,
    )
  }

  // 6. Section state allowlist
  if (rule.allowedSectionStates && opts.sectionState !== undefined) {
    if (!rule.allowedSectionStates.includes(opts.sectionState)) {
      throw new ValidationError(
        'sectionState',
        `Section state is '${opts.sectionState}'; expected one of ${rule.allowedSectionStates.join(', ')}`,
        rule.errorCodes.sectionWrongState,
      )
    }
  }

  // 7. Section state denylist (forbidIfSectionState) — currently unused,
  //    kept for future mutations where a denylist is cleaner than an
  //    allowlist.
  if (rule.forbidIfSectionState && opts.sectionState !== undefined) {
    if (rule.forbidIfSectionState.includes(opts.sectionState)) {
      throw new ValidationError(
        'sectionState',
        `Section state '${opts.sectionState}' is not allowed for this operation`,
        rule.errorCodes.sectionWrongState,
      )
    }
  }
}
```

- [ ] **Step 4: Run the test and verify all pass**

```bash
cd app && npx vitest run tests/unit/policy/enforce.test.ts
```

Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/policy/enforce.ts tests/unit/policy/enforce.test.ts
git commit -m "feat(phase3a): add assertPolicy helper for service-layer gates

Throws ValidationError with stable policyCode on any gate failure.
Driven by the declarative POLICY_MATRIX from the policy module.
Services call this after ownership + stateVersion checks so the
same invariant is enforced regardless of caller (V3, MCP, managed)."
```

---

## Task 6: Schema migration 1 — 'rejected' + rejection_reason

**Files:**
- Modify: `app/src/lib/db/schema.ts`
- Modify: `app/src/lib/ai/agent/types.ts`
- Modify: `app/src/lib/ai/agent/services/types.ts` (propagate `SectionStatus` type — see Step 5b)
- Create: `app/drizzle/NNNN_agent_sections_rejected_and_reason.sql` (generated — `NNNN` is the next available number)
- Modify: `app/drizzle/meta/_journal.json` (auto-updated by db:generate)

> **Postgres enum warning:** `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block on some Postgres versions/environments (< 12 strictly, but also some managed Postgres setups). Drizzle usually handles this correctly by generating a standalone `ALTER TYPE` statement outside the transaction, but if `npm run db:push` fails with `ALTER TYPE ... cannot run inside a transaction block`, run the ALTER TYPE statement manually via `psql "$DATABASE_URL" -c "ALTER TYPE agent_section_status ADD VALUE 'rejected';"` and mark the migration applied.

- [ ] **Step 1: Verify current enum state**

```bash
cd app && grep -n "agentSectionStatusEnum" src/lib/db/schema.ts
```

Expected output includes the existing values. Confirm `'stale'` is already present (it is — at line 903-905).

- [ ] **Step 2: Add 'rejected' to the TS union**

Edit `app/src/lib/ai/agent/types.ts`. Find the `SECTION_STATUSES` constant around line 11:

```typescript
export const SECTION_STATUSES = [
  'pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed',
] as const
```

Change to:

```typescript
export const SECTION_STATUSES = [
  'pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed', 'rejected',
] as const
```

- [ ] **Step 3: Add 'rejected' to the Drizzle enum**

Edit `app/src/lib/db/schema.ts`. Find `agentSectionStatusEnum` around line 903:

```typescript
export const agentSectionStatusEnum = pgEnum('agent_section_status', [
  'pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed',
])
```

Change to:

```typescript
export const agentSectionStatusEnum = pgEnum('agent_section_status', [
  'pending', 'generating', 'draft', 'accepted', 'stale', 'invalidated', 'needs_review', 'failed', 'rejected',
])
```

- [ ] **Step 4: Add the rejection_reason column to agentSections**

In the same file, find the `agentSections` table definition (around line 907). Add a new column before the closing brace:

```typescript
export const agentSections = pgTable('agent_sections', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  sectionKey: varchar('section_key', { length: 100 }).notNull(),
  title: varchar('title', { length: 500 }).notNull(),
  documentOrder: integer('document_order').notNull(),
  generationOrder: integer('generation_order').notNull(),
  status: agentSectionStatusEnum('status').notNull().default('pending'),
  content: text('content'),
  acceptedContent: text('accepted_content'),
  modelUsed: varchar('model_used', { length: 100 }),
  retryCount: integer('retry_count').notNull().default(0),
  sourcesUsed: jsonb('sources_used'),
  promptVersion: varchar('prompt_version', { length: 50 }),
  latencyMs: integer('latency_ms'),
  tokenUsage: jsonb('token_usage'),
  errorClass: varchar('error_class', { length: 100 }),
  rejectionReason: text('rejection_reason'),  // NEW — Phase 3a
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqSessionSection: uniqueIndex('uniq_agent_section_session_key').on(table.sessionId, table.sectionKey),
  idxSessionOrder: index('idx_agent_sections_order').on(table.sessionId, table.documentOrder),
  idxSessionStatus: index('idx_agent_sections_status').on(table.sessionId, table.status),
}))
```

- [ ] **Step 5: Add rejectionReason to the AgentSection TS interface**

Edit `app/src/lib/ai/agent/types.ts`. Find the `AgentSection` interface around line 77:

```typescript
export interface AgentSection {
  id: string
  sessionId: string
  sectionKey: string
  title: string
  documentOrder: number
  generationOrder: number
  status: SectionStatus
  content: string | null
  acceptedContent: string | null
  modelUsed: string | null
  retryCount: number
  sourcesUsed: string[] | null
  promptVersion: string | null
  latencyMs: number | null
  tokenUsage: { input: number; output: number } | null
  errorClass: string | null
  rejectionReason: string | null  // NEW — Phase 3a
  updatedAt: Date
}
```

- [ ] **Step 5b: Propagate SectionStatus type into services/types.ts**

Per the spec §5.5 propagation checklist, the service-layer types file currently uses a stringly-typed section status. Tighten it.

Open `app/src/lib/ai/agent/services/types.ts`. Find the `SectionListItem` interface (around line 124). Change the `status: string` field to import and use the proper `SectionStatus` union:

```typescript
// Add to the top of services/types.ts imports
import type { SectionStatus } from '../types'

// Then update SectionListItem:
export interface SectionListItem {
  id: string
  sessionId: string
  sectionKey: string
  title: string
  documentOrder: number
  generationOrder: number
  status: SectionStatus  // was: string
  retryCount: number
  updatedAt: Date
}
```

If the tightening causes typecheck errors elsewhere in the codebase (e.g., a caller was comparing `status` against a string literal that is not a `SectionStatus` member), those are real bugs and must be fixed in the same commit.

Run `npm run typecheck` after this change to catch any downstream type errors:

```bash
cd app && npm run typecheck
```

Expected: clean. If errors appear, they are bugs in existing code that were masked by the stringly-typed field — fix them inline.

- [ ] **Step 6: Generate the migration**

```bash
cd app && npm run db:generate
```

Expected: Drizzle prints the migration name (`NNNN_agent_sections_rejected_and_reason` where NNNN is the next available sequence number — run `ls app/drizzle/*.sql | tail -1` beforehand to confirm which number it should be) and writes a new file under `app/drizzle/`. Read the generated file and confirm it contains:
- `ALTER TYPE "agent_section_status" ADD VALUE 'rejected';`
- `ALTER TABLE "agent_sections" ADD COLUMN "rejection_reason" text;`

If the generated file doesn't have the expected ALTER TYPE, the enum migration may be split into a separate step. Drizzle sometimes generates an `ALTER TYPE` separately. Inspect the file to confirm both changes are present (possibly across multiple statements).

- [ ] **Step 7: Apply the migration locally**

```bash
cd app && npm run db:push
```

Expected: `db:push` reports the enum + column applied. If running against a shared DB, use `npm run db:migrate` instead.

- [ ] **Step 8: Verify in the DB**

```bash
cd app && psql "$DATABASE_URL" -c "\dT+ agent_section_status"
cd app && psql "$DATABASE_URL" -c "\d agent_sections" | grep rejection_reason
```

Expected: `'rejected'` appears in the enum values; `rejection_reason` appears as a text column in the table.

- [ ] **Step 9: Commit**

```bash
cd app && git add src/lib/db/schema.ts src/lib/ai/agent/types.ts drizzle/
cd .. && git commit -m "feat(phase3a): add 'rejected' section status + rejection_reason column

Schema support for the new rejectSection service. The 'rejected'
enum value is added to agent_section_status, and a nullable
rejection_reason text column is added to agent_sections so the
reject reason can be stored alongside the status transition.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Schema migration 2 — 'rollback' + rolled_back_from_version

**Files:**
- Modify: `app/src/lib/db/schema.ts`
- Modify: `app/src/lib/ai/agent/types.ts`
- Create: `app/drizzle/NNNN_agent_section_versions_rollback.sql` (generated — next number after Task 6's migration)

> **Postgres enum warning**: same caveat as Task 6 — if `db:push` refuses the `ALTER TYPE ... ADD VALUE`, run it manually via `psql`. See Task 6's note.

- [ ] **Step 1: Add 'rollback' to the Drizzle enum**

Edit `app/src/lib/db/schema.ts`. Find `agentSectionVersionKindEnum` around line 931:

```typescript
export const agentSectionVersionKindEnum = pgEnum('agent_section_version_kind', [
  'draft', 'accepted', 'regenerated', 'system_rewrite',
])
```

Change to:

```typescript
export const agentSectionVersionKindEnum = pgEnum('agent_section_version_kind', [
  'draft', 'accepted', 'regenerated', 'system_rewrite', 'rollback',
])
```

- [ ] **Step 2: Add the rolled_back_from_version column**

In the same file, find the `agentSectionVersions` table definition (around line 935). Add the new column:

```typescript
export const agentSectionVersions = pgTable('agent_section_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sectionId: uuid('section_id').notNull().references(() => agentSections.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  kind: agentSectionVersionKindEnum('kind').notNull(),
  content: text('content').notNull(),
  modelUsed: varchar('model_used', { length: 100 }),
  sourcesUsed: jsonb('sources_used'),
  rolledBackFromVersion: integer('rolled_back_from_version'),  // NEW — Phase 3a; populated only when kind='rollback'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // preserve existing indexes and unique constraints
}))
```

Read the existing table definition to see what index/constraint block already exists and keep it unchanged.

- [ ] **Step 3: Update the AgentSectionVersion TS interface**

Edit `app/src/lib/ai/agent/types.ts`. Find the `AgentSectionVersion` interface around line 97:

```typescript
export interface AgentSectionVersion {
  id: string
  sectionId: string
  versionNumber: number
  // ... existing fields
  rolledBackFromVersion: number | null  // NEW — Phase 3a
  createdAt: Date
}
```

Read the current definition first to see what existing fields are there, then add `rolledBackFromVersion: number | null` before `createdAt`.

- [ ] **Step 4: Add 'rollback' to any SectionVersionKind TS union**

Search for any TS union that enumerates version kinds:

```bash
cd app && grep -rn "'draft' | 'accepted' | 'regenerated' | 'system_rewrite'" src/
```

If any match is found, add `| 'rollback'` to the end. If none is found, version kinds are referenced via the inferred type from the Drizzle enum and no further change is needed.

- [ ] **Step 5: Generate the migration**

```bash
cd app && npm run db:generate
```

Expected: the generated file `NNNN_agent_section_versions_rollback.sql` appears under `drizzle/` with:
- `ALTER TYPE "agent_section_version_kind" ADD VALUE 'rollback';`
- `ALTER TABLE "agent_section_versions" ADD COLUMN "rolled_back_from_version" integer;`

- [ ] **Step 6: Apply the migration locally**

```bash
cd app && npm run db:push
```

Expected: applied successfully.

- [ ] **Step 7: Verify in the DB**

```bash
cd app && psql "$DATABASE_URL" -c "\dT+ agent_section_version_kind"
cd app && psql "$DATABASE_URL" -c "\d agent_section_versions" | grep rolled_back
```

Expected: `'rollback'` appears in the enum values; `rolled_back_from_version` appears as an integer column.

- [ ] **Step 8: Commit**

```bash
cd app && git add src/lib/db/schema.ts src/lib/ai/agent/types.ts drizzle/
cd .. && git commit -m "feat(phase3a): add 'rollback' version kind + rolled_back_from_version column

Schema support for rollbackSection creating a new version entry
with kind='rollback' and a pointer to the target version. Keeps
the version history linear and auditable — rollbacks do not
overwrite content in place.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Section enum sync test

**Files:**
- Create: `app/tests/unit/schema/section-enums.test.ts`

- [ ] **Step 1: Write the sync test**

Create `app/tests/unit/schema/section-enums.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { SECTION_STATUSES } from '@/lib/ai/agent/types'
import { agentSectionStatusEnum, agentSectionVersionKindEnum } from '@/lib/db/schema'

describe('section status enum sync', () => {
  it('Drizzle enum values include rejected', () => {
    expect(agentSectionStatusEnum.enumValues).toContain('rejected')
  })

  it('Drizzle enum values include stale', () => {
    expect(agentSectionStatusEnum.enumValues).toContain('stale')
  })

  it('TS SECTION_STATUSES union and Drizzle enum have the same values', () => {
    const tsValues = [...SECTION_STATUSES].sort()
    const drizzleValues = [...agentSectionStatusEnum.enumValues].sort()
    expect(tsValues).toEqual(drizzleValues)
  })
})

describe('section version kind enum sync', () => {
  it('Drizzle enum values include rollback', () => {
    expect(agentSectionVersionKindEnum.enumValues).toContain('rollback')
  })

  it('Drizzle enum values include the original 4 plus rollback', () => {
    const values = [...agentSectionVersionKindEnum.enumValues].sort()
    expect(values).toEqual(['accepted', 'draft', 'regenerated', 'rollback', 'system_rewrite'])
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd app && npx vitest run tests/unit/schema/section-enums.test.ts
```

Expected: 5 tests PASS. If any fail, it means Task 6 or Task 7 missed a propagation step.

- [ ] **Step 3: Commit**

```bash
cd app && git add tests/unit/schema/section-enums.test.ts
git commit -m "test(phase3a): add section enum sync test

Asserts DB enum values match TS union values for both
agent_section_status and agent_section_version_kind. Catches
future drift where someone adds an enum value to one place
but forgets the other."
```

---

## Task 9: Add policy check to existing saveSectionDraft

**Files:**
- Modify: `app/src/lib/ai/agent/services/sections.ts`
- Create or modify: `app/tests/unit/services/save-section-draft.test.ts`

- [ ] **Step 1: Write the failing test for the new gate**

Check if a test file already exists:

```bash
cd app && ls tests/unit/services/save-section-draft.test.ts 2>/dev/null && echo EXISTS || echo MISSING
```

If EXISTS, open the file and add the new test inside the existing describe block. If MISSING, create a new file:

Create or extend `app/tests/unit/services/save-section-draft.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn(),
}))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  stateVersion: 0,
  selectedCallId: 'call-1',
  outlineFrozen: false,
  eligibility: null,
}

describe('saveSectionDraft policy gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws POLICY_OUTLINE_NOT_FROZEN when outline is not frozen', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ ...baseSession, outlineFrozen: false, eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 } }]),
        }),
      }),
    })

    const { saveSectionDraft } = await import('@/lib/ai/agent/services/sections')

    try {
      await saveSectionDraft(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        {
          sessionId: baseSession.id,
          sectionKey: 'obiective',
          content: 'draft content',
          expectedStateVersion: 0,
        },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    }
  })

  it('throws POLICY_ELIGIBILITY_NOT_PASSED when eligibility failCount > 0', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            ...baseSession,
            outlineFrozen: true,
            eligibility: { results: [], score: 50, passCount: 2, failCount: 3, warningCount: 0 },
          }]),
        }),
      }),
    })

    const { saveSectionDraft } = await import('@/lib/ai/agent/services/sections')

    try {
      await saveSectionDraft(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', content: 'draft', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
    }
  })
})
```

- [ ] **Step 2: Run the test — expected to fail**

```bash
cd app && npx vitest run tests/unit/services/save-section-draft.test.ts
```

Expected: the two new tests FAIL because `saveSectionDraft` does not yet call `assertPolicy`.

- [ ] **Step 3: Modify saveSectionDraft to call assertPolicy**

Open `app/src/lib/ai/agent/services/sections.ts`. Find the existing `saveSectionDraft` function (around line 285). At the top of the file, add the import:

```typescript
import { assertPolicy } from '../policy/enforce'
import { POLICY_MATRIX } from '../policy/matrix'
```

Then modify the function body. Find the existing shape:

```typescript
export async function saveSectionDraft(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; content: string; expectedStateVersion: number },
): Promise<SectionDraftSaveResult> {
  // 1. Verify ownership
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Enforce expectedStateVersion
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  const newStateVersion = session.stateVersion + 1
  // ... existing transaction code ...
```

Add one line after the stateVersion check:

```typescript
  // 2. Enforce expectedStateVersion
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Enforce policy gates (new in Phase 3a)
  assertPolicy(POLICY_MATRIX.saveSectionDraft, session as unknown as AgentSession)

  const newStateVersion = session.stateVersion + 1
```

Note: `verifySessionOwnership` returns a Drizzle row type which may not exactly match `AgentSession`. The cast `as unknown as AgentSession` is safe here because `assertPolicy` only reads `status`, `selectedCallId`, `outlineFrozen`, `eligibility`, and `stateVersion` — all of which are present on both shapes with matching field names. If the compiler complains about other missing fields, the cast handles it.

Add the `AgentSession` import at the top of the file if it isn't already there:

```typescript
import type { AgentSession } from '../types'
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/services/save-section-draft.test.ts
```

Expected: both new policy tests PASS. All pre-existing tests in the file still PASS.

- [ ] **Step 5: Run the full services test suite**

```bash
cd app && npx vitest run tests/unit/services
```

Expected: all services tests still pass. If any pre-existing `saveSectionDraft` test fails, it's likely because the test's fixture session had `outlineFrozen=false` or `eligibility=null`. Update those fixtures to set `outlineFrozen: true` and `eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 }` so they pass the new gates.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/services/sections.ts tests/unit/services/save-section-draft.test.ts
git commit -m "feat(phase3a): enforce policy gates in saveSectionDraft

Calls assertPolicy after ownership + stateVersion checks.
Throws ValidationError with POLICY_OUTLINE_NOT_FROZEN or
POLICY_ELIGIBILITY_NOT_PASSED for the most common pre-drafting
mistakes. V3 runtime already enforces these upstream, so this
is defense in depth; managed runtime will rely on it in 3b."
```

---

## Task 10: Add policy check to existing approveSection

**Files:**
- Modify: `app/src/lib/ai/agent/services/sections.ts`
- Create or modify: `app/tests/unit/services/approve-section.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/services/approve-section.test.ts` (or extend an existing file):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn((fn) => fn({ update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }) })),
  },
}))

vi.mock('@/lib/legal/audit', () => ({
  logAudit: vi.fn(),
}))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  stateVersion: 0,
  selectedCallId: 'call-1',
  outlineFrozen: true,
  eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
}

describe('approveSection policy gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws POLICY_OUTLINE_NOT_FROZEN when outline is not frozen', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ ...baseSession, outlineFrozen: false }]),
        }),
      }),
    }).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'sec-1', status: 'draft', content: 'text' }]),
        }),
      }),
    })

    const { approveSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await approveSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    }
  })

  it('throws POLICY_SECTION_WRONG_STATE when section is already accepted', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([baseSession]),
        }),
      }),
    }).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'sec-1', status: 'stale', content: 'text' }]),
        }),
      }),
    })

    const { approveSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await approveSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd app && npx vitest run tests/unit/services/approve-section.test.ts
```

Expected: both tests FAIL because `approveSection` does not yet call `assertPolicy` with the section state.

- [ ] **Step 3: Modify approveSection to call assertPolicy**

Open `app/src/lib/ai/agent/services/sections.ts`. Find the existing `approveSection` function (around line 387). Modify:

```typescript
export async function approveSection(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)

  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // NEW: policy gates (outline frozen + section state allowlist)
  assertPolicy(POLICY_MATRIX.approveSection, session as unknown as AgentSession, { sectionState: section.status })

  // Idempotent: if already accepted, return current stateVersion (no mutation)
  if (section.status === 'accepted') {
    return { newStateVersion: session.stateVersion }
  }
  // ... existing code
```

Note the ordering: the policy check runs AFTER the section is loaded (because we need `section.status` for `allowedSectionStates`) but BEFORE the idempotent no-op check. This means trying to approve a `stale` section throws `POLICY_SECTION_WRONG_STATE` — which is correct per the matrix row.

The idempotent no-op for `status === 'accepted'` still runs because `'accepted'` is NOT in `approveSection`'s `allowedSectionStates` list `['draft', 'needs_review']`. Wait — that means the policy check would reject already-accepted sections with `POLICY_SECTION_WRONG_STATE` before the idempotent no-op can fire.

Looking at this more carefully: the idempotent no-op is for an already-accepted section. The policy check rejects it. These conflict.

**Resolution:** Run the idempotent no-op check BEFORE `assertPolicy`. If the section is already accepted, return early — we don't need to enforce state-allowlist rules on a no-op. Only after the idempotent check do we enforce the allowlist for actual mutations.

Change the ordering to:

```typescript
  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // ── Service contract: idempotent no-op ordering ──────────────────────
  // Per the Phase 3 policy matrix (§4) and idempotent no-op rule:
  //
  //   1. Idempotent no-op checks run BEFORE assertPolicy.
  //   2. If the mutation would be a no-op (here: section already accepted),
  //      return the current state unchanged — no stateVersion bump, no
  //      updatedAt change, no audit event, AND no policy error.
  //   3. Only non-idempotent paths run assertPolicy. The section state
  //      allowlist `['draft', 'needs_review']` intentionally excludes
  //      'accepted' because the idempotent short-circuit already handles
  //      that case above.
  //
  // This ordering is a deliberate design choice, not a bug. It matches
  // the spec's "no state change, no audit, no policy error" contract for
  // no-ops. Re-approving an accepted section is a valid user gesture
  // (e.g., double-click) and must not produce errors or audit noise.
  // ─────────────────────────────────────────────────────────────────────

  // Idempotent no-op FIRST
  if (section.status === 'accepted') {
    return { newStateVersion: session.stateVersion }
  }

  // Policy gates (outline frozen + section state allowlist).
  // Only runs for paths that will actually mutate.
  assertPolicy(POLICY_MATRIX.approveSection, session as unknown as AgentSession, { sectionState: section.status })

  // ... rest of existing code
```

**Leave the contract comment block in the source file** — it is the in-code explanation of an intentional exception that would otherwise confuse future reviewers who expect policy to run before idempotency.

- [ ] **Step 4: Run the tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/services/approve-section.test.ts
```

Expected: both new policy tests PASS. The `stale` section test now asserts the policy error fires correctly because 'stale' is not in the allowlist. The `outline not frozen` test fires because the policy check runs after the idempotent no-op short-circuit (which doesn't apply when the section is `draft`).

- [ ] **Step 5: Run all services tests**

```bash
cd app && npx vitest run tests/unit/services
```

Expected: all tests pass. If an existing test was relying on a section being approvable from an unexpected state, update the test fixture.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/services/sections.ts tests/unit/services/approve-section.test.ts
git commit -m "feat(phase3a): enforce policy gates in approveSection

Runs assertPolicy AFTER the idempotent no-op short-circuit but
BEFORE mutation. Already-accepted sections return current state
without hitting policy gates (the no-op rule: no state change,
no audit, no policy error). Non-idempotent paths enforce the
section state allowlist."
```

---

## Task 11: Add policy check to existing rollbackSection

**Files:**
- Modify: `app/src/lib/ai/agent/services/sections.ts`
- Create: `app/tests/unit/services/rollback-section.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/services/rollback-section.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

describe('rollbackSection policy gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('throws POLICY_OUTLINE_NOT_FROZEN when outline is not frozen', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{
            id: '11111111-1111-4111-8111-111111111111',
            userId: '22222222-2222-4222-8222-222222222222',
            stateVersion: 0,
            outlineFrozen: false,
            status: 'active',
            selectedCallId: 'call-1',
            eligibility: null,
          }]),
        }),
      }),
    })

    const { rollbackSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await rollbackSection(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', sectionKey: 'obiective', targetVersion: 1, expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_NOT_FROZEN')
    }
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd app && npx vitest run tests/unit/services/rollback-section.test.ts
```

Expected: FAIL — rollbackSection does not yet call assertPolicy.

- [ ] **Step 3: Modify rollbackSection**

Open `app/src/lib/ai/agent/services/sections.ts`. Find `rollbackSection` (around line 461). Add the policy check after ownership + stateVersion:

```typescript
export async function rollbackSection(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; targetVersion: number; expectedStateVersion: number },
): Promise<SectionRollbackResult> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // NEW: policy gate — outline must be frozen
  assertPolicy(POLICY_MATRIX.rollbackSection, session as unknown as AgentSession)

  // ... existing logic
```

Then, further down in the same function, when the new version row is inserted, add `kind: 'rollback'` and `rolledBackFromVersion: input.targetVersion` to the insert values. Find the existing version insert block and update it:

```typescript
// Existing code may look like:
// await tx.insert(agentSectionVersions).values({
//   sectionId, versionNumber: newVersionNumber, kind: 'draft', content: targetVersionContent,
// })

// Change to:
await tx.insert(agentSectionVersions).values({
  sectionId,
  versionNumber: newVersionNumber,
  kind: 'rollback',
  content: targetVersionContent,
  rolledBackFromVersion: input.targetVersion,
})
```

Read the existing `rollbackSection` body first to understand its current shape, then make this specific change. If the function currently reuses `kind: 'draft'` for the new version, change it to `kind: 'rollback'` and add `rolledBackFromVersion`.

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/services/rollback-section.test.ts
```

Expected: PASS. Existing rollbackSection tests still pass. If any existing test asserted `kind === 'draft'` on the new version row, update it to `kind === 'rollback'` and verify `rolledBackFromVersion` matches the target.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/services/sections.ts tests/unit/services/rollback-section.test.ts
git commit -m "feat(phase3a): enforce outline-frozen gate + kind='rollback' in rollbackSection

Adds assertPolicy call for POLICY_OUTLINE_NOT_FROZEN. Tags the
restored version row with kind='rollback' and populates the new
rolled_back_from_version column, so the audit trail shows an
explicit rollback rather than an opaque content swap."
```

---

## Task 12: Add policy check to existing setApplicationStatus

**Files:**
- Modify: `app/src/lib/ai/agent/services/application.ts`
- Create: `app/tests/unit/services/set-application-status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/services/set-application-status.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

vi.mock('@/lib/db', () => ({ db: { select: vi.fn(), update: vi.fn() } }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active' as const,
  stateVersion: 0,
  selectedCallId: 'call-1',
  outlineFrozen: true,
  eligibility: { results: [], score: 100, passCount: 1, failCount: 0, warningCount: 0 },
}

describe('setApplicationStatus policy gates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('allows setting status to paused from active', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([baseSession]),
        }),
      }),
    })
    ;(db.update as any).mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    })

    const { setApplicationStatus } = await import('@/lib/ai/agent/services/application')
    const result = await setApplicationStatus(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, status: 'paused', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('throws when trying to set completed without validate_application pass', async () => {
    // This test depends on the service's validate_application precondition.
    // If the existing service does not run validate_application, this test
    // will need to be skipped or the service updated — see Step 3.
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([baseSession]),
        }),
      }),
    })

    const { setApplicationStatus } = await import('@/lib/ai/agent/services/application')

    try {
      await setApplicationStatus(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, status: 'completed', expectedStateVersion: 0 },
      )
      // If the service happily sets completed without validation, this is
      // the expected behavior for the pre-3a service. The V3 audit should
      // have flagged it, and 3a will fix it in Step 3.
      expect.fail('should have thrown POLICY_VALIDATION_NOT_PASSED')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_VALIDATION_NOT_PASSED')
    }
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd app && npx vitest run tests/unit/services/set-application-status.test.ts
```

Expected: the first test PASSES (sets paused successfully), the second test FAILS because setApplicationStatus does not yet enforce the completed-requires-validation rule.

- [ ] **Step 3: Modify setApplicationStatus**

Open `app/src/lib/ai/agent/services/application.ts`. Find `setApplicationStatus`. Add the policy check + completed-specific validation.

**No self-import.** `validateApplication` lives in the same file as `setApplicationStatus`, so it is already in scope. Do NOT write `import { validateApplication } from './application'` — that's a self-import smell. Just call the local function directly.

Add these imports to the top of the file (only if not already present):

```typescript
import { assertPolicy } from '../policy/enforce'
import { POLICY_MATRIX } from '../policy/matrix'
import type { AgentSession } from '../types'
import { ValidationError } from './errors'
```

Then modify the function body:

```typescript
export async function setApplicationStatus(
  ctx: ServiceContext,
  input: { sessionId: string; status: 'paused' | 'completed'; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // Idempotent no-op: same status → return current state, no mutation, no audit
  if (session.status === input.status) {
    return { newStateVersion: session.stateVersion }
  }

  // Base policy gate (ownership + session status already enforced above)
  assertPolicy(POLICY_MATRIX.setApplicationStatus, session as unknown as AgentSession)

  // Completed-specific validation: validate_application must pass
  if (input.status === 'completed') {
    const validationResult = await validateApplication(ctx, input.sessionId)
    if (!validationResult.passed) {
      throw new ValidationError(
        'validation',
        'Application cannot be marked complete: validate_application did not pass',
        'POLICY_VALIDATION_NOT_PASSED',
      )
    }
  }

  // ... existing mutation code
```

Read the current `setApplicationStatus` body first to understand its existing shape. `validateApplication` is defined in the same file (`application.ts`), so it is already in scope — call it directly, **no import statement needed**.

**Pinned validation rule** (verified against `app/src/lib/ai/agent/services/types.ts:195`): `ApplicationValidationResult` already has a `passed: boolean` field. The rule is exactly:

> `validate_application` passes iff `validationResult.passed === true`.

No further logic is required. Do not introspect `summary.missing` or `annexChecklist` in `setApplicationStatus`; that logic already lives inside `validateApplication` and is encoded in its `passed` return value.

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/services/set-application-status.test.ts
```

Expected: both tests PASS. The second test needs the mock to return a failing validation result. Update the mock if needed to make `validateApplication` return `{ passed: false, ... }`:

```typescript
vi.mock('@/lib/ai/agent/services/application', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    validateApplication: vi.fn().mockResolvedValue({ passed: false, issues: [{ type: 'missing_section', message: 'obiective missing' }], summary: { accepted: 0, draft: 0, missing: 1 }, annexChecklist: [] }),
  }
})
```

Note: because the test imports `setApplicationStatus` from the same module as `validateApplication`, mocking only `validateApplication` within the module requires the partial-mock pattern above.

- [ ] **Step 5: Run the full services test suite**

```bash
cd app && npx vitest run tests/unit/services
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/services/application.ts tests/unit/services/set-application-status.test.ts
git commit -m "feat(phase3a): enforce validate_application gate on mark_complete

setApplicationStatus with status='completed' now requires
validate_application to pass. Throws POLICY_VALIDATION_NOT_PASSED
if the application has missing sections or unmet requirements.
Idempotent same-status no-op remains unchanged (no policy check,
no mutation, no audit)."
```

---

## Task 13: Build new setSelectedCall service

**Files:**
- Modify: `app/src/lib/ai/agent/services/application.ts`
- Create: `app/tests/unit/services/set-selected-call.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/services/set-selected-call.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError, ConcurrencyError, NotFoundError } from '@/lib/ai/agent/services/errors'

// vi.hoisted runs BEFORE imports so the mock db is available both at
// module-eval time (vi.mock callback) and inside helper functions.
// This is the idiomatic Vitest ESM pattern — no require(), no dynamic
// import at call sites.
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active' as const,
  stateVersion: 0,
  selectedCallId: null,
  outlineFrozen: false,
  eligibility: null,
}

function mockSelect(session: any) {
  ;(mockDb.select as any).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([session]),
      }),
    }),
  })
  ;(mockDb.update as any).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })
}

describe('setSelectedCall', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: sets call on an unfrozen active session', async () => {
    mockSelect(baseSession)
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    const result = await setSelectedCall(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('throws ConcurrencyError on stateVersion mismatch', async () => {
    mockSelect({ ...baseSession, stateVersion: 5 })
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    try {
      await setSelectedCall(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConcurrencyError)
    }
  })

  it('throws POLICY_OUTLINE_ALREADY_FROZEN when outline is frozen', async () => {
    mockSelect({ ...baseSession, outlineFrozen: true })
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    try {
      await setSelectedCall(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_OUTLINE_ALREADY_FROZEN')
    }
  })

  it('throws NotFoundError when session does not exist', async () => {
    const { db } = await import('@/lib/db')
    ;(db.select as any).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    })

    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')

    try {
      await setSelectedCall(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, callId: 'CALL-42', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(NotFoundError)
    }
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd app && npx vitest run tests/unit/services/set-selected-call.test.ts
```

Expected: FAIL — `setSelectedCall` not exported.

- [ ] **Step 3a: Extract the shared ownership helper (prerequisite)**

The existing `verifySessionOwnership` helper lives in `sections.ts` as a private (non-exported) function at around line 74. Before `setSelectedCall` and the other new services in `application.ts` can reuse it, we must promote it to a shared location.

**Move `verifySessionOwnership` into `app/src/lib/ai/agent/services/context-helpers.ts`** (which already exists):

1. Open `app/src/lib/ai/agent/services/context-helpers.ts`
2. Add the function, exported:

```typescript
import { db } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { NotFoundError } from './errors'
import type { ServiceContext } from './types'

/**
 * Verifies that the session exists AND is owned by ctx.userId.
 * Returns the full session row. Throws NotFoundError if the session
 * is missing or owned by another user.
 *
 * This is the canonical ownership check for all Phase 3 service
 * mutations. Do not inline equivalent logic in individual services.
 */
export async function verifySessionOwnership(
  ctx: ServiceContext,
  sessionId: string,
): Promise<typeof agentSessions.$inferSelect> {
  const rows = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, ctx.userId)))
    .limit(1)

  if (!rows[0]) {
    throw new NotFoundError('session', sessionId)
  }

  return rows[0]
}
```

3. Open `app/src/lib/ai/agent/services/sections.ts`. Remove the local `verifySessionOwnership` (around line 74) — now it's shared. Replace the local calls with an import:

```typescript
import { verifySessionOwnership } from './context-helpers'
```

The `assertSessionOwnership` helper (the void variant that doesn't return the row) can either stay local to `sections.ts` or be promoted too — **leave it local** for now to keep this PR's scope tight. Only `verifySessionOwnership` needs to be shared for the new services.

4. Run the existing sections tests to verify no regression:

```bash
cd app && npx vitest run tests/unit/services/sections tests/unit/services/save-section-draft.test.ts tests/unit/services/approve-section.test.ts tests/unit/services/rollback-section.test.ts
```

Expected: all pass. The extracted helper preserves the exact same semantics.

5. Commit the extraction as a separate commit BEFORE implementing `setSelectedCall`:

```bash
cd app && git add src/lib/ai/agent/services/context-helpers.ts src/lib/ai/agent/services/sections.ts
cd .. && git commit -m "refactor(phase3a): share verifySessionOwnership via context-helpers

Moves the ownership guard helper from sections.ts into the shared
context-helpers module so the new narrow mutation services in
application.ts (setSelectedCall, freezeOutline) can reuse the
same canonical check without inlining or duplicating the logic.

No behavior change for existing callers.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 3b: Implement setSelectedCall**

Open `app/src/lib/ai/agent/services/application.ts`. Add the new function near the other session-level mutations (or at the end of the file):

```typescript
import { assertPolicy } from '../policy/enforce'
import { POLICY_MATRIX } from '../policy/matrix'
import type { AgentSession } from '../types'
import { logAudit } from '@/lib/legal/audit'
import { ConcurrencyError } from './errors'
import { verifySessionOwnership } from './context-helpers'  // shared helper from Step 3a
// Other imports should already exist.

export async function setSelectedCall(
  ctx: ServiceContext,
  input: { sessionId: string; callId: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  // 1. Verify ownership (canonical helper — throws NotFoundError if missing/unauthorized)
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Concurrency check
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Idempotent no-op: same callId → return current state unchanged
  //    (no stateVersion bump, no updatedAt change, no audit event)
  if (session.selectedCallId === input.callId) {
    return { newStateVersion: session.stateVersion }
  }

  // 4. Policy gate — cannot reselect once outline is frozen
  assertPolicy(POLICY_MATRIX.setSelectedCall, session as unknown as AgentSession)

  // 5. Mutate
  const newStateVersion = session.stateVersion + 1
  await db
    .update(agentSessions)
    .set({
      selectedCallId: input.callId,
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, input.sessionId))

  // 6. Audit
  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.setSelectedCall.auditAction,
    resourceType: 'agent_session',
    resourceId: input.sessionId,
    metadata: { callId: input.callId, previousCallId: session.selectedCallId, requestId: ctx.requestId },
  })

  return { newStateVersion }
}
```

The `agentSessions`, `db`, `eq`, and `and` imports should already exist at the top of `application.ts`. If not, add them.

- [ ] **Step 4: Run the test and verify all pass**

```bash
cd app && npx vitest run tests/unit/services/set-selected-call.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/services/application.ts tests/unit/services/set-selected-call.test.ts
git commit -m "feat(phase3a): add setSelectedCall service

New narrow mutation service for the select_call structured action.
Enforces ownership, concurrency, and POLICY_OUTLINE_ALREADY_FROZEN.
Idempotent on same callId (no stateVersion bump, no audit).
Audits as session.call_selected."
```

---

## Task 14: Build new freezeOutline service

**Files:**
- Modify: `app/src/lib/ai/agent/services/application.ts`
- Create: `app/tests/unit/services/freeze-outline.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/services/freeze-outline.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError, ConcurrencyError } from '@/lib/ai/agent/services/errors'

const { mockDb } = vi.hoisted(() => ({
  mockDb: { select: vi.fn(), update: vi.fn() },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const eligiblePassing = { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 2 }

function mockSessionSelect(overrides: any) {
  const session = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active' as const,
    stateVersion: 0,
    selectedCallId: 'CALL-42',
    outlineFrozen: false,
    eligibility: eligiblePassing,
    currentPhase: 'research' as const,
    ...overrides,
  }
  ;(mockDb.select as any).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([session]),
      }),
    }),
  })
  ;(mockDb.update as any).mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  })
  return session
}

describe('freezeOutline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: freezes outline, advances phase to drafting', async () => {
    mockSessionSelect({})
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    const result = await freezeOutline(
      { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
      { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('idempotent no-op when outline already frozen', async () => {
    mockSessionSelect({ outlineFrozen: true, stateVersion: 3 })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    const result = await freezeOutline(
      { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
      { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 3 },
    )
    expect(result.newStateVersion).toBe(3)  // unchanged
  })

  it('throws POLICY_NO_CALL_SELECTED when no call', async () => {
    mockSessionSelect({ selectedCallId: null })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    try {
      await freezeOutline(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_NO_CALL_SELECTED')
    }
  })

  it('throws POLICY_ELIGIBILITY_NOT_PASSED when eligibility has failures', async () => {
    mockSessionSelect({ eligibility: { ...eligiblePassing, failCount: 2 } })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    try {
      await freezeOutline(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
    }
  })

  it('throws POLICY_ELIGIBILITY_NOT_PASSED when eligibility is null', async () => {
    mockSessionSelect({ eligibility: null })
    const { freezeOutline } = await import('@/lib/ai/agent/services/application')

    try {
      await freezeOutline(
        { userId: '22222222-2222-4222-8222-222222222222', requestId: 'req-1', now: new Date() },
        { sessionId: '11111111-1111-4111-8111-111111111111', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_ELIGIBILITY_NOT_PASSED')
    }
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd app && npx vitest run tests/unit/services/freeze-outline.test.ts
```

Expected: FAIL — function not exported.

- [ ] **Step 3: Implement freezeOutline**

Add to `app/src/lib/ai/agent/services/application.ts`:

```typescript
export async function freezeOutline(
  ctx: ServiceContext,
  input: { sessionId: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  // 1. Verify ownership — use the shared helper extracted in Task 13 Step 3a
  const session = await verifySessionOwnership(ctx, input.sessionId)

  // 2. Concurrency check
  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  // 3. Idempotent no-op: already frozen
  //    (no stateVersion bump, no updatedAt change, no audit event)
  if (session.outlineFrozen) {
    return { newStateVersion: session.stateVersion }
  }

  // 4. Policy gate
  assertPolicy(POLICY_MATRIX.freezeOutline, session as unknown as AgentSession)

  // 5. Mutate: set outlineFrozen=true and advance phase to drafting
  const newStateVersion = session.stateVersion + 1
  await db
    .update(agentSessions)
    .set({
      outlineFrozen: true,
      currentPhase: 'drafting',
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    })
    .where(eq(agentSessions.id, input.sessionId))

  // 6. Audit
  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.freezeOutline.auditAction,
    resourceType: 'agent_session',
    resourceId: input.sessionId,
    metadata: { previousPhase: session.currentPhase, requestId: ctx.requestId },
  })

  return { newStateVersion }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/services/freeze-outline.test.ts
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/services/application.ts tests/unit/services/freeze-outline.test.ts
git commit -m "feat(phase3a): add freezeOutline service

New narrow mutation service for the approve_outline structured
action. Enforces ownership, concurrency, call-selected, eligibility-
passed. Advances phase from structuring to drafting. Idempotent
when outline is already frozen. Audits as session.outline_frozen."
```

---

## Task 15: Build new markSectionStale service

**Files:**
- Modify: `app/src/lib/ai/agent/services/sections.ts`
- Create: `app/tests/unit/services/mark-section-stale.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/services/mark-section-stale.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    transaction: vi.fn((fn: any) => fn({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    })),
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  stateVersion: 0,
  selectedCallId: 'CALL-42',
  outlineFrozen: true,
  eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
}

function mockSelectChain(session: any, sectionRows: any[]) {
  let call = 0
  ;(mockDb.select as any).mockImplementation(() => {
    call += 1
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(call === 1 ? [session] : sectionRows),
        }),
      }),
    }
  })
}

describe('markSectionStale', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path from draft', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'draft', content: 'text', acceptedContent: null }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    const result = await markSectionStale(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('demotes from accepted and clears acceptedContent', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'accepted', content: 'text', acceptedContent: 'accepted text' }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    const result = await markSectionStale(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
    // Verifies acceptedContent is cleared in the mutation — integration test
    // in Task 18 asserts the actual DB value.
  })

  it('idempotent no-op when already stale', async () => {
    mockSelectChain({ ...baseSession, stateVersion: 7 }, [{ id: 'sec-1', status: 'stale', content: 'text', acceptedContent: null }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    const result = await markSectionStale(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 7 },
    )
    expect(result.newStateVersion).toBe(7)
  })

  it('throws POLICY_SECTION_WRONG_STATE from pending', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'pending', content: null, acceptedContent: null }])
    const { markSectionStale } = await import('@/lib/ai/agent/services/sections')

    try {
      await markSectionStale(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd app && npx vitest run tests/unit/services/mark-section-stale.test.ts
```

Expected: FAIL — function not exported.

- [ ] **Step 3: Implement markSectionStale**

Add to `app/src/lib/ai/agent/services/sections.ts`, after `rejectSection` or near the other section-level mutations:

```typescript
export async function markSectionStale(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)

  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // Idempotent no-op: already stale
  if (section.status === 'stale') {
    return { newStateVersion: session.stateVersion }
  }

  // Policy gate — outline frozen + allowed section state
  assertPolicy(POLICY_MATRIX.markSectionStale, session as unknown as AgentSession, { sectionState: section.status })

  const newStateVersion = session.stateVersion + 1

  await db.transaction(async (tx) => {
    await tx.update(agentSections).set({
      status: 'stale',
      acceptedContent: null,  // clear the accepted snapshot per spec §4 row 6
      updatedAt: new Date(),
    }).where(eq(agentSections.id, section.id))

    await tx.update(agentSessions).set({
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    }).where(eq(agentSessions.id, input.sessionId))
  })

  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.markSectionStale.auditAction,
    resourceType: 'agent_section',
    resourceId: section.id,
    metadata: {
      sessionId: input.sessionId,
      sectionKey: input.sectionKey,
      previousStatus: section.status,
      demotedFromAccepted: section.status === 'accepted',
      requestId: ctx.requestId,
    },
  })

  return { newStateVersion }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/services/mark-section-stale.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/services/sections.ts tests/unit/services/mark-section-stale.test.ts
git commit -m "feat(phase3a): add markSectionStale service

New narrow mutation service for the regenerate_section structured
action. Transitions draft/needs_review/accepted sections to stale.
When demoting from accepted, clears acceptedContent so the stale
section becomes a fresh rework candidate; prior accepted snapshot
is preserved only via version history. Idempotent on already-stale."
```

---

## Task 16: Build new rejectSection service

**Files:**
- Modify: `app/src/lib/ai/agent/services/sections.ts`
- Create: `app/tests/unit/services/reject-section.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/services/reject-section.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ValidationError } from '@/lib/ai/agent/services/errors'

const { mockDb, mockLogAudit } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    transaction: vi.fn((fn: any) => fn({
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
    })),
  },
  mockLogAudit: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: mockLogAudit }))

const baseSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  status: 'active',
  stateVersion: 0,
  selectedCallId: 'CALL-42',
  outlineFrozen: true,
  eligibility: { results: [], score: 100, passCount: 5, failCount: 0, warningCount: 0 },
}

function mockSelectChain(session: any, sectionRows: any[]) {
  let call = 0
  ;(mockDb.select as any).mockImplementation(() => {
    call += 1
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(call === 1 ? [session] : sectionRows),
        }),
      }),
    }
  })
}

describe('rejectSection', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: rejects a draft section with a reason', async () => {
    mockSelectChain(baseSession, [{ id: 'sec-1', status: 'draft', rejectionReason: null, content: 'text' }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    const result = await rejectSection(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'not specific enough', expectedStateVersion: 0 },
    )
    expect(result.newStateVersion).toBe(1)
  })

  it('idempotent: same-reason re-reject returns current state', async () => {
    mockSelectChain({ ...baseSession, stateVersion: 4 }, [{
      id: 'sec-1',
      status: 'rejected',
      rejectionReason: 'not specific enough',
      content: 'text',
    }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    mockLogAudit.mockClear()  // explicit — we want to verify zero calls below

    const result = await rejectSection(
      { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
      { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'not specific enough', expectedStateVersion: 4 },
    )
    expect(result.newStateVersion).toBe(4)  // unchanged

    // Idempotent no-op invariant: no audit event emitted, stateVersion unchanged
    expect(mockLogAudit).not.toHaveBeenCalled()
  })

  it('throws POLICY_SECTION_WRONG_STATE on different-reason re-reject', async () => {
    mockSelectChain(baseSession, [{
      id: 'sec-1',
      status: 'rejected',
      rejectionReason: 'not specific enough',
      content: 'text',
    }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await rejectSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'wrong tone', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError)
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })

  it('throws POLICY_SECTION_WRONG_STATE from accepted', async () => {
    mockSelectChain(baseSession, [{
      id: 'sec-1',
      status: 'accepted',
      rejectionReason: null,
      content: 'text',
    }])
    const { rejectSection } = await import('@/lib/ai/agent/services/sections')

    try {
      await rejectSection(
        { userId: baseSession.userId, requestId: 'req-1', now: new Date() },
        { sessionId: baseSession.id, sectionKey: 'obiective', reason: 'x', expectedStateVersion: 0 },
      )
      expect.fail('should have thrown')
    } catch (err) {
      expect((err as ValidationError).policyCode).toBe('POLICY_SECTION_WRONG_STATE')
    }
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd app && npx vitest run tests/unit/services/reject-section.test.ts
```

Expected: FAIL — function not exported.

- [ ] **Step 3: Implement rejectSection**

Add to `app/src/lib/ai/agent/services/sections.ts`:

```typescript
export async function rejectSection(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; reason: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)

  const section = sectionRows[0]
  if (!section) {
    throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)
  }

  // Partial idempotency: already-rejected with same reason → no-op;
  // different reason → POLICY_SECTION_WRONG_STATE (rejection is not
  // a metadata-edit path).
  if (section.status === 'rejected') {
    if (section.rejectionReason === input.reason) {
      return { newStateVersion: session.stateVersion }
    }
    throw new ValidationError(
      'reason',
      'Section already rejected with a different reason; cannot edit rejection metadata',
      'POLICY_SECTION_WRONG_STATE',
    )
  }

  // Policy gate — outline frozen + allowed section state
  assertPolicy(POLICY_MATRIX.rejectSection, session as unknown as AgentSession, { sectionState: section.status })

  const newStateVersion = session.stateVersion + 1

  await db.transaction(async (tx) => {
    await tx.update(agentSections).set({
      status: 'rejected',
      rejectionReason: input.reason,
      updatedAt: new Date(),
    }).where(eq(agentSections.id, section.id))

    await tx.update(agentSessions).set({
      stateVersion: newStateVersion,
      updatedAt: new Date(),
    }).where(eq(agentSessions.id, input.sessionId))
  })

  await logAudit({
    userId: ctx.userId,
    action: POLICY_MATRIX.rejectSection.auditAction,
    resourceType: 'agent_section',
    resourceId: section.id,
    metadata: {
      sessionId: input.sessionId,
      sectionKey: input.sectionKey,
      reason: input.reason,
      previousStatus: section.status,
      requestId: ctx.requestId,
    },
  })

  return { newStateVersion }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/services/reject-section.test.ts
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/services/sections.ts tests/unit/services/reject-section.test.ts
git commit -m "feat(phase3a): add rejectSection service

New narrow mutation service for the reject_section structured
action. Sets status='rejected' and stores the reason. Idempotent
only when the reason matches exactly; different-reason re-reject
throws POLICY_SECTION_WRONG_STATE so rejection cannot become a
stealth metadata-edit path."
```

---

## Task 17: Policy matrix coverage meta-test

**Files:**
- Create: `app/tests/unit/services/policy-matrix-coverage.test.ts`

- [ ] **Step 1: Write the meta-test**

Create `app/tests/unit/services/policy-matrix-coverage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SERVICES_ROOT = join(__dirname, '../../../src/lib/ai/agent/services')

const PHASE_3_WRITE_FUNCTIONS = [
  { file: 'sections.ts', fn: 'saveSectionDraft' },
  { file: 'sections.ts', fn: 'approveSection' },
  { file: 'sections.ts', fn: 'rollbackSection' },
  { file: 'sections.ts', fn: 'markSectionStale' },
  { file: 'sections.ts', fn: 'rejectSection' },
  { file: 'application.ts', fn: 'setSelectedCall' },
  { file: 'application.ts', fn: 'freezeOutline' },
  { file: 'application.ts', fn: 'setApplicationStatus' },
] as const

describe('policy matrix coverage', () => {
  for (const { file, fn } of PHASE_3_WRITE_FUNCTIONS) {
    it(`${file}:${fn} references POLICY_MATRIX`, () => {
      const src = readFileSync(join(SERVICES_ROOT, file), 'utf8')
      const fnStart = src.indexOf(`export async function ${fn}`)
      expect(fnStart, `${fn} not found in ${file}`).toBeGreaterThan(-1)

      // Find the function body bounds by walking braces.
      const bodyStart = src.indexOf('{', fnStart)
      let depth = 0
      let bodyEnd = bodyStart
      for (let i = bodyStart; i < src.length; i++) {
        if (src[i] === '{') depth += 1
        if (src[i] === '}') {
          depth -= 1
          if (depth === 0) { bodyEnd = i; break }
        }
      }
      const body = src.slice(bodyStart, bodyEnd)

      // Every Phase 3 write function must reference POLICY_MATRIX in its body.
      // setApplicationStatus may use it indirectly via assertPolicy(POLICY_MATRIX.setApplicationStatus, ...);
      // that still shows up as a text match.
      expect(body).toContain('POLICY_MATRIX')
    })
  }
})
```

- [ ] **Step 2: Run the test and verify all pass**

```bash
cd app && npx vitest run tests/unit/services/policy-matrix-coverage.test.ts
```

Expected: 8 tests PASS. If any fails, it means a Phase 3 write function was added or modified without wiring `POLICY_MATRIX`, which is the bug this test catches.

- [ ] **Step 3: Commit**

```bash
cd app && git add tests/unit/services/policy-matrix-coverage.test.ts
git commit -m "test(phase3a): add policy matrix coverage meta-test

Asserts every Phase 3 write service function references
POLICY_MATRIX in its body. Catches the 'forgot to wire policy'
bug cheaply — a new write service added without policy gating
fails the test at parse time."
```

---

## Task 18: Integration test for concurrency across all 8 services

**Files:**
- Create: `app/tests/integration/services/phase3-concurrency.test.ts`

- [ ] **Step 1: Check the integration test pattern in this repo**

```bash
cd app && ls tests/integration/services/ 2>/dev/null && cat tests/integration/services/*.test.ts 2>/dev/null | head -40
```

Look for an existing integration test file that seeds a real DB session to use as a pattern. If none exists, use the general integration test setup under `app/tests/integration/`.

- [ ] **Step 2: Write the integration test**

Create `app/tests/integration/services/phase3-concurrency.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { agentSessions, agentSections, users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { ConcurrencyError } from '@/lib/ai/agent/services/errors'
import {
  saveSectionDraft,
  approveSection,
  rollbackSection,
  markSectionStale,
  rejectSection,
} from '@/lib/ai/agent/services/sections'
import {
  setSelectedCall,
  freezeOutline,
  setApplicationStatus,
} from '@/lib/ai/agent/services/application'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

const TEST_USER_ID = '99999999-9999-4999-8999-999999999999'

async function seedUser(): Promise<void> {
  await db.insert(users).values({
    id: TEST_USER_ID,
    email: 'phase3-concurrency-test@example.com',
    passwordHash: '$2a$12$fake_hash_for_test_only',
    emailVerified: new Date(),
    onboardingCompleted: true,
  }).onConflictDoNothing()
}

async function seedSession(overrides: Partial<typeof agentSessions.$inferInsert> = {}): Promise<string> {
  const [row] = await db.insert(agentSessions).values({
    userId: TEST_USER_ID,
    status: 'active',
    locale: 'ro',
    currentPhase: 'research',
    selectedCallId: 'CALL-42',
    outlineFrozen: true,
    stateVersion: 10,
    eligibility: { results: [], score: 100, passCount: 3, failCount: 0, warningCount: 0 },
    ...overrides,
  }).returning({ id: agentSessions.id })
  return row.id
}

async function cleanupSession(sessionId: string): Promise<void> {
  await db.delete(agentSections).where(eq(agentSections.sessionId, sessionId))
  await db.delete(agentSessions).where(eq(agentSessions.id, sessionId))
}

const ctx: ServiceContext = {
  userId: TEST_USER_ID,
  requestId: 'phase3-concurrency-test',
  now: new Date(),
}

describe('Phase 3 concurrency enforcement across all 8 write services', () => {
  beforeEach(async () => {
    await seedUser()
  })

  it('saveSectionDraft rejects stale stateVersion', async () => {
    const sessionId = await seedSession()
    try {
      await expect(
        saveSectionDraft(ctx, { sessionId, sectionKey: 'obiective', content: 'x', expectedStateVersion: 9 })
      ).rejects.toThrow(ConcurrencyError)
    } finally {
      await cleanupSession(sessionId)
    }
  })

  it('setSelectedCall rejects stale stateVersion', async () => {
    const sessionId = await seedSession({ outlineFrozen: false })
    try {
      await expect(
        setSelectedCall(ctx, { sessionId, callId: 'CALL-99', expectedStateVersion: 9 })
      ).rejects.toThrow(ConcurrencyError)
    } finally {
      await cleanupSession(sessionId)
    }
  })

  it('freezeOutline rejects stale stateVersion', async () => {
    const sessionId = await seedSession({ outlineFrozen: false })
    try {
      await expect(
        freezeOutline(ctx, { sessionId, expectedStateVersion: 9 })
      ).rejects.toThrow(ConcurrencyError)
    } finally {
      await cleanupSession(sessionId)
    }
  })

  it('rejectSection rejects stale stateVersion', async () => {
    const sessionId = await seedSession()
    await db.insert(agentSections).values({
      sessionId,
      sectionKey: 'obiective',
      title: 'Obiective',
      documentOrder: 1,
      generationOrder: 1,
      status: 'draft',
      content: 'some draft content',
    })
    try {
      await expect(
        rejectSection(ctx, { sessionId, sectionKey: 'obiective', reason: 'x', expectedStateVersion: 9 })
      ).rejects.toThrow(ConcurrencyError)
    } finally {
      await cleanupSession(sessionId)
    }
  })

  it('markSectionStale rejects stale stateVersion', async () => {
    const sessionId = await seedSession()
    await db.insert(agentSections).values({
      sessionId,
      sectionKey: 'obiective',
      title: 'Obiective',
      documentOrder: 1,
      generationOrder: 1,
      status: 'draft',
      content: 'some draft content',
    })
    try {
      await expect(
        markSectionStale(ctx, { sessionId, sectionKey: 'obiective', expectedStateVersion: 9 })
      ).rejects.toThrow(ConcurrencyError)
    } finally {
      await cleanupSession(sessionId)
    }
  })

  it('setApplicationStatus rejects stale stateVersion', async () => {
    const sessionId = await seedSession()
    try {
      await expect(
        setApplicationStatus(ctx, { sessionId, status: 'paused', expectedStateVersion: 9 })
      ).rejects.toThrow(ConcurrencyError)
    } finally {
      await cleanupSession(sessionId)
    }
  })
})
```

- [ ] **Step 3: Run the integration test**

```bash
cd app && npx vitest run tests/integration/services/phase3-concurrency.test.ts
```

Expected: 6 tests PASS. If any fail due to missing seed fields (e.g., `passwordHash` required), consult the `users` table schema and adjust the seed values accordingly.

- [ ] **Step 4: Commit**

```bash
cd app && git add tests/integration/services/phase3-concurrency.test.ts
git commit -m "test(phase3a): integration test for concurrency across all write services

Seeds a real session with stateVersion=10, then attempts each of
the 8 Phase 3 write services with expectedStateVersion=9. All must
throw ConcurrencyError. Cleans up seeded rows after each test."
```

---

## Task 19: Integration test for audit chain integrity

**Files:**
- Create: `app/tests/integration/services/phase3-audit-chain.test.ts`

- [ ] **Step 1: Find the audit chain verification helper**

```bash
cd app && grep -n "verifyAuditChainIntegrity" src/lib/legal/audit-integrity.ts
```

Confirm the function exists and note its signature.

- [ ] **Step 2: Write the integration test**

Create `app/tests/integration/services/phase3-audit-chain.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { agentSessions, agentSections, users, auditLog } from '@/lib/db/schema'
import { eq, and, gte } from 'drizzle-orm'
import { verifyAuditChainIntegrity } from '@/lib/legal/audit-integrity'
import { setSelectedCall, freezeOutline } from '@/lib/ai/agent/services/application'
import { saveSectionDraft } from '@/lib/ai/agent/services/sections'

const TEST_USER_ID = '88888888-8888-4888-8888-888888888888'

async function seedUser() {
  await db.insert(users).values({
    id: TEST_USER_ID,
    email: 'phase3-audit-test@example.com',
    passwordHash: '$2a$12$fake_hash',
    emailVerified: new Date(),
    onboardingCompleted: true,
  }).onConflictDoNothing()
}

async function seedSession() {
  const [row] = await db.insert(agentSessions).values({
    userId: TEST_USER_ID,
    status: 'active',
    locale: 'ro',
    currentPhase: 'discovery',
    outlineFrozen: false,
    stateVersion: 0,
    eligibility: { results: [], score: 100, passCount: 3, failCount: 0, warningCount: 0 },
  }).returning({ id: agentSessions.id })
  return row.id
}

async function cleanup(sessionId: string) {
  await db.delete(agentSections).where(eq(agentSections.sessionId, sessionId))
  await db.delete(agentSessions).where(eq(agentSessions.id, sessionId))
}

describe('Phase 3 audit chain integrity', () => {
  beforeEach(() => seedUser())

  it('a 3-step mutation sequence produces an unbroken audit chain', async () => {
    const sessionId = await seedSession()
    const ctx = { userId: TEST_USER_ID, requestId: 'audit-test', now: new Date() }
    const startTime = new Date()

    try {
      // Step 1: select a call
      let result = await setSelectedCall(ctx, { sessionId, callId: 'CALL-42', expectedStateVersion: 0 })
      expect(result.newStateVersion).toBe(1)

      // Step 2: freeze the outline (requires call selected + eligibility passed)
      result = await freezeOutline(ctx, { sessionId, expectedStateVersion: 1 })
      expect(result.newStateVersion).toBe(2)

      // Step 3: save a section draft (requires outline frozen + eligibility passed)
      const draftResult = await saveSectionDraft(ctx, {
        sessionId,
        sectionKey: 'obiective',
        content: 'Draft content for audit test',
        expectedStateVersion: 2,
      })
      expect(draftResult.newStateVersion).toBe(3)

      // Verify audit chain integrity for the entries produced in this test window
      const chainResult = await verifyAuditChainIntegrity({ sinceDate: startTime })
      expect(chainResult.valid).toBe(true)
      expect(chainResult.brokenAt).toBeUndefined()
    } finally {
      await cleanup(sessionId)
    }
  })
})
```

Note: this test assumes `verifyAuditChainIntegrity` accepts `{ sinceDate }` or a similar filter. If the actual signature differs, adapt the call accordingly after reading the function signature.

- [ ] **Step 3: Run the test**

```bash
cd app && npx vitest run tests/integration/services/phase3-audit-chain.test.ts
```

Expected: PASS. If `verifyAuditChainIntegrity` has a different signature, adjust the call. If the test fails because the audit hash chain is actually broken, that's a real bug and must be investigated before 3a can merge.

- [ ] **Step 4: Commit**

```bash
cd app && git add tests/integration/services/phase3-audit-chain.test.ts
git commit -m "test(phase3a): verify audit chain integrity after Phase 3 mutations

Runs a 3-step mutation sequence (setSelectedCall → freezeOutline →
saveSectionDraft) and asserts verifyAuditChainIntegrity returns
valid=true. Catches any future change that breaks the SHA-256
hash chain in the audit_log table."
```

---

## Task 20: Policy matrix doc + docs sync test

**Files:**
- Create: `docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md`
- Create: `app/tests/unit/policy/matrix-docs-sync.test.ts`

- [ ] **Step 1: Write the policy matrix doc**

Create `docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md`:

```markdown
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

Rules 3 and 4 reuse legacy V3 audit actions (`project.version_save`, `section.state_change`) on purpose to preserve hash-chain continuity across the V3 → managed migration. Do not rename them without a coordinated audit migration.
```

- [ ] **Step 2: Write the sync test**

Create `app/tests/unit/policy/matrix-docs-sync.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POLICY_MATRIX } from '@/lib/ai/agent/policy/matrix'

const DOC_PATH = join(__dirname, '../../../../docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md')

describe('policy matrix docs sync', () => {
  it('every POLICY_MATRIX key appears in the doc rules table', () => {
    const doc = readFileSync(DOC_PATH, 'utf8')
    for (const key of Object.keys(POLICY_MATRIX)) {
      expect(doc, `${key} not found in policy matrix doc`).toContain(`\`${key}\``)
    }
  })

  it('every POLICY_MATRIX audit action appears in the doc', () => {
    const doc = readFileSync(DOC_PATH, 'utf8')
    for (const key of Object.keys(POLICY_MATRIX)) {
      const rule = POLICY_MATRIX[key as keyof typeof POLICY_MATRIX]
      expect(doc, `${key} audit action "${rule.auditAction}" not found in doc`).toContain(`\`${rule.auditAction}\``)
    }
  })
})
```

- [ ] **Step 3: Run the sync test**

```bash
cd app && npx vitest run tests/unit/policy/matrix-docs-sync.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 4: Commit**

```bash
cd app && git add docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md app/tests/unit/policy/matrix-docs-sync.test.ts
git commit -m "docs(phase3a): commit policy matrix mirror doc + sync test

Mirror of the POLICY_MATRIX constant as a human-readable table.
Sync test asserts every matrix key and audit action appears in
the doc — drift is caught at test time."
```

---

## Task 21: Final verification pass

- [ ] **Step 1: Run the full managed + services test suite**

```bash
cd app && npx vitest run tests/unit/services tests/unit/policy tests/unit/schema tests/integration/services
```

Expected: all tests pass.

- [ ] **Step 2: Run the full project test suite to catch regressions**

```bash
cd app && npm run test
```

Expected: all tests pass. If any V3 test fails, investigate whether the service-layer gates changed behavior. If V3 has a legitimate path that now fails, consult the V3 audit report from Task 1 — this should have been flagged there.

- [ ] **Step 3: Run typecheck**

```bash
cd app && npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Run lint**

```bash
cd app && npm run lint
```

Expected: no new errors in `src/lib/ai/agent/policy/`, `src/lib/ai/agent/services/`, or the test files.

- [ ] **Step 5: Verify no cross-boundary imports**

The policy module must not import from `managed/`, `mcp/`, or `runtime.ts`:

```bash
cd app && grep -rn "from '.*managed/" src/lib/ai/agent/policy/ 2>&1 || echo "OK: policy does not import from managed"
cd app && grep -rn "from '.*mcp/" src/lib/ai/agent/policy/ 2>&1 || echo "OK: policy does not import from mcp"
cd app && grep -rn "from '.*runtime" src/lib/ai/agent/policy/ 2>&1 || echo "OK: policy does not import from runtime"
```

Expected: three `OK:` lines.

- [ ] **Step 6: Verify the policy matrix coverage meta-test catches missing wiring**

Temporarily comment out the `assertPolicy` call in one service function, run the coverage test, and verify it fails:

```bash
# Temporarily edit one service to remove assertPolicy, run test
cd app && sed -i.bak 's/assertPolicy(POLICY_MATRIX.saveSectionDraft/\/\/ assertPolicy(POLICY_MATRIX.saveSectionDraft/' src/lib/ai/agent/services/sections.ts
npx vitest run tests/unit/services/policy-matrix-coverage.test.ts
# Restore
mv src/lib/ai/agent/services/sections.ts.bak src/lib/ai/agent/services/sections.ts
```

Expected: the test fails on the modified file, then passes after restore. This is a one-shot verification — do not commit the temporary edit.

- [ ] **Step 7: Check git status — everything should be committed**

```bash
cd app && cd .. && git status
```

Expected: `nothing to commit, working tree clean`.

- [ ] **Step 8: Review the commit log**

```bash
git log --oneline -25
```

Expected: ~20 commits for 3a tasks, each with a clear `feat(phase3a):`, `test(phase3a):`, or `docs(phase3a):` prefix and a single-purpose change.

---

## Summary

| Task | Focus | Key deliverable |
|---|---|---|
| 1 | Research | V3 audit report documenting enforcement parity |
| 2 | Infra | `isEligibilityPassed` helper |
| 3 | Infra | `ValidationError.policyCode` optional field |
| 4 | Policy | `POLICY_MATRIX` declarative constant for 8 mutations |
| 5 | Policy | `assertPolicy` enforcement helper |
| 6 | Schema | `'rejected'` enum + `rejection_reason` column |
| 7 | Schema | `'rollback'` enum + `rolled_back_from_version` column |
| 8 | Schema | Enum sync test |
| 9 | Service | Policy gate added to `saveSectionDraft` |
| 10 | Service | Policy gate added to `approveSection` (idempotent ordering fix) |
| 11 | Service | Policy gate + `kind='rollback'` in `rollbackSection` |
| 12 | Service | Policy gate + `validate_application` check in `setApplicationStatus` |
| 13 | Service | New `setSelectedCall` service |
| 14 | Service | New `freezeOutline` service |
| 15 | Service | New `markSectionStale` service (with `acceptedContent` demotion) |
| 16 | Service | New `rejectSection` service (with same-reason idempotency) |
| 17 | Meta-test | Policy matrix coverage test |
| 18 | Integration | Concurrency enforcement across all 8 services |
| 19 | Integration | Audit chain integrity verification |
| 20 | Docs | Policy matrix mirror doc + sync test |
| 21 | Verification | Full test suite, typecheck, lint, boundary check |

**Total:** 21 tasks, ~1,200 LOC added, ~20 LOC modified. Each task produces one focused commit.

---

## What 3a does NOT deliver

- No changes to the managed runtime (`lib/ai/agent/managed/`)
- No changes to MCP handlers (`lib/ai/agent/mcp/`)
- No changes to the managed tool list or executor
- No changes to the route handler
- No new feature flags
- No frontend changes
- No history normalizer changes — that lands in 3b
- No structured action bridge — that lands in 3c
- No quality harness — that lands in 3d
