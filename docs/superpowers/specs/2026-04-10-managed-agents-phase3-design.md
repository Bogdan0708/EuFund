# Managed Agents Phase 3 — Section Drafting & Structured Action Bridge

> End-to-end managed execution for the full application workflow. Writes are authoritative in the service layer. Structured UI actions become deterministic tool executions. V3 remains the fallback.

**Date:** 2026-04-10
**Status:** Draft — pending implementation plan
**Supersedes:** Phase 2 `hasStructuredAction → V3` bypass guard (commit fc2f1d7)
**Prerequisite:** Phase 2 merged (read-only managed pilot, 14 tools, feature-flagged routing)
**Parent architecture:** `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md`
**Spec authors:** Human + Claude Opus 4.6

---

## 1. Goals / Non-goals

### Goals

1. **Authoritative service-layer gates.** Every write mutation in Phase 3 has its ownership, concurrency, and domain invariants enforced inside the service function — not in a runtime, not in an executor, not in a prompt. The service is the last line of defense and cannot be bypassed by any caller.
2. **Eight managed write tools.** The managed runtime can call `save_section_draft`, `approve_revision`, `rollback_section`, `set_application_status`, plus four new narrow mutations (`set_selected_call`, `freeze_outline`, `mark_section_stale`, `reject_section`). Every call is audited, concurrency-guarded, and policy-checked.
3. **Structured action bridge.** All 7 frontend `StructuredAction` variants execute deterministically through the managed runtime. Button clicks become typed tool executions, never ad-hoc natural-language reinterpretation.
4. **End-to-end managed workflow.** With both feature flags enabled, a user can complete the full discovery → research → structuring → drafting → review → completion flow inside the managed runtime without any request silently falling back to V3.
5. **`mark_complete` is in scope.** Handled through `setApplicationStatus('completed')` as an explicit Phase 3 mutation — not an accidental side effect.
6. **Quality parity with V3.** Managed agent drafts match or exceed V3 quality in a 10-application human-rated evaluation.
7. **Independently revertible rollout.** Four sequential PRs, each shippable and revertible on its own terms.

### Non-goals

- **No `create_export_snapshot` or `save_call_blueprint` exposure.** Both stay blocked in Phase 3 and targeted at Phase 4. A managed drafting session that encounters a blueprint cache miss must surface it as a user-facing message — it must not persist anything via `save_call_blueprint` indirectly.
- **No multi-agent or specialist agents** — Phase 5 territory.
- **No concurrent editing.** One active session per `(userId, projectId, selectedCallId)` tuple, unchanged from Phase 2.
- **No frontend changes.** `useAgent` contract and `AgentEvent` SSE shape remain frozen. The managed runtime must emit the same event types V3 does.
- **No pattern write-back changes.** V3's `onSectionAccepted` and `trackPatternUsage` stay where they are (invoked from services). Nothing in the managed runtime touches knowledge write-back directly.
- **No rate-limit or billing changes.**
- **No default switch.** After Phase 3, managed mode is still opt-in per user. Phase 4 is where "80%+ of sessions run managed" becomes the goal.

### Success criteria

1. Eight write tools callable via managed runtime with full audit + concurrency integrity.
2. All 7 structured actions complete successfully in managed mode when both flags are on.
3. V3 regression-free: existing V3 tests pass unchanged; no behavior change for users without the new flag.
4. Draft quality in the 10-app comparison is ≥ V3 baseline under human rating, following the §9.4 pass rule.
5. Zero new `any` / `@ts-expect-error` in the diff; typecheck + lint clean.
6. **When both flags are enabled, every structured action must complete through the managed path or return an explicit managed-path error. Silent V3 fallback for actions is a bug.**

---

## 2. Core Invariants

These are the ruling principles for Phase 3. Every decision in the design respects them.

1. **Service layer is authoritative.** Workflow and policy invariants for state-changing operations are enforced in the service layer. Runtimes, executors, and route handlers may perform preflight checks for UX and efficiency, but they must not be the only enforcement point.
2. **Policy matrix is declarative.** `app/src/lib/ai/agent/policy/matrix.ts` describes rules (required session state, allowed section states, audit action, error codes, idempotency mode). It does not encode procedural logic — mutation-specific logic stays in service functions.
3. **Determinism for structured actions.** Button clicks become typed tool executions. The bridge runs mutations first, then the agent reacts to the resulting state. User intent is never reinterpreted as free-form text when it came from a structured UI action.
4. **No silent V3 fallback for actions.** With `managed_agent_enabled=true`, any request carrying a `body.action` either completes through managed or returns an explicit managed-path error. The Phase 2 `hasStructuredAction → V3` guard is intentionally removed.
5. **Idempotent no-op contract.** Mutations whose preconditions imply no change (e.g., already-accepted section, already-frozen outline, already-completed status) return the current state with no `stateVersion` bump, no `updatedAt` change, and no audit event.
6. **Write flag off ≠ V3 restoration.** Disabling `managed_agent_writes_enabled` while `managed_agent_enabled` stays on causes write tool calls and structured action requests to return explicit managed-path errors. It does not restore V3 as a hidden fallback for actions.
7. **Write tools require confirmation.** The system prompt enforces: *"Before calling any write tool, obtain explicit user intent or an equivalent structured UI action confirmation."* The bridge counts as that confirmation for action-driven writes.

---

## 3. Component Diagram

```
  POST /api/ai/agent  {action?, message?, sessionId}
           │
           ▼
  ┌──────────────────────────────────────────────────────┐
  │ route.ts                                              │
  │  • requireAuth, loadSession                           │
  │  • flags: managed_agent_enabled + writes_enabled      │
  │  • (Phase 2 hasStructuredAction guard REMOVED)        │
  │                                                       │
  │  body.action present?                                 │
  │     │                                                 │
  │     ├── writes_enabled=false → explicit SSE error     │
  │     │                                                 │
  │     └── writes_enabled=true → bridgeStructuredAction  │
  │                                                       │
  │  bridge result?                                       │
  │     ├── error → explicit SSE error                    │
  │     └── success → reload session + dispatch managed   │
  └─────────────┬─────────────────────────────────────────┘
                │
                ▼
  ┌──────────────────────────────────────────────────────┐
  │ managed runtime                                       │
  │  • buildSystemPrompt (Phase 3: all 5 workflow phases) │
  │  • loadManagedHistory (includes synthetic pairs)      │
  │  • anthropic.messages.stream(tools=22)                │
  │  • translator → SSE AgentEvent                        │
  │  • executeManagedTool for each tool_use               │
  └─────────────┬─────────────────────────────────────────┘
                │
                ▼
  ┌──────────────────────────────────────────────────────┐
  │ executor                                              │
  │  • allowlist: MANAGED_TOOL_NAMES (22 total)           │
  │  • allowWrites gate for WRITE_TOOL_NAMES              │
  │  • dispatch → service function                        │
  │  • error mapping: policyCode → tool_result            │
  └─────────────┬─────────────────────────────────────────┘
                │
                ▼
  ┌──────────────────────────────────────────────────────┐
  │ services (+ policy/assertPolicy)                      │
  │  • verifyOwnership                                    │
  │  • concurrency: expectedStateVersion check            │
  │  • assertPolicy(POLICY_MATRIX[name], session, opts)   │
  │  • transaction: mutate, increment stateVersion        │
  │  • logAudit                                           │
  └─────────────┬─────────────────────────────────────────┘
                │
                ▼
  ┌──────────────────────────────────────────────────────┐
  │ PostgreSQL                                            │
  │  agent_sessions   agent_sections   agent_section_vers │
  │  agent_messages (+ provider='action_bridge' rows)     │
  │  audit_log (hash chain)                               │
  └──────────────────────────────────────────────────────┘
```

### Four first-class tool-name sets

Exported from `app/src/lib/ai/agent/managed/tools.ts` and used by executor, tests, logs, metrics:

```typescript
export const READ_TOOL_NAMES: Set<string>          // 9 read tools (Phase 2)
export const RULE_TOOL_NAMES: Set<string>          // 5 rules tools (Phase 2)
export const WRITE_TOOL_NAMES: Set<string>         // 8 write tools (Phase 3)
export const PHASE_4_BLOCKED_TOOL_NAMES: Set<string>  // save_call_blueprint, create_export_snapshot
export const MANAGED_TOOL_NAMES: Set<string>       // union of READ+RULE+WRITE (22 total)
```

Renamed from Phase 2's `MANAGED_READ_ONLY_TOOLS` → `MANAGED_TOOLS`.

---

## 4. Policy Matrix

Authoritative table for every mutation in Phase 3. Shipped as:

1. **Code**: `app/src/lib/ai/agent/policy/matrix.ts` — the `POLICY_MATRIX` typed constant services import.
2. **Doc**: `docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md` — human-readable version, checked in sync with the code via a sync test.

| # | Mutation | Ownership | stateVersion | Session preconditions | Section preconditions | Audit action | Idempotent mode |
|---|---|---|---|---|---|---|---|
| 1 | `setSelectedCall(callId)` | required | required | `status=active`, `outlineFrozen=false` | — | `session.call_selected` | No — cannot reselect once outline is frozen |
| 2 | `freezeOutline()` | required | required | `status=active`, `selectedCallId != null`, `eligibility != null && eligibility.eligible === true`, `outlineFrozen=false` | — | `session.outline_frozen` | Yes — already-frozen returns current state (no-op, no stateVersion bump, no audit) |
| 3 | `saveSectionDraft(sectionKey, content)` | required | required | `outlineFrozen=true`, `eligibility.eligible=true`, `status=active` | any (creates if missing) | `project.version_save` (legacy, preserved for hash chain continuity) | No — each call creates a new version entry |
| 4 | `approveSection(sectionKey)` *(MCP name: `approve_revision`)* | required | required | `outlineFrozen=true` | section must exist; status ∈ `{draft, needs_review}` | `section.state_change` (legacy) | Yes — already-accepted no-op |
| 5 | `rollbackSection(sectionKey, targetVersion)` | required | required | `outlineFrozen=true` | section must exist; target version must exist | `section.rolled_back` | No — creates a new version entry with `kind='rollback'` and pointer to `targetVersion` |
| 6 | `markSectionStale(sectionKey)` | required | required | `outlineFrozen=true` | section must exist; status ∈ `{draft, needs_review, accepted}` | `section.marked_stale` | Yes — already-stale no-op. When demoting from `accepted`, sets `status=stale` and clears `acceptedContent`; prior accepted snapshot is preserved only via version history |
| 7 | `rejectSection(sectionKey, reason)` | required | required | `outlineFrozen=true` | section must exist; status ∈ `{draft, needs_review, rejected}` | `section.rejected` | Partial — same `sectionKey` + same `reason` = no-op; same `sectionKey` + different `reason` throws `POLICY_SECTION_WRONG_STATE` (rejection is not a metadata-edit path) |
| 8 | `setApplicationStatus(status)` *(Phase 3 values: `'paused'`, `'completed'`)* | required | required | For `'completed'`: `validate_application` must pass (all required sections accepted, all mandatory annexes uploaded). For `'paused'`: `status=active`. | — | `session.status_change` | Yes — same-status no-op |

### Policy error codes (stable vocabulary)

| Code | Raised by | Meaning |
|---|---|---|
| `POLICY_NO_CALL_SELECTED` | freezeOutline | No `selectedCallId` set |
| `POLICY_OUTLINE_ALREADY_FROZEN` | setSelectedCall, freezeOutline | Attempted mutation on a frozen outline |
| `POLICY_OUTLINE_NOT_FROZEN` | saveSectionDraft, approveSection, rollbackSection, markSectionStale, rejectSection | Outline must be frozen first |
| `POLICY_ELIGIBILITY_NOT_PASSED` | freezeOutline, saveSectionDraft | `eligibility == null` or `eligibility.eligible !== true` |
| `POLICY_SECTION_WRONG_STATE` | approveSection, rollbackSection, markSectionStale, rejectSection | Section is not in an allowed state for this mutation (includes current status + allowed list in message) |
| `POLICY_VALIDATION_NOT_PASSED` | setApplicationStatus('completed') | `validate_application` failed |
| `CONCURRENCY` | all services | `expectedStateVersion !== session.stateVersion` |
| `NOT_FOUND` | all services | Session or section missing |
| `VALIDATION:<field>` | Zod input validation | Input schema validation failure |

### Idempotent no-op rule

A service function MUST treat an already-applied mutation as a no-op:
- Return the current `stateVersion` unchanged
- Do not bump `updatedAt`
- Do not emit an audit event

This prevents noise in the audit chain and respects the principle that `stateVersion` only increments when a real mutation occurs.

---

## 5. 3a — Service-Layer Hardening

**Goal:** Every Phase 3 mutation's invariants are enforced inside the service layer before any new managed surface is built.

**Risk:** LOW. Services are internal; no caller changes yet. V3 continues to pass its existing tests because its upstream checks already enforce the same conditions.

**Rollback:** Straightforward git revert.

### 5.1 Policy module

**New file: `app/src/lib/ai/agent/policy/matrix.ts`** — declarative `POLICY_MATRIX` constant. The `PolicyRule` type carries explicit fields:

```typescript
export interface PolicyRule {
  requiresOwnership: true
  requiresStateVersion: true
  requiresSessionStatus?: Array<'active' | 'paused' | 'completed' | 'abandoned' | 'error'>
  requiresCallSelected?: boolean
  requiresOutlineFrozen?: boolean
  forbidsOutlineFrozen?: boolean
  requiresEligibility?: 'none' | 'run' | 'passed'
  allowedSectionStates?: SectionStatus[]
  forbidIfSectionState?: SectionStatus[]
  auditAction: string            // legacy strings are reused intentionally for hash chain continuity; see file header
  errorCodes: Partial<Record<PolicyGateKey, PolicyErrorCode>>
}

export const POLICY_MATRIX = {
  setSelectedCall: { /* ... */ },
  freezeOutline: { /* ... */ },
  saveSectionDraft: { /* ... */ },
  approveSection: { /* ... */ },
  rollbackSection: { /* ... */ },
  markSectionStale: { /* ... */ },
  rejectSection: { /* ... */ },
  setApplicationStatus: { /* ... */ },
} as const satisfies Record<string, PolicyRule>
```

Reused legacy audit strings (`project.version_save`, `section.state_change`) are documented in the file header with a comment:

> The following audit actions intentionally reuse legacy V3 strings to preserve hash-chain continuity across the V3 → managed migration. Do not rename them without a coordinated audit migration.

**New file: `app/src/lib/ai/agent/policy/enforce.ts`** — the `assertPolicy` helper used by services:

```typescript
export function assertPolicy(
  rule: PolicyRule,
  session: AgentSession,
  opts?: { sectionState?: SectionStatus },
): void {
  if (rule.requiresSessionStatus && !rule.requiresSessionStatus.includes(session.status)) {
    throw new ValidationError('sessionStatus',
      `Session is ${session.status}; expected one of ${rule.requiresSessionStatus.join(',')}`)
  }
  if (rule.requiresCallSelected && !session.selectedCallId) {
    throw new ValidationError('selectedCallId', 'No call selected', rule.errorCodes.noCall)
  }
  if (rule.forbidsOutlineFrozen && session.outlineFrozen) {
    throw new ValidationError('outlineFrozen', 'Outline already frozen', rule.errorCodes.outlineFrozen)
  }
  if (rule.requiresOutlineFrozen && !session.outlineFrozen) {
    throw new ValidationError('outlineFrozen', 'Outline must be frozen first', rule.errorCodes.outlineNotFrozen)
  }
  if (rule.requiresEligibility === 'passed') {
    if (!session.eligibility || session.eligibility.eligible !== true) {
      throw new ValidationError('eligibility', 'Eligibility must have passed', rule.errorCodes.eligibility)
    }
  }
  if (rule.allowedSectionStates && opts?.sectionState && !rule.allowedSectionStates.includes(opts.sectionState)) {
    throw new ValidationError('sectionState',
      `Section state is '${opts.sectionState}'; expected one of ${rule.allowedSectionStates.join(',')}`,
      rule.errorCodes.sectionWrongState)
  }
}
```

### 5.2 `ValidationError` extension

Backwards-compatible third constructor argument in `app/src/lib/ai/agent/services/errors.ts`:

```typescript
export class ValidationError extends ServiceError {
  constructor(
    public field: string,
    message: string,
    public policyCode?: PolicyErrorCode,
  ) { super('VALIDATION', message) }
}
```

Existing callers pass two args and stay compatible. New callers include `policyCode` for stable machine-readable codes. `policyCode` is optional in serialization — older consumers that only read `{error, code, field}` continue to work.

### 5.3 Changes to existing services

Each existing write service in `app/src/lib/ai/agent/services/` grows a single `assertPolicy` call right after ownership + stateVersion checks:

- `sections.ts` → `saveSectionDraft`, `approveSection`, `rollbackSection`
- `application.ts` → `setApplicationStatus`

The patch per service is ~5 LOC. Example for `saveSectionDraft`:

```typescript
export async function saveSectionDraft(ctx, input) {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  assertPolicy(POLICY_MATRIX.saveSectionDraft, session)   // ← NEW

  // ... existing transaction logic unchanged
}
```

### 5.4 Four new services

All four live in existing service files — no new service files added.

| Service | File | Rationale |
|---|---|---|
| `setSelectedCall` | `services/application.ts` | Session-level mutation |
| `freezeOutline` | `services/application.ts` | Session-level mutation |
| `markSectionStale` | `services/sections.ts` | Section-level mutation |
| `rejectSection` | `services/sections.ts` | Section-level mutation |

Each follows the same 7-step pattern:

1. Verify ownership via `verifySessionOwnership`
2. Compare `expectedStateVersion` → `ConcurrencyError` if mismatch
3. `assertPolicy(POLICY_MATRIX[name], session, { sectionState })`
4. Idempotent early-return if the mutation is a no-op (per matrix)
5. Transaction: mutate, increment `stateVersion`
6. Audit: `logAudit({ action: POLICY_MATRIX[name].auditAction, ... })`
7. Return `{ newStateVersion, ...domainSpecific }`

Concrete example — `rejectSection`:

```typescript
export async function rejectSection(
  ctx: ServiceContext,
  input: { sessionId: string; sectionKey: string; reason: string; expectedStateVersion: number },
): Promise<{ newStateVersion: number }> {
  const session = await verifySessionOwnership(ctx, input.sessionId)

  if (session.stateVersion !== input.expectedStateVersion) {
    throw new ConcurrencyError(input.expectedStateVersion, session.stateVersion)
  }

  const sectionRows = await db.select().from(agentSections)
    .where(and(eq(agentSections.sessionId, input.sessionId), eq(agentSections.sectionKey, input.sectionKey)))
    .limit(1)
  const section = sectionRows[0]
  if (!section) throw new NotFoundError('section', `${input.sessionId}:${input.sectionKey}`)

  assertPolicy(POLICY_MATRIX.rejectSection, session, { sectionState: section.status })

  // Idempotency: same reason = no-op; different reason = explicit error
  if (section.status === 'rejected') {
    if (section.rejectionReason === input.reason) {
      return { newStateVersion: session.stateVersion } // no stateVersion bump, no audit
    }
    throw new ValidationError(
      'reason',
      'Section already rejected with a different reason',
      'POLICY_SECTION_WRONG_STATE',
    )
  }

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
    metadata: { sessionId: input.sessionId, sectionKey: input.sectionKey, reason: input.reason, requestId: ctx.requestId },
  })

  return { newStateVersion }
}
```

`markSectionStale` additionally clears `acceptedContent` when demoting from `accepted`. `freezeOutline` additionally advances the session phase to `drafting`. Details in each service's JSDoc.

### 5.5 Schema additions

One migration: `NNNN_agent_sections_phase3_columns.sql`.

1. `agent_sections.rejection_reason` — `text`, nullable (new column for `rejectSection`)
2. `agent_sections.status` enum — add `'stale'` value

**Propagation of `'stale'` across the codebase** (all in the same PR):
- DB enum (migration)
- Drizzle `sectionStatusEnum` in `schema.ts`
- `SectionStatus` TypeScript union in `services/types.ts` and `lib/ai/agent/types.ts`
- Any Zod schemas referencing `SectionStatus`
- Any `SectionStatus → UIStateSnapshot` mapper code

`'stale'` must not become an "unknown status" in any existing code path. A sync test under `tests/unit/schema/section-status-enum.test.ts` asserts the enum values match the TS union match the Zod schema.

### 5.6 V3 audit

Before 3a merges, a scripted audit runs against V3's runtime:

1. **Search** for every call site that mutates `agentSections.content`, `agentSections.status`, `agentSessions.outlineFrozen`, `agentSessions.selectedCallId`, `agentSessions.status`.
2. **Verify** each call site already enforces the corresponding policy check upstream (or documents a legitimate exception).
3. **Document findings** in the PR description. Expected outcome: V3 already enforces everything upstream and the audit is a paperwork exercise.

If the audit finds a genuine V3 bug where the service layer's new gate would change behavior:
- **Fix V3 in a separate small PR before 3a.** Do not bundle the V3 fix into 3a's diff.
- This keeps 3a's rollback story clean and the V3 fix reviewable on its own merits.

### 5.7 Escape hatch (near-forbidden)

If the audit surfaces a **legitimate legacy exception** — a V3 path that intentionally bypasses one of the new gates and the bypass is domain-correct — the service may accept an `overridePolicy: { code: string; justification: string }` parameter. This escape hatch requires:

- Code comment explaining why the bypass is correct
- A dedicated test for the exception path
- A PR-note flagging the exception for reviewer attention
- Default expectation: **zero uses**. If the escape hatch is used more than once, we revisit the gate definition.

### 5.8 Tests for 3a

**Unit tests:**
- `tests/unit/services/policy-matrix.test.ts` — verifies `POLICY_MATRIX` shape, `assertPolicy` behavior for each rule
- `tests/unit/services/set-selected-call.test.ts`
- `tests/unit/services/freeze-outline.test.ts`
- `tests/unit/services/mark-section-stale.test.ts`
- `tests/unit/services/reject-section.test.ts`
- Additions to `tests/unit/services/sections.test.ts` and `tests/unit/services/application.test.ts` — one negative test per new gate
- **`tests/unit/services/policy-matrix-coverage.test.ts`** — asserts that every write service references a `POLICY_MATRIX` entry. Catches "forgot to wire policy into one service" mistakes cheaply.

**Integration tests (real DB):**
- `tests/integration/services/phase3-concurrency.test.ts` — stateVersion enforcement across all 8 services with concurrent-call scenarios
- `tests/integration/services/phase3-audit-chain.test.ts` — audit hash chain integrity after each new service runs

**Docs sync test:**
- `tests/unit/policy/matrix-docs-sync.test.ts` — reads `docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md` and verifies every rule in `POLICY_MATRIX` has a corresponding row in the doc (string match on tool name)

### 5.9 Estimated diff size

| Component | LOC |
|---|---|
| `policy/` module (matrix + enforce) | ~150 |
| 4 new service functions | ~320 |
| Existing service additions (4 × ~5) | ~20 |
| Migration + schema changes | ~20 |
| Tests (~15 files) | ~600 |
| Policy matrix doc | ~200 |

**Total:** ~1,200 LOC added, ~20 LOC modified, 0 LOC deleted.

---

## 6. 3b — MCP Handlers + Managed Tool Exposure + Prompt

**Goal:** Expose the 8 write tools through MCP + managed runtime, update the prompt to unlock all 5 workflow phases, gate the new surface behind a second feature flag. Structured actions still force V3 via the Phase 2 guard (lifted in 3c).

**Risk:** MEDIUM. Agents can now write to the DB, but only in conversational flows. Structured actions are still bypassed. Blast radius: free-text drafting flows by pilot users with both flags on.

**Rollback:** Flip `managed_agent_writes_enabled` off; no code revert needed.

### 6.1 Four new MCP handlers

Four new files under `app/src/lib/ai/agent/mcp/write/`, mirroring the existing envelope pattern (thin wrapper around the service, maps `ServiceError` subclasses to `isError` results):

```
app/src/lib/ai/agent/mcp/write/
├── set-selected-call.ts       (NEW — Phase 3)
├── freeze-outline.ts          (NEW — Phase 3)
├── mark-section-stale.ts      (NEW — Phase 3)
├── reject-section.ts          (NEW — Phase 3)
├── save-section-draft.ts      (existing, policy gates added in 3a)
├── approve-revision.ts        (existing, policy gates added in 3a)
├── rollback-section.ts        (existing, policy gates added in 3a)
├── set-application-status.ts  (existing, policy gates added in 3a)
├── create-export-snapshot.ts  (existing, NOT exposed in managed — Phase 4)
└── save-call-blueprint.ts     (existing, NOT exposed in managed — Phase 4)
```

Each new handler exports `inputShape` (raw Zod object) and `inputSchema` (`z.object(inputShape)`) so the managed runtime's `tools.ts` imports a single canonical schema per tool — no drift between MCP surface and managed surface.

Example skeleton (`freeze-outline.ts`):

```typescript
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { freezeOutline } from '../../services/application'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

export const inputShape = {
  sessionId: z.string().uuid(),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerFreezeOutline(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'freeze_outline',
    'Freeze the application outline, moving the workflow from structuring into drafting. Requires a selected call and passing eligibility. After freeze, the call cannot change and drafting tools become available. Idempotent if outline is already frozen.',
    inputShape,
    async (args) => {
      try {
        const result = await freezeOutline(ctx, args)
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (err) {
        if (err instanceof ConcurrencyError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'CONCURRENCY', expected: err.expected, actual: err.actual }) }], isError: true }
        }
        if (err instanceof ValidationError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: err.policyCode ?? 'VALIDATION', field: err.field }) }], isError: true }
        }
        if (err instanceof NotFoundError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'NOT_FOUND' }) }], isError: true }
        }
        throw err
      }
    },
  )
}
```

Registration goes in `app/src/lib/ai/agent/mcp/write/index.ts`.

### 6.2 Managed tool exposure

**Rename**: `MANAGED_READ_ONLY_TOOLS` → `MANAGED_TOOLS` in `app/src/lib/ai/agent/managed/tools.ts`. All callers updated in the same commit.

**Add 8 write tool entries** to the array. Each entry follows a consistent description rubric:
- First sentence: what it does
- Second sentence: preconditions relevant for the LLM's planning (not the full policy matrix)
- Third sentence: *"Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool."*

**Define the four name sets** at the bottom of the file:

```typescript
export const READ_TOOL_NAMES: Set<string> = new Set([
  'search_calls', 'get_call_blueprint', 'retrieve_evidence',
  'get_application_state', 'list_sections', 'get_section',
  'get_validation_report', 'get_project_summary', 'list_uploaded_documents',
])

export const RULE_TOOL_NAMES: Set<string> = new Set([
  'run_eligibility', 'score_fit', 'validate_section',
  'validate_application', 'check_missing_annexes',
])

export const WRITE_TOOL_NAMES: Set<string> = new Set([
  'save_section_draft', 'approve_revision', 'rollback_section',
  'set_application_status', 'set_selected_call', 'freeze_outline',
  'mark_section_stale', 'reject_section',
])

export const PHASE_4_BLOCKED_TOOL_NAMES: Set<string> = new Set([
  'create_export_snapshot', 'save_call_blueprint',
])

export const MANAGED_TOOL_NAMES: Set<string> = new Set([
  ...READ_TOOL_NAMES, ...RULE_TOOL_NAMES, ...WRITE_TOOL_NAMES,
])  // 22 total
```

### 6.3 Executor changes

In `app/src/lib/ai/agent/managed/executor.ts`:

**Remove `KNOWN_WRITE_TOOLS` constant.** Replace with `PHASE_4_BLOCKED_TOOL_NAMES` imported from `tools.ts`. The blocklist logic becomes:

```typescript
if (!MANAGED_TOOL_NAMES.has(name)) {
  if (PHASE_4_BLOCKED_TOOL_NAMES.has(name)) {
    return errorResult(name, start,
      'This tool is not available in the managed runtime yet (Phase 4 scope). ' +
      'Please continue in the standard workflow.')
  }
  return errorResult(name, start, `Unknown tool: ${name}`)
}
```

**Add `allowWrites` gate.** Before dispatch:

```typescript
if (WRITE_TOOL_NAMES.has(name) && ctx.allowWrites !== true) {
  return errorResult(name, start,
    'Managed write tools are disabled for your account. Reads and evaluations are still available. ' +
    'This is a rollout gate, not a permanent restriction.')
}
```

**Add 8 dispatch cases** in `dispatchTool(name, rawInput, ctx)`:

```typescript
case 'save_section_draft': {
  const i = saveSectionDraftSchema.parse(rawInput)
  return sections.saveSectionDraft(ctx, i)
}
case 'approve_revision': {
  const i = approveRevisionSchema.parse(rawInput)
  return sections.approveSection(ctx, i)
}
case 'rollback_section': {
  const i = rollbackSectionSchema.parse(rawInput)
  return sections.rollbackSection(ctx, i)
}
case 'set_application_status': {
  const i = setApplicationStatusSchema.parse(rawInput)
  return application.setApplicationStatus(ctx, i)
}
case 'set_selected_call': {
  const i = setSelectedCallSchema.parse(rawInput)
  return application.setSelectedCall(ctx, i)
}
case 'freeze_outline': {
  const i = freezeOutlineSchema.parse(rawInput)
  return application.freezeOutline(ctx, i)
}
case 'mark_section_stale': {
  const i = markSectionStaleSchema.parse(rawInput)
  return sections.markSectionStale(ctx, i)
}
case 'reject_section': {
  const i = rejectSectionSchema.parse(rawInput)
  return sections.rejectSection(ctx, i)
}
```

**Extend error mapping** to include `policyCode`:

```typescript
if (err instanceof ValidationError) {
  const code = err.policyCode ?? `VALIDATION:${err.field}`
  return errorResult(name, start, `${code}: ${err.message}`)
}
```

This gives the agent a stable machine-readable prefix (e.g. `POLICY_OUTLINE_NOT_FROZEN: Outline must be frozen first`) that the system prompt teaches it to handle.

**Add write-tool observability log line:**

```typescript
if (WRITE_TOOL_NAMES.has(name)) {
  log.info({
    tool: name,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    requestId: ctx.requestId,
    isError: result.isError,
    latencyMs: result.latencyMs,
  }, 'managed write tool executed')
}
```

**Defensive truncation for write tools** — write results are tiny by design; any truncation is a bug signal. Log a warn and return the result as-is.

### 6.4 `ServiceContext.allowWrites`

Add an optional field in `app/src/lib/ai/agent/services/types.ts`:

```typescript
export interface ServiceContext {
  userId: string
  sessionId?: string
  organizationId?: string
  projectId?: string
  requestId: string
  now: Date
  allowWrites?: boolean  // NEW — read by managed executor only; services ignore this
}
```

**Services do not read `allowWrites`.** It's a managed-runtime rollout control, not a domain invariant. Enforcement happens in the executor and in the action bridge (§7).

### 6.5 Prompt update

Replace `app/src/lib/ai/agent/managed/prompt.ts` contents. Keep the RO/EN split and the `buildManagedSystemPrompt(session, sections, phase, locale)` signature.

Key changes from Phase 2 prompt:
- **Remove** "Phase 2 — Read-Only Pilot" framing; replace with "FondEU Managed Mode"
- **Remove** "allowed phases: discovery + research only" restriction
- **Add** full workflow phase descriptions: discovery → research → structuring → drafting → review → completed
- **Add** write-tool section listing the 8 write tools with short purpose strings
- **Add** hard rule: *"Before calling any write tool, obtain explicit user intent or an equivalent structured UI action confirmation. For `save_section_draft`, present the draft content for review first. For `approve_revision`, confirm the user accepts the current draft. For `set_application_status('completed')`, confirm the application is ready."*
- **Add** hard rule: *"Never call write tools in parallel. Execute them one at a time, waiting for each result, then deciding the next step."*
- **Add** session-state block: `outlineFrozen`, eligibility summary, section statuses
- **Add** concurrency recovery rule: *"The current session stateVersion is X. Every write tool requires `expectedStateVersion` matching the current value. After any CONCURRENCY error, fetch fresh state via `get_application_state` before retrying. Never blindly retry a write with a stale `expectedStateVersion`."*
- **Add** policy-code recovery rule: *"If a tool returns a POLICY_* error, read the policy matrix description in the error message and address the precondition before retrying. For POLICY_ELIGIBILITY_NOT_PASSED, run `run_eligibility` first. For POLICY_OUTLINE_NOT_FROZEN, `freeze_outline` must be called first."*

Both RO and EN versions stay ≤ 2500 tokens.

### 6.6 New feature flag

New flag `managed_agent_writes_enabled`, seeded via migration following the existing pattern (`0015_agent_v3_feature_flag.sql`, Phase 2's `0055_managed_agent_enabled_flag.sql`). Default off. Targeting empty.

Migration: `NNNN_managed_agent_writes_enabled_flag.sql` plus a `meta/_journal.json` entry.

**Route handler change** in `runManagedWithSSE`:

```typescript
const writesEnabled = await isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id })
const serviceCtx = {
  userId: user.id,
  sessionId: session.id,
  projectId: session.projectId ?? undefined,
  requestId: body.requestId,
  now: new Date(),
  allowWrites: writesEnabled,
}
```

### 6.7 Tests for 3b

**Unit tests:**
- `tests/unit/managed/tools.test.ts` — 22 tools total (9 read + 5 rules + 8 write). Positive assertion per tool name. Verifies the four name sets are disjoint and their union matches `MANAGED_TOOL_NAMES`.
- `tests/unit/managed/executor.test.ts` — one happy-path test per write tool with services mocked, one error-mapping test per new `POLICY_*` code, one `allowWrites=false` test per write tool
- `tests/unit/managed/prompt.test.ts` — Phase 3 expectations: no "read-only" lockdown, all 5 phases listed, confirm-before-write rule present, concurrency recovery rule present, policy-code recovery rule present
- `tests/unit/mcp/write/set-selected-call.test.ts`, `freeze-outline.test.ts`, `mark-section-stale.test.ts`, `reject-section.test.ts` — input validation, service call, error mapping for each new MCP handler

**Integration tests (real Anthropic SDK mock, real DB):**
- `tests/integration/managed/runtime-write-tool.test.ts` — synthetic stream emits `save_section_draft`; asserts service called, section row written, audit log entry present, `tool_result` event has `success: true`
- `tests/integration/managed/runtime-write-disabled.test.ts` — `allowWrites=false`; synthetic stream emits `save_section_draft`; executor blocks with targeted error; turn completes without DB writes
- `tests/integration/managed/runtime-concurrency-error.test.ts` — two parallel turns attempting to write to the same section; one succeeds, the other gets `CONCURRENCY` in `tool_result`; agent recovers via `get_application_state`
- `tests/integration/managed/runtime-policy-error.test.ts` — synthetic stream emits `save_section_draft` before outline frozen; executor returns `POLICY_OUTLINE_NOT_FROZEN`; turn completes; no section written

### 6.8 Estimated diff size

| Component | LOC |
|---|---|
| 4 new MCP handler files (~60 each) | ~240 |
| `write/index.ts` registration | ~10 |
| `managed/tools.ts` (entries + name sets) | ~90 |
| `managed/executor.ts` (dispatch + gates + mapping) | ~110 |
| `managed/prompt.ts` (full rewrite both languages) | ~150 |
| `route.ts` (writesEnabled + ctx field) | ~10 |
| `services/types.ts` (allowWrites field) | ~2 |
| New flag migration | ~15 |
| Tests (~20 files) | ~1,200 |

**Total:** ~1,800 LOC added, ~200 LOC modified.

---

## 7. 3c — Structured Action Bridge

**Goal:** Route all 7 `StructuredAction` variants through the managed runtime. Button clicks become deterministic tool executions. Remove the Phase 2 bypass guard.

**Risk:** HIGH. This is the change that unlocks real end-to-end managed mode and is the most likely to introduce subtle state bugs, history-shape issues, or runtime handoff mistakes.

**Rollback:** Revert the route guard change. Note the interaction with the two-flag kill-switch semantics in §9.2: with `managed_agent_writes_enabled=off`, action requests will return explicit managed-path errors (not V3 fallback). If a full V3 fallback for actions is required during a 3c rollback, BOTH flags must be disabled.

### 7.1 Architecture

**Rule**: structured action → deterministic mutation first → managed turn reacts second. The agent sees a pre-existing `tool_use` + `tool_result` pair in history and responds to the post-mutation state.

**Key invariant**: bridge errors become explicit SSE `error` events. There is no silent V3 fallback for action requests when `managed_agent_enabled=true`.

### 7.2 Action → tool mapping

Authoritative mapping encoded in `app/src/lib/ai/agent/managed/action-bridge.ts` as a pure dispatch function `planForAction`. Bilingual user messages inline.

| Action | Tool calls (in order) | User message (RO) | User message (EN) |
|---|---|---|---|
| `select_call { callId }` | `set_selected_call(callId)` | "Am selectat apelul {callId}. Te rog obține blueprint-ul, rulează verificarea de eligibilitate și propune schița." | "I selected call {callId}. Please fetch the blueprint, run eligibility, and propose the outline." |
| `approve_outline` | `freeze_outline()` | "Am aprobat schița. Te rog începe redactarea secțiunilor în ordinea de generare." | "I approved the outline. Please start drafting sections in generation order." |
| `accept_section { sectionKey }` | `approve_revision(sectionKey)` | "Am acceptat secțiunea '{sectionKey}'. Te rog continuă cu următoarea secțiune." | "I accepted section '{sectionKey}'. Please continue with the next section." |
| `regenerate_section { sectionKey, feedback }` | `mark_section_stale(sectionKey)` | "Vreau să regenerez secțiunea '{sectionKey}'. Feedback: {feedback}" | "I want to regenerate section '{sectionKey}'. Feedback: {feedback}" |
| `reject_section { sectionKey, reason }` | `reject_section(sectionKey, reason)` | "Am respins secțiunea '{sectionKey}': {reason}" | "I rejected section '{sectionKey}': {reason}" |
| `request_refresh` | *(none — bridged message only)* | "Te rog reîncarcă starea curentă a aplicației via `get_application_state` și continuă." | "Please refresh the current application state via `get_application_state` and continue." |
| `mark_complete` | `set_application_status('completed')` | "Am marcat aplicația ca finalizată. Te rog confirmă starea finală." | "I marked the application complete. Please confirm the final state." |

### 7.3 Bridge module

**New file: `app/src/lib/ai/agent/managed/action-bridge.ts`**

Core exports:

```typescript
export interface BridgeSuccess {
  success: true
  bridgedMessage: string
  toolsExecuted: string[]
}

export interface BridgeFailure {
  success: false
  error: {
    code: string
    message: string
    retryable: boolean
    toolName?: string
  }
}

export type BridgeResult = BridgeSuccess | BridgeFailure

export async function bridgeStructuredAction(input: {
  action: StructuredAction
  session: AgentSession
  serviceCtx: ServiceContext
  locale: 'ro' | 'en'
}): Promise<BridgeResult>
```

Bridge execution steps:
1. Call `planForAction(action, locale)` — pure function returning `{ toolCalls, userMessage }` or `{ rejection }` for unknown action types.
2. If `rejection`, return `{ success: false, error: { code: 'UNKNOWN_ACTION', ... } }` **without persisting any synthetic history** — per §7.5's persistence rule.
3. For each `call` in `plan.toolCalls`:
   - Merge `{ expectedStateVersion: session.stateVersion }` into the tool input
   - Build a synthetic `ToolUseBlock` with `id: tu_action_<uuid>`
   - Call `executeManagedTool(block, serviceCtx)` — same path the managed runtime uses
   - **If the executor produced a structured result (success or structured error)**, persist the synthetic pair via `persistSyntheticPair` (per §7.5)
   - If the result is an error, return `{ success: false, error: parsePolicyCode(result.content) }`
4. After the last successful tool call, return `{ success: true, bridgedMessage: plan.userMessage, toolsExecuted }`
5. **Session reload is the route handler's responsibility**, not the bridge's — the bridge returns and the route reloads once before dispatching `runManagedWithSSE`.

For `request_refresh` specifically, the plan has `toolCalls: []` — the bridge returns success immediately with the bridged message. No synthetic history persisted.

### 7.4 `parsePolicyCode` helper

Maps a tool error content string to a structured error with known prefixes:

```typescript
export function parsePolicyCode(content: string): { code: string; message: string; retryable: boolean } {
  // POLICY_* → non-retryable domain error
  if (content.startsWith('POLICY_')) {
    const [code, ...rest] = content.split(': ')
    return { code, message: rest.join(': '), retryable: false }
  }
  // CONCURRENCY → retryable (stateVersion mismatch; refresh will fix it)
  if (content.startsWith('CONCURRENCY')) {
    return { code: 'CONCURRENCY', message: content, retryable: true }
  }
  // NOT_FOUND → non-retryable
  if (content.startsWith('NOT_FOUND')) {
    return { code: 'NOT_FOUND', message: content, retryable: false }
  }
  // VALIDATION:<field> → non-retryable (input shape error)
  if (content.startsWith('VALIDATION:')) {
    const match = content.match(/^VALIDATION:(\S+)\s*(.*)$/)
    return {
      code: `VALIDATION:${match?.[1] ?? 'unknown'}`,
      message: match?.[2] ?? content,
      retryable: false,
    }
  }
  return { code: 'UNKNOWN_ERROR', message: content, retryable: false }
}
```

### 7.5 Synthetic history persistence

**Rule**: *Persist synthetic history only when the executor actually produced a structured result.*

Persist the synthetic pair iff:
- The bridge reached `executeManagedTool` for this call AND
- The executor returned a structured result (`ExecutorResult`) — whether `isError=false` or `isError=true` with a known error code like `POLICY_*`, `CONCURRENCY`, `NOT_FOUND`, `VALIDATION:*`

Do NOT persist when:
- `planForAction` returned a `rejection` (no tool execution ever happened)
- Bridge internal crashes before the executor call
- Session reload fails before dispatching (bridge returns `SESSION_LOST`)
- `request_refresh` (no tool calls by design)

The helper `persistSyntheticPair` writes two rows to `agent_messages`:

```typescript
async function persistSyntheticPair(
  sessionId: string,
  block: ToolUseBlock,
  result: ExecutorResult,
): Promise<void> {
  await appendManagedMessage(sessionId, {
    role: 'assistant',
    messageType: 'tool_use',
    content: [block],
    toolCallId: block.id,
    toolName: block.name,
  }, {
    runtimeMode: 'managed',
    provider: 'action_bridge',   // distinct from 'anthropic' — tags origin
    model: null,
  })

  await appendManagedMessage(sessionId, {
    role: 'user',
    messageType: 'tool_result',
    content: [{
      type: 'tool_result',
      tool_use_id: block.id,
      content: result.content,
      is_error: result.isError,
    }],
    toolCallId: block.id,
    toolName: block.name,
  }, {
    runtimeMode: 'managed',
    provider: 'action_bridge',
    model: null,
  })
}
```

**Why `provider='action_bridge'`**: explicit origin marker. Observability dashboards, triage queries, and audit analysis can distinguish model-authored tool calls from synthetic UI-driven ones. This is a first-class observability concern, not noise.

### 7.6 Route handler changes

In `app/src/app/api/ai/agent/route.ts`:

**Remove** the `hasStructuredAction` guard and the `structured action request — routing to V3 ...` log line. Add one commit message note that the guard was introduced in commit fc2f1d7 and removed in 3c.

**New handler flow:**

```typescript
const managedReadEnabled = await isFeatureEnabled('managed_agent_enabled', { userId: user.id })
const managedWriteEnabled = await isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id })

if (managedReadEnabled) {
  // Circuit breaker check (existing code)
  // Pre-construction Anthropic client check (existing code)

  if (body.action) {
    if (!managedWriteEnabled) {
      // Per Invariant 6: writes-off does NOT restore V3 for actions.
      // Return explicit SSE error.
      return sseError(
        'Structured actions are not available on your account yet. Writes are rolled out separately from reads.',
        { retryable: false },
      )
    }

    const serviceCtx = {
      userId: user.id,
      sessionId: session.id,
      projectId: session.projectId ?? undefined,
      requestId: body.requestId,
      now: new Date(),
      allowWrites: true,
    }

    const bridgeResult = await bridgeStructuredAction({
      action: body.action,
      session,
      serviceCtx,
      locale: body.locale,
    })

    if (!bridgeResult.success) {
      log.warn({
        sessionId: session.id,
        userId: user.id,
        action: body.action.type,
        code: bridgeResult.error.code,
      }, 'action bridge failed')

      return sseError(bridgeResult.error.message, {
        retryable: bridgeResult.error.retryable,
      })
    }

    // Capture action type BEFORE clearing body.action
    const actionType = body.action.type

    // Reload session once after the full bridge — bridge tools may have
    // mutated selectedCallId, outlineFrozen, stateVersion, etc.
    session = await reloadSessionOrThrow(session.id, user.id)
    sections = await loadSections(session.id)

    // Merge bridged message with any user-typed text
    body.message = body.message
      ? `${bridgeResult.bridgedMessage}\n\n${body.message}`
      : bridgeResult.bridgedMessage
    body.action = undefined  // consumed

    // Update observability
    try {
      await updateLastActionBridge(session.id, user.id, actionType)
    } catch { /* non-fatal */ }
  }

  return runManagedWithSSE(session, sections, body, user)
}

// Both flags off → V3 (unchanged)
return runV3WithSSE(session, sections, body, user)
```

`sseError(message, opts)` is a small helper that constructs a one-event SSE response stream — same shape as `runManagedWithSSE` error handling but without the full runtime machinery.

### 7.7 Observability column addition

Add `application_agent_sessions.last_action_bridge_at` (nullable timestamp) in a new migration. Set by `updateLastActionBridge` whenever a bridge runs successfully.

Dashboard query potential: "how many sessions are driving real actions via managed vs. just chatting".

### 7.8 Error surface table

| Error category | Source | SSE event |
|---|---|---|
| `POLICY_*` | Bridge tool execution | `{ type: 'error', message, retryable: false }` |
| `CONCURRENCY` | Bridge tool execution | `{ type: 'error', message, retryable: true }` |
| `NOT_FOUND` | Bridge tool execution | `{ type: 'error', message, retryable: false }` |
| `VALIDATION:*` | Bridge tool input validation | `{ type: 'error', message, retryable: false }` |
| `UNKNOWN_ACTION` | `planForAction` default | `{ type: 'error', message, retryable: false }` |
| `SESSION_LOST` | Session reload after bridge | `{ type: 'error', message, retryable: false }` |
| Writes flag off + action present | Route handler | `{ type: 'error', message, retryable: false }` |
| Managed flag off | Route handler | V3 fallback (action was never going to managed) |
| Managed turn fails after successful bridge | `runManagedWithSSE` | Existing managed-turn error handling |

### 7.9 Tests for 3c

**Unit tests:**
- `tests/unit/managed/action-bridge-plan.test.ts` — `planForAction` mapping for every `StructuredAction` variant in both locales
- `tests/unit/managed/action-bridge.test.ts` — bridge execution with mocked executor: success, policy error, concurrency error, unknown action, `request_refresh` no-tool path
- `tests/unit/managed/action-bridge-persist.test.ts` — `persistSyntheticPair` writes two rows with `provider='action_bridge'`, correct roles, correct content shape
- `tests/unit/managed/action-bridge-persistence-rule.test.ts` — verifies the split rule: persist on executor-produced result (success or structured error), skip on planning failures, bridge crashes, `SESSION_LOST`, `request_refresh`
- `tests/unit/managed/parse-policy-code.test.ts` — handles all four prefixes (`POLICY_*`, `CONCURRENCY`, `NOT_FOUND`, `VALIDATION:*`) and unknown fallback

**Integration tests (real DB, Anthropic SDK mocked):**
- `tests/integration/managed/bridge-select-call.test.ts`
- `tests/integration/managed/bridge-approve-outline.test.ts`
- `tests/integration/managed/bridge-accept-section.test.ts`
- `tests/integration/managed/bridge-regenerate-section.test.ts`
- `tests/integration/managed/bridge-reject-section.test.ts`
- `tests/integration/managed/bridge-request-refresh.test.ts`
- `tests/integration/managed/bridge-mark-complete.test.ts`
- `tests/integration/managed/bridge-policy-error.test.ts` — approve_outline before eligibility → `POLICY_ELIGIBILITY_NOT_PASSED` SSE error, no managed turn
- `tests/integration/managed/bridge-concurrency-error.test.ts` — stale stateVersion simulated → `retryable: true` SSE error
- `tests/integration/managed/bridge-writes-flag-off.test.ts` — managed read flag on, write flag off, action present → explicit SSE error (not V3 fallback, not silent)
- `tests/integration/managed/bridge-history-visible.test.ts` — after a successful bridge + managed turn, `loadManagedHistory` returns the synthetic pair AND subsequent agent-authored content in correct sequence

**E2E test:**
- `tests/integration/managed/e2e-discovery-to-complete.test.ts` — scripted 7-action sequence: `select_call` → free-text question about blueprint → `approve_outline` → free-text request to draft first section → `accept_section` × 2 → `mark_complete`. Asserts end state: all sections accepted, `session.status='completed'`, audit chain intact, no V3 fallback triggered at any step.

**Phase 2 test rename:**
- `tests/integration/managed/route-action-bypass.test.ts` → `route-action-bridge-flag-gate.test.ts`. The test now verifies the **inverse** of what Phase 2 tested: with `managed_agent_writes_enabled=false`, action requests return an explicit managed-path error (not V3 fallback).

### 7.10 Estimated diff size

| Component | LOC |
|---|---|
| `action-bridge.ts` (plan + execute + parsePolicyCode + persistSyntheticPair) | ~400 |
| Route handler changes | ~60 modified, ~10 removed |
| Schema: `last_action_bridge_at` column + migration | ~10 |
| Tests (~15 files) | ~1,800 |

**Total:** ~2,270 LOC added, ~60 LOC modified, ~10 LOC removed.

---

## 8. 3d — Quality Comparison Harness

**Goal:** Satisfy the Phase 3 success criterion: *"Draft quality >= V3 baseline (human evaluation, 10 test cases)."*

**Risk:** LOW. Measurement only, no production impact.

### 8.1 Files

- `app/scripts/phase3-quality-eval.ts` — driver script
- `app/scripts/phase3-quality-eval/fixtures/` — 10 seed project specs + 10 call IDs
- `app/scripts/phase3-quality-eval/rubric.md` — the scoring rubric
- `docs/superpowers/specs/2026-04-10-managed-agents-phase3-quality-results.md` — results output, committed after human rating
- `docs/runbooks/managed-agent-phase3.md` — operational runbook

### 8.2 Script behavior

1. For each of the 10 fixtures:
   - Create a fresh session in an isolated eval database namespace (e.g., `eval_phase3_<timestamp>`)
   - Run a scripted 7-step flow through V3 (flag off) and through managed (both flags on)
   - Steps: `select_call` → `approve_outline` → draft 3 sections → accept 2 → `mark_complete` (or stop if blocked)
   - Capture all draft contents, final validation reports, tool call counts, token usage, latency
2. Output: side-by-side CSV + markdown per fixture
3. Human reviewer rates each section pair across 5 rubric dimensions
4. Aggregate scores committed to `phase3-quality-results.md`

### 8.3 Run metadata

Every quality eval run must record in the results file header:
- Commit SHA
- Prompt version hash (SHA of `managed/prompt.ts` at run time)
- Fixture version (SHA of `fixtures/` directory)
- Reviewer initials
- Run date (ISO 8601)
- V3 runtime SHA + managed runtime SHA
- Anthropic model used (should be locked for the comparison)

Without this header, a results file is invalid and must not be merged.

### 8.4 Rubric (1-5 per dimension, per section pair)

| Dimension | 5 = excellent | 1 = unusable |
|---|---|---|
| **Structure adherence** | Matches call blueprint's required structure exactly | Missing or ignores structure |
| **Source grounding** | Every factual claim cited, sources relevant | Invented facts, no citations |
| **Length targets** | Within spec range (short/medium/long) | Wildly over or under |
| **Romanian idiom quality** | Native-level bureaucratic Romanian | Awkward, translated-feeling, errors |
| **Specificity** | Concrete numbers, timelines, metrics | Generic filler |

### 8.5 Pass rule (tight)

Phase 3 quality check passes iff **all three** conditions hold:

1. **No dimension regresses by more than 0.5.** For each dimension, `managed_mean_score - v3_mean_score >= -0.5`.
2. **Aggregate managed score is at parity or better.** `sum(managed_dimension_means) >= sum(v3_dimension_means)`.
3. **Differences within ±0.3 are treated as noise.** Any dimension with `|managed - v3| <= 0.3` is counted as equal when computing the aggregate.

Any dimension regressing by more than 0.5 blocks Phase 3 sign-off and requires remediation (prompt tuning, retrieval tuning, or scope revision) before Phase 4 starts. Phase 3 code stays shipped regardless; 3d is a Phase 4 gate, not a Phase 3 code-correctness gate.

### 8.6 Operational prerequisites

Before running the eval:
- Both flags enabled **only** for the eval user set
- Clean staging dataset or isolated namespace
- Fixed prompt/tool/model versions recorded in the output header
- Eval user set does not overlap with active production pilots (prevents data contamination)

### 8.7 Who runs the eval

One or two team members with Romanian fluency and EU funding context. Expected duration: ~3 hours per reviewer. Reviewer initials committed with results.

### 8.8 Why not automated LLM-as-judge

LLM-as-judge has known biases when evaluating LLM output from similar architectures (especially same model family). The spec calls for human evaluation deliberately. An automated LLM-judge pass MAY be run as a sanity check, but the committed score is always human.

### 8.9 Remediation matrix

| Regression dimension | Likely cause | Remediation |
|---|---|---|
| Structure adherence | Prompt doesn't emphasize blueprint | Prompt fix: add explicit "always match blueprint.requiredSections" rule |
| Source grounding | Agent not calling `retrieve_evidence` enough | Prompt fix: require evidence retrieval before every draft; retrieval tuning |
| Length targets | Prompt doesn't encode length targets | Prompt fix: pass section expected length from blueprint into context |
| Romanian idiom | System prompt language register mismatched | Prompt fix: add example corpus; adjust register instructions |
| Specificity | Retrieval quality low | Retrieval tuning: increase chunk count, adjust filtering |

If no remediation fixes the regression in a reasonable timeframe, Phase 4 rollout is delayed but Phase 3 code stays shipped — the write path still works; the quality bar just isn't met yet.

---

## 9. Feature Flags & Rollout

### 9.1 Two-flag model

| Flag | Default | Controls | Phase | Emergency rollback |
|---|---|---|---|---|
| `managed_agent_enabled` | off | Phase 2 read-only pilot (existing) | 2 | Flip off → all managed sessions revert to V3 |
| `managed_agent_writes_enabled` | off | Phase 3 write surface: write tools in executor + structured action bridge | 3 | Flip off → writes rejected via tool result, structured actions return explicit error |

**Rollout order** — logically sequenced but independently togglable:

1. `managed_agent_enabled` → enterprise tier (Phase 2 shipped)
2. `managed_agent_writes_enabled` → 1 pilot user (self, lead, dogfooding engineer)
3. `managed_agent_writes_enabled` → 2-3 internal pilot users
4. `managed_agent_writes_enabled` → enterprise tier
5. `managed_agent_enabled` → pro tier (Phase 4)
6. `managed_agent_writes_enabled` → pro tier (Phase 4)

### 9.2 Emergency kill switches

**Disable writes while keeping reads:**
```sql
UPDATE feature_flags SET enabled = false WHERE key = 'managed_agent_writes_enabled';
```

Takes effect within 60 seconds (LRU cache TTL).

**Disable all managed traffic:**
```sql
UPDATE feature_flags SET enabled = false WHERE key = 'managed_agent_enabled';
```

**Write-flag-off kill-switch semantics** — this is a critical operational distinction:

> Disabling `managed_agent_writes_enabled` does **not** restore action fallback to V3. It intentionally returns explicit managed-path errors for action requests when `managed_agent_enabled` is still on. The only way to restore V3-handled structured actions is to disable BOTH flags.

This matches Invariant 6. Reviewers, operators, and the runbook must all understand this: the write flag is a writes gate, not an action fallback switch.

### 9.3 Rollout timeline (sequence, not dates)

Each arrow = "previous must be verified in production before next starts".

```
3a (services + policy gates + V3 audit)
   ↓  verify: unit + integration tests green, V3 regression suite green, audit findings documented
3b (MCP handlers + managed tool exposure + prompt + writes flag, flag off)
   ↓  verify: 3a deployed, 3b tests green, local smoke test with write flag on for self
   ↓  enable write flag for 1 pilot user → observe 1-2 days
3c (structured action bridge, unused until write flag enabled)
   ↓  verify: 3c tests green, full E2E test passes, bridge dry-run in staging
   ↓  enable write flag for same pilot user
3d (quality comparison harness run)
   ↓  verify: rubric pass rule met; results committed
   ↓  expand write flag to 2-3 internal pilots → observe
   ↓  expand to enterprise tier
   ↓  Phase 3 complete

Phase 4 starts
```

---

## 10. Observability

### 10.1 New DB columns

- `agent_sections.rejection_reason` — text, nullable (3a)
- `application_agent_sessions.last_action_bridge_at` — timestamp, nullable (3c)

### 10.2 Log lines

- Executor: `'managed write tool executed'` — tool name, latency, success, policy code if error
- Bridge: `'action bridge executed'` — action type, tools executed, outcome, latency
- Bridge: `'action bridge failed'` — action type, tool name, code, session ID
- Route: existing managed/degraded log lines unchanged

### 10.3 Metrics

New Prometheus metrics (additive, no changes to existing):

- `managed_write_tool_total{tool, outcome}` — counter; outcome ∈ `{success, policy_error, concurrency_error, not_found, validation_error, unknown_error}`
- `managed_write_tool_duration_ms{tool}` — histogram
- `managed_action_bridge_total{action_type, outcome, code}` — counter; includes error code dimension for triage (instead of just `outcome=policy_error` with no visibility into which gate fired)
- `managed_action_bridge_duration_ms{action_type}` — histogram
- `managed_policy_violation_total{tool, code}` — counter tracking which gates are firing

The `code` label on the bridge counter is important: policy-error alone is too coarse when debugging rollout pain. Seeing `code=POLICY_OUTLINE_NOT_FROZEN` spike tells you instantly that users are clicking accept/regenerate before outline is frozen.

### 10.4 Audit integrity check

CI job runs `verifyAuditChainIntegrity()` against a seeded test database after a scripted Phase 3 flow (select_call → freeze_outline → save draft → approve → mark complete). Catches any future change that breaks the hash chain.

### 10.5 Runbook

`docs/runbooks/managed-agent-phase3.md` covers:

- How to enable/disable each flag and the operational implications (especially the write-flag kill-switch semantics — "does not restore V3 fallback for actions")
- How to triage bridge failures by error code
- How to read the observability dashboards
- How to roll back each of 3a/3b/3c/3d
- **How to identify `provider='action_bridge'` rows vs. `provider='anthropic'` rows in `agent_messages`** — critical for triage
- How to run the quality eval script and interpret results
- Known issues and workarounds (populated over time)

---

## 11. Testing Strategy

### 11.1 Test pyramid across all 4 PRs

| Layer | Count | Scope |
|---|---|---|
| Unit tests | ~50 files, ~3,000 LOC | Policy matrix, services, managed tools, executor, prompt, bridge planning, error mapping, name-set invariants |
| Integration (DB-backed) | ~30 files, ~4,000 LOC | Each write service end-to-end, each MCP handler end-to-end, each action bridge end-to-end, concurrency scenarios, audit chain verification |
| Full E2E | 1 file, ~400 LOC | Scripted 7-action flow from discovery to `mark_complete` |
| Quality eval | 10 fixtures, human-rated | See §8 |

### 11.2 V3 regression coverage

Existing V3 test files stay untouched. The only V3-adjacent change is the V3 audit (part of 3a). If the audit finds a V3 bug, it lands in a **separate small PR before 3a** — never mixed into 3a's diff. This keeps 3a's rollback story clean and the V3 fix reviewable on its own merits.

### 11.3 Manual smoke tests before each PR merges

- **3a**: Seed DB → call each service directly via a script → verify audit rows → verify policy gate rejections for each `POLICY_*` code
- **3b**: Seed DB → run managed turn with a prompt that asks the agent to save a draft → verify DB state + audit + observability → verify write flag gate
- **3c**: Run the full 7-action flow locally against staging → verify end state → verify `provider='action_bridge'` rows in `agent_messages`
- **3d**: Run the quality eval script → spot-check 2 fixtures manually to validate the output before the human rating pass

---

## 12. "Done" Definition for Phase 3

Phase 3 is done when **all** of the following are true:

1. 3a, 3b, 3c, 3d all merged to master
2. V3 regression suite green after each merge
3. `managed_agent_writes_enabled` enabled for at least 3 users in production for at least 3 days without any `managed_action_bridge_total{outcome=unknown_error}` incidents
4. Quality eval committed with managed scores meeting the §8.5 pass rule
5. Audit chain integrity verified end-to-end (CI job green)
6. Runbook `docs/runbooks/managed-agent-phase3.md` committed and reviewed by an operator
7. **At least one successful write-flag kill-switch drill performed in staging or production-preview.** Not because the feature is unsafe, but because it proves the operational story actually works: the operator can flip the flag, observe the effect, confirm writes stop, confirm reads continue, confirm structured actions return explicit errors (not silent V3 fallback), and flip it back.

---

## 13. Documentation Deliverables

- `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md` — this spec
- `docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md` — policy matrix (co-located with 3a)
- `docs/superpowers/specs/2026-04-10-managed-agents-phase3-quality-results.md` — quality eval results (committed as part of 3d)
- `docs/runbooks/managed-agent-phase3.md` — operational runbook (committed as part of 3d)
- `docs/superpowers/plans/2026-04-10-managed-agents-phase3a.md` — 3a implementation plan (next step after spec approval)
- `docs/superpowers/plans/2026-04-10-managed-agents-phase3b.md` — 3b plan (after 3a merges)
- `docs/superpowers/plans/2026-04-10-managed-agents-phase3c.md` — 3c plan (after 3b merges)
- `docs/superpowers/plans/2026-04-10-managed-agents-phase3d.md` — 3d plan (after 3c merges)

No updates to root `CLAUDE.md`. Phase 3 is a scoped feature, not a durable project guideline.

---

## Appendix A: Error Code Vocabulary

Complete list of stable error codes introduced or referenced in Phase 3.

| Code | Raised by | Category | Retryable |
|---|---|---|---|
| `POLICY_NO_CALL_SELECTED` | `freezeOutline` | Policy | No |
| `POLICY_OUTLINE_ALREADY_FROZEN` | `setSelectedCall`, `freezeOutline` | Policy | No |
| `POLICY_OUTLINE_NOT_FROZEN` | `saveSectionDraft`, `approveSection`, `rollbackSection`, `markSectionStale`, `rejectSection` | Policy | No |
| `POLICY_ELIGIBILITY_NOT_PASSED` | `freezeOutline`, `saveSectionDraft` | Policy | No |
| `POLICY_SECTION_WRONG_STATE` | `approveSection`, `markSectionStale`, `rejectSection` | Policy | No |
| `POLICY_VALIDATION_NOT_PASSED` | `setApplicationStatus('completed')` | Policy | No |
| `CONCURRENCY` | all write services | Concurrency | Yes |
| `NOT_FOUND` | all write services | Not-found | No |
| `VALIDATION:<field>` | Zod input validation | Input validation | No |
| `SESSION_LOST` | Bridge session reload | Bridge | No |
| `UNKNOWN_ACTION` | `planForAction` default case | Bridge | No |

## Appendix B: V3 → Managed Structured Action Mapping

Summary of how each `StructuredAction` is handled:

| V3 behavior | Managed behavior (3c) |
|---|---|
| `select_call` → `SET_SELECTED_CALL` transition + LLM | Bridge calls `setSelectedCall` service → synthetic `(tool_use, tool_result)` in history → managed turn runs with bridged user msg |
| `approve_outline` → `FREEZE_OUTLINE` + `SET_PHASE('drafting')` + LLM | Bridge calls `freezeOutline` service → synthetic pair → managed turn |
| `accept_section` → `ACCEPT_SECTION` + skipLLM | Bridge calls `approveSection` service → synthetic pair → managed turn (bridged msg asks agent to continue to next section) |
| `regenerate_section` → `MARK_SECTION_STALE` + LLM | Bridge calls `markSectionStale` service → synthetic pair → managed turn (bridged msg includes feedback) |
| `reject_section` → `REJECT_SECTION` + skipLLM | Bridge calls `rejectSection` service → synthetic pair → managed turn |
| `request_refresh` → no transition + LLM | Bridge returns no-tool success → managed turn with bridged user msg instructing `get_application_state` |
| `mark_complete` → `SET_STATUS('completed')` + skipLLM | Bridge calls `setApplicationStatus('completed')` service → synthetic pair → managed turn (bridged msg requests final confirmation) |

## Appendix C: Files Changed

**New files (3a)**
- `app/src/lib/ai/agent/policy/matrix.ts`
- `app/src/lib/ai/agent/policy/enforce.ts`
- `app/tests/unit/services/policy-matrix.test.ts`
- `app/tests/unit/services/set-selected-call.test.ts`
- `app/tests/unit/services/freeze-outline.test.ts`
- `app/tests/unit/services/mark-section-stale.test.ts`
- `app/tests/unit/services/reject-section.test.ts`
- `app/tests/unit/services/policy-matrix-coverage.test.ts`
- `app/tests/unit/policy/matrix-docs-sync.test.ts`
- `app/tests/integration/services/phase3-concurrency.test.ts`
- `app/tests/integration/services/phase3-audit-chain.test.ts`
- `app/drizzle/NNNN_agent_sections_phase3_columns.sql`
- `docs/superpowers/specs/2026-04-10-managed-agents-phase3-policy-matrix.md`

**Modified files (3a)**
- `app/src/lib/ai/agent/services/sections.ts` — existing policy additions + 2 new functions
- `app/src/lib/ai/agent/services/application.ts` — existing policy additions + 2 new functions
- `app/src/lib/ai/agent/services/errors.ts` — `ValidationError.policyCode` field
- `app/src/lib/db/schema.ts` — `rejection_reason` column + `'stale'` enum value
- `app/tests/unit/services/sections.test.ts` — negative tests per new gate
- `app/tests/unit/services/application.test.ts` — negative tests per new gate

**New files (3b)**
- `app/src/lib/ai/agent/mcp/write/set-selected-call.ts`
- `app/src/lib/ai/agent/mcp/write/freeze-outline.ts`
- `app/src/lib/ai/agent/mcp/write/mark-section-stale.ts`
- `app/src/lib/ai/agent/mcp/write/reject-section.ts`
- `app/drizzle/NNNN_managed_agent_writes_enabled_flag.sql`
- `app/tests/unit/managed/prompt.test.ts` updates (or new file)
- `app/tests/unit/mcp/write/set-selected-call.test.ts` (+ 3 more)
- `app/tests/integration/managed/runtime-write-tool.test.ts`
- `app/tests/integration/managed/runtime-write-disabled.test.ts`
- `app/tests/integration/managed/runtime-concurrency-error.test.ts`
- `app/tests/integration/managed/runtime-policy-error.test.ts`

**Modified files (3b)**
- `app/src/lib/ai/agent/managed/tools.ts` — rename, add 8 entries, add 4 name sets
- `app/src/lib/ai/agent/managed/executor.ts` — dispatch cases, gate, error mapping, truncation fallback
- `app/src/lib/ai/agent/managed/prompt.ts` — full rewrite
- `app/src/lib/ai/agent/mcp/write/index.ts` — register 4 new handlers
- `app/src/lib/ai/agent/services/types.ts` — `allowWrites` field
- `app/src/app/api/ai/agent/route.ts` — `writesEnabled` flag read
- `app/src/messages/ro.json`, `en.json` — new i18n keys if any

**New files (3c)**
- `app/src/lib/ai/agent/managed/action-bridge.ts`
- `app/drizzle/NNNN_app_agent_sessions_last_action_bridge_at.sql`
- `app/tests/unit/managed/action-bridge-plan.test.ts`
- `app/tests/unit/managed/action-bridge.test.ts`
- `app/tests/unit/managed/action-bridge-persist.test.ts`
- `app/tests/unit/managed/action-bridge-persistence-rule.test.ts`
- `app/tests/unit/managed/parse-policy-code.test.ts`
- `app/tests/integration/managed/bridge-*.test.ts` (×10)
- `app/tests/integration/managed/e2e-discovery-to-complete.test.ts`

**Modified files (3c)**
- `app/src/app/api/ai/agent/route.ts` — remove `hasStructuredAction` guard, add bridge dispatch, add `sseError` helper
- `app/src/lib/ai/agent/managed/session-metadata.ts` — add `updateLastActionBridge`
- `app/tests/integration/managed/route-action-bypass.test.ts` → renamed to `route-action-bridge-flag-gate.test.ts` with inverted assertions

**New files (3d)**
- `app/scripts/phase3-quality-eval.ts`
- `app/scripts/phase3-quality-eval/fixtures/*.json` (10 files)
- `app/scripts/phase3-quality-eval/rubric.md`
- `docs/superpowers/specs/2026-04-10-managed-agents-phase3-quality-results.md`
- `docs/runbooks/managed-agent-phase3.md`

**Total rough estimate across all 4 PRs:** ~5,300 LOC added, ~280 LOC modified, ~10 LOC removed.
