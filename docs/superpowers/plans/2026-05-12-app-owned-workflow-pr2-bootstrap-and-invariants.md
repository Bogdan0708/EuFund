# App-Owned Workflow — PR 2: Bootstrap Fix + Freeze/Section Invariants

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After preselect picks a call, the UI stops auto-sending the description (no wasted model turn). Two new declarative policy gates ensure freeze can't fire without an outline and section drafts can't target outline-absent sectionKeys.

**Architecture:** Add a feature flag `preselect_no_auto_send` (DB-backed, `bypassCache: true` reads). Gate the `sendMessage(description)` call after preselect in `NewProjectView.tsx`. Render a static locale-aware welcome string when no chat history exists. Extend `PolicyRule` with two declarative fields and one new `AssertPolicyOpts.sectionKey` input; widen `assertPolicy` to enforce them. Apply to `freezeOutline` and `saveSectionDraft`.

**Tech Stack:** Next.js 14, TypeScript, next-intl, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-12-app-owned-workflow-design.md` §1 and §3

**Depends on:** PR 1 merged (state-projection helper present).

**Flag:** `preselect_no_auto_send` (default `false` everywhere).

---

## File Inventory

**Create:**
- `app/drizzle/0036_preselect_no_auto_send_flag.sql` — feature flag seed.
- `app/drizzle/meta/_journal.json` entry — required for `db:migrate` to run the SQL.
- `app/tests/unit/policy-invariants.test.ts` — unit coverage for new policy fields.
- `app/tests/integration/policy-freeze-outline-missing.test.ts` — integration coverage for `freezeOutline` rejecting null/empty outline.
- `app/tests/integration/policy-save-section-not-in-outline.test.ts` — integration coverage for `saveSectionDraft` rejecting unknown sectionKey.
- `app/e2e/preselect-no-auto-send.spec.ts` — Playwright check that no `agent_turns` row is created post-preselect.

**Modify:**
- `app/src/lib/ai/agent/policy/matrix.ts` — extend `PolicyRule` + `PolicyErrorCodes`, apply new fields to `freezeOutline` + `saveSectionDraft`, add JSDoc invariants block.
- `app/src/lib/ai/agent/policy/enforce.ts` — extend `AssertPolicyOpts`, implement new gates.
- `app/src/lib/ai/agent/services/application.ts` — when `freezeOutlineService` calls `assertPolicy`, no signature change is needed (new field reads from `session`). Confirm.
- `app/src/lib/ai/agent/services/sections.ts` — when `saveSectionDraftService` calls `assertPolicy`, pass `sectionKey` via `opts`.
- `app/src/messages/ro.json` — `agent.errors.POLICY_OUTLINE_NOT_READY`, `agent.errors.POLICY_SECTION_NOT_IN_OUTLINE`, `agent.welcomeAfterPreselect`.
- `app/src/messages/en.json` — same keys.
- `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx` — gate the `sendMessage(description)` calls behind the flag (lines 125 and 210); render the static welcome string when the flag is on and there are no chat messages yet.
- `app/src/components/agent/AgentConversation.tsx` — add a `welcomeMessage?: string` prop and render it in place of empty chat when set.

---

## Task 1: Seed the `preselect_no_auto_send` feature flag

**Files:**
- Create: `app/drizzle/0036_preselect_no_auto_send_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Create the migration SQL**

```sql
-- Seed the preselect_no_auto_send feature flag (default disabled).
-- Gates the UI's first-message auto-send to /api/ai/agent after deterministic
-- preselect picks a call. When enabled, preselect ends with adoptSession() and
-- the UI renders a static welcome string; no model turn fires until the user
-- explicitly chats or clicks Generate.
-- Admins enable via targeting JSONB: {"userIds": [...]} or {"percentage": 10}.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'preselect_no_auto_send',
  false,
  'Gates the UI from auto-sending the project description to /api/ai/agent after deterministic preselect. When on, preselect is the workflow start; chat is opt-in.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Add journal entry**

In `app/drizzle/meta/_journal.json`, append after the existing last entry (`idx: 35`):

```json
    {
      "idx": 36,
      "version": "7",
      "when": 1778803200000,
      "tag": "0036_preselect_no_auto_send_flag",
      "breakpoints": true
    }
```

(Comma after the previous entry's closing brace; trailing entry has no comma. Use timestamp greater than `1776988800005` from `idx: 35`.)

- [ ] **Step 3: Run the migration locally**

```bash
cd app && npm run db:migrate
```
Expected: `0036_preselect_no_auto_send_flag` applies. `SELECT key, enabled FROM feature_flags WHERE key = 'preselect_no_auto_send';` returns one row, `enabled = false`.

- [ ] **Step 4: Commit**

```bash
git add app/drizzle/0036_preselect_no_auto_send_flag.sql app/drizzle/meta/_journal.json
git commit -m "feat(flags): seed preselect_no_auto_send feature flag (off)"
```

---

## Task 2: Extend `PolicyRule` with new declarative fields

**Files:**
- Modify: `app/src/lib/ai/agent/policy/matrix.ts`

- [ ] **Step 1: Extend the types and add JSDoc invariants block**

Replace the leading comment block in `matrix.ts` (lines 1-14) with a JSDoc invariants block:

```ts
// ── Policy Matrix ────────────────────────────────────────────────────────
// Declarative rules for every state-changing operation. This file is purely
// declarative; procedural logic (idempotency checks, validation-application
// preconditions, rejection-reason comparison, etc.) lives in service
// functions, not here. The matrix describes:
//   - which invariants must hold before the mutation
//   - which error code is raised when a gate fails
//   - which audit action string tags the event
//
// LEGACY AUDIT STRINGS: Some rules reuse the legacy V3 audit action strings
// (e.g. `project.version_save`, `section.state_change`) on purpose, to
// preserve hash-chain continuity across the V3 → managed migration. Do not
// rename them without a coordinated audit migration.
//
// ── Code-enforced invariants ────────────────────────────────────────────
// 1. Outline-before-freeze: outlineFrozen === true ⇒
//    outline !== null && outline.length >= 1.
// 2. Outline-before-section: every agent_sections.sectionKey for a session
//    matches some SectionSpec.id in agent_sessions.outline for that session.
//    Enforced by saveSectionDraft policy.
// 3. Phase-monotonic-frozen: once outlineFrozen === true, phase cannot
//    regress below `drafting`. Already implicit; restated for clarity.
```

Extend `PolicyRule` and `PolicyErrorCodes`:

```ts
export interface PolicyRule {
  requiresOwnership: true
  requiresStateVersion: true
  requiresSessionStatus?: SessionStatus[]
  requiresCallSelected?: boolean
  requiresOutlineFrozen?: boolean
  forbidsOutlineFrozen?: boolean
  requiresOutlinePresent?: boolean
  requiresSectionKeyInOutline?: boolean
  requiresEligibility: EligibilityRequirement
  allowedSectionStates?: SectionStatus[]
  forbidIfSectionState?: SectionStatus[]
  auditAction: string
  errorCodes: PolicyErrorCodes
}

export interface PolicyErrorCodes {
  sessionStatus?: string
  noCall?: string
  outlineFrozen?: string
  outlineNotFrozen?: string
  outlineMissing?: string
  sectionNotInOutline?: string
  eligibility?: string
  sectionWrongState?: string
}
```

Update the `freezeOutline` entry to require outline presence:

```ts
  freezeOutline: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresCallSelected: true,
    requiresOutlinePresent: true,
    requiresEligibility: 'passed',
    forbidsOutlineFrozen: true,
    auditAction: 'session.outline_frozen',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      noCall: 'POLICY_NO_CALL_SELECTED',
      eligibility: 'POLICY_ELIGIBILITY_NOT_PASSED',
      outlineFrozen: 'POLICY_OUTLINE_ALREADY_FROZEN',
      outlineMissing: 'POLICY_OUTLINE_NOT_READY',
    },
  },
```

Update `saveSectionDraft` to require both outline presence and sectionKey membership:

```ts
  saveSectionDraft: {
    requiresOwnership: true,
    requiresStateVersion: true,
    requiresSessionStatus: ['active'],
    requiresOutlineFrozen: true,
    requiresOutlinePresent: true,
    requiresSectionKeyInOutline: true,
    requiresEligibility: 'passed',
    auditAction: 'project.version_save',
    errorCodes: {
      sessionStatus: 'POLICY_SESSION_NOT_ACTIVE',
      outlineNotFrozen: 'POLICY_OUTLINE_NOT_FROZEN',
      eligibility: 'POLICY_ELIGIBILITY_NOT_PASSED',
      outlineMissing: 'POLICY_OUTLINE_NOT_READY',
      sectionNotInOutline: 'POLICY_SECTION_NOT_IN_OUTLINE',
    },
  },
```

- [ ] **Step 2: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: PolicyRule type errors point at `enforce.ts` (handled in next task).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/ai/agent/policy/matrix.ts
git commit -m "feat(policy): extend PolicyRule with outline-present and sectionKey-in-outline gates"
```

---

## Task 3: Implement new gates in `assertPolicy`

**Files:**
- Modify: `app/src/lib/ai/agent/policy/enforce.ts`
- Test: `app/tests/unit/policy-invariants.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `app/tests/unit/policy-invariants.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assertPolicy } from '@/lib/ai/agent/policy/enforce'
import { POLICY_MATRIX } from '@/lib/ai/agent/policy/matrix'
import type { AgentSession, SectionSpec } from '@/lib/ai/agent/types'

function spec(id: string): SectionSpec {
  return {
    id, title: id, description: '', order: 1, generationOrder: 1,
    importance: 'standard', expectedLength: 'medium', dependsOn: [],
    modelHint: 'light', mandatory: true, confidence: 0.9,
  }
}

function baseSession(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's', userId: 'u', projectId: null, status: 'active', locale: 'ro',
    selectedCallId: 'C-1', currentPhase: 'structuring',
    blueprint: null, eligibility: { results: [], score: 100, passCount: 0, failCount: 0, warningCount: 0 },
    outline: null, warnings: [], planningArtifact: null, outlineFrozen: false,
    messageSummary: null, stateVersion: 0,
    createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  }
}

describe('assertPolicy — requiresOutlinePresent', () => {
  it('rejects freezeOutline when outline is null', () => {
    expect(() => assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ outline: null })))
      .toThrowError(/POLICY_OUTLINE_NOT_READY/)
  })

  it('rejects freezeOutline when outline is empty', () => {
    expect(() => assertPolicy(POLICY_MATRIX.freezeOutline, baseSession({ outline: [] })))
      .toThrowError(/POLICY_OUTLINE_NOT_READY/)
  })

  it('allows freezeOutline when outline has at least one section', () => {
    expect(() => assertPolicy(POLICY_MATRIX.freezeOutline,
      baseSession({ outline: [spec('a')] })))
      .not.toThrow()
  })
})

describe('assertPolicy — requiresSectionKeyInOutline', () => {
  const frozen = baseSession({ outlineFrozen: true, outline: [spec('a'), spec('b')] })

  it('rejects saveSectionDraft when sectionKey is missing from outline', () => {
    expect(() => assertPolicy(POLICY_MATRIX.saveSectionDraft, frozen, { sectionKey: 'ghost' }))
      .toThrowError(/POLICY_SECTION_NOT_IN_OUTLINE/)
  })

  it('rejects saveSectionDraft when sectionKey is undefined', () => {
    expect(() => assertPolicy(POLICY_MATRIX.saveSectionDraft, frozen, {}))
      .toThrowError(/POLICY_SECTION_NOT_IN_OUTLINE/)
  })

  it('allows saveSectionDraft when sectionKey is in outline', () => {
    expect(() => assertPolicy(POLICY_MATRIX.saveSectionDraft, frozen, { sectionKey: 'a' }))
      .not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/unit/policy-invariants.test.ts`
Expected: FAIL — `assertPolicy` doesn't yet enforce the new gates.

- [ ] **Step 3: Extend `enforce.ts`**

Update `AssertPolicyOpts` and add two new gate blocks. Replace the file content from line 14 onward with the augmented version (keep imports and signature):

```ts
export interface AssertPolicyOpts {
  sectionState?: SectionStatus
  sectionKey?: string
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

  // 5. Outline present
  if (rule.requiresOutlinePresent) {
    if (!session.outline || session.outline.length === 0) {
      throw new ValidationError(
        'outline',
        'Outline must be present (at least one section) before this operation',
        rule.errorCodes.outlineMissing,
      )
    }
  }

  // 6. SectionKey must be in outline
  if (rule.requiresSectionKeyInOutline) {
    const key = opts.sectionKey
    const found = key && session.outline?.some(s => s.id === key)
    if (!found) {
      throw new ValidationError(
        'sectionKey',
        `Section key '${key ?? '<unset>'}' is not part of this session's outline`,
        rule.errorCodes.sectionNotInOutline,
      )
    }
  }

  // 7. Eligibility
  if (rule.requiresEligibility === 'passed' && !isEligibilityPassed(session.eligibility)) {
    throw new ValidationError(
      'eligibility',
      'Eligibility must have been run and produced no hard failures',
      rule.errorCodes.eligibility,
    )
  }

  // 8. Section state allowlist
  if (rule.allowedSectionStates && opts.sectionState !== undefined) {
    if (!rule.allowedSectionStates.includes(opts.sectionState)) {
      throw new ValidationError(
        'sectionState',
        `Section state is '${opts.sectionState}'; expected one of ${rule.allowedSectionStates.join(', ')}`,
        rule.errorCodes.sectionWrongState,
      )
    }
  }

  // 9. Section state denylist
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/unit/policy-invariants.test.ts`
Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/policy/enforce.ts app/tests/unit/policy-invariants.test.ts
git commit -m "feat(policy): enforce outline-present and sectionKey-in-outline gates"
```

---

## Task 4: Wire `sectionKey` into `saveSectionDraftService` calls

**Files:**
- Modify: `app/src/lib/ai/agent/services/sections.ts`

- [ ] **Step 1: Identify the assertPolicy call in `saveSectionDraftService`**

```bash
grep -n "assertPolicy" /home/godja/Dev/EU-Funds/app/src/lib/ai/agent/services/sections.ts
```

- [ ] **Step 2: Pass `sectionKey` in the opts argument**

In `services/sections.ts`, locate every `assertPolicy(POLICY_MATRIX.saveSectionDraft, session, ...)` call. Update the call site to thread the section key:

```ts
assertPolicy(POLICY_MATRIX.saveSectionDraft, session, {
  sectionState: existingSectionRow?.status,
  sectionKey: args.sectionKey,
})
```

If the existing call already passes `{ sectionState: ... }`, just add the `sectionKey` field. If it passes no opts, add the object literal with both fields.

If `args` uses a different parameter name for the key, adapt accordingly (e.g., `args.sectionKey` vs `input.sectionKey`).

- [ ] **Step 3: Run service-layer integration tests for sections**

```bash
cd app && npx vitest run tests/integration 2>&1 | grep -E "(section|saveSectionDraft)" | head -30
```
Expected: no regressions; tests that hit this code path see the gate exercised.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/ai/agent/services/sections.ts
git commit -m "feat(policy): thread sectionKey to assertPolicy for saveSectionDraft"
```

---

## Task 5: Integration test — freeze rejects null/empty outline

**Files:**
- Test: `app/tests/integration/policy-freeze-outline-missing.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

// Test asserts freezeOutlineService raises POLICY_OUTLINE_NOT_READY
// when outline is null/empty. We exercise the policy gate at the
// service layer (assertPolicy throws ValidationError with policyCode).

describe('freezeOutlineService policy gate', () => {
  it('rejects when outline is null', async () => {
    const { freezeOutlineService } = await import('@/lib/ai/agent/services/application')
    // Use the service's test seam: typically a session loader is injected
    // or the test mocks the DB. Use the same pattern as
    // tests/integration/managed/route-v3-claim.test.ts (mock @/lib/db).
    // For the spec contract, we assert on the thrown ValidationError shape.
    // (Wire up the mock DB to return a session with outline = null,
    // outlineFrozen = false, eligibility = passed, status = active,
    // selectedCallId set. Adapt this stub to the project's existing
    // service-test scaffolding.)
    await expect(async () => {
      await freezeOutlineService({
        // ServiceContext
        userId: '11111111-1111-4111-8111-111111111111',
        sessionId: '22222222-2222-4222-8222-222222222222',
        requestId: '33333333-3333-4333-8333-333333333333',
        now: new Date(),
      } as never, {
        sessionId: '22222222-2222-4222-8222-222222222222',
        expectedStateVersion: 0,
      })
    }).rejects.toThrow(/POLICY_OUTLINE_NOT_READY/)
  })
})
```

If your existing service-layer tests use a different mocking shape (e.g., `withUserRLS` mock that returns a fake session), copy that pattern verbatim. The above stub illustrates the assertion; mirror your project's actual mock scaffold.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/integration/policy-freeze-outline-missing.test.ts`
Expected: FAIL — either with the policy code (which means the gate already fires from Task 3) or with a missing-mock error. If the gate already fires, the test passes; if the mock harness is wrong, adapt to the project's standard.

- [ ] **Step 3: If the test fails on mock setup, copy the mock pattern from an existing service test**

Locate a green integration test that already exercises `freezeOutlineService` or `setSelectedCall` (e.g., `tests/integration/managed/...`) and copy its `vi.mock('@/lib/db', ...)` block verbatim, adapting the session row payload to have `outline: null`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/integration/policy-freeze-outline-missing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/tests/integration/policy-freeze-outline-missing.test.ts
git commit -m "test(policy): freezeOutline rejects null/empty outline"
```

---

## Task 6: Integration test — saveSectionDraft rejects unknown sectionKey

**Files:**
- Test: `app/tests/integration/policy-save-section-not-in-outline.test.ts`

- [ ] **Step 1: Write the failing integration test**

Mirror the `policy-freeze-outline-missing.test.ts` mock pattern. The session payload has `outlineFrozen: true`, `outline: [{ id: 'a', ... }]`, `eligibility` passed, then call `saveSectionDraftService` with `sectionKey: 'ghost'`.

```ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

describe('saveSectionDraftService policy gate', () => {
  it('rejects when sectionKey is not in outline', async () => {
    const { saveSectionDraftService } = await import('@/lib/ai/agent/services/sections')
    // Wire up the DB mock so the loaded session has:
    //   outline = [{ id: 'a', ... full SectionSpec ... }]
    //   outlineFrozen = true
    //   eligibility = { score: 100, ... }
    //   status = 'active'
    await expect(async () => {
      await saveSectionDraftService(
        { userId: '...', sessionId: '...', requestId: '...', now: new Date() } as never,
        { sessionId: '...', sectionKey: 'ghost', content: 'x', expectedStateVersion: 0 } as never,
      )
    }).rejects.toThrow(/POLICY_SECTION_NOT_IN_OUTLINE/)
  })
})
```

Adapt the mock harness to mirror an existing green test in `tests/integration/`.

- [ ] **Step 2: Run the test to verify it fails initially, then passes after correct mocks are in place**

Run: `cd app && npx vitest run tests/integration/policy-save-section-not-in-outline.test.ts`
Expected: PASS once the mock returns a valid session with `outline` containing only `'a'`.

- [ ] **Step 3: Commit**

```bash
git add app/tests/integration/policy-save-section-not-in-outline.test.ts
git commit -m "test(policy): saveSectionDraft rejects sectionKey not in outline"
```

---

## Task 7: Add bilingual error messages for new POLICY codes

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`

- [ ] **Step 1: Add Romanian messages**

In `app/src/messages/ro.json`, find the `agent.errors` (or equivalent) namespace and add:

```json
{
  "agent": {
    "errors": {
      "POLICY_OUTLINE_NOT_READY": "Schița apelului încă nu este pregătită. Reîncearcă într-o clipă.",
      "POLICY_SECTION_NOT_IN_OUTLINE": "Secțiunea selectată nu face parte din schiță."
    }
  }
}
```

(Don't duplicate the top-level structure — merge into the existing `agent.errors` namespace.)

- [ ] **Step 2: Add English messages**

In `app/src/messages/en.json`:

```json
{
  "agent": {
    "errors": {
      "POLICY_OUTLINE_NOT_READY": "Outline isn't ready yet. Try again in a moment.",
      "POLICY_SECTION_NOT_IN_OUTLINE": "The selected section isn't part of this outline."
    }
  }
}
```

- [ ] **Step 3: Verify the keys load**

Run: `cd app && npx vitest run tests/integration/i18n 2>&1 | tail -10` if such a test exists. Otherwise, restart `npm run dev` and inspect the network response for translated strings under `/api/messages/...` (or whichever route serves them).

- [ ] **Step 4: Commit**

```bash
git add app/src/messages/ro.json app/src/messages/en.json
git commit -m "i18n(agent): bilingual messages for new POLICY codes"
```

---

## Task 8: Add static welcome string and accept it in `AgentConversation`

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`
- Modify: `app/src/components/agent/AgentConversation.tsx`

- [ ] **Step 1: Add the welcome strings**

`ro.json`:
```json
{
  "agent": {
    "welcomeAfterPreselect": "Am selectat apelul. Apasă „Generează schiță” pentru a începe sau scrie-mi întrebări despre cerere."
  }
}
```

`en.json`:
```json
{
  "agent": {
    "welcomeAfterPreselect": "I've selected the call. Click \"Generate draft\" to begin, or ask me anything about the application."
  }
}
```

- [ ] **Step 2: Accept a `welcomeMessage` prop in `AgentConversation`**

Open `app/src/components/agent/AgentConversation.tsx`. Add an optional prop:

```ts
interface AgentConversationProps {
  // ... existing
  welcomeMessage?: string
}

export function AgentConversation({ messages, status, error, initialInput, onSendMessage, welcomeMessage }: AgentConversationProps) {
  // ... existing setup

  return (
    <>
      {messages.length === 0 && welcomeMessage && (
        <div className="px-4 py-6 text-sm text-gray-600" data-testid="agent-welcome">
          {welcomeMessage}
        </div>
      )}
      {/* existing conversation rendering */}
    </>
  )
}
```

Render the welcome only when `messages.length === 0` so any future model output replaces it naturally.

- [ ] **Step 3: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/src/messages/ro.json app/src/messages/en.json app/src/components/agent/AgentConversation.tsx
git commit -m "feat(agent): static welcome message prop for AgentConversation"
```

---

## Task 9: Gate the auto-send behind `preselect_no_auto_send` in `NewProjectView.tsx`

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` (server component that feeds the flag)

- [ ] **Step 1: Read the flag in the server component**

`page.tsx` is the server component for the route. It currently passes `preselectEnabled` to `NewProjectView`. Add a second flag read:

```ts
import { isFeatureEnabled } from '@/lib/feature-flags'

// inside the page component, after requireAuth():
const noAutoSend = await isFeatureEnabled('preselect_no_auto_send', {
  userId: user.id,
  bypassCache: true,
})

return <NewProjectView
  locale={locale}
  initialSessionId={resumeId}
  preselectEnabled={preselectEnabled}
  noAutoSend={noAutoSend}
/>
```

- [ ] **Step 2: Accept the prop in `NewProjectView.tsx`**

```ts
interface NewProjectViewProps {
  locale: 'ro' | 'en'
  initialSessionId?: string
  preselectEnabled: boolean
  noAutoSend: boolean
}
```

- [ ] **Step 3: Gate the two auto-send sites**

Replace `NewProjectView.tsx:125`:

```ts
      setState({
        kind: 'selected',
        sessionId: result.sessionId,
        callId: result.selectedCallId,
        callTitle: result.candidates[0]?.title ?? result.selectedCallId,
        description,
      })
      if (!noAutoSend) {
        await agent.sendMessage(description)
      }
```

Replace `NewProjectView.tsx:210` (in the new-session candidate-pick handler):

```ts
        setState({
          kind: 'selected',
          sessionId: result.sessionId,
          callId: result.selectedCallId,
          callTitle: result.candidates[0]?.title ?? result.selectedCallId,
          description,
        })
        if (!noAutoSend) {
          await agent.sendMessage(description)
        }
```

Leave the override-existing-session path (around lines 167-189) unchanged — it does not call `sendMessage`.

- [ ] **Step 4: Pass the welcome string to `AgentConversation`**

In the render, swap the `<AgentConversation />` usage to pass `welcomeMessage`:

```tsx
<AgentConversation
  messages={agent.messages}
  status={agent.status}
  error={agent.error}
  initialInput={initialInput}
  onSendMessage={handleSendMessage}
  welcomeMessage={
    noAutoSend && state.kind === 'selected' && agent.messages.length === 0
      ? tPage('welcomeAfterPreselect')
      : undefined
  }
/>
```

(Use whichever `useTranslations` namespace covers `agent.welcomeAfterPreselect`. If the namespace is `'agent'`, call `tAgent('welcomeAfterPreselect')`; instantiate `useTranslations('agent')` near `tPre`/`tPage` at the top of the component.)

- [ ] **Step 5: Update `useCallback` dependencies**

The two callbacks that use `noAutoSend` need it in their deps array:

```ts
const handleSendMessage = useCallback(
  async (description: string) => { /* ... */ },
  [preselectEnabled, initialSessionId, locale, agent, state.kind, tPre, noAutoSend],
)

const handleCandidatePick = useCallback(
  async (callId: string) => { /* ... */ },
  [state, locale, agent, tPre, noAutoSend],
)
```

- [ ] **Step 6: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/[locale]/\(dashboard\)/proiecte/nou/NewProjectView.tsx app/src/app/[locale]/\(dashboard\)/proiecte/nou/page.tsx
git commit -m "feat(agent): gate preselect auto-send behind preselect_no_auto_send flag"
```

---

## Task 10: E2E test — no agent_turns row, static welcome only

**Files:**
- Create: `app/e2e/preselect-no-auto-send.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

```ts
// e2e/preselect-no-auto-send.spec.ts
//
// Asserts the PR 2 bootstrap fix:
//   - preselect-selected creates and adopts the session
//   - UI shows selected call banner + Generate button + static local welcome
//   - no /api/ai/agent SSE call is made
//   - DB has no agent_turns row for the session until user explicitly acts
//
// Pre-condition: feature flag `preselect_no_auto_send` enabled for the test user.

import { test, expect } from '@playwright/test'
import { Client } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL!

test.describe('preselect no-auto-send', () => {
  test.beforeAll(async () => {
    // Enable the flag for the test user
    const c = new Client({ connectionString: DATABASE_URL })
    await c.connect()
    await c.query(`UPDATE feature_flags SET enabled = true WHERE key = 'preselect_no_auto_send'`)
    await c.end()
  })

  test.afterAll(async () => {
    const c = new Client({ connectionString: DATABASE_URL })
    await c.connect()
    await c.query(`UPDATE feature_flags SET enabled = false WHERE key = 'preselect_no_auto_send'`)
    await c.end()
  })

  test('preselect selected → static welcome, no agent SSE, no agent_turns row', async ({ page }) => {
    // Spy on /api/ai/agent requests
    let agentSseCalls = 0
    await page.route('**/api/ai/agent', (route, req) => {
      if (req.method() === 'POST') agentSseCalls++
      return route.continue()
    })

    await page.goto('/ro/proiecte/nou')

    const description = 'Vrem să cumpărăm utilaje agricole pentru irigații în zona PNRR'
    await page.locator('textarea[name="message"]').first().fill(description)
    await page.locator('button[type="submit"]').first().click()

    // Wait for selected-call banner
    await expect(page.getByTestId('selected-call-banner')).toBeVisible({ timeout: 20_000 })

    // Static welcome present, no model-generated chat
    await expect(page.getByTestId('agent-welcome')).toBeVisible()
    await expect(page.getByTestId('agent-message')).toHaveCount(0)

    // No agent SSE call
    expect(agentSseCalls).toBe(0)

    // No agent_turns row in DB for this session
    const url = page.url()
    const sessionId = new URL(url).searchParams.get('session')
    expect(sessionId).toBeTruthy()

    const c = new Client({ connectionString: DATABASE_URL })
    await c.connect()
    const res = await c.query(
      `SELECT count(*)::int AS n FROM agent_turns WHERE session_id = $1`,
      [sessionId],
    )
    await c.end()
    expect(res.rows[0].n).toBe(0)
  })
})
```

(If your project's `AgentConversation` doesn't currently include the `data-testid="agent-message"` and `selected-call-banner` test IDs, add them as part of this task. They're cheap to add and they pin the assertion.)

- [ ] **Step 2: Run the E2E test (with dev server running)**

```bash
cd app && PORT=3002 npm run dev &
sleep 5
DATABASE_URL=$DATABASE_URL npx playwright test e2e/preselect-no-auto-send.spec.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/e2e/preselect-no-auto-send.spec.ts
git commit -m "test(e2e): preselect no-auto-send leaves agent_turns empty"
```

---

## Task 11: Add `policy_violation_total` metric

**Files:**
- Modify: `app/src/lib/monitoring/metrics.ts`
- Modify: `app/src/lib/ai/agent/policy/enforce.ts`

- [ ] **Step 1: Define the counter**

In `app/src/lib/monitoring/metrics.ts`:

```ts
import { Counter } from 'prom-client'

export const policyViolationTotal = new Counter({
  name: 'policy_violation_total',
  help: 'Number of policy gate rejections from assertPolicy',
  labelNames: ['rule', 'code'],
})
```

Adapt to the existing Counter wrapper if the project uses one.

- [ ] **Step 2: Increment from `assertPolicy`**

In `app/src/lib/ai/agent/policy/enforce.ts`, wrap each `throw new ValidationError(...)` call with the counter increment. Cleanest: derive the `rule` name from the matrix key. Since `assertPolicy` doesn't receive the rule name today, extend the signature minimally:

```ts
export function assertPolicy(
  rule: PolicyRule,
  session: AgentSession,
  opts: AssertPolicyOpts = {},
  ruleName: string = rule.auditAction,  // fallback for back-compat
): void {
  // ... existing gates ...
  // On any throw, increment policyViolationTotal first:
  // throw new ValidationError(...) becomes:
  //   policyViolationTotal.inc({ rule: ruleName, code: rule.errorCodes.X ?? 'UNKNOWN' })
  //   throw new ValidationError(...)
}
```

Update every call site (`services/application.ts`, `services/sections.ts`) to pass the rule name:

```ts
assertPolicy(POLICY_MATRIX.freezeOutline, session, opts, 'freezeOutline')
```

- [ ] **Step 3: Run typecheck + tests**

```bash
cd app && npm run typecheck && npx vitest run tests/unit/policy-invariants.test.ts
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/monitoring/metrics.ts app/src/lib/ai/agent/policy/enforce.ts app/src/lib/ai/agent/services/
git commit -m "feat(metrics): policy_violation_total counter on assertPolicy rejections"
```

---

## Task 12: Final regression sweep

- [ ] **Step 1: Full typecheck + unit + integration suite**

```bash
cd app && npm run typecheck && npm run test
```
Expected: all green.

- [ ] **Step 2: Lint changed files**

```bash
cd app && npx eslint --no-error-on-unmatched-pattern \
  src/lib/ai/agent/policy/ \
  src/lib/ai/agent/services/sections.ts \
  src/app/api/ai/agent/state/route.ts \
  src/app/\[locale\]/\(dashboard\)/proiecte/nou/NewProjectView.tsx \
  src/components/agent/AgentConversation.tsx
```
Expected: no new errors (pre-existing are allowed per `ignoreDuringBuilds: true`).

- [ ] **Step 3: Verify flag-off behavior unchanged**

```bash
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = false WHERE key = 'preselect_no_auto_send'"
```
Then load `/ro/proiecte/nou`, submit a description, observe the legacy behavior (auto-send fires; chat begins with model response). This proves the flag gate is clean.

- [ ] **Step 4: Commit any final fixes**

If lint or tests required fixups during the sweep, commit them now.

---

## Self-Review Checklist

- [ ] Spec coverage: §1 bootstrap fix ✓ Tasks 7/8/9 (welcome string, prop wiring, gated sendMessage). §3 invariants ✓ Tasks 2/3/4 (matrix, enforce, sections wiring) + Tasks 5/6 (integration coverage).
- [ ] No placeholders: every code snippet is complete.
- [ ] Type consistency: `requiresOutlinePresent` / `requiresSectionKeyInOutline` / `outlineMissing` / `sectionNotInOutline` / `sectionKey` opts field — identical names across `matrix.ts`, `enforce.ts`, services, and tests.
- [ ] Commits per task = one logical change; messages follow conventional commits.

## Definition of Done

- Flag `preselect_no_auto_send` exists in production at `enabled = false`.
- With flag off: legacy auto-send behavior unchanged.
- With flag on (staff/test orgs): preselect ends with adopt + welcome string + Generate button, no agent SSE call until user opts in.
- Policy gates reject null/empty outline (freeze) and unknown sectionKey (save) with `POLICY_OUTLINE_NOT_READY` / `POLICY_SECTION_NOT_IN_OUTLINE`.
- Bilingual messages for both new POLICY codes load from `ro.json` and `en.json`.
- E2E spec passes locally; existing test suites still green.
