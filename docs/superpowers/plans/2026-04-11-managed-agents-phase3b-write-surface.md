# Managed Agents Phase 3b (PR-A) — Write Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Prerequisite:** History normalizer PR merged first. `managed_agent_writes_enabled` must not be enabled before the normalizer lands. See `2026-04-11-managed-agents-phase3b-history-normalizer.md` (PR-B).

**Goal:** Expose the 8 Phase 3 write tools through the managed runtime behind a new `managed_agent_writes_enabled` feature flag, add a runtime-level parallel-write cap for safety, and land a minimal prompt delta describing the new tools and the hard rules. The full bilingual prompt rewrite is deferred to a later PR if pilot behavior shows it's needed.

**Architecture:** Phase 3a services are the authoritative enforcement point. This PR is a *thin* wiring layer on top of them:
- 4 new MCP write handlers + 4 updated MCP write handlers (policyCode propagation + named exports)
- Managed runtime `tools.ts` expanded from 14 → 22 tools, organized into 4 disjoint tool-name sets
- Managed executor gets 8 new dispatch cases, an `allowWrites` gate, extended error mapping, a write-tool observability log line, and a **runtime-level cap on multiple writes per assistant message**
- `ServiceContext.allowWrites` is the rollout control (executor-only; services ignore it)
- Managed system prompt gains **minimal delta**: the 8 write tools, the 4 hard rules. No bilingual rewrite.

**Tech Stack:** TypeScript, Anthropic SDK (stable `resources/messages`), Drizzle ORM + postgres.js, Vitest, existing managed runtime conventions (`lib/ai/agent/managed/`), existing MCP handler envelope (`lib/ai/agent/mcp/write/`).

**Spec:** `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md` §6 (scope narrowed: §6.5 is in PR-B)

**Prerequisites:**
- Phase 3a merged (PR #18)
- Phase 3a V3 fix merged (PR #45)
- **PR-B history normalizer merged** — this is non-negotiable. Without PR-B, V3→managed session transitions replay mangled content into Claude, and enabling writes could produce duplicate drafts, double-audits, or retry loops.

**Non-goals (explicit):**
- No structured action support in managed runtime — the route-level `body.action != null → V3` guard from Phase 2 stays in place; 3c lifts it
- No `create_export_snapshot` or `save_call_blueprint` exposure — Phase 4 scope
- No full bilingual prompt rewrite — minimal delta only
- No frontend changes
- No V3 runtime changes
- No history normalizer changes — PR-B scope
- No quality comparison harness — 3d

---

## Desk audit fixes applied to this plan

Two of the four desk audit findings from the original combined plan land in this PR-A:

- **Finding 1 (runtime-level parallel-write cap):** the original plan relied on a prompt-only "no parallel writes" rule, but `runtime.ts:163-201` iterates `toolBlocksToExecute` with zero cap. A misbehaving model response could emit multiple write tool_use blocks in one assistant message and the executor would run all of them serially against stale state. Prompt text is advisory; enforcement must be in code. This plan adds **Task 18**: a runtime-level cap that executes only the first write and returns a synthetic `PARALLEL_WRITE_BLOCKED` tool_result for subsequent writes in the same assistant message. Non-write tools still execute normally alongside the first write. This preserves the first legitimate write and gives the agent a recoverable signal.
- **Finding 4 (correct executor API in tests):** the original plan's test skeletons referenced a nonexistent `executeToolCall(name, input, ctx)` function with `result.content[0].text` access. The actual export in `app/src/lib/ai/agent/managed/executor.ts:67` is `executeManagedTool(block: ToolUseBlock, ctx: ServiceContext)` returning `ExecutorResult { content: string, isError: boolean, toolName: string, latencyMs: number, truncated?: boolean }`. Every test snippet in this plan that touches the executor uses the correct surface.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `app/src/lib/ai/agent/mcp/write/set-selected-call.ts` | MCP envelope for `set_selected_call`; wraps `setSelectedCall` service. Exports `inputShape` + `inputSchema`. |
| `app/src/lib/ai/agent/mcp/write/freeze-outline.ts` | MCP envelope for `freeze_outline`. |
| `app/src/lib/ai/agent/mcp/write/mark-section-stale.ts` | MCP envelope for `mark_section_stale`. |
| `app/src/lib/ai/agent/mcp/write/reject-section.ts` | MCP envelope for `reject_section`. |
| `app/drizzle/NNNN_managed_agent_writes_enabled_flag.sql` | Seed the new `managed_agent_writes_enabled` feature flag, disabled by default, empty targeting. |
| `app/tests/unit/mcp/write/set-selected-call.test.ts` | Input validation, service call, error mapping including `policyCode`. |
| `app/tests/unit/mcp/write/freeze-outline.test.ts` | Same. |
| `app/tests/unit/mcp/write/mark-section-stale.test.ts` | Same. |
| `app/tests/unit/mcp/write/reject-section.test.ts` | Same. |
| `app/tests/unit/managed/tools.test.ts` | 22 tools total (9 read + 5 rules + 8 write); four name sets disjoint; union matches `MANAGED_TOOL_NAMES`. |
| `app/tests/unit/managed/executor-write-dispatch.test.ts` | One happy-path dispatch test per write tool with services mocked. |
| `app/tests/unit/managed/executor-policy-code-mapping.test.ts` | One error-mapping test per new `POLICY_*` code. |
| `app/tests/unit/managed/executor-allow-writes-gate.test.ts` | One `allowWrites=false` test per write tool. |
| `app/tests/unit/managed/runtime-parallel-write-cap.test.ts` | Runtime cap: assistant message with 2 writes → first executes, second returns `PARALLEL_WRITE_BLOCKED`. Non-writes still execute. |
| `app/tests/unit/managed/prompt-delta.test.ts` | Phase 3 minimal delta: all 8 write tool names appear, the 4 hard rules present. Backwards compat: no Phase 2 strings removed other than the "read-only" lockdown. |
| `app/tests/integration/managed/runtime-write-tool.test.ts` | Real DB + mocked Anthropic stream: `save_section_draft` writes the section, emits audit, returns `tool_result` with `is_error=false`. |
| `app/tests/integration/managed/runtime-write-disabled.test.ts` | `allowWrites=false`; `save_section_draft` blocks before dispatch; no DB writes. |
| `app/tests/integration/managed/runtime-policy-error.test.ts` | `save_section_draft` before outline frozen → `POLICY_OUTLINE_NOT_FROZEN`; turn completes; no section written. |
| `app/tests/integration/managed/runtime-parallel-write-end-to-end.test.ts` | Real runtime loop: synthetic Anthropic stream with 2 write tool_use blocks → first succeeds (DB row written, stateVersion=1), second returns `PARALLEL_WRITE_BLOCKED`, final state has exactly one new audit log entry. |

### Modified files

| File | Change |
|---|---|
| `app/src/lib/ai/agent/mcp/write/save-section-draft.ts` | Add named exports `inputShape` + `inputSchema`. Extend error mapping: `ValidationError` → `code: err.policyCode ?? 'VALIDATION:<field>'`. |
| `app/src/lib/ai/agent/mcp/write/approve-revision.ts` | Same pattern. |
| `app/src/lib/ai/agent/mcp/write/rollback-section.ts` | Same. |
| `app/src/lib/ai/agent/mcp/write/set-application-status.ts` | Same. |
| `app/src/lib/ai/agent/mcp/write/index.ts` | Register the 4 new MCP handlers. |
| `app/src/lib/ai/agent/managed/tools.ts` | Rename `MANAGED_READ_ONLY_TOOLS` → `MANAGED_TOOLS`. Add 8 write entries. Define 4 name sets (`READ_TOOL_NAMES`, `RULE_TOOL_NAMES`, `WRITE_TOOL_NAMES`, `PHASE_4_BLOCKED_TOOL_NAMES`). Derive `MANAGED_TOOL_NAMES` as the union. |
| `app/src/lib/ai/agent/managed/executor.ts` | Remove `KNOWN_WRITE_TOOLS` constant. Import `PHASE_4_BLOCKED_TOOL_NAMES` + `WRITE_TOOL_NAMES` from `tools.ts`. Add `allowWrites` gate before dispatch. Add 8 dispatch cases. Extend error mapping with `policyCode`. Add write-tool observability log line. |
| `app/src/lib/ai/agent/managed/runtime.ts` | Add runtime-level parallel-write cap (Desk Audit Fix 1). Before executing `toolBlocksToExecute`, split writes from non-writes; execute only the first write plus all non-writes; return synthetic `PARALLEL_WRITE_BLOCKED` tool_result blocks for additional writes. |
| `app/src/lib/ai/agent/managed/prompt.ts` | **Minimal delta**: add the 8 write tool names to the existing tool list section, add the 4 hard rules block (confirm-before-write, no parallel writes, concurrency recovery, policy-code recovery). **Do NOT rewrite the bilingual content.** Phase 2 structure is preserved. |
| `app/src/lib/ai/agent/services/types.ts` | Add optional `allowWrites?: boolean` field to `ServiceContext` with documentation comment. |
| `app/src/app/api/ai/agent/route.ts` | Read `managed_agent_writes_enabled` feature flag in `runManagedWithSSE` prep. Thread it onto `ctx.allowWrites`. |
| `app/drizzle/meta/_journal.json` | Auto-updated by `npm run db:generate` for the new flag migration. |

---

## Task 1: Add named exports to existing MCP write handlers

**Files:**
- Modify: `app/src/lib/ai/agent/mcp/write/save-section-draft.ts`
- Modify: `app/src/lib/ai/agent/mcp/write/approve-revision.ts`
- Modify: `app/src/lib/ai/agent/mcp/write/rollback-section.ts`
- Modify: `app/src/lib/ai/agent/mcp/write/set-application-status.ts`

The existing handlers declare `const inputShape = { ... }` as a file-local const. `managed/tools.ts` needs a single canonical import per tool. Promote to named exports. No behavior change.

- [ ] **Step 1: Read current shapes**

```bash
cd /home/godja/Dev/EU-Funds/app && grep -n "const inputShape\|export const" src/lib/ai/agent/mcp/write/*.ts | grep -v "read/\|rules/"
```

- [ ] **Step 2: Promote to named exports in each file**

For each of the 4 files:

```typescript
// Before:
const inputShape = { ... }

// After:
export const inputShape = { ... }
export const inputSchema = z.object(inputShape)
```

- [ ] **Step 3: Run existing MCP write tests**

```bash
cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/unit/mcp/write 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "refactor(phase3b): export inputShape/inputSchema from write MCP handlers

Named exports on the 4 existing write handlers so managed/tools.ts
can import a single canonical schema per tool and avoid drift
between the MCP surface and the managed surface. No behavior change."
```

---

## Task 2: Propagate policyCode in existing MCP write handler error mapping

**Files:**
- Modify: `app/src/lib/ai/agent/mcp/write/save-section-draft.ts`
- Modify: `app/src/lib/ai/agent/mcp/write/approve-revision.ts`
- Modify: `app/src/lib/ai/agent/mcp/write/rollback-section.ts`
- Modify: `app/src/lib/ai/agent/mcp/write/set-application-status.ts`
- Modify or create: tests for each asserting `policyCode` is propagated

Phase 3a added `ValidationError.policyCode`. The existing MCP write handlers drop it, returning `code: 'VALIDATION'`. This task propagates the policy code through the MCP envelope.

- [ ] **Step 1: Write failing tests**

For each handler, add tests asserting:
- 3-arg `ValidationError('field', 'msg', 'POLICY_X')` → `JSON.parse(content).code === 'POLICY_X'`
- 2-arg `ValidationError('field', 'msg')` → `JSON.parse(content).code === 'VALIDATION:field'` (backwards compat)

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Update each handler's ValidationError catch block**

```typescript
if (err instanceof ValidationError) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: err.message,
        code: err.policyCode ?? `VALIDATION:${err.field}`,
        field: err.field,
      }),
    }],
    isError: true,
  }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): propagate policyCode into MCP write error payloads

Phase 3a added ValidationError.policyCode. The MCP write handlers
dropped it, returning a generic 'VALIDATION' code. This extends
the catch block to emit the stable policy code when present
(e.g. POLICY_OUTLINE_NOT_FROZEN), falling back to
'VALIDATION:<field>' for backwards compat."
```

---

## Task 3: MCP handler — set_selected_call

**Files:**
- Create: `app/src/lib/ai/agent/mcp/write/set-selected-call.ts`
- Create: `app/tests/unit/mcp/write/set-selected-call.test.ts`

- [ ] **Step 1: Write the failing test**

Mirror the pattern from the existing `save-section-draft.test.ts`. Cover: exports, input validation, ConcurrencyError → CONCURRENCY code, ValidationError with `POLICY_OUTLINE_ALREADY_FROZEN`, NotFoundError → NOT_FOUND, happy path returning service result.

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement**

```typescript
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { setSelectedCall } from '../../services/application'
import { ConcurrencyError, NotFoundError, ValidationError } from '../../services/errors'
import type { ServiceContext } from '../../services/types'

export const inputShape = {
  sessionId: z.string().uuid(),
  callId: z.string().min(1),
  expectedStateVersion: z.number().int(),
}
export const inputSchema = z.object(inputShape)

export function registerSetSelectedCall(server: McpServer, ctx: ServiceContext): void {
  server.tool(
    'set_selected_call',
    "Set the session's selected funding call. Requires the session to be active and the outline not yet frozen. Idempotent if the same callId is already selected. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.",
    inputShape,
    async (args) => {
      try {
        const result = await setSelectedCall(ctx, args)
        return { content: [{ type: 'text', text: JSON.stringify(result) }] }
      } catch (err) {
        if (err instanceof ConcurrencyError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: 'CONCURRENCY', expected: err.expected, actual: err.actual }) }], isError: true }
        }
        if (err instanceof ValidationError) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: err.message, code: err.policyCode ?? `VALIDATION:${err.field}`, field: err.field }) }], isError: true }
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

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): add set_selected_call MCP handler

Thin envelope over services.setSelectedCall. Exports inputShape
and inputSchema for managed/tools.ts consumption."
```

---

## Task 4: MCP handler — freeze_outline

**Files:**
- Create: `app/src/lib/ai/agent/mcp/write/freeze-outline.ts`
- Create: `app/tests/unit/mcp/write/freeze-outline.test.ts`

Same TDD pattern as Task 3. Input: `{ sessionId: uuid, expectedStateVersion: int }`. Wraps `freezeOutline` service.

Description:
> "Freeze the application outline, moving the workflow from structuring into drafting. Requires a selected call and passing eligibility. After freeze, the call cannot change and drafting tools become available. Idempotent if outline is already frozen. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool."

Test policy codes: `POLICY_NO_CALL_SELECTED`, `POLICY_ELIGIBILITY_NOT_PASSED`, `POLICY_OUTLINE_ALREADY_FROZEN`.

- [ ] **Step 1-5**: TDD loop + commit.

---

## Task 5: MCP handler — mark_section_stale

**Files:**
- Create: `app/src/lib/ai/agent/mcp/write/mark-section-stale.ts`
- Create: `app/tests/unit/mcp/write/mark-section-stale.test.ts`

Input: `{ sessionId: uuid, sectionKey: string, expectedStateVersion: int }`. Wraps `markSectionStale`.

Description:
> "Mark a section as stale, flagging it for regeneration. Valid from draft, needs_review, or accepted status. When demoting from accepted, the accepted snapshot is cleared and the section becomes a fresh rework candidate. Idempotent if already stale. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool."

Test policy codes: `POLICY_OUTLINE_NOT_FROZEN`, `POLICY_SECTION_WRONG_STATE`.

- [ ] **Step 1-5**: TDD loop + commit.

---

## Task 6: MCP handler — reject_section

**Files:**
- Create: `app/src/lib/ai/agent/mcp/write/reject-section.ts`
- Create: `app/tests/unit/mcp/write/reject-section.test.ts`

Input: `{ sessionId: uuid, sectionKey: string, reason: string, expectedStateVersion: int }`. Wraps `rejectSection`.

Description:
> "Reject a section with a required reason string. Valid from draft, needs_review, or same-reason rejected (no-op). Different-reason re-reject is forbidden to prevent rejection metadata churn. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool."

Test cases: happy path, idempotent same-reason, different-reason `POLICY_SECTION_WRONG_STATE`, ConcurrencyError, NotFoundError.

- [ ] **Step 1-5**: TDD loop + commit.

---

## Task 7: Register new MCP handlers in write/index.ts

**Files:**
- Modify: `app/src/lib/ai/agent/mcp/write/index.ts`

- [ ] **Step 1: Read the current index**

```bash
cd /home/godja/Dev/EU-Funds/app && cat src/lib/ai/agent/mcp/write/index.ts
```

- [ ] **Step 2: Add imports + register calls**

```typescript
import { registerSetSelectedCall } from './set-selected-call'
import { registerFreezeOutline } from './freeze-outline'
import { registerMarkSectionStale } from './mark-section-stale'
import { registerRejectSection } from './reject-section'

// Inside the registration function, alongside existing 6 calls:
registerSetSelectedCall(server, ctx)
registerFreezeOutline(server, ctx)
registerMarkSectionStale(server, ctx)
registerRejectSection(server, ctx)
```

- [ ] **Step 3: Run MCP write test suite**

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): register 4 new MCP write handlers"
```

---

## Task 8: Rename MANAGED_READ_ONLY_TOOLS → MANAGED_TOOLS

**Files:**
- Modify: `app/src/lib/ai/agent/managed/tools.ts`
- Modify: all callers

- [ ] **Step 1: Grep callers**

```bash
cd /home/godja/Dev/EU-Funds/app && grep -rn "MANAGED_READ_ONLY_TOOLS" src/ tests/ 2>/dev/null
```

- [ ] **Step 2: Rename + update all callers in one sweep**

Use `replace_all: true` on each file. No behavior change.

- [ ] **Step 3: Run full test suite**

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "refactor(phase3b): rename MANAGED_READ_ONLY_TOOLS to MANAGED_TOOLS

Preparing for write tool additions. Pure rename."
```

---

## Task 9: Add 8 write tool entries to MANAGED_TOOLS

**Files:**
- Modify: `app/src/lib/ai/agent/managed/tools.ts`
- Create: `app/tests/unit/managed/tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { MANAGED_TOOLS, MANAGED_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'

describe('MANAGED_TOOLS', () => {
  it('contains exactly 22 tools (9 read + 5 rules + 8 write)', () => {
    expect(MANAGED_TOOLS).toHaveLength(22)
  })

  it('includes all 8 write tool names', () => {
    const names = new Set(MANAGED_TOOLS.map(t => t.name))
    for (const name of ['save_section_draft', 'approve_revision', 'rollback_section', 'set_application_status', 'set_selected_call', 'freeze_outline', 'mark_section_stale', 'reject_section']) {
      expect(names.has(name), `missing ${name}`).toBe(true)
    }
  })

  it('write tool descriptions include the confirmation rule', () => {
    const writeNames = ['save_section_draft', 'approve_revision', 'rollback_section', 'set_application_status', 'set_selected_call', 'freeze_outline', 'mark_section_stale', 'reject_section']
    for (const name of writeNames) {
      const tool = MANAGED_TOOLS.find(t => t.name === name)
      expect(tool?.description, `${name} description`).toMatch(/explicit user confirmation|structured UI action confirmation/i)
    }
  })

  it('every tool has a valid input_schema object', () => {
    for (const tool of MANAGED_TOOLS) {
      expect(tool.input_schema).toBeDefined()
      expect(tool.input_schema.type).toBe('object')
    }
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Add imports + 8 entries**

Import the 8 write schemas (from Task 1's named exports for existing handlers + Tasks 3-6 for new ones). Append entries to `MANAGED_TOOLS` following the 3-sentence rubric:
1. What it does
2. Preconditions the LLM needs to know
3. "Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool."

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): expose 8 write tools to managed runtime

MANAGED_TOOLS now contains 22 entries: 9 read + 5 rules + 8 write."
```

---

## Task 10: Define four tool-name sets + MANAGED_TOOL_NAMES union

**Files:**
- Modify: `app/src/lib/ai/agent/managed/tools.ts`

- [ ] **Step 1: Extend tools.test.ts**

```typescript
import { READ_TOOL_NAMES, RULE_TOOL_NAMES, WRITE_TOOL_NAMES, PHASE_4_BLOCKED_TOOL_NAMES, MANAGED_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'

describe('tool name sets', () => {
  it('READ_TOOL_NAMES has 9 entries', () => expect(READ_TOOL_NAMES.size).toBe(9))
  it('RULE_TOOL_NAMES has 5 entries', () => expect(RULE_TOOL_NAMES.size).toBe(5))
  it('WRITE_TOOL_NAMES has 8 entries', () => expect(WRITE_TOOL_NAMES.size).toBe(8))
  it('PHASE_4_BLOCKED_TOOL_NAMES has 2 entries', () => {
    expect(PHASE_4_BLOCKED_TOOL_NAMES.has('create_export_snapshot')).toBe(true)
    expect(PHASE_4_BLOCKED_TOOL_NAMES.has('save_call_blueprint')).toBe(true)
    expect(PHASE_4_BLOCKED_TOOL_NAMES.size).toBe(2)
  })
  it('sets are disjoint', () => {
    for (const r of READ_TOOL_NAMES) {
      expect(RULE_TOOL_NAMES.has(r)).toBe(false)
      expect(WRITE_TOOL_NAMES.has(r)).toBe(false)
    }
    for (const r of RULE_TOOL_NAMES) expect(WRITE_TOOL_NAMES.has(r)).toBe(false)
  })
  it('MANAGED_TOOL_NAMES is the union (22)', () => {
    const expected = new Set([...READ_TOOL_NAMES, ...RULE_TOOL_NAMES, ...WRITE_TOOL_NAMES])
    expect(new Set(MANAGED_TOOL_NAMES)).toEqual(expected)
    expect(MANAGED_TOOL_NAMES.size).toBe(22)
  })
  it('PHASE_4_BLOCKED_TOOL_NAMES is disjoint from MANAGED_TOOL_NAMES', () => {
    for (const name of PHASE_4_BLOCKED_TOOL_NAMES) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Define the sets in tools.ts**

Replace the existing `MANAGED_TOOL_NAMES` derivation with explicit sets:

```typescript
export const READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  'search_calls', 'get_call_blueprint', 'retrieve_evidence',
  'get_application_state', 'list_sections', 'get_section',
  'get_validation_report', 'get_project_summary', 'list_uploaded_documents',
])
export const RULE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'run_eligibility', 'score_fit', 'validate_section',
  'validate_application', 'check_missing_annexes',
])
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'save_section_draft', 'approve_revision', 'rollback_section',
  'set_application_status', 'set_selected_call', 'freeze_outline',
  'mark_section_stale', 'reject_section',
])
export const PHASE_4_BLOCKED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_export_snapshot', 'save_call_blueprint',
])
export const MANAGED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...READ_TOOL_NAMES, ...RULE_TOOL_NAMES, ...WRITE_TOOL_NAMES,
])
```

- [ ] **Step 3: Run — expect pass**

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): define categorized managed tool name sets

Four disjoint sets: READ, RULE, WRITE, PHASE_4_BLOCKED. The
MANAGED_TOOL_NAMES union is derived from READ + RULE + WRITE.
Used by the executor's allowWrites gate and Phase 4 rejection
branch, and by runtime.ts for the parallel-write cap."
```

---

## Task 11: Add ServiceContext.allowWrites field

**Files:**
- Modify: `app/src/lib/ai/agent/services/types.ts`

- [ ] **Step 1: Add the field**

```typescript
export interface ServiceContext {
  userId: string
  sessionId?: string
  organizationId?: string
  projectId?: string
  requestId: string
  now: Date
  /**
   * Managed-runtime rollout control. When false (or undefined),
   * the managed executor blocks write tools with a targeted error.
   * Services IGNORE this field — it's checked only in the managed
   * executor and (later) the structured action bridge. Enforcement
   * at the service layer would couple domain logic to rollout state,
   * which is wrong.
   */
  allowWrites?: boolean
}
```

- [ ] **Step 2: Run typecheck + tests**

- [ ] **Step 3: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): add ServiceContext.allowWrites optional field

Rollout control for the managed runtime's write surface. Services
never read this field — it's checked only in the managed executor.
Documented inline."
```

---

## Task 12: Seed managed_agent_writes_enabled feature flag migration

**Files:**
- Create: `app/drizzle/NNNN_managed_agent_writes_enabled_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Find the Phase 2 flag migration pattern**

```bash
cd /home/godja/Dev/EU-Funds/app && ls drizzle/ | grep -i managed
cd /home/godja/Dev/EU-Funds/app && cat $(ls drizzle/*.sql | xargs grep -l "managed_agent_enabled" 2>/dev/null | head -1)
```

- [ ] **Step 2: Write the migration manually**

Create `app/drizzle/NNNN_managed_agent_writes_enabled_flag.sql` (use the next sequential NNNN):

```sql
INSERT INTO feature_flags (key, enabled, targeting, description, created_at, updated_at)
VALUES (
  'managed_agent_writes_enabled',
  false,
  '{}'::jsonb,
  'Gates managed runtime write tools (Phase 3b). Default off. Enable per-user via targeting.userIds after normalizer metrics are clean.',
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

Adjust column names to match the actual `feature_flags` schema.

- [ ] **Step 3: Update _journal.json**

Mirror an existing entry's shape.

- [ ] **Step 4: Apply**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run db:push 2>&1 | tail -10
docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c "SELECT key, enabled FROM feature_flags WHERE key = 'managed_agent_writes_enabled';"
```

Expected: row exists, enabled=false.

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): seed managed_agent_writes_enabled feature flag

Default off. Empty targeting. Will be flipped on per-user once
PR-B (history normalizer) is in production, the normalizer
metrics show no classification_error events in a sample of
>=100 managed turns, and the runbook enable-writes checklist
is signed off."
```

---

## Task 13: Replace KNOWN_WRITE_TOOLS with PHASE_4_BLOCKED_TOOL_NAMES in executor

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts`
- Update existing tests that assert the Phase 2 rejection message for the 6 write tools

- [ ] **Step 1: Read the current executor blocklist**

```bash
cd /home/godja/Dev/EU-Funds/app && sed -n '45,90p' src/lib/ai/agent/managed/executor.ts
```

- [ ] **Step 2: Remove constant + refactor the branch**

Delete `const KNOWN_WRITE_TOOLS = new Set([...])`. Import `PHASE_4_BLOCKED_TOOL_NAMES` from `./tools`. Update the unknown-tool branch:

```typescript
if (!MANAGED_TOOL_NAMES.has(name)) {
  if (PHASE_4_BLOCKED_TOOL_NAMES.has(name)) {
    return errorResult(
      name,
      start,
      'This tool is not available in the managed runtime yet (Phase 4 scope). Please continue in the standard workflow.',
    )
  }
  return errorResult(name, start, `Unknown tool: ${name}`)
}
```

- [ ] **Step 3: Update existing tests**

Search for tests asserting the old "Write tools are not available in Phase 2" message:

```bash
cd /home/godja/Dev/EU-Funds/app && grep -rn "Write tools are not available\|Phase 2\|KNOWN_WRITE_TOOLS" tests/unit/managed/ 2>/dev/null
```

For `save_section_draft`, `approve_revision`, `rollback_section`, `set_application_status` tests: these tools are now dispatchable (they hit the `allowWrites` gate or succeed in dispatch). Update assertions to expect the new gate message OR happy-path result depending on the test's fixtures.

For `create_export_snapshot` and `save_call_blueprint` tests: update the expected message to the new Phase 4 rejection text.

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "refactor(phase3b): replace KNOWN_WRITE_TOOLS with PHASE_4_BLOCKED set

Phase 2's blocklist lumped all 6 write tools into one rejection
bucket. Phase 3b makes 8 tools dispatchable and keeps only
create_export_snapshot + save_call_blueprint blocked (Phase 4)."
```

---

## Task 14: Add allowWrites gate to executor

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts`
- Create: `app/tests/unit/managed/executor-allow-writes-gate.test.ts`

### Correct executor API (Desk Audit Fix 4)

The executor's actual signature is:

```typescript
export async function executeManagedTool(
  block: ToolUseBlock,
  ctx: ServiceContext,
): Promise<ExecutorResult>

export interface ExecutorResult {
  content: string       // JSON string, NOT an array of content blocks
  isError: boolean
  toolName: string
  latencyMs: number
  truncated?: boolean
}
```

All tests in this plan use `executeManagedTool(block, ctx)` with a `ToolUseBlock` fixture and assert on `result.content` as a plain string.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeManagedTool } from '@/lib/ai/agent/managed/executor'
import { WRITE_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

vi.mock('@/lib/ai/agent/services/sections', () => ({
  saveSectionDraft: vi.fn(), approveSection: vi.fn(), rollbackSection: vi.fn(),
  markSectionStale: vi.fn(), rejectSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/application', () => ({
  setApplicationStatus: vi.fn(), setSelectedCall: vi.fn(), freezeOutline: vi.fn(),
}))

function makeBlock(name: string, input: Record<string, unknown> = {}): ToolUseBlock {
  return { type: 'tool_use', id: `tu_${name}`, name, input }
}

function makeCtx(allowWrites?: boolean): ServiceContext {
  return {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: 'req-1',
    now: new Date(),
    allowWrites,
  }
}

function validInputFor(name: string): Record<string, unknown> {
  const base = { sessionId: '22222222-2222-4222-8222-222222222222', expectedStateVersion: 0 }
  if (name === 'save_section_draft') return { ...base, sectionKey: 'obiective', content: 'x' }
  if (name === 'approve_revision' || name === 'rollback_section' || name === 'mark_section_stale') return { ...base, sectionKey: 'obiective' }
  if (name === 'rollback_section') return { ...base, sectionKey: 'obiective', targetVersion: 1 }
  if (name === 'reject_section') return { ...base, sectionKey: 'obiective', reason: 'x' }
  if (name === 'set_application_status') return { ...base, status: 'paused' }
  if (name === 'set_selected_call') return { ...base, callId: 'CALL-1' }
  if (name === 'freeze_outline') return base
  return base
}

describe('executor allowWrites gate', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const name of WRITE_TOOL_NAMES) {
    it(`blocks ${name} when ctx.allowWrites is false`, async () => {
      const result = await executeManagedTool(makeBlock(name, validInputFor(name)), makeCtx(false))
      expect(result.isError).toBe(true)
      expect(result.content).toMatch(/disabled for your account|rollout gate/i)
    })

    it(`blocks ${name} when ctx.allowWrites is undefined`, async () => {
      const result = await executeManagedTool(makeBlock(name, validInputFor(name)), makeCtx())
      expect(result.isError).toBe(true)
      expect(result.content).toMatch(/disabled for your account|rollout gate/i)
    })
  }
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Add the gate**

In `executor.ts`, right after the `MANAGED_TOOL_NAMES.has(name)` allowlist check, before `dispatchTool`:

```typescript
import { WRITE_TOOL_NAMES, PHASE_4_BLOCKED_TOOL_NAMES, MANAGED_TOOL_NAMES } from './tools'

// ... inside executeManagedTool ...

if (WRITE_TOOL_NAMES.has(name) && ctx.allowWrites !== true) {
  return errorResult(
    name,
    start,
    'Managed write tools are disabled for your account. Reads and evaluations are still available. This is a rollout gate, not a permanent restriction.',
  )
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): add allowWrites rollout gate to managed executor

Write tools require ctx.allowWrites === true before dispatch.
Default false. Gate fires BEFORE dispatch — no service call
happens on the blocked path. Error message explains the gate
is a rollout control, not a permanent denial."
```

---

## Task 15: Add 8 write dispatch cases to executor

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts`
- Create: `app/tests/unit/managed/executor-write-dispatch.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeManagedTool } from '@/lib/ai/agent/managed/executor'
import * as sections from '@/lib/ai/agent/services/sections'
import * as application from '@/lib/ai/agent/services/application'

vi.mock('@/lib/ai/agent/services/sections')
vi.mock('@/lib/ai/agent/services/application')

const WRITE_CASES: Array<{ name: string; mock: any; input: Record<string, unknown>; result: unknown }> = [
  { name: 'save_section_draft', mock: () => sections.saveSectionDraft, input: { /* ... */ }, result: { sectionId: 's1', versionNumber: 1, newStateVersion: 1 } },
  { name: 'approve_revision', mock: () => sections.approveSection, input: { /* ... */ }, result: { newStateVersion: 1 } },
  { name: 'rollback_section', mock: () => sections.rollbackSection, input: { /* ... */ }, result: { content: 'x', restoredVersion: 1, newStateVersion: 1 } },
  { name: 'mark_section_stale', mock: () => sections.markSectionStale, input: { /* ... */ }, result: { newStateVersion: 1 } },
  { name: 'reject_section', mock: () => sections.rejectSection, input: { /* ... */ }, result: { newStateVersion: 1 } },
  { name: 'set_application_status', mock: () => application.setApplicationStatus, input: { /* ... */ }, result: { newStateVersion: 1 } },
  { name: 'set_selected_call', mock: () => application.setSelectedCall, input: { /* ... */ }, result: { newStateVersion: 1 } },
  { name: 'freeze_outline', mock: () => application.freezeOutline, input: { /* ... */ }, result: { newStateVersion: 1 } },
]

describe('executor write dispatch happy paths', () => {
  beforeEach(() => vi.clearAllMocks())

  for (const { name, mock, input, result: expected } of WRITE_CASES) {
    it(`dispatches ${name}`, async () => {
      vi.mocked(mock()).mockResolvedValueOnce(expected as never)
      const r = await executeManagedTool(
        { type: 'tool_use', id: `tu_${name}`, name, input },
        { userId: 'u', sessionId: 's', requestId: 'r', now: new Date(), allowWrites: true },
      )
      expect(r.isError).toBe(false)
      expect(JSON.parse(r.content)).toEqual(expected)
      expect(mock()).toHaveBeenCalledTimes(1)
    })
  }
})
```

- [ ] **Step 2: Run — expect fail (unknown tool for the new ones)**

- [ ] **Step 3: Add dispatch cases**

Import schemas + services at the top of `executor.ts`:

```typescript
import * as sections from '../services/sections'
import * as application from '../services/application'
import { inputSchema as saveSectionDraftSchema } from '../mcp/write/save-section-draft'
// ... 7 more schema imports ...
```

In `dispatchTool(name, rawInput, ctx)` switch:

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

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): dispatch 8 write tools through the managed executor

Each case parses its input via the canonical Zod schema from the
MCP handler module and calls the matching 3a service with the
verified payload and the service context."
```

---

## Task 16: Extend executor error mapping with policyCode

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts`
- Create: `app/tests/unit/managed/executor-policy-code-mapping.test.ts`

- [ ] **Step 1: Write the failing test**

One test per POLICY_* code. Mock the matching service to throw `new ValidationError('<field>', '<message>', '<POLICY_CODE>')`, call `executeManagedTool(block, ctx)`, assert `result.content` is prefixed with the policy code and `result.isError === true`.

Cover: `POLICY_OUTLINE_NOT_FROZEN`, `POLICY_OUTLINE_ALREADY_FROZEN`, `POLICY_NO_CALL_SELECTED`, `POLICY_ELIGIBILITY_NOT_PASSED`, `POLICY_SECTION_WRONG_STATE`, `POLICY_SESSION_NOT_ACTIVE`, `POLICY_VALIDATION_NOT_PASSED`.

```typescript
it('maps ValidationError with POLICY_OUTLINE_NOT_FROZEN', async () => {
  vi.mocked(sections.saveSectionDraft).mockRejectedValueOnce(
    new ValidationError('outlineFrozen', 'Outline must be frozen', 'POLICY_OUTLINE_NOT_FROZEN'),
  )
  const r = await executeManagedTool(
    { type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: validInputFor('save_section_draft') },
    makeCtx(true),
  )
  expect(r.isError).toBe(true)
  expect(r.content).toMatch(/^POLICY_OUTLINE_NOT_FROZEN:/)
})
```

- [ ] **Step 2: Run — expect fail (current mapping returns 'VALIDATION: ...')**

- [ ] **Step 3: Update the mapping**

In the executor's catch block:

```typescript
if (err instanceof ValidationError) {
  const code = err.policyCode ?? `VALIDATION:${err.field}`
  return errorResult(name, start, `${code}: ${err.message}`)
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): surface policyCode in managed executor error results

When a ValidationError carries a policyCode, the executor prefixes
the error content with that code. Stable machine-readable prefixes
let the agent self-recover from expected precondition failures."
```

---

## Task 17: Write-tool observability log line

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts`

- [ ] **Step 1: Add the log line**

Right after `dispatchTool`'s result is captured:

```typescript
if (WRITE_TOOL_NAMES.has(name)) {
  log.info({
    tool: name,
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    requestId: ctx.requestId,
    isError: result.isError === true,
    latencyMs: Date.now() - start,
  }, 'managed write tool executed')
}
```

Use whatever logger the executor already imports.

- [ ] **Step 2: Run tests + commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): log every managed write-tool execution

Structured info log for pilot rollout monitoring."
```

---

## Task 18: Runtime-level parallel-write cap (Desk Audit Fix 1)

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`
- Create: `app/tests/unit/managed/runtime-parallel-write-cap.test.ts`

### The bug

Prompt-only "no parallel writes" guidance is unenforced. The current `runtime.ts:163-201` iterates `toolBlocksToExecute` with zero cap. A single assistant message emitting multiple write `tool_use` blocks would execute all of them against stale state.

Even though the atomic CAS from Phase 3a catches races in the DB, the surface is still wrong: two parallel writes in one turn will both hit stateVersion=N at dispatch time, the first write bumps it, and the second will fail with `CONCURRENCY` in a confusing way to the agent. Worse, if the writes target different sessions or different sections, CAS doesn't protect them at all.

### The fix

Enforce the constraint in code. Before iterating `toolBlocksToExecute`:

1. Split blocks into `writeBlocks` (those whose `name` is in `WRITE_TOOL_NAMES`) and `nonWriteBlocks`.
2. If `writeBlocks.length > 1`:
   - Execute only the FIRST write block normally via `executeManagedTool`.
   - For each additional write block (index >= 1), **do not call the executor at all**. Synthesize an `ExecutorResult` with:
     - `isError: true`
     - `content: 'PARALLEL_WRITE_BLOCKED: Only one write tool call is allowed per assistant message. This write was rejected because another write was already issued in the same turn. Wait for the first result, then decide the next step.'`
     - `toolName: block.name`
     - `latencyMs: 0`
3. Execute all `nonWriteBlocks` normally (no cap).
4. Preserve the order of tool_results in the final user message — the agent needs to see them in the same order as the tool_use blocks.

**Ordering note:** the existing loop emits `tool_result` blocks in the order of `toolBlocksToExecute`. The cap must preserve this ordering so the tool_use ↔ tool_result pairing is maintained. The simplest implementation: loop over `toolBlocksToExecute` in order and track `writesExecutedCount`. For each write block, if `writesExecutedCount >= 1`, synthesize the rejection; otherwise dispatch and increment the counter.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
// Import the internal helper that processes tool blocks, OR export a
// helper function for testability. Prefer a small pure helper that
// takes `toolBlocksToExecute` + the executor + ctx and returns the
// ordered array of { block, result } pairs. Example:
//
// export async function executeToolBlocksWithWriteCap(
//   blocks: ToolUseBlock[],
//   ctx: ServiceContext,
//   executor: (block: ToolUseBlock, ctx: ServiceContext) => Promise<ExecutorResult>,
// ): Promise<Array<{ block: ToolUseBlock; result: ExecutorResult }>>

import { executeToolBlocksWithWriteCap } from '@/lib/ai/agent/managed/runtime'

describe('runtime parallel-write cap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('executes a single write block normally', async () => {
    const execMock = vi.fn().mockResolvedValue({ content: '{"ok":true}', isError: false, toolName: 'save_section_draft', latencyMs: 10 })
    const out = await executeToolBlocksWithWriteCap(
      [{ type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: {} }],
      { userId: 'u', sessionId: 's', requestId: 'r', now: new Date(), allowWrites: true },
      execMock,
    )
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(out).toHaveLength(1)
    expect(out[0].result.isError).toBe(false)
  })

  it('executes the first write, rejects subsequent writes with PARALLEL_WRITE_BLOCKED', async () => {
    const execMock = vi.fn().mockResolvedValue({ content: '{"ok":true}', isError: false, toolName: 'save_section_draft', latencyMs: 10 })
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'save_section_draft', input: { sectionKey: 'a' } },
      { type: 'tool_use', id: 'tu_2', name: 'save_section_draft', input: { sectionKey: 'b' } },
      { type: 'tool_use', id: 'tu_3', name: 'approve_revision', input: { sectionKey: 'a' } },
    ]
    const out = await executeToolBlocksWithWriteCap(blocks, makeCtx(true), execMock)
    // Executor called only once (for the first write)
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock).toHaveBeenCalledWith(blocks[0], expect.anything())
    // Results preserve order
    expect(out).toHaveLength(3)
    expect(out[0].block.id).toBe('tu_1'); expect(out[0].result.isError).toBe(false)
    expect(out[1].block.id).toBe('tu_2'); expect(out[1].result.isError).toBe(true)
    expect(out[1].result.content).toMatch(/^PARALLEL_WRITE_BLOCKED:/)
    expect(out[2].block.id).toBe('tu_3'); expect(out[2].result.isError).toBe(true)
    expect(out[2].result.content).toMatch(/^PARALLEL_WRITE_BLOCKED:/)
  })

  it('does NOT cap non-write tool calls — read tools run alongside the first write', async () => {
    const execMock = vi.fn().mockImplementation((block) => Promise.resolve({
      content: '{}', isError: false, toolName: block.name, latencyMs: 5,
    }))
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'get_application_state', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'save_section_draft', input: {} },
      { type: 'tool_use', id: 'tu_3', name: 'list_sections', input: {} },
      { type: 'tool_use', id: 'tu_4', name: 'save_section_draft', input: {} },  // second write — blocked
      { type: 'tool_use', id: 'tu_5', name: 'search_calls', input: {} },
    ]
    const out = await executeToolBlocksWithWriteCap(blocks, makeCtx(true), execMock)
    // Executor called for: tu_1 (read), tu_2 (first write), tu_3 (read), tu_5 (read) — 4 calls
    expect(execMock).toHaveBeenCalledTimes(4)
    // tu_4 is blocked with PARALLEL_WRITE_BLOCKED
    const out4 = out.find(r => r.block.id === 'tu_4')!
    expect(out4.result.isError).toBe(true)
    expect(out4.result.content).toMatch(/^PARALLEL_WRITE_BLOCKED:/)
    // Order preserved
    expect(out.map(r => r.block.id)).toEqual(['tu_1', 'tu_2', 'tu_3', 'tu_4', 'tu_5'])
  })

  it('zero writes in the batch runs everything normally', async () => {
    const execMock = vi.fn().mockResolvedValue({ content: '{}', isError: false, toolName: 'x', latencyMs: 5 })
    const blocks: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'search_calls', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'list_sections', input: {} },
    ]
    await executeToolBlocksWithWriteCap(blocks, makeCtx(true), execMock)
    expect(execMock).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Extract `executeToolBlocksWithWriteCap` and wire it into runManagedTurn**

Add a small exported helper in `runtime.ts`:

```typescript
import { WRITE_TOOL_NAMES } from './tools'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'

const PARALLEL_WRITE_BLOCKED_MESSAGE =
  'PARALLEL_WRITE_BLOCKED: Only one write tool call is allowed per assistant message. This write was rejected because another write was already issued in the same turn. Wait for the first result, then decide the next step.'

export async function executeToolBlocksWithWriteCap(
  blocks: ToolUseBlock[],
  ctx: ServiceContext,
  executor: (block: ToolUseBlock, ctx: ServiceContext) => Promise<ExecutorResult>,
): Promise<Array<{ block: ToolUseBlock; result: ExecutorResult }>> {
  let writesExecuted = 0
  const out: Array<{ block: ToolUseBlock; result: ExecutorResult }> = []

  for (const block of blocks) {
    const isWrite = WRITE_TOOL_NAMES.has(block.name)

    if (isWrite && writesExecuted >= 1) {
      // Reject without dispatching
      out.push({
        block,
        result: {
          content: PARALLEL_WRITE_BLOCKED_MESSAGE,
          isError: true,
          toolName: block.name,
          latencyMs: 0,
        },
      })
      continue
    }

    const result = await executor(block, ctx)
    if (isWrite) writesExecuted += 1
    out.push({ block, result })
  }

  return out
}
```

Then update the loop in `runManagedTurn` (around `runtime.ts:163-201`) to use this helper:

```typescript
// Before: `for (const block of toolBlocksToExecute) { ... executeManagedTool(block, serviceCtx) ... }`
// After:
const results = await executeToolBlocksWithWriteCap(toolBlocksToExecute, serviceCtx, executeManagedTool)
const toolResultBlocks: ToolResultBlockParam[] = []
for (const { block, result } of results) {
  toolCount += 1
  emit({ type: 'tool_result', tool: result.toolName, summary: result.isError ? result.content : 'OK', success: !result.isError })
  toolResultBlocks.push({
    type: 'tool_result',
    tool_use_id: block.id,
    content: result.content,
    is_error: result.isError,
  })
  await appendManagedMessage(session.id, {
    role: 'user',
    messageType: 'tool_result',
    content: [{ type: 'tool_result', tool_use_id: block.id, content: result.content, is_error: result.isError }],
    toolName: block.name,
    toolCallId: block.id,
  }, { runtimeMode: 'managed', provider: 'anthropic', model: tctx.messageModel })
}
```

Preserve all existing emit/persist logic — this is a pure wrapper around the existing loop body.

- [ ] **Step 4: Run tests — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): runtime-level parallel-write cap for managed turns

The managed runtime's tool loop previously executed every tool_use
block sequentially with zero cap. A model response emitting multiple
write tool_use blocks in one assistant message would fire all of them
against stale state — the Phase 3a stateVersion CAS would catch
cross-session races at the DB level, but same-session parallel writes
would still produce confusing CONCURRENCY errors at the agent layer.

New rule: executeToolBlocksWithWriteCap allows at most ONE write
tool call per assistant message. Subsequent write tool_use blocks
receive a synthetic PARALLEL_WRITE_BLOCKED tool_result without
being dispatched. Non-write tools run normally alongside the first
write, preserving order.

The agent sees a stable error prefix it can reason about and
recover from on the next turn.

Desk audit Finding 1 fix."
```

---

## Task 19: Wire managed_agent_writes_enabled into route handler

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts`

- [ ] **Step 1: Find the managed turn context construction**

```bash
cd /home/godja/Dev/EU-Funds/app && grep -n "runManagedWithSSE\|ServiceContext\|managed_agent_enabled" src/app/api/ai/agent/route.ts
```

- [ ] **Step 2: Read the flag + set on ctx**

```typescript
const writesEnabled = await isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id })
const serviceCtx: ServiceContext = {
  userId: user.id,
  sessionId: session.id,
  projectId: session.projectId ?? undefined,
  requestId: body.requestId,
  now: new Date(),
  allowWrites: writesEnabled,
}
```

- [ ] **Step 3: Update route-level tests**

If there's a route.test.ts mocking feature flags, add a mock for `managed_agent_writes_enabled`.

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): wire managed_agent_writes_enabled into managed turn ctx

Route handler reads the writes flag and threads it onto
ctx.allowWrites. Default flag value is false."
```

---

## Task 20: Minimal prompt delta

**Files:**
- Modify: `app/src/lib/ai/agent/managed/prompt.ts`
- Create: `app/tests/unit/managed/prompt-delta.test.ts`

### Minimal delta scope

**What this task adds:**
- The 8 write tool names in the existing tool list section (alongside the 14 read/rules tools)
- A "Hard rules for write tools" block with the 4 rules:
  1. Confirm before write
  2. No parallel writes (agent-visible rule; runtime enforces it too per Task 18)
  3. Concurrency recovery (use `get_application_state` + fresh `expectedStateVersion`)
  4. Policy-code recovery (handle `POLICY_*` prefixes)
- Removal of any Phase 2 "read-only pilot" lockdown language (e.g., "writes are not available yet")

**What this task does NOT do:**
- No full bilingual rewrite
- No structural reorganization of the prompt
- No addition of a session-state block (phase, outlineFrozen, eligibility summary — that's deferred)
- No workflow phase descriptions (they stay as-is from Phase 2)

The full rewrite stays deferred to a potential PR-C if pilot behavior shows the minimal delta is insufficient.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { buildManagedSystemPrompt } from '@/lib/ai/agent/managed/prompt'
// ... baseSession fixture ...

describe('Phase 3b minimal prompt delta', () => {
  it('removes Phase 2 read-only lockdown language (RO + EN)', () => {
    const ro = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro')
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).not.toMatch(/writes are not available|read-only pilot/i)
    expect(ro).not.toMatch(/numai citire|scrierile nu sunt disponibile/i)
  })

  it('lists all 8 write tool names', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    for (const name of ['save_section_draft', 'approve_revision', 'rollback_section', 'set_application_status', 'set_selected_call', 'freeze_outline', 'mark_section_stale', 'reject_section']) {
      expect(en, `missing ${name}`).toContain(name)
    }
  })

  it('includes the confirm-before-write hard rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/explicit user (intent|confirmation)|before (calling|executing) any write/i)
  })

  it('includes the no-parallel-writes rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/one (write )?at a time|never.*parallel|single write/i)
  })

  it('includes the concurrency recovery rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/expectedStateVersion|get_application_state/i)
  })

  it('includes the policy-code recovery rule', () => {
    const en = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(en).toMatch(/POLICY_/)
  })

  it('backwards compat: 4-arg call still works', () => {
    const result = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(result).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Apply the minimal delta**

Read the current prompt content. Identify the section that lists read/rule tools. Append the 8 write tool names (with 1-line descriptions for LLM planning). Append a "Hard rules for write tools" block:

```markdown
## Write tool rules

Write tools mutate the session state. Follow these rules:

1. **Confirm before writing.** Before calling any write tool, get explicit user intent — either a direct statement ("save it", "approve this section") or a structured UI action confirmation. Never write on speculation.

2. **One write at a time.** Never call multiple write tools in parallel in the same turn. Execute one write, wait for the result, then decide the next step. The runtime enforces this — additional writes in the same message will return PARALLEL_WRITE_BLOCKED.

3. **Concurrency recovery.** Every write tool requires `expectedStateVersion`. After a CONCURRENCY error, call `get_application_state` to fetch the fresh stateVersion, then retry the write with the updated value. Never blindly retry with the stale version.

4. **Policy-code recovery.** If a write returns an error prefixed with `POLICY_*` (e.g., `POLICY_OUTLINE_NOT_FROZEN`, `POLICY_ELIGIBILITY_NOT_PASSED`), read the message and address the precondition before retrying. For `POLICY_OUTLINE_NOT_FROZEN`, call `freeze_outline` first. For `POLICY_ELIGIBILITY_NOT_PASSED`, run `run_eligibility` first. For `POLICY_VALIDATION_NOT_PASSED` on `set_application_status('completed')`, run `validate_application` and address the reported issues.
```

Remove any Phase 2 "read-only" sentence from the existing content.

Make the minimal edits in both the RO and EN bodies. Keep the existing prompt structure.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): minimal prompt delta — write tools + 4 hard rules

Adds the 8 write tool names to the tool list and a 'Write tool
rules' block covering: confirm before writing, one write at a
time (paired with runtime cap in Task 18), concurrency recovery
via get_application_state + fresh expectedStateVersion, and
policy-code recovery for POLICY_* prefixes.

Removes Phase 2's 'read-only pilot' lockdown language.

Preserves the existing Phase 2 prompt structure. Full bilingual
rewrite deferred to a potential PR-C if pilot behavior shows
the minimal delta is insufficient."
```

---

## Task 21: Integration test — managed write tool happy path

**Files:**
- Create: `app/tests/integration/managed/runtime-write-tool.test.ts`

Real DB, synthetic Anthropic stream. Seed user + session (`stateVersion=0, outlineFrozen=true, eligibility passing`) + pending section. Construct a stream that emits one `save_section_draft` tool_use block. Run `runManagedTurn` with `allowWrites: true`. Assert:

1. The real `saveSectionDraft` service was called (check DB state)
2. The section row has the new content + `stateVersion=1`
3. An `audit_log` entry exists for `project.version_save`
4. The final SSE tool_result event has `success: true`

Follow the pattern from existing managed integration tests (`tests/integration/managed/`).

- [ ] **Step 1-5**: TDD + commit.

---

## Task 22: Integration test — managed allowWrites=false blocks writes

**Files:**
- Create: `app/tests/integration/managed/runtime-write-disabled.test.ts`

Same setup as Task 21, but with `allowWrites: false`. Assert:
1. The executor's gate fires before dispatch
2. No service call happens (no DB mutation, no audit entry)
3. Turn completes with a visible tool_result carrying the "rollout gate" message
4. Session's stateVersion unchanged

- [ ] **Step 1-5**: TDD + commit.

---

## Task 23: Integration test — managed policy error recovery

**Files:**
- Create: `app/tests/integration/managed/runtime-policy-error.test.ts`

Seed a session with `outlineFrozen=false`. Synthetic stream emits `save_section_draft`. Assert:
1. Executor dispatches to the real service
2. Service throws `ValidationError` with `policyCode='POLICY_OUTLINE_NOT_FROZEN'`
3. Executor returns `POLICY_OUTLINE_NOT_FROZEN: ...` as the tool_result text
4. Turn completes without a section row being written
5. Session's stateVersion unchanged

- [ ] **Step 1-5**: TDD + commit.

---

## Task 24: Integration test — runtime parallel-write cap end-to-end

**Files:**
- Create: `app/tests/integration/managed/runtime-parallel-write-end-to-end.test.ts`

Real DB + synthetic stream. Seed a session and 2 pending sections. Construct a stream that emits TWO `save_section_draft` tool_use blocks in one assistant message. Run `runManagedTurn` with `allowWrites: true`. Assert:

1. The first write succeeds — section row written, `stateVersion=1`, one `audit_log` entry
2. The second write returns `PARALLEL_WRITE_BLOCKED` in its tool_result (not dispatched to the service)
3. The second section's DB row is unchanged (still `pending` status, no content)
4. Only ONE audit log entry exists (from the first write)
5. Both `tool_use` blocks have matching `tool_result` blocks in the persisted `agent_messages`, preserving Anthropic's pairing invariant

- [ ] **Step 1-5**: TDD + commit.

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "test(phase3b): end-to-end parallel-write cap against real DB

Seeds two pending sections, fires a synthetic Anthropic stream
with two save_section_draft tool_use blocks in one assistant
message, runs the real managed turn, asserts exactly one section
is written and the second returns PARALLEL_WRITE_BLOCKED. Verifies
the runtime-level cap holds against the full end-to-end loop."
```

---

## Task 25: Final verification pass

- [ ] **Step 1: Managed test suite**

```bash
cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/unit/managed tests/unit/mcp/write tests/integration/managed 2>&1 | tail -25
```

Expected: all pass.

- [ ] **Step 2: Full project test suite**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run test 2>&1 | tail -30
```

Expected: all tests pass. V3 runtime, services, policy module all untouched by this PR.

- [ ] **Step 3: Typecheck**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 4: Lint**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run lint 2>&1 | tail -30
```

- [ ] **Step 5: Cross-boundary checks**

```bash
cd /home/godja/Dev/EU-Funds/app && grep -rn "from '.*\.\./runtime'" src/lib/ai/agent/managed/ 2>&1 || echo "OK: managed does not import V3 runtime"
cd /home/godja/Dev/EU-Funds/app && grep -rn "from '.*managed/" src/lib/ai/agent/mcp/ 2>&1 || echo "OK: mcp does not import from managed"
```

- [ ] **Step 6: Phase 3a surface preserved check**

```bash
cd /home/godja/Dev/EU-Funds/app && git diff feature/phase3a-service-hardening -- src/lib/ai/agent/policy/ src/lib/ai/agent/services/sections.ts src/lib/ai/agent/services/application.ts | wc -l
```

Expected: the only service diff is the `ServiceContext.allowWrites` field addition. The policy module should have zero diff.

- [ ] **Step 7: Commit log review**

```bash
cd /home/godja/Dev/EU-Funds && git log --oneline <base-branch>..HEAD
```

Expected: ~24 commits, each prefixed `feat(phase3b):`, `refactor(phase3b):`, or `test(phase3b):`.

- [ ] **Step 8: Runbook checklist for flipping the flag**

Before `managed_agent_writes_enabled` is flipped on for the first user, the runbook requires:

1. This PR is merged to master
2. PR-B (history normalizer) is merged and in production
3. The normalizer metrics panel shows zero `classification_error` events in a sample of ≥100 managed turns
4. The managed write integration tests are green on CI
5. A staging deploy has exercised one real `save_section_draft` write end-to-end with a test user
6. On-call engineer signs off

The flag itself has no code coupling to this checklist — operational gate, documented in the runbook.

---

## Summary

| Task | Focus | Key deliverable |
|---|---|---|
| 1 | Refactor | Named exports on existing MCP write handlers |
| 2 | Infra | MCP write handlers propagate `policyCode` |
| 3 | MCP | `set_selected_call` handler |
| 4 | MCP | `freeze_outline` handler |
| 5 | MCP | `mark_section_stale` handler |
| 6 | MCP | `reject_section` handler |
| 7 | MCP | Register 4 new handlers |
| 8 | Refactor | `MANAGED_READ_ONLY_TOOLS` → `MANAGED_TOOLS` rename |
| 9 | Managed | 8 write tool entries |
| 10 | Managed | Four tool-name sets |
| 11 | Infra | `ServiceContext.allowWrites` |
| 12 | Schema | `managed_agent_writes_enabled` migration |
| 13 | Executor | Replace `KNOWN_WRITE_TOOLS` with `PHASE_4_BLOCKED` |
| 14 | Executor | `allowWrites` rollout gate |
| 15 | Executor | 8 write dispatch cases |
| 16 | Executor | `policyCode` error mapping |
| 17 | Executor | Write-tool observability log |
| 18 | Runtime | **Parallel-write cap (Desk Audit Fix 1)** |
| 19 | Route | Wire `managed_agent_writes_enabled` flag |
| 20 | Prompt | **Minimal delta** (write tools + 4 hard rules) |
| 21 | Integration | Write tool happy path |
| 22 | Integration | `allowWrites=false` block |
| 23 | Integration | Policy error recovery |
| 24 | Integration | Runtime parallel-write cap end-to-end |
| 25 | Verification | Full test + typecheck + lint + cross-boundary |

**Total:** 25 tasks, ~1,100 LOC added (~600 implementation, ~500 tests), ~300 LOC modified. Each task produces one focused commit.

---

## What PR-A does NOT deliver

- **No history normalizer** — PR-B scope. PR-A depends on PR-B being merged first.
- **No structured action support in managed runtime** — 3c.
- **No `create_export_snapshot` / `save_call_blueprint` exposure** — Phase 4.
- **No full bilingual prompt rewrite** — minimal delta only. Deferred to PR-C if needed.
- **No V3 runtime changes.** No frontend changes. No service-layer changes except the `allowWrites` field.

---

## Dependency diagram

```
Phase 3a (PR #18, merged)
  └─> V3 fix (PR #45, merged)
        └─> PR-B: History normalizer ← merge first
              └─> PR-A: Write surface ← this plan, merges second
                    └─> [ops] flip managed_agent_writes_enabled per-user
                          └─> 3c: Structured action bridge (future)
                                └─> 3d: Quality comparison harness (future)
```
