# Managed Agents Phase 2 — Read-Only Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a feature-flagged managed runtime that uses Anthropic's beta messages API with in-process tool dispatch to the Phase 1 service layer, keeping V3 as circuit-breaker fallback, exposing only 14 read+rules tools.

**Architecture:** New `lib/ai/agent/managed/` package with runtime, executor, tools, translator, prompt, history, circuit-breaker modules. `POST /api/ai/agent` dispatches based on feature flag + breaker state. All managed writes go through the same Phase 1 service layer V3 uses. Zero frontend changes — SSE `AgentEvent` contract preserved.

**Tech Stack:** TypeScript, Next.js 14 App Router, `@anthropic-ai/sdk` beta messages API, Drizzle ORM + postgres.js, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-04-10-managed-agents-phase2-design.md`

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `app/src/lib/ai/anthropic-client.ts` | `getAnthropicClient()` lazy singleton factory — single source of truth for Anthropic SDK client construction; tests stub this. |
| `app/src/lib/ai/agent/managed/circuit-breaker.ts` | `managedCircuitBreaker` instance, `DegradedReason` union, `recordManagedFailure`/`recordManagedSuccess` helpers. |
| `app/src/lib/ai/agent/managed/tools.ts` | `MANAGED_READ_ONLY_TOOLS: BetaTool[]` (14 tools) and `MANAGED_TOOL_NAMES: Set<string>`. Reuses Phase 1 Zod schemas via imports. |
| `app/src/lib/ai/agent/managed/translator.ts` | `translateAnthropicEvent(event, tctx) → AgentEvent \| null`, side-effect-free with caller-owned context. |
| `app/src/lib/ai/agent/managed/history.ts` | `loadManagedHistory(sessionId)` / `appendManagedMessage(sessionId, msg, meta)` helpers over `agent_messages`. |
| `app/src/lib/ai/agent/managed/prompt.ts` | `buildManagedSystemPrompt(session, sections, phase, locale)` — Phase 2 system prompt builder. |
| `app/src/lib/ai/agent/managed/executor.ts` | `executeManagedTool(block, ctx)` — switch-based dispatcher to Phase 1 services. |
| `app/src/lib/ai/agent/managed/runtime.ts` | `runManagedTurn(opts)` — the tool loop driver. |
| `app/drizzle/NNNN_runtime_mode_and_app_agent_sessions.sql` | Migration: `runtime_mode` enum + `application_agent_sessions` table. |
| `app/drizzle/NNNN_agent_messages_observability.sql` | Migration: adds `runtime_mode`/`provider`/`model` columns to `agent_messages`. |
| `app/drizzle/NNNN_managed_agent_enabled_flag.sql` | Migration: seed `managed_agent_enabled` feature flag row. |
| `app/tests/unit/managed/circuit-breaker.test.ts` | Unit tests for breaker state transitions. |
| `app/tests/unit/managed/translator.test.ts` | Unit tests for all 11 translator cases + full synthetic stream. |
| `app/tests/unit/managed/history.test.ts` | Unit tests for message round-trip conversion. |
| `app/tests/unit/managed/prompt.test.ts` | Unit tests for prompt builder. |
| `app/tests/unit/managed/executor.test.ts` | Unit tests for dispatch, write blocks, error mapping. |
| `app/tests/integration/managed/runtime-happy-path.test.ts` | One tool iteration → end_turn integration test. |
| `app/tests/integration/managed/runtime-multi-iteration.test.ts` | 3 tool iterations in one turn. |
| `app/tests/integration/managed/runtime-iteration-cap.test.ts` | Iteration cap triggers controlled stop. |
| `app/tests/integration/managed/runtime-tool-error.test.ts` | ServiceError → isError tool result. |
| `app/tests/integration/managed/runtime-write-tool-blocked.test.ts` | Write tool blocked with Phase 2 message. |
| `app/tests/integration/managed/route-pre-stream-fallback.test.ts` | Setup error → V3 fallback. |
| `app/tests/integration/managed/route-mid-stream-failure.test.ts` | Mid-stream Anthropic error → error SSE. |
| `app/tests/integration/managed/route-breaker-open.test.ts` | Breaker open → V3 even with flag on. |
| `app/tests/integration/managed/route-flag-off.test.ts` | Flag off → V3, no managed row. |

### Modified files

| File | Change |
|---|---|
| `app/src/lib/db/schema.ts` | Add `runtimeModeEnum` + `applicationAgentSessions` + 3 new columns on `agentMessages`. |
| `app/src/app/api/ai/agent/route.ts` | Add flag + breaker check, managed dispatch, pre-construction fallback. |
| `app/src/lib/ai/agent/mcp/read/*.ts` (9 files) | Promote local `inputShape` const to `export const inputShape`. |
| `app/src/lib/ai/agent/mcp/rules/*.ts` (5 files) | Same: promote `inputShape` to `export const inputShape`. |
| `app/src/messages/ro.json` | Add `managedAgent.*` keys. |
| `app/src/messages/en.json` | Add `managedAgent.*` keys. |

---

## Task 1: DB Schema — runtime_mode enum + application_agent_sessions table

**Files:**
- Modify: `app/src/lib/db/schema.ts`
- Create: `app/drizzle/NNNN_runtime_mode_and_app_agent_sessions.sql` (generated)

- [ ] **Step 1: Add `runtimeModeEnum` to schema.ts**

Open `app/src/lib/db/schema.ts`. Find the section near `agentSessionStatusEnum` (around line 870). Add after it:

```typescript
export const runtimeModeEnum = pgEnum('runtime_mode', ['v3', 'managed'])
```

- [ ] **Step 2: Add `applicationAgentSessions` table to schema.ts**

Add this table definition immediately after the `agentMessages` table definition (search for `export const agentMessages = pgTable`):

```typescript
export const applicationAgentSessions = pgTable('application_agent_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().unique()
    .references(() => agentSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id),

  runtimeMode: runtimeModeEnum('runtime_mode').notNull().default('managed'),
  createdWithFlag: boolean('created_with_flag').notNull().default(false),

  status: agentSessionStatusEnum('status').notNull().default('active'),

  degradedAt: timestamp('degraded_at', { withTimezone: true }),
  degradedReason: text('degraded_reason'),

  lastTurnAt: timestamp('last_turn_at', { withTimezone: true }),
  lastTurnModel: varchar('last_turn_model', { length: 50 }),
  lastTurnToolCount: integer('last_turn_tool_count').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (table) => ({
  idxUserStatus: index('idx_app_agent_sessions_user_status')
    .on(table.userId, table.status, table.updatedAt),
}))
```

Verify that the imports at the top of `schema.ts` already include `index`. If not, add it to the `drizzle-orm/pg-core` import.

- [ ] **Step 3: Generate the migration**

Run from the `app/` directory:

```bash
cd app && npm run db:generate
```

Expected: Drizzle prints the migration name (e.g. `0053_runtime_mode_and_app_agent_sessions`) and creates a new SQL file under `app/drizzle/`. Inspect the generated file; it should contain:
- `CREATE TYPE runtime_mode AS ENUM ('v3', 'managed');`
- `CREATE TABLE "application_agent_sessions" (...)`
- `CREATE INDEX "idx_app_agent_sessions_user_status" ...`

- [ ] **Step 4: Run the migration locally**

```bash
cd app && npm run db:push
```

Expected: `db:push` reports the new table/enum applied. If running migrations against a shared DB use `npm run db:migrate` instead.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/db/schema.ts drizzle/
git commit -m "feat(managed): add runtime_mode enum and application_agent_sessions table

New table stores managed-runtime metadata (runtime mode, degradation
reason, last turn model, tool count). Created lazily on first managed
turn. Never stores conversation content."
```

---

## Task 2: DB Schema — agent_messages observability columns

**Files:**
- Modify: `app/src/lib/db/schema.ts`
- Create: `app/drizzle/NNNN_agent_messages_observability.sql` (generated)

- [ ] **Step 1: Add 3 columns to `agentMessages` table definition**

In `app/src/lib/db/schema.ts`, find the existing `agentMessages` table definition. Add `runtimeMode`, `provider`, `model` columns after the existing columns (before the `}, (table) => (` closing) and add a new index:

```typescript
export const agentMessages = pgTable('agent_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 15 }).notNull(),
  messageType: varchar('message_type', { length: 20 }).notNull(),
  content: jsonb('content').notNull(),
  toolName: varchar('tool_name', { length: 100 }),
  toolCallId: varchar('tool_call_id', { length: 100 }),
  sequenceNumber: integer('sequence_number').notNull(),
  compactedAt: timestamp('compacted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // NEW: observability columns for Phase 2 managed runtime
  runtimeMode: runtimeModeEnum('runtime_mode').notNull().default('v3'),
  provider: varchar('provider', { length: 20 }),
  model: varchar('model', { length: 50 }),
}, (table) => ({
  idxSessionSeq: index('idx_agent_messages_seq').on(table.sessionId, table.sequenceNumber),
  idxSessionCompacted: index('idx_agent_messages_compacted').on(table.sessionId, table.compactedAt),
  idxRuntime: index('idx_agent_messages_runtime').on(table.runtimeMode, table.createdAt),
}))
```

- [ ] **Step 2: Generate the migration**

```bash
cd app && npm run db:generate
```

Expected: A new migration file appears under `app/drizzle/` containing `ALTER TABLE agent_messages ADD COLUMN runtime_mode runtime_mode NOT NULL DEFAULT 'v3'`, plus `provider` and `model` columns and the new index.

- [ ] **Step 3: Apply the migration**

```bash
cd app && npm run db:push
```

Expected: Reports the new columns applied. Existing rows get `runtime_mode='v3'` via the default; `provider` and `model` are NULL.

- [ ] **Step 4: Verify in the DB**

```bash
cd app && npx drizzle-kit introspect
```

Or use `npm run db:studio` → inspect `agent_messages` columns. Confirm the 3 new columns exist and `runtime_mode` defaults to `'v3'`.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/db/schema.ts drizzle/
git commit -m "feat(managed): add observability columns to agent_messages

Adds runtime_mode, provider, model columns to tag each persisted
message with which runtime produced it. Existing rows backfill
with runtime_mode='v3' via default."
```

---

## Task 3: Seed the `managed_agent_enabled` feature flag

**Files:**
- Create: `app/drizzle/NNNN_managed_agent_enabled_flag.sql`

- [ ] **Step 1: Check existing migrations for seed-file naming convention**

```bash
cd app && ls drizzle/*.sql | tail -10
```

Identify the next available sequence number (e.g., if last is `0054_...sql`, next is `0055_...sql`).

- [ ] **Step 2: Create the seed migration SQL**

Create `app/drizzle/NNNN_managed_agent_enabled_flag.sql` (replace `NNNN` with the next number) with:

```sql
INSERT INTO feature_flags (key, enabled, targeting, description)
VALUES (
  'managed_agent_enabled',
  false,
  '{}'::jsonb,
  'Route POST /api/ai/agent to the managed runtime for allowlisted users. Phase 2 pilot — discovery/research only, no writes.'
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 3: Register the file in `meta/_journal.json`**

Open `app/drizzle/meta/_journal.json`. Append a new entry matching the format of the previous entries, with `idx` incremented and `tag` matching the file name (minus `.sql`). Example (adapt to the actual incrementing values):

```json
{
  "idx": 55,
  "version": "7",
  "when": 1744243200000,
  "tag": "0055_managed_agent_enabled_flag",
  "breakpoints": true
}
```

Important: the `idx` and `tag` must match the file name. Check the preceding entry to determine `version` and `when` format.

- [ ] **Step 4: Apply the seed via `db:migrate`**

```bash
cd app && npm run db:migrate
```

Expected: The new seed migration runs, inserting the feature flag row.

- [ ] **Step 5: Verify the row exists**

```bash
cd app && npm run db:studio
```

Find `feature_flags` → confirm `managed_agent_enabled` row with `enabled=false` and `targeting={}`.

- [ ] **Step 6: Commit**

```bash
cd app && git add drizzle/
git commit -m "feat(managed): seed managed_agent_enabled feature flag (default off)

Feature flag is disabled by default; allowlist is empty. Enable
per-user via UPDATE feature_flags SET enabled=true, targeting with
userIds list."
```

---

## Task 4: Anthropic client factory

**Files:**
- Create: `app/src/lib/ai/anthropic-client.ts`
- Create: `app/tests/unit/managed/anthropic-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/managed/anthropic-client.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('getAnthropicClient', () => {
  const originalKey = process.env.ANTHROPIC_API_KEY

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalKey
  })

  it('returns the same instance across calls (singleton)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    const a = getAnthropicClient()
    const b = getAnthropicClient()
    expect(a).toBe(b)
  })

  it('throws if ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    expect(() => getAnthropicClient()).toThrow(/ANTHROPIC_API_KEY/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/managed/anthropic-client.test.ts
```

Expected: FAIL — module `@/lib/ai/anthropic-client` does not exist.

- [ ] **Step 3: Implement the factory**

Create `app/src/lib/ai/anthropic-client.ts`:

```typescript
// ── Anthropic SDK client factory ────────────────────────────────
// Lazy module-level singleton. Single source of truth for Anthropic
// client construction. Tests can stub `getAnthropicClient` via vi.mock.

import Anthropic from '@anthropic-ai/sdk'

let cachedClient: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (cachedClient) return cachedClient

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  cachedClient = new Anthropic({
    apiKey,
    timeout: 60_000, // 60s per request — longer than V3 because managed turns span multiple sub-streams
  })

  return cachedClient
}

// Test-only reset helper. Do not call from production code.
export function __resetAnthropicClientForTests(): void {
  cachedClient = null
}
```

- [ ] **Step 4: Update the test to reset between cases**

Add a reset call in `beforeEach` by modifying the test:

```typescript
beforeEach(async () => {
  vi.resetModules()
  try {
    const mod = await import('@/lib/ai/anthropic-client')
    mod.__resetAnthropicClientForTests()
  } catch { /* ignore — module might not exist in first test run */ }
})
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/managed/anthropic-client.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/anthropic-client.ts tests/unit/managed/anthropic-client.test.ts
git commit -m "feat(managed): add Anthropic client factory singleton

Lazy module-level singleton with test reset helper. Throws if
ANTHROPIC_API_KEY is missing. Single source of truth for SDK
client construction across the managed runtime."
```

---

## Task 5: Circuit breaker

**Files:**
- Create: `app/src/lib/ai/agent/managed/circuit-breaker.ts`
- Create: `app/tests/unit/managed/circuit-breaker.test.ts`

- [ ] **Step 1: Check the existing CircuitBreaker class signature**

```bash
cd app && grep -n "class CircuitBreaker" src/lib/errors/index.ts
```

If found, read its constructor signature. The plan assumes the constructor accepts `{ name, failureThreshold, resetTimeoutMs, monitoringPeriodMs }` and exposes `isOpen()`, `recordSuccess()`, `recordFailure()`. If the signature differs, adapt the wrapper in Step 3 accordingly.

- [ ] **Step 2: Write the failing test**

Create `app/tests/unit/managed/circuit-breaker.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('managedCircuitBreaker', () => {
  beforeEach(async () => {
    vi.resetModules()
    // Clear any previous state
    const mod = await import('@/lib/ai/agent/managed/circuit-breaker')
    if (mod.__resetBreakerForTests) mod.__resetBreakerForTests()
  })

  it('starts closed', async () => {
    const { managedCircuitBreaker } = await import('@/lib/ai/agent/managed/circuit-breaker')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('stays closed after 1 failure', async () => {
    const { managedCircuitBreaker, recordManagedFailure } =
      await import('@/lib/ai/agent/managed/circuit-breaker')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('opens after 3 consecutive failures', async () => {
    const { managedCircuitBreaker, recordManagedFailure } =
      await import('@/lib/ai/agent/managed/circuit-breaker')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(true)
  })

  it('resets failure count on success', async () => {
    const { managedCircuitBreaker, recordManagedFailure, recordManagedSuccess } =
      await import('@/lib/ai/agent/managed/circuit-breaker')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedSuccess()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false) // only 2 consecutive after reset
  })

  it('rejects invalid DegradedReason at compile time via TypeScript', async () => {
    // This test documents that DegradedReason is a type-checked union.
    // The actual check is at compile time; this is a runtime sanity check.
    const { recordManagedFailure } = await import('@/lib/ai/agent/managed/circuit-breaker')
    expect(() => recordManagedFailure('circuit_open')).not.toThrow()
    expect(() => recordManagedFailure('anthropic_unavailable')).not.toThrow()
    expect(() => recordManagedFailure('anthropic_timeout')).not.toThrow()
    expect(() => recordManagedFailure('stream_disconnect')).not.toThrow()
    expect(() => recordManagedFailure('auth_setup_failure')).not.toThrow()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd app && npx vitest run tests/unit/managed/circuit-breaker.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement the circuit breaker module**

Create `app/src/lib/ai/agent/managed/circuit-breaker.ts`:

```typescript
// ── Managed-agent circuit breaker ───────────────────────────────
// Per-process in-memory breaker that protects the managed runtime
// from cascading Anthropic API failures. 3 consecutive failures in
// a 10s window open the breaker; a 30s cooldown precedes a half-open
// probe on the next request.

import { CircuitBreaker } from '@/lib/errors'

export type DegradedReason =
  | 'circuit_open'
  | 'anthropic_unavailable'   // 401, 429, 5xx
  | 'anthropic_timeout'
  | 'stream_disconnect'
  | 'auth_setup_failure'

// Module-scoped singleton. Adapt the constructor call if the existing
// CircuitBreaker class uses a different signature.
export const managedCircuitBreaker = new CircuitBreaker({
  name: 'managed-agent',
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  monitoringPeriodMs: 10_000,
})

export function recordManagedFailure(_reason: DegradedReason): void {
  managedCircuitBreaker.recordFailure()
}

export function recordManagedSuccess(): void {
  managedCircuitBreaker.recordSuccess()
}

// Test-only reset. Do not call from production code.
export function __resetBreakerForTests(): void {
  const anyBreaker = managedCircuitBreaker as unknown as { reset?: () => void; state?: unknown }
  if (typeof anyBreaker.reset === 'function') anyBreaker.reset()
}
```

If the actual `CircuitBreaker` class in `@/lib/errors` has a different constructor or method names, adjust:
- Constructor params → match the class's actual shape
- `isOpen()` / `recordFailure()` / `recordSuccess()` — adapt to the actual method names

- [ ] **Step 5: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/managed/circuit-breaker.test.ts
```

Expected: All 5 tests PASS. If the "opens after 3 failures" test fails because of the reset helper not working, implement `__resetBreakerForTests` to clear the internal counter via whatever mechanism the existing `CircuitBreaker` class exposes.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/circuit-breaker.ts tests/unit/managed/circuit-breaker.test.ts
git commit -m "feat(managed): add circuit breaker with DegradedReason vocabulary

Per-process in-memory breaker opens after 3 consecutive failures
in a 10s window. 30s cooldown. DegradedReason is a typed union of
5 controlled values used for failure classification and ops
analytics."
```

---

## Task 6: Promote Phase 1 MCP input schemas to exports

**Files (all modified, all the same change):**
- `app/src/lib/ai/agent/mcp/read/search-calls.ts`
- `app/src/lib/ai/agent/mcp/read/get-call-blueprint.ts`
- `app/src/lib/ai/agent/mcp/read/retrieve-evidence.ts`
- `app/src/lib/ai/agent/mcp/read/get-application-state.ts`
- `app/src/lib/ai/agent/mcp/read/list-sections.ts`
- `app/src/lib/ai/agent/mcp/read/get-section.ts`
- `app/src/lib/ai/agent/mcp/read/get-validation-report.ts`
- `app/src/lib/ai/agent/mcp/read/get-project-summary.ts`
- `app/src/lib/ai/agent/mcp/read/list-uploaded-documents.ts`
- `app/src/lib/ai/agent/mcp/rules/run-eligibility.ts`
- `app/src/lib/ai/agent/mcp/rules/score-fit.ts`
- `app/src/lib/ai/agent/mcp/rules/validate-section.ts`
- `app/src/lib/ai/agent/mcp/rules/validate-application.ts`
- `app/src/lib/ai/agent/mcp/rules/check-missing-annexes.ts`

- [ ] **Step 1: Add `export` keyword to `inputShape` in each file**

For each of the 14 files listed above, open the file and change:

```typescript
const inputShape = {
  // ...
}
```

to:

```typescript
export const inputShape = {
  // ...
}
```

Also export a Zod object version at the bottom of each file so tools.ts has one single canonical shape per tool. After `export const inputShape = { ... }`, add:

```typescript
import { z } from 'zod'  // already imported at top in all files
export const inputSchema = z.object(inputShape)
```

Check each file for the exact variable name — most use `inputShape` but one may differ. If any file already has a differently-named schema, align it with this convention.

- [ ] **Step 2: Verify Phase 1 MCP tests still pass**

```bash
cd app && npx vitest run tests/unit/mcp
```

Expected: All existing MCP unit tests pass (no behavior change from adding `export`).

- [ ] **Step 3: Verify typecheck**

```bash
cd app && npm run typecheck
```

Expected: no errors. If any file imports `inputShape` from itself, fix the export convention to avoid circular references.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/ai/agent/mcp/read/ src/lib/ai/agent/mcp/rules/
git commit -m "refactor(mcp): export inputShape and inputSchema from Phase 1 handlers

Mechanical change to let the Phase 2 managed-agent tools.ts import
a single canonical Zod schema per tool. No behavior change to
existing MCP handlers."
```

---

## Task 7: Managed tool definitions

**Files:**
- Create: `app/src/lib/ai/agent/managed/tools.ts`
- Create: `app/tests/unit/managed/tools.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/managed/tools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { MANAGED_READ_ONLY_TOOLS, MANAGED_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'

describe('MANAGED_READ_ONLY_TOOLS', () => {
  it('contains exactly 14 tools (9 read + 5 rules)', () => {
    expect(MANAGED_READ_ONLY_TOOLS).toHaveLength(14)
  })

  it('each tool has name, description, and input_schema', () => {
    for (const tool of MANAGED_READ_ONLY_TOOLS) {
      expect(tool.name).toBeTypeOf('string')
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool.description).toBeTypeOf('string')
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.input_schema).toBeDefined()
      expect(tool.input_schema.type).toBe('object')
    }
  })

  it('MANAGED_TOOL_NAMES is a Set of all tool names', () => {
    expect(MANAGED_TOOL_NAMES.size).toBe(14)
    for (const tool of MANAGED_READ_ONLY_TOOLS) {
      expect(MANAGED_TOOL_NAMES.has(tool.name)).toBe(true)
    }
  })

  it('includes all 9 read tools', () => {
    const expected = new Set([
      'search_calls', 'get_call_blueprint', 'retrieve_evidence',
      'get_application_state', 'list_sections', 'get_section',
      'get_validation_report', 'get_project_summary', 'list_uploaded_documents',
    ])
    for (const name of expected) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it('includes all 5 rules tools', () => {
    const expected = new Set([
      'run_eligibility', 'score_fit', 'validate_section',
      'validate_application', 'check_missing_annexes',
    ])
    for (const name of expected) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(true)
    }
  })

  it('does NOT include any write tools', () => {
    const writeTools = [
      'save_section_draft', 'approve_revision', 'rollback_section',
      'save_call_blueprint', 'set_application_status', 'create_export_snapshot',
    ]
    for (const name of writeTools) {
      expect(MANAGED_TOOL_NAMES.has(name)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/managed/tools.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the tools module**

Create `app/src/lib/ai/agent/managed/tools.ts`:

```typescript
// ── Managed runtime tool definitions ────────────────────────────
// 14 tools exposed to Anthropic's Messages API in Phase 2: 9 read +
// 5 rules. Each tool's JSON schema is derived from the Phase 1 MCP
// handler's Zod schema via `zodToJsonSchema`. Write tools are NOT
// included — see spec §6.1 / §6.3 rule 1.

import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages'
import { zodToJsonSchema } from '../utils'

// Read tools
import { inputSchema as searchCallsSchema } from '../mcp/read/search-calls'
import { inputSchema as getCallBlueprintSchema } from '../mcp/read/get-call-blueprint'
import { inputSchema as retrieveEvidenceSchema } from '../mcp/read/retrieve-evidence'
import { inputSchema as getApplicationStateSchema } from '../mcp/read/get-application-state'
import { inputSchema as listSectionsSchema } from '../mcp/read/list-sections'
import { inputSchema as getSectionSchema } from '../mcp/read/get-section'
import { inputSchema as getValidationReportSchema } from '../mcp/read/get-validation-report'
import { inputSchema as getProjectSummarySchema } from '../mcp/read/get-project-summary'
import { inputSchema as listUploadedDocumentsSchema } from '../mcp/read/list-uploaded-documents'

// Rules tools
import { inputSchema as runEligibilitySchema } from '../mcp/rules/run-eligibility'
import { inputSchema as scoreFitSchema } from '../mcp/rules/score-fit'
import { inputSchema as validateSectionSchema } from '../mcp/rules/validate-section'
import { inputSchema as validateApplicationSchema } from '../mcp/rules/validate-application'
import { inputSchema as checkMissingAnnexesSchema } from '../mcp/rules/check-missing-annexes'

export const MANAGED_READ_ONLY_TOOLS: BetaTool[] = [
  {
    name: 'search_calls',
    description: 'Search EU funding calls by semantic similarity. Returns ranked matches with call ID, title, program, relevance score, and a short snippet. Read-only.',
    input_schema: zodToJsonSchema(searchCallsSchema) as BetaTool['input_schema'],
  },
  {
    name: 'get_call_blueprint',
    description: 'Look up a funding call blueprint by ID. Returns cached blueprint, or a cache-miss result containing raw evidence for extraction. Read-only.',
    input_schema: zodToJsonSchema(getCallBlueprintSchema) as BetaTool['input_schema'],
  },
  {
    name: 'retrieve_evidence',
    description: 'Retrieve evidence chunks from Qdrant for a query, optionally filtered by call ID. Returns top-scored chunks with source metadata. Read-only.',
    input_schema: zodToJsonSchema(retrieveEvidenceSchema) as BetaTool['input_schema'],
  },
  {
    name: 'get_application_state',
    description: 'Get the current application state for a session: phase, selected call, eligibility summary, section statuses, warnings. Read-only.',
    input_schema: zodToJsonSchema(getApplicationStateSchema) as BetaTool['input_schema'],
  },
  {
    name: 'list_sections',
    description: 'List sections for a session with key, title, status, and document order. Does not return section content. Read-only.',
    input_schema: zodToJsonSchema(listSectionsSchema) as BetaTool['input_schema'],
  },
  {
    name: 'get_section',
    description: 'Get full details of one section: title, status, content, accepted content, model used, sources. Read-only.',
    input_schema: zodToJsonSchema(getSectionSchema) as BetaTool['input_schema'],
  },
  {
    name: 'get_validation_report',
    description: 'Get the latest validation report for a session: issues, pass/fail summary, annex checklist. Read-only view of validation state.',
    input_schema: zodToJsonSchema(getValidationReportSchema) as BetaTool['input_schema'],
  },
  {
    name: 'get_project_summary',
    description: 'Get the project summary: name, organization type, sector, region, budget range, team size, description. Read-only.',
    input_schema: zodToJsonSchema(getProjectSummarySchema) as BetaTool['input_schema'],
  },
  {
    name: 'list_uploaded_documents',
    description: 'List documents uploaded for a project with filename, type, upload date, and size. Read-only.',
    input_schema: zodToJsonSchema(listUploadedDocumentsSchema) as BetaTool['input_schema'],
  },
  {
    name: 'run_eligibility',
    description: 'Run deterministic eligibility rules against a project summary and call ID. Returns eligible/not-eligible, score, passes, failures, warnings.',
    input_schema: zodToJsonSchema(runEligibilitySchema) as BetaTool['input_schema'],
  },
  {
    name: 'score_fit',
    description: 'Multi-dimensional project-to-call fit scoring. Returns overall score and per-dimension rationale.',
    input_schema: zodToJsonSchema(scoreFitSchema) as BetaTool['input_schema'],
  },
  {
    name: 'validate_section',
    description: 'Validate a section deterministically (placeholders, length, repetition). Returns issues, score, and recommended status.',
    input_schema: zodToJsonSchema(validateSectionSchema) as BetaTool['input_schema'],
  },
  {
    name: 'validate_application',
    description: 'Validate the entire application: section status summary, annex checklist, outstanding issues.',
    input_schema: zodToJsonSchema(validateApplicationSchema) as BetaTool['input_schema'],
  },
  {
    name: 'check_missing_annexes',
    description: 'Compare required annexes against uploaded documents. Returns required, uploaded, and missing lists.',
    input_schema: zodToJsonSchema(checkMissingAnnexesSchema) as BetaTool['input_schema'],
  },
]

export const MANAGED_TOOL_NAMES: Set<string> = new Set(MANAGED_READ_ONLY_TOOLS.map(t => t.name))
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/managed/tools.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/tools.ts tests/unit/managed/tools.test.ts
git commit -m "feat(managed): add Phase 2 tool definitions (14 read+rules tools)

Tool list reuses Phase 1 MCP Zod schemas via zodToJsonSchema. No
write tools exposed. MANAGED_TOOL_NAMES provides O(1) allowlist
membership check for the executor."
```

---

## Task 8: Event translator

**Files:**
- Create: `app/src/lib/ai/agent/managed/translator.ts`
- Create: `app/tests/unit/managed/translator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/managed/translator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  translateAnthropicEvent,
  createTranslatorContext,
} from '@/lib/ai/agent/managed/translator'
import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages'

describe('translateAnthropicEvent', () => {
  it('message_start captures model and emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 0 },
      },
    } as unknown as BetaRawMessageStreamEvent
    const result = translateAnthropicEvent(event, tctx)
    expect(result).toBeNull()
    expect(tctx.messageModel).toBe('claude-sonnet-4-6')
  })

  it('content_block_start type=text emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    } as unknown as BetaRawMessageStreamEvent
    expect(translateAnthropicEvent(event, tctx)).toBeNull()
  })

  it('content_block_start type=tool_use emits tool_start with empty input', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'tool_use', id: 'tu_1', name: 'search_calls', input: {} },
    } as unknown as BetaRawMessageStreamEvent
    const result = translateAnthropicEvent(event, tctx)
    expect(result).toEqual({ type: 'tool_start', tool: 'search_calls', input: {} })
  })

  it('content_block_delta text_delta emits text_delta', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Salut' },
    } as unknown as BetaRawMessageStreamEvent
    const result = translateAnthropicEvent(event, tctx)
    expect(result).toEqual({ type: 'text_delta', content: 'Salut' })
  })

  it('content_block_delta input_json_delta emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: '{"query":' },
    } as unknown as BetaRawMessageStreamEvent
    expect(translateAnthropicEvent(event, tctx)).toBeNull()
  })

  it('content_block_delta thinking_delta emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'thinking_delta', thinking: 'Let me think...' },
    } as unknown as BetaRawMessageStreamEvent
    expect(translateAnthropicEvent(event, tctx)).toBeNull()
  })

  it('content_block_stop emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'content_block_stop',
      index: 0,
    } as unknown as BetaRawMessageStreamEvent
    expect(translateAnthropicEvent(event, tctx)).toBeNull()
  })

  it('message_delta with stop_reason=max_tokens emits error', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'message_delta',
      delta: { stop_reason: 'max_tokens', stop_sequence: null },
      usage: { output_tokens: 4096 },
    } as unknown as BetaRawMessageStreamEvent
    const result = translateAnthropicEvent(event, tctx)
    expect(result).toEqual({
      type: 'error',
      message: 'Response truncated: model hit max token limit.',
      retryable: true,
    })
  })

  it('message_delta with stop_reason=end_turn emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 500 },
    } as unknown as BetaRawMessageStreamEvent
    expect(translateAnthropicEvent(event, tctx)).toBeNull()
  })

  it('message_delta with stop_reason=tool_use emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'message_delta',
      delta: { stop_reason: 'tool_use', stop_sequence: null },
      usage: { output_tokens: 300 },
    } as unknown as BetaRawMessageStreamEvent
    expect(translateAnthropicEvent(event, tctx)).toBeNull()
  })

  it('message_stop emits nothing', () => {
    const tctx = createTranslatorContext()
    const event = {
      type: 'message_stop',
    } as unknown as BetaRawMessageStreamEvent
    expect(translateAnthropicEvent(event, tctx)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/managed/translator.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the translator**

Create `app/src/lib/ai/agent/managed/translator.ts`:

```typescript
// ── Anthropic stream → AgentEvent translator ────────────────────
// Side-effect-free mapping function with caller-owned context.
// Returns null for events the frontend does not care about.
// The only state the translator touches is `tctx.messageModel`,
// written once when `message_start` is observed.

import type { BetaRawMessageStreamEvent } from '@anthropic-ai/sdk/resources/beta/messages'
import type { AgentEvent } from '../types'

export interface TranslatorContext {
  messageModel: string | null
}

export function createTranslatorContext(): TranslatorContext {
  return { messageModel: null }
}

export function translateAnthropicEvent(
  event: BetaRawMessageStreamEvent,
  tctx: TranslatorContext,
): AgentEvent | null {
  switch (event.type) {
    case 'message_start': {
      tctx.messageModel = event.message.model
      return null
    }

    case 'content_block_start': {
      if (event.content_block.type === 'tool_use') {
        return {
          type: 'tool_start',
          tool: event.content_block.name,
          input: {},
        }
      }
      return null
    }

    case 'content_block_delta': {
      if (event.delta.type === 'text_delta') {
        return { type: 'text_delta', content: event.delta.text }
      }
      return null
    }

    case 'content_block_stop':
      return null

    case 'message_delta': {
      if (event.delta.stop_reason === 'max_tokens') {
        return {
          type: 'error',
          message: 'Response truncated: model hit max token limit.',
          retryable: true,
        }
      }
      return null
    }

    case 'message_stop':
      return null

    default:
      return null
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/managed/translator.test.ts
```

Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/translator.ts tests/unit/managed/translator.test.ts
git commit -m "feat(managed): add Anthropic stream → AgentEvent translator

Side-effect-free mapping function with caller-owned context. Emits
tool_start early at content_block_start with empty input (UX-first
divergence from V3). Suppresses thinking_delta. max_tokens stop
reason emits retryable error event."
```

---

## Task 9: History helpers

**Files:**
- Create: `app/src/lib/ai/agent/managed/history.ts`
- Create: `app/tests/unit/managed/history.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/managed/history.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: {
    sessionId: 'session_id',
    sequenceNumber: 'sequence_number',
  },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
}))

describe('history helpers', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('loadManagedHistory', () => {
    it('returns empty array when no messages', async () => {
      const { db } = await import('@/lib/db')
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      })

      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory('sess-1')
      expect(result).toEqual([])
    })

    it('converts user text message to BetaMessageParam', async () => {
      const { db } = await import('@/lib/db')
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: 'msg-1', sessionId: 'sess-1', sequenceNumber: 0,
                role: 'user', messageType: 'text',
                content: 'Vreau fonduri',
                toolName: null, toolCallId: null,
                runtimeMode: 'managed', provider: null, model: null,
              },
            ]),
          }),
        }),
      })

      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory('sess-1')
      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('user')
      expect(result[0].content).toBe('Vreau fonduri')
    })

    it('converts assistant text message to BetaMessageParam', async () => {
      const { db } = await import('@/lib/db')
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: 'msg-2', sessionId: 'sess-1', sequenceNumber: 1,
                role: 'assistant', messageType: 'text',
                content: [{ type: 'text', text: 'Salut' }],
                toolName: null, toolCallId: null,
                runtimeMode: 'managed', provider: 'anthropic', model: 'claude-sonnet-4-6',
              },
            ]),
          }),
        }),
      })

      const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
      const result = await loadManagedHistory('sess-1')
      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('assistant')
    })
  })

  describe('appendManagedMessage', () => {
    it('inserts with runtime_mode, provider, model tags', async () => {
      const { db } = await import('@/lib/db')
      const insertValues = vi.fn().mockResolvedValue(undefined)
      ;(db.insert as any).mockReturnValue({ values: insertValues })
      ;(db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ sequenceNumber: 2 }]),
            }),
          }),
        }),
      })

      const { appendManagedMessage } = await import('@/lib/ai/agent/managed/history')
      await appendManagedMessage('sess-1', {
        role: 'user',
        messageType: 'text',
        content: 'Test',
      }, {
        runtimeMode: 'managed',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
      })

      expect(insertValues).toHaveBeenCalledOnce()
      const arg = insertValues.mock.calls[0][0]
      expect(arg.runtimeMode).toBe('managed')
      expect(arg.provider).toBe('anthropic')
      expect(arg.model).toBe('claude-sonnet-4-6')
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/managed/history.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement history.ts**

Create `app/src/lib/ai/agent/managed/history.ts`:

```typescript
// ── Managed runtime message history helpers ─────────────────────
// Read/write agent_messages rows as Anthropic BetaMessageParam shapes.
// Tags each appended message with runtime_mode, provider, model for
// observability.

import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages'
import { db } from '@/lib/db'
import { agentMessages } from '@/lib/db/schema'
import { eq, asc, desc } from 'drizzle-orm'

export interface ManagedMessageMeta {
  runtimeMode: 'v3' | 'managed'
  provider?: string | null
  model?: string | null
}

/**
 * Load all non-compacted messages for a session and convert to
 * Anthropic BetaMessageParam[] for replay in a managed turn.
 */
export async function loadManagedHistory(sessionId: string): Promise<BetaMessageParam[]> {
  const rows = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.sequenceNumber))

  const messages: BetaMessageParam[] = []
  for (const row of rows) {
    if (row.compactedAt) continue // skip compacted messages

    const role = row.role as 'user' | 'assistant'
    if (role !== 'user' && role !== 'assistant') continue

    // Content normalization: row.content can be a string (V3-style)
    // or an array of content blocks (Anthropic-native).
    const content = row.content
    if (typeof content === 'string') {
      messages.push({ role, content })
    } else if (Array.isArray(content)) {
      messages.push({ role, content: content as BetaMessageParam['content'] })
    } else {
      // Object form (e.g., structured action from V3) — serialize as text
      messages.push({ role, content: JSON.stringify(content) })
    }
  }

  return messages
}

/**
 * Append a new message to agent_messages with Phase 2 observability
 * tags (runtime_mode, provider, model).
 */
export async function appendManagedMessage(
  sessionId: string,
  message: {
    role: 'user' | 'assistant'
    messageType: 'text' | 'tool_use' | 'tool_result'
    content: unknown
    toolName?: string
    toolCallId?: string
  },
  meta: ManagedMessageMeta,
): Promise<number> {
  const [last] = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.sequenceNumber))
    .limit(1)

  const sequenceNumber = last ? last.sequenceNumber + 1 : 0

  await db.insert(agentMessages).values({
    sessionId,
    role: message.role,
    messageType: message.messageType,
    content: message.content as Record<string, unknown>,
    toolName: message.toolName ?? null,
    toolCallId: message.toolCallId ?? null,
    sequenceNumber,
    runtimeMode: meta.runtimeMode,
    provider: meta.provider ?? null,
    model: meta.model ?? null,
  })

  return sequenceNumber
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/managed/history.test.ts
```

Expected: All 4 tests PASS. If any test fails because of mock shape mismatches, adjust the mocks to match the actual Drizzle query chain.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/history.ts tests/unit/managed/history.test.ts
git commit -m "feat(managed): add managed history load/append helpers

loadManagedHistory reads agent_messages and converts to
BetaMessageParam[]. appendManagedMessage tags each insert with
runtime_mode, provider, model for observability."
```

---

## Task 10: Prompt builder

**Files:**
- Create: `app/src/lib/ai/agent/managed/prompt.ts`
- Create: `app/tests/unit/managed/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/managed/prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildManagedSystemPrompt } from '@/lib/ai/agent/managed/prompt'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'
import { MANAGED_TOOL_NAMES } from '@/lib/ai/agent/managed/tools'

const mockSession: AgentSession = {
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
}

describe('buildManagedSystemPrompt', () => {
  it('returns a non-empty string for Romanian locale', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.length).toBeGreaterThan(100)
  })

  it('includes Phase 2 scope notice (read-only)', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.toLowerCase()).toMatch(/read.?only|nu poți scrie|doar citire/)
  })

  it('mentions all 14 tool names (or confirms tool names are exposed via tools array)', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    // The prompt does not need to list every tool name, but it should reference
    // the tool categories (read, rules) that are available.
    expect(prompt.toLowerCase()).toMatch(/tool|instrument|apel/)
  })

  it('switches language on locale change', () => {
    const ro = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    const en = buildManagedSystemPrompt({ ...mockSession, locale: 'en' }, [], 'discovery', 'en')
    expect(ro).not.toBe(en)
  })

  it('includes hard rules (evidence discipline, no invented facts)', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.toLowerCase()).toMatch(/evidence|dovezi|nu inventa|never invent/)
  })

  it('includes current phase indicator', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    expect(prompt.toLowerCase()).toMatch(/discovery|descoperire/)
  })

  it('does not reference write tools', () => {
    const prompt = buildManagedSystemPrompt(mockSession, [], 'discovery', 'ro')
    const writeTools = ['save_section_draft', 'approve_revision', 'rollback_section']
    for (const name of writeTools) {
      expect(prompt).not.toContain(name)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/managed/prompt.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement prompt.ts**

Create `app/src/lib/ai/agent/managed/prompt.ts`:

```typescript
// ── Phase 2 managed-agent system prompt builder ─────────────────
// Fresh builder — does NOT import from V3 prompt.ts. Phase 2 scope
// is intentionally narrow (discovery + research, read-only), and
// reusing the V3 builder would force conditionals that make both
// harder to reason about.

import type { AgentSession, AgentSection, Phase } from '../types'

export function buildManagedSystemPrompt(
  session: AgentSession,
  sections: AgentSection[],
  phase: Phase,
  locale: 'ro' | 'en',
): string {
  return locale === 'ro' ? buildRomanianPrompt(session, sections, phase) : buildEnglishPrompt(session, sections, phase)
}

function buildRomanianPrompt(session: AgentSession, sections: AgentSection[], phase: Phase): string {
  const sectionLines = sections.length > 0
    ? sections.map(s => `- ${s.sectionKey} (${s.status})`).join('\n')
    : '(nicio secțiune încă)'

  return `Ești FondEU, un asistent expert pentru cereri de finanțare UE (fonduri europene) destinate organizațiilor din România.

## Modul curent (Faza 2 — Pilot de citire)

Ești în modul **read-only**. Poți căuta apeluri, citi documente, evalua eligibilitatea și calcula scoruri de potrivire. **Nu poți salva ciorne, aproba secțiuni, sau modifica starea cererii** — aceste operațiuni rămân în fluxul standard V3.

## Fazele permise în modul curent

Doar **descoperire** (discovery) și **cercetare** (research). Când ajungi la structurare, redactare sau revizuire, indică utilizatorului că aceste faze sunt gestionate de fluxul standard.

## Instrumentele tale

Ai acces la două categorii de instrumente:
- **Read** (citire): \`search_calls\`, \`get_call_blueprint\`, \`retrieve_evidence\`, \`get_application_state\`, \`list_sections\`, \`get_section\`, \`get_validation_report\`, \`get_project_summary\`, \`list_uploaded_documents\`
- **Rules** (reguli deterministe): \`run_eligibility\`, \`score_fit\`, \`validate_section\`, \`validate_application\`, \`check_missing_annexes\`

Toate rezultatele regulilor sunt deterministe — prezintă-le ca fapte.

## Reguli absolute

1. **Nu inventa niciodată** criterii de eligibilitate, sume de buget, cerințe de conformitate sau termene limită. Fiecare astfel de afirmație trebuie să provină dintr-un rezultat de instrument.
2. **Citează sursele**: pentru fiecare afirmație factuală, include "[Sursă: {titlu}]".
3. **Spune când nu știi**. Sugerează ce instrument ar putea ajuta.
4. **Nu depăși Faza 2**. Dacă utilizatorul cere să salvezi sau să aprobi ceva, explică politicos că în Faza 2 ești doar pentru citire și cerere de continuat în fluxul standard.

## Stil conversațional

- Vorbește în română, clar și direct.
- Folosește liste structurate pentru criterii, secțiuni și rezultate de validare.
- Nu repeta ce utilizatorul știe deja.

## Starea sesiunii curente

- Faza: ${phase}
- Apel selectat: ${session.selectedCallId ?? '(niciunul)'}
- Secțiuni:
${sectionLines}
- Avertismente active: ${session.warnings.length}
- Versiune stare: ${session.stateVersion}
`
}

function buildEnglishPrompt(session: AgentSession, sections: AgentSection[], phase: Phase): string {
  const sectionLines = sections.length > 0
    ? sections.map(s => `- ${s.sectionKey} (${s.status})`).join('\n')
    : '(no sections yet)'

  return `You are FondEU, an expert operator for Romanian EU funding applications (cereri de finanțare).

## Current mode (Phase 2 — Read-Only Pilot)

You are in **read-only mode**. You can search calls, read documents, evaluate eligibility, and compute fit scores. You **cannot save drafts, approve sections, or modify application state** — those operations remain in the standard V3 workflow.

## Allowed phases

Only **discovery** and **research**. When the user needs structuring, drafting, or review, explain that those phases are handled by the standard workflow.

## Your tools

You have access to two tool categories:
- **Read**: \`search_calls\`, \`get_call_blueprint\`, \`retrieve_evidence\`, \`get_application_state\`, \`list_sections\`, \`get_section\`, \`get_validation_report\`, \`get_project_summary\`, \`list_uploaded_documents\`
- **Rules** (deterministic): \`run_eligibility\`, \`score_fit\`, \`validate_section\`, \`validate_application\`, \`check_missing_annexes\`

All rule results are deterministic — present them as facts.

## Hard rules

1. **Never invent** eligibility criteria, budget figures, compliance requirements, or deadlines. Every such claim must come from a tool result.
2. **Cite sources**: for every factual claim, include "[Source: {title}]".
3. **Say when you don't know**. Suggest which tool could help.
4. **Do not exceed Phase 2**. If the user asks you to save or approve something, politely explain that Phase 2 is read-only and suggest continuing in the standard workflow.

## Communication style

- Speak English, clear and direct.
- Use structured lists for criteria, sections, and validation results.
- Do not repeat what the user already knows.

## Current session state

- Phase: ${phase}
- Selected call: ${session.selectedCallId ?? '(none)'}
- Sections:
${sectionLines}
- Active warnings: ${session.warnings.length}
- State version: ${session.stateVersion}
`
}
```

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/managed/prompt.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/prompt.ts tests/unit/managed/prompt.test.ts
git commit -m "feat(managed): add Phase 2 system prompt builder (RO + EN)

Fresh builder — does not share V3's prompt.ts. Phase 2 scope is
discovery+research read-only; prompt locks down allowed phases and
tools, includes evidence-discipline hard rules."
```

---

## Task 11: Tool executor

**Files:**
- Create: `app/src/lib/ai/agent/managed/executor.ts`
- Create: `app/tests/unit/managed/executor.test.ts`

- [ ] **Step 1: Write the failing test (covers happy path, write-block, unknown, error mapping)**

Create `app/tests/unit/managed/executor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages'
import type { ServiceContext } from '@/lib/ai/agent/services/types'
import {
  NotFoundError, AuthorizationError, ValidationError,
  ExternalDependencyError, ConcurrencyError,
} from '@/lib/ai/agent/services/errors'

const mockCtx: ServiceContext = {
  userId: '11111111-1111-4111-8111-111111111111',
  requestId: 'req-1',
  now: new Date(),
}

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn(),
  retrieveEvidence: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({
  lookupBlueprint: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/application', () => ({
  getApplicationState: vi.fn(),
  validateApplication: vi.fn(),
  checkMissingAnnexes: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/sections', () => ({
  listSections: vi.fn(),
  getSection: vi.fn(),
  validateSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/projects', () => ({
  getProjectSummary: vi.fn(),
  listUploadedDocuments: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({
  runEligibility: vi.fn(),
  scoreFit: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

function makeBlock(name: string, input: unknown = {}): BetaToolUseBlock {
  return {
    type: 'tool_use',
    id: 'tu_1',
    name,
    input: input as BetaToolUseBlock['input'],
  }
}

describe('executeManagedTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it('happy path: search_calls → service → serialized JSON', async () => {
    const { searchCalls } = await import('@/lib/ai/agent/services/evidence')
    ;(searchCalls as any).mockResolvedValue({ matches: [{ callId: 'C1', title: 'T', program: 'PNRR', score: 0.9, snippet: 's' }] })

    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(makeBlock('search_calls', { query: 'solar panels' }), mockCtx)

    expect(result.isError).toBe(false)
    expect(result.toolName).toBe('search_calls')
    expect(JSON.parse(result.content)).toEqual({ matches: expect.any(Array) })
  })

  it('blocks write tool with Phase 2 message', async () => {
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(makeBlock('save_section_draft'), mockCtx)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Phase 2')
    expect(result.content).toMatch(/read and evaluate|read-only/i)
  })

  it('blocks unknown tool name', async () => {
    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(makeBlock('made_up_tool'), mockCtx)

    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown tool')
  })

  it('maps NotFoundError to isError with NOT_FOUND prefix', async () => {
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    ;(lookupBlueprint as any).mockRejectedValue(new NotFoundError('call', 'CALL-X'))

    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(makeBlock('get_call_blueprint', { callId: 'CALL-X' }), mockCtx)

    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/^NOT_FOUND:/)
  })

  it('maps AuthorizationError with safe phrasing', async () => {
    const { getApplicationState } = await import('@/lib/ai/agent/services/application')
    ;(getApplicationState as any).mockRejectedValue(new AuthorizationError())

    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(
      makeBlock('get_application_state', { sessionId: '22222222-2222-4222-8222-222222222222' }),
      mockCtx,
    )

    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/^AUTHORIZATION:/)
    expect(result.content).toContain('Access denied')
  })

  it('maps unexpected errors to safe Internal tool error', async () => {
    const { searchCalls } = await import('@/lib/ai/agent/services/evidence')
    ;(searchCalls as any).mockRejectedValue(new Error('some internal detail with stack trace'))

    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(makeBlock('search_calls', { query: 'x' }), mockCtx)

    expect(result.isError).toBe(true)
    expect(result.content).toBe('Internal tool error')
    expect(result.content).not.toContain('stack trace')
  })

  it('records latencyMs', async () => {
    const { searchCalls } = await import('@/lib/ai/agent/services/evidence')
    ;(searchCalls as any).mockResolvedValue({ matches: [] })

    const { executeManagedTool } = await import('@/lib/ai/agent/managed/executor')
    const result = await executeManagedTool(makeBlock('search_calls', { query: 'x' }), mockCtx)

    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/managed/executor.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the executor**

Create `app/src/lib/ai/agent/managed/executor.ts`:

```typescript
// ── Managed runtime tool executor ───────────────────────────────
// In-process dispatcher: maps tool_use blocks to Phase 1 service
// calls. Allowlist via MANAGED_TOOL_NAMES. Write tools explicitly
// blocked with Phase 2 rejection message. All ServiceError subclasses
// mapped to isError tool results with safe content strings.

import type { BetaToolUseBlock } from '@anthropic-ai/sdk/resources/beta/messages'
import { MANAGED_TOOL_NAMES } from './tools'
import type { ServiceContext } from '../services/types'
import {
  ServiceError,
  NotFoundError,
  AuthorizationError,
  ValidationError,
  ConcurrencyError,
  ExternalDependencyError,
} from '../services/errors'
import * as evidence from '../services/evidence'
import * as blueprint from '../services/blueprint'
import * as application from '../services/application'
import * as sections from '../services/sections'
import * as projects from '../services/projects'
import * as eligibility from '../services/eligibility'

// Zod schemas from Phase 1 handlers
import { inputSchema as searchCallsSchema } from '../mcp/read/search-calls'
import { inputSchema as getCallBlueprintSchema } from '../mcp/read/get-call-blueprint'
import { inputSchema as retrieveEvidenceSchema } from '../mcp/read/retrieve-evidence'
import { inputSchema as getApplicationStateSchema } from '../mcp/read/get-application-state'
import { inputSchema as listSectionsSchema } from '../mcp/read/list-sections'
import { inputSchema as getSectionSchema } from '../mcp/read/get-section'
import { inputSchema as getValidationReportSchema } from '../mcp/read/get-validation-report'
import { inputSchema as getProjectSummarySchema } from '../mcp/read/get-project-summary'
import { inputSchema as listUploadedDocumentsSchema } from '../mcp/read/list-uploaded-documents'
import { inputSchema as runEligibilitySchema } from '../mcp/rules/run-eligibility'
import { inputSchema as scoreFitSchema } from '../mcp/rules/score-fit'
import { inputSchema as validateSectionSchema } from '../mcp/rules/validate-section'
import { inputSchema as validateApplicationSchema } from '../mcp/rules/validate-application'
import { inputSchema as checkMissingAnnexesSchema } from '../mcp/rules/check-missing-annexes'

import { logger } from '@/lib/logger'

const log = logger.child({ component: 'managed-executor' })

const KNOWN_WRITE_TOOLS = new Set([
  'save_section_draft',
  'approve_revision',
  'rollback_section',
  'save_call_blueprint',
  'set_application_status',
  'create_export_snapshot',
])

const MAX_CONTENT_BYTES = 16_000

export interface ExecutorResult {
  content: string
  isError: boolean
  toolName: string
  latencyMs: number
  truncated?: boolean
}

export async function executeManagedTool(
  block: BetaToolUseBlock,
  ctx: ServiceContext,
): Promise<ExecutorResult> {
  const start = Date.now()
  const { name, input } = block

  // 1. Allowlist check
  if (!MANAGED_TOOL_NAMES.has(name)) {
    if (KNOWN_WRITE_TOOLS.has(name)) {
      return errorResult(name, start,
        'Write tools are not available in Phase 2. The managed agent can only read and evaluate. ' +
        'To save, approve, or export, please use the standard workflow.',
      )
    }
    return errorResult(name, start, `Unknown tool: ${name}`)
  }

  // 2. Dispatch with timeout
  try {
    const result = await Promise.race([
      dispatchTool(name, input, ctx),
      new Promise((_, reject) => setTimeout(() => reject(new Error('tool_timeout')), 15_000)),
    ])

    let content = JSON.stringify(result)
    let truncated = false
    if (content.length > MAX_CONTENT_BYTES) {
      content = JSON.stringify(truncateResult(name, result))
      truncated = true
    }

    log.info({
      tool: name,
      latencyMs: Date.now() - start,
      isError: false,
      truncated,
      requestId: ctx.requestId,
    }, 'managed tool executed')

    return {
      content,
      isError: false,
      toolName: name,
      latencyMs: Date.now() - start,
      truncated,
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'tool_timeout') {
      return errorResult(name, start, 'Tool timed out after 15s')
    }
    if (err instanceof NotFoundError) {
      return errorResult(name, start, `NOT_FOUND: ${err.message}`)
    }
    if (err instanceof AuthorizationError) {
      return errorResult(name, start, 'AUTHORIZATION: Access denied to requested session')
    }
    if (err instanceof ValidationError) {
      return errorResult(name, start, `VALIDATION: ${err.message}`)
    }
    if (err instanceof ConcurrencyError) {
      return errorResult(name, start, `CONCURRENCY: ${err.message}`)
    }
    if (err instanceof ExternalDependencyError) {
      return errorResult(name, start, `EXTERNAL_DEPENDENCY: ${err.service} unavailable`)
    }
    if (err instanceof ServiceError) {
      return errorResult(name, start, `${err.code}: ${err.message}`)
    }
    log.error({
      tool: name,
      error: err instanceof Error ? err.message : String(err),
      requestId: ctx.requestId,
    }, 'unexpected managed tool error')
    return errorResult(name, start, 'Internal tool error')
  }
}

function errorResult(name: string, start: number, msg: string): ExecutorResult {
  return {
    content: msg,
    isError: true,
    toolName: name,
    latencyMs: Date.now() - start,
  }
}

/**
 * Structural truncation of oversized tool results. Returns a
 * reduced-size payload with truncated=true signal.
 */
function truncateResult(toolName: string, result: unknown): unknown {
  const base = {
    truncated: true,
    tool: toolName,
    originalSizeBytes: JSON.stringify(result).length,
    omitted: `Result exceeded ${MAX_CONTENT_BYTES} bytes. Top-ranked items only were included.`,
  }

  if (toolName === 'retrieve_evidence' && typeof result === 'object' && result !== null && 'chunks' in result) {
    const r = result as { chunks: unknown[] }
    return { ...base, summary: { chunks: r.chunks.slice(0, 5) } }
  }
  if (toolName === 'search_calls' && typeof result === 'object' && result !== null && 'matches' in result) {
    const r = result as { matches: unknown[] }
    return { ...base, summary: { matches: r.matches.slice(0, 5) } }
  }
  if (toolName === 'list_uploaded_documents' && Array.isArray(result)) {
    return { ...base, summary: result.slice(0, 10), remainderCount: result.length - 10 }
  }
  if (toolName === 'validate_application' && typeof result === 'object' && result !== null && 'issues' in result) {
    const r = result as { issues: unknown[]; summary?: unknown }
    return { ...base, summary: { summary: r.summary, issues: r.issues.slice(0, 10) } }
  }

  // Fallback: safe string truncation of the stringified result
  const stringified = JSON.stringify(result)
  return {
    ...base,
    fallbackPreview: stringified.slice(0, 8_000),
  }
}

async function dispatchTool(name: string, rawInput: unknown, ctx: ServiceContext): Promise<unknown> {
  switch (name) {
    case 'search_calls': {
      const i = searchCallsSchema.parse(rawInput)
      return evidence.searchCalls(ctx, i.query, { program: i.program, maxResults: i.maxResults })
    }
    case 'get_call_blueprint': {
      const i = getCallBlueprintSchema.parse(rawInput)
      return blueprint.lookupBlueprint(ctx, i.callId)
    }
    case 'retrieve_evidence': {
      const i = retrieveEvidenceSchema.parse(rawInput)
      return evidence.retrieveEvidence(ctx, i.query, { callId: i.callId, maxChunks: i.maxChunks })
    }
    case 'get_application_state': {
      const i = getApplicationStateSchema.parse(rawInput)
      return application.getApplicationState(ctx, i.sessionId)
    }
    case 'list_sections': {
      const i = listSectionsSchema.parse(rawInput)
      return sections.listSections(ctx, i.sessionId)
    }
    case 'get_section': {
      const i = getSectionSchema.parse(rawInput)
      return sections.getSection(ctx, i.sessionId, i.sectionKey)
    }
    case 'get_validation_report': {
      const i = getValidationReportSchema.parse(rawInput)
      return application.validateApplication(ctx, i.sessionId)
    }
    case 'get_project_summary': {
      const i = getProjectSummarySchema.parse(rawInput)
      return projects.getProjectSummary(ctx, i.projectId)
    }
    case 'list_uploaded_documents': {
      const i = listUploadedDocumentsSchema.parse(rawInput)
      return projects.listUploadedDocuments(ctx, i.projectId)
    }
    case 'run_eligibility': {
      const i = runEligibilitySchema.parse(rawInput)
      return eligibility.runEligibility(ctx, i as unknown as Parameters<typeof eligibility.runEligibility>[1])
    }
    case 'score_fit': {
      const i = scoreFitSchema.parse(rawInput)
      return eligibility.scoreFit(ctx, i as unknown as Parameters<typeof eligibility.scoreFit>[1])
    }
    case 'validate_section': {
      const i = validateSectionSchema.parse(rawInput)
      return sections.validateSection(ctx, i.sessionId, i.sectionKey)
    }
    case 'validate_application': {
      const i = validateApplicationSchema.parse(rawInput)
      return application.validateApplication(ctx, i.sessionId)
    }
    case 'check_missing_annexes': {
      const i = checkMissingAnnexesSchema.parse(rawInput)
      return application.checkMissingAnnexes(ctx, i.sessionId)
    }
    default:
      throw new Error(`Dispatcher has no handler for ${name}`)
  }
}
```

**Note:** the `run_eligibility` and `score_fit` casts to `Parameters<...>` are placeholders. If the actual service signatures accept a simpler object argument, replace with a direct call. Inspect `services/eligibility.ts` during implementation to get the real signatures.

- [ ] **Step 4: Run tests and verify they pass**

```bash
cd app && npx vitest run tests/unit/managed/executor.test.ts
```

Expected: All 7 tests PASS. If any test fails because of service signature mismatches, adjust the dispatch cases or the test mocks.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/executor.ts tests/unit/managed/executor.test.ts
git commit -m "feat(managed): add in-process tool executor

Dispatches 14 read+rules tools to Phase 1 service layer. Blocks
write tools with Phase 2 rejection message. Safe error mapping for
all ServiceError subclasses with no stack trace leaks. 16KB
structured truncation with per-tool strategies. 15s per-tool
timeout."
```

---

## Task 12: Managed runtime (the big one)

**Files:**
- Create: `app/src/lib/ai/agent/managed/runtime.ts`
- Create: `app/tests/integration/managed/runtime-happy-path.test.ts`

This task implements the core tool loop. It's large (~350 LOC) but follows directly from the spec §4. Tests focus on integration behavior; later tasks add more scenarios.

- [ ] **Step 1: Write the happy-path integration test**

Create `app/tests/integration/managed/runtime-happy-path.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Anthropic SDK to produce synthetic streaming events
vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({
    beta: {
      messages: {
        stream: vi.fn().mockImplementation(() => makeFakeStream([
          { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Salut, caut apeluri.' } },
          { type: 'content_block_stop', index: 0 },
          { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
          { type: 'message_stop' },
        ])),
      },
    },
  }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue([]),
          limit: vi.fn().mockResolvedValue([]),
        })),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number' },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

// Helper: build an async generator + .abort() shim matching the SDK's stream shape
function makeFakeStream(events: unknown[]) {
  const ai = {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
    abort: vi.fn(),
  }
  return ai
}

import type { AgentEvent, AgentSession } from '@/lib/ai/agent/types'

const mockSession: AgentSession = {
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
}

describe('runManagedTurn — happy path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits text_delta and done for a simple text-only turn', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: {
        requestId: 'req-1',
        locale: 'ro',
        message: 'Salut',
      },
      emit: (e) => events.push(e),
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-1',
        now: new Date(),
      },
    })

    const textDeltas = events.filter(e => e.type === 'text_delta')
    expect(textDeltas.length).toBeGreaterThan(0)
    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/integration/managed/runtime-happy-path.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the runtime (happy path first — no tool loop yet)**

Create `app/src/lib/ai/agent/managed/runtime.ts`:

```typescript
// ── Managed runtime — one-turn driver ───────────────────────────
// Runs one browser request through Anthropic's beta messages API.
// A single request can span multiple tool-use sub-streams inside the
// loop; all emissions go through a single SSE stream back to the
// frontend.

import type {
  BetaMessageParam,
  BetaToolUseBlock,
  BetaTextBlock,
  BetaRequestMCPToolResultBlockParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages'
import type {
  AgentEvent,
  AgentRequest,
  AgentSession,
  AgentSection,
  Phase,
  UIStateSnapshot,
} from '../types'
import type { ServiceContext } from '../services/types'
import { getAnthropicClient } from '@/lib/ai/anthropic-client'
import { MANAGED_READ_ONLY_TOOLS } from './tools'
import { translateAnthropicEvent, createTranslatorContext, type TranslatorContext } from './translator'
import { buildManagedSystemPrompt } from './prompt'
import { executeManagedTool, type ExecutorResult } from './executor'
import { loadManagedHistory, appendManagedMessage } from './history'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'managed-runtime' })

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS_PER_TURN = 4096
const ITERATION_CAP = 8

export interface ManagedRuntimeOptions {
  session: AgentSession
  sections: AgentSection[]
  request: AgentRequest
  emit: (event: AgentEvent) => void
  serviceCtx: ServiceContext
}

export interface ManagedTurnResult {
  toolCount: number
  iterationCount: number
  model: string | null
  latencyMs: number
}

export async function runManagedTurn(opts: ManagedRuntimeOptions): Promise<ManagedTurnResult> {
  const { session, sections, request, emit, serviceCtx } = opts
  const start = Date.now()
  const anthropic = getAnthropicClient()
  const tctx = createTranslatorContext()

  let toolCount = 0
  let iterationCount = 0

  // 1. Load history
  const history = await loadManagedHistory(session.id)

  // 2. Append the current user message if present
  if (request.message) {
    await appendManagedMessage(session.id, {
      role: 'user',
      messageType: 'text',
      content: request.message,
    }, { runtimeMode: 'managed' })
    history.push({ role: 'user', content: request.message })
  }

  // 3. Build the system prompt
  const systemPrompt = buildManagedSystemPrompt(session, sections, session.currentPhase as Phase, session.locale)

  // 4. Tool loop
  const runningMessages: BetaMessageParam[] = [...history]

  while (iterationCount < ITERATION_CAP) {
    iterationCount += 1

    const stream = anthropic.beta.messages.stream({
      model: MODEL,
      system: systemPrompt,
      tools: MANAGED_READ_ONLY_TOOLS,
      messages: runningMessages,
      max_tokens: MAX_TOKENS_PER_TURN,
    })

    const assistantBlocks: (BetaTextBlock | BetaToolUseBlock)[] = []
    const toolBlocksToExecute: BetaToolUseBlock[] = []
    const inputJsonAccumulators = new Map<number, string>()
    let stopReason: string | null = null

    try {
      for await (const event of stream as unknown as AsyncIterable<any>) {
        // Translate and emit
        const agentEvent = translateAnthropicEvent(event, tctx)
        if (agentEvent) emit(agentEvent)

        // Runtime-level bookkeeping
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            inputJsonAccumulators.set(event.index, '')
            assistantBlocks.push(event.content_block)
          } else if (event.content_block.type === 'text') {
            assistantBlocks.push({ ...event.content_block, text: '' })
          }
        }
        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const last = assistantBlocks[assistantBlocks.length - 1]
            if (last && last.type === 'text') last.text += event.delta.text
          } else if (event.delta.type === 'input_json_delta') {
            const existing = inputJsonAccumulators.get(event.index) ?? ''
            inputJsonAccumulators.set(event.index, existing + event.delta.partial_json)
          }
        }
        if (event.type === 'content_block_stop') {
          const block = assistantBlocks[assistantBlocks.length - 1]
          if (block && block.type === 'tool_use') {
            // Parse the accumulated input JSON
            const jsonStr = inputJsonAccumulators.get(event.index) ?? '{}'
            try {
              ;(block as BetaToolUseBlock).input = JSON.parse(jsonStr) as BetaToolUseBlock['input']
            } catch {
              ;(block as BetaToolUseBlock).input = {} as BetaToolUseBlock['input']
            }
            toolBlocksToExecute.push(block as BetaToolUseBlock)
          }
        }
        if (event.type === 'message_delta') {
          stopReason = event.delta?.stop_reason ?? stopReason
        }
      }
    } catch (err) {
      // Let the caller (route.ts) handle stream errors
      throw err
    }

    // Persist the assistant message
    if (assistantBlocks.length > 0) {
      await appendManagedMessage(session.id, {
        role: 'assistant',
        messageType: 'text',
        content: assistantBlocks,
      }, { runtimeMode: 'managed', provider: 'anthropic', model: tctx.messageModel })
      runningMessages.push({ role: 'assistant', content: assistantBlocks })
    }

    // If there are no tool calls, we're done
    if (toolBlocksToExecute.length === 0) {
      break
    }

    // Execute tools sequentially in emitted order
    const toolResultBlocks: BetaToolResultBlockParam[] = []
    for (const block of toolBlocksToExecute) {
      const result: ExecutorResult = await executeManagedTool(block, serviceCtx)
      toolCount += 1

      emit({
        type: 'tool_result',
        tool: result.toolName,
        summary: result.isError ? result.content : 'OK',
        success: !result.isError,
      })

      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result.content,
        is_error: result.isError,
      })

      await appendManagedMessage(session.id, {
        role: 'user',
        messageType: 'tool_result',
        content: [{
          type: 'tool_result',
          tool_use_id: block.id,
          content: result.content,
          is_error: result.isError,
        }],
        toolCallId: block.id,
        toolName: result.toolName,
      }, { runtimeMode: 'managed' })
    }

    runningMessages.push({ role: 'user', content: toolResultBlocks })

    // Continue the loop if the model wants more tools
    if (stopReason !== 'tool_use') {
      break
    }
  }

  // Iteration cap hit
  if (iterationCount >= ITERATION_CAP) {
    log.warn({
      sessionId: session.id,
      requestId: request.requestId,
      iterationCount,
    }, 'managed turn hit iteration cap')
    emit({
      type: 'text_delta',
      content: session.locale === 'ro'
        ? '\n\n(Limita de iterații atinsă. Vă rog, clarificați întrebarea.)'
        : '\n\n(Reached tool iteration limit. Please clarify your request.)',
    })
  }

  const finalState = buildUISnapshot(session, sections)
  emit({ type: 'done', finalState })

  log.info({
    sessionId: session.id,
    requestId: request.requestId,
    toolCount,
    iterationCount,
    model: tctx.messageModel,
    latencyMs: Date.now() - start,
  }, 'managed turn complete')

  return {
    toolCount,
    iterationCount,
    model: tctx.messageModel,
    latencyMs: Date.now() - start,
  }
}

function buildUISnapshot(session: AgentSession, sections: AgentSection[]): UIStateSnapshot {
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    selectedCallId: session.selectedCallId,
    outlineFrozen: session.outlineFrozen,
    sections: sections.map(s => ({
      key: s.sectionKey,
      title: s.title,
      status: s.status,
      documentOrder: s.documentOrder,
      generationOrder: s.generationOrder,
    })),
    warnings: session.warnings,
    stateVersion: session.stateVersion,
  } as UIStateSnapshot
}
```

**Note on `UIStateSnapshot`:** The `buildUISnapshot` function's return shape must match the existing `UIStateSnapshot` type in `../types`. Inspect the existing type and adjust the property set if necessary. The cast `as UIStateSnapshot` is a safety valve during TDD; remove it after aligning the shape.

- [ ] **Step 4: Run the happy-path test**

```bash
cd app && npx vitest run tests/integration/managed/runtime-happy-path.test.ts
```

Expected: PASS. If the test fails:
- Check that the mock Anthropic stream iterator protocol matches the actual SDK iterator (the `Symbol.asyncIterator` approach works for most recent SDK versions).
- Check that `UIStateSnapshot` type aligns.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/runtime.ts tests/integration/managed/runtime-happy-path.test.ts
git commit -m "feat(managed): add runtime tool loop driver

Single turn may span multiple Anthropic sub-streams inside the
iteration cap (8). Sequential tool execution in emitted order.
Persists assistant + tool_result messages via history helpers.
Emits tool_start/tool_result, text_delta, done to the SSE layer."
```

---

## Task 13: Additional runtime integration tests

**Files:**
- Create: `app/tests/integration/managed/runtime-multi-iteration.test.ts`
- Create: `app/tests/integration/managed/runtime-iteration-cap.test.ts`
- Create: `app/tests/integration/managed/runtime-tool-error.test.ts`
- Create: `app/tests/integration/managed/runtime-write-tool-blocked.test.ts`

These cover scenarios beyond the happy path. Each follows the same structure as Task 12's test file with a different synthetic stream and different assertions.

- [ ] **Step 1: Create `runtime-multi-iteration.test.ts`**

Mirror the happy-path test file. The mock stream should emit:
1. First sub-stream: assistant message with 1 `tool_use` block (`search_calls`), stop_reason=`tool_use`
2. Second sub-stream: assistant message with another `tool_use` (`get_call_blueprint`), stop_reason=`tool_use`
3. Third sub-stream: assistant message with text only, stop_reason=`end_turn`

Mock `executeManagedTool` (or the underlying services) to return successful results for both tool calls. Assert:
- `toolCount === 2`
- `iterationCount === 3`
- Events include 2 `tool_start` + 2 `tool_result`
- `done` is the last event

- [ ] **Step 2: Create `runtime-iteration-cap.test.ts`**

Mock stream always emits `stop_reason=tool_use` with a `tool_use` block for `search_calls`. The service mock returns a valid result each time. Run the turn and assert:
- `iterationCount === 8` (the cap)
- The final events include a `text_delta` containing "iteration limit" / "limita de iterații"
- `done` event emitted
- Log WARN includes `attemptedTools`

- [ ] **Step 3: Create `runtime-tool-error.test.ts`**

Mock stream emits 1 tool_use for `get_call_blueprint`. Mock `blueprint.lookupBlueprint` to throw `NotFoundError('call', 'CALL-X')`. Then a second sub-stream emits text and ends. Assert:
- `tool_result` event emitted with `success: false`
- `summary` / content includes `NOT_FOUND`
- Turn completes normally (no unhandled exception)
- `done` event emitted

- [ ] **Step 4: Create `runtime-write-tool-blocked.test.ts`**

Mock stream emits 1 tool_use for `save_section_draft`. Assert:
- No service function is invoked (mock service spies should be untouched)
- `tool_result` event emitted with `success: false`
- Content includes "Phase 2"

- [ ] **Step 5: Run all 4 new tests**

```bash
cd app && npx vitest run tests/integration/managed/runtime-multi-iteration.test.ts tests/integration/managed/runtime-iteration-cap.test.ts tests/integration/managed/runtime-tool-error.test.ts tests/integration/managed/runtime-write-tool-blocked.test.ts
```

Expected: All 4 tests PASS. If any fail, the likely cause is a discrepancy between the mock stream protocol and the runtime's event consumption loop. Debug by logging the events the test receives.

- [ ] **Step 6: Commit**

```bash
cd app && git add tests/integration/managed/
git commit -m "test(managed): add multi-iteration, iteration cap, tool error, write-block tests

Four integration scenarios covering: multiple sequential tool calls in
one turn; iteration cap triggers controlled stop; service error mapped
to tool_result isError; write tools rejected before service invocation."
```

---

## Task 14: Route integration + pre-construction fallback

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts`
- Create: `app/tests/integration/managed/route-pre-stream-fallback.test.ts`
- Create: `app/tests/integration/managed/route-mid-stream-failure.test.ts`
- Create: `app/tests/integration/managed/route-breaker-open.test.ts`
- Create: `app/tests/integration/managed/route-flag-off.test.ts`

- [ ] **Step 1: Modify the route handler**

Open `app/src/app/api/ai/agent/route.ts`. After the session-load logic and before the existing SSE `ReadableStream` construction, insert the managed-path branch.

Concretely, locate the current flow:

```typescript
// Existing V3 SSE stream construction
const encoder = new TextEncoder()
const stream = new ReadableStream({ /* ... */ })
return new Response(stream, { /* ... */ })
```

Replace with a new branching flow. Here's the complete new handler body (replace the old body below the session-load section):

```typescript
// Decide routing: managed vs V3
const managedEnabled = await isFeatureEnabled('managed_agent_enabled', { userId: user.id })

if (managedEnabled) {
  const { managedCircuitBreaker, recordManagedFailure } = await import('@/lib/ai/agent/managed/circuit-breaker')
  const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')

  if (!managedCircuitBreaker.isOpen()) {
    // Pre-construction setup — can still fall back cleanly
    try {
      getAnthropicClient() // throws if ANTHROPIC_API_KEY missing
    } catch (err) {
      recordManagedFailure('auth_setup_failure')
      log.warn({ sessionId: session.id, userId: user.id, reason: 'auth_setup_failure' }, 'managed setup failed, degrading to V3')
      // fall through to V3
      return runV3WithSSE(session, sections, body, user)
    }

    // Dispatch to managed runtime
    return runManagedWithSSE(session, sections, body, user)
  }
  // breaker open → fall through to V3
}

// V3 fallback path (default)
return runV3WithSSE(session, sections, body, user)
```

Then extract the existing V3 SSE construction into a helper `runV3WithSSE(session, sections, body, user)` in the same file (below the `handler` function). Create a parallel `runManagedWithSSE` helper that constructs its own `ReadableStream` and calls `runManagedTurn`:

```typescript
function runManagedWithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
): Response {
  const encoder = new TextEncoder()
  let firstByteFlushed = false

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentEvent) => {
        firstByteFlushed = true
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
      }

      try {
        const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
        const serviceCtx = {
          userId: user.id,
          sessionId: session.id,
          projectId: session.projectId ?? undefined,
          requestId: body.requestId,
          now: new Date(),
        }
        await runManagedTurn({ session, sections, request: body, emit, serviceCtx })

        const { recordManagedSuccess } = await import('@/lib/ai/agent/managed/circuit-breaker')
        recordManagedSuccess()
      } catch (err) {
        const { recordManagedFailure, type DegradedReason } = await import('@/lib/ai/agent/managed/circuit-breaker') as any
        const reason = classifyError(err)
        recordManagedFailure(reason)

        if (!firstByteFlushed) {
          log.warn({ sessionId: session.id, reason }, 'managed turn failed pre-first-byte')
        } else {
          log.error({ sessionId: session.id, reason }, 'managed turn failed mid-stream')
        }

        const msg = firstByteFlushed
          ? 'Agent encountered a problem mid-response. Please retry.'
          : 'Agent temporarily unavailable, please retry.'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: 'error',
          message: msg,
          retryable: true,
        })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

function classifyError(err: unknown): 'anthropic_unavailable' | 'anthropic_timeout' | 'stream_disconnect' {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    if (msg.includes('timeout')) return 'anthropic_timeout'
    if (msg.includes('401') || msg.includes('429') || msg.includes('5') && msg.includes('status')) {
      return 'anthropic_unavailable'
    }
    if (msg.includes('stream') || msg.includes('disconnect') || msg.includes('abort')) {
      return 'stream_disconnect'
    }
  }
  return 'stream_disconnect'
}

// runV3WithSSE wraps the EXISTING V3 stream logic — extract from the
// current handler body. It should contain everything inside the current
// `new ReadableStream({ start(controller) { ... } })` block.
function runV3WithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
): Response {
  // ...existing V3 logic moved here, including runAgentTurn call...
}
```

**Important:** the dynamic import of `DegradedReason` as `type` inside a value context is illegal. Replace with: `const { recordManagedFailure } = await import('@/lib/ai/agent/managed/circuit-breaker')`. Do not import types at runtime.

- [ ] **Step 2: Write the pre-stream fallback test**

Create `app/tests/integration/managed/route-pre-stream-fallback.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRunV3 = vi.fn()
const mockRunManaged = vi.fn()

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: vi.fn(() => {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }),
}))

vi.mock('@/lib/ai/agent/managed/runtime', () => ({
  runManagedTurn: mockRunManaged,
}))

vi.mock('@/lib/ai/agent/runtime', () => ({
  runAgentTurn: mockRunV3,
}))

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{
            id: 'sess-1', userId: 'user-1', stateVersion: 0, status: 'active',
            locale: 'ro', currentPhase: 'discovery', outlineFrozen: false,
            warnings: [],
          }]),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

describe('POST /api/ai/agent — pre-construction fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunV3.mockResolvedValue(undefined)
  })

  it('falls back to V3 when Anthropic client fails to initialize', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'req-1', locale: 'ro', sessionId: 'sess-1' }),
    })

    const res = await POST(req as any)

    // V3 should have been invoked
    expect(mockRunV3).toHaveBeenCalled()
    expect(mockRunManaged).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Write the breaker-open test**

Create `app/tests/integration/managed/route-breaker-open.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/ai/agent/managed/circuit-breaker', () => ({
  managedCircuitBreaker: { isOpen: () => true },
  recordManagedFailure: vi.fn(),
  recordManagedSuccess: vi.fn(),
}))

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRunManaged = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/ai/agent/managed/runtime', () => ({
  runManagedTurn: mockRunManaged,
}))

vi.mock('@/lib/ai/agent/runtime', () => ({
  runAgentTurn: mockRunV3,
}))

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{
            id: 'sess-1', userId: 'user-1', stateVersion: 0, status: 'active',
            locale: 'ro', currentPhase: 'discovery',
          }]),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

describe('POST /api/ai/agent — breaker open', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes to V3 when circuit breaker is open', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'req-1', locale: 'ro', sessionId: 'sess-1' }),
    })

    await POST(req as any)
    expect(mockRunV3).toHaveBeenCalled()
    expect(mockRunManaged).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Write the flag-off test**

Create `app/tests/integration/managed/route-flag-off.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}))

const mockRunV3 = vi.fn().mockResolvedValue(undefined)
const mockRunManaged = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/ai/agent/managed/runtime', () => ({
  runManagedTurn: mockRunManaged,
}))

vi.mock('@/lib/ai/agent/runtime', () => ({
  runAgentTurn: mockRunV3,
}))

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue([{
            id: 'sess-1', userId: 'user-1', stateVersion: 0, status: 'active',
            locale: 'ro', currentPhase: 'discovery',
          }]),
        })),
      })),
    })),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

describe('POST /api/ai/agent — flag off', () => {
  beforeEach(() => vi.clearAllMocks())

  it('routes to V3 when feature flag is off', async () => {
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new Request('http://localhost/api/ai/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: 'req-1', locale: 'ro', sessionId: 'sess-1' }),
    })

    await POST(req as any)
    expect(mockRunV3).toHaveBeenCalled()
    expect(mockRunManaged).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Write the mid-stream failure test**

Create `app/tests/integration/managed/route-mid-stream-failure.test.ts`. Structure: mock Anthropic stream to throw AFTER the first event is yielded. The test asserts:
- One error SSE event is enqueued
- `recordManagedFailure` was called with `'stream_disconnect'` or similar
- The response body contains `"type":"error"` and `"retryable":true`

Use the same mocking harness as the other route tests, but make `getAnthropicClient` succeed and make the stream itself throw mid-iteration. This test is the most delicate — adjust the mock stream shape to match the runtime's actual consumption protocol.

- [ ] **Step 6: Run all route tests**

```bash
cd app && npx vitest run tests/integration/managed/route-
```

Expected: All 4 route tests PASS. Failures likely indicate:
- The route-handler extraction of `runV3WithSSE` didn't preserve existing behavior — compare the refactored code against the pre-change route.ts
- Mock paths don't match actual import paths in the route handler
- The managed path was not wired correctly to the flag/breaker check

- [ ] **Step 7: Run the full managed test suite**

```bash
cd app && npx vitest run tests/unit/managed tests/integration/managed
```

Expected: all managed-path tests pass.

- [ ] **Step 8: Commit**

```bash
cd app && git add src/app/api/ai/agent/route.ts tests/integration/managed/route-*.test.ts
git commit -m "feat(managed): wire route handler to managed runtime with fallback

Route evaluates feature flag + circuit breaker + Anthropic client
setup before constructing the SSE stream. Pre-construction failure
degrades to V3 in the same request. Post-construction failures emit
error SSE events. V3 stream logic extracted to runV3WithSSE helper."
```

---

## Task 15: Lazy-create application_agent_sessions + observability updates

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts` (extend `runManagedWithSSE`)

- [ ] **Step 1: Create a helper to upsert the application_agent_sessions row**

Add to `app/src/lib/ai/agent/managed/session-metadata.ts` (new file):

```typescript
// ── application_agent_sessions upsert + observability updates ──

import { db } from '@/lib/db'
import { applicationAgentSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { DegradedReason } from './circuit-breaker'

export async function ensureAppAgentSession(
  sessionId: string,
  userId: string,
  createdWithFlag: boolean,
): Promise<void> {
  const [existing] = await db.select()
    .from(applicationAgentSessions)
    .where(and(
      eq(applicationAgentSessions.sessionId, sessionId),
      eq(applicationAgentSessions.userId, userId),
    ))
    .limit(1)

  if (existing) {
    await db.update(applicationAgentSessions)
      .set({ updatedAt: new Date() })
      .where(eq(applicationAgentSessions.id, existing.id))
    return
  }

  await db.insert(applicationAgentSessions).values({
    sessionId,
    userId,
    runtimeMode: 'managed',
    createdWithFlag,
    status: 'active',
  })
}

export async function markDegraded(
  sessionId: string,
  userId: string,
  reason: DegradedReason,
): Promise<void> {
  await db.update(applicationAgentSessions)
    .set({
      degradedAt: new Date(),
      degradedReason: reason,
      updatedAt: new Date(),
    })
    .where(and(
      eq(applicationAgentSessions.sessionId, sessionId),
      eq(applicationAgentSessions.userId, userId),
    ))
}

export async function recordTurnSuccess(
  sessionId: string,
  userId: string,
  model: string | null,
  toolCount: number,
): Promise<void> {
  await db.update(applicationAgentSessions)
    .set({
      lastTurnAt: new Date(),
      lastTurnModel: model,
      lastTurnToolCount: toolCount,
      updatedAt: new Date(),
    })
    .where(and(
      eq(applicationAgentSessions.sessionId, sessionId),
      eq(applicationAgentSessions.userId, userId),
    ))
}
```

- [ ] **Step 2: Wire the helper calls into `runManagedWithSSE` in route.ts**

In the managed path:
1. Before `runManagedTurn`: call `ensureAppAgentSession(session.id, user.id, true)`.
2. On success (after `recordManagedSuccess()`): call `recordTurnSuccess(session.id, user.id, result.model, result.toolCount)`.
3. On failure: call `markDegraded(session.id, user.id, reason)` before returning.

Update `runManagedTurn` in Task 12's runtime.ts to return `ManagedTurnResult` with `{ toolCount, iterationCount, model, latencyMs }` (already in the spec — verify the return shape is accessible in the route handler).

Similarly, wire `ensureAppAgentSession` call into the pre-construction fallback path (the setup-error case) so the DB row is created even when we fall back to V3 — this matches the spec's lazy-creation rule ("including requests that later degrade pre-stream to V3").

- [ ] **Step 3: Write a simple unit test for the metadata helpers**

Create `app/tests/unit/managed/session-metadata.test.ts` with mocked DB. Assert:
- `ensureAppAgentSession` inserts when no row exists
- `ensureAppAgentSession` bumps `updatedAt` when row exists
- `markDegraded` sets `degradedAt` and `degradedReason`
- `recordTurnSuccess` updates `lastTurnAt`, `lastTurnModel`, `lastTurnToolCount`

- [ ] **Step 4: Run the new tests**

```bash
cd app && npx vitest run tests/unit/managed/session-metadata.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Re-run route integration tests to confirm nothing regressed**

```bash
cd app && npx vitest run tests/integration/managed/
```

Expected: All route and runtime tests still PASS.

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/ai/agent/managed/session-metadata.ts src/app/api/ai/agent/route.ts tests/unit/managed/session-metadata.test.ts
git commit -m "feat(managed): lazy-create application_agent_sessions + observability

Row is created on first managed attempt (including pre-stream
fallback). On success: lastTurnAt, lastTurnModel, lastTurnToolCount
updated. On failure: degradedAt + degradedReason set. updated_at
bumped on every managed attempt."
```

---

## Task 16: i18n keys

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`

- [ ] **Step 1: Add managed-agent keys to ro.json**

Locate a suitable top-level section in `app/src/messages/ro.json` (e.g., alongside existing agent-related keys). Add:

```json
"managedAgent": {
  "pilotBadge": "Pilot — mod asistent gestionat",
  "degraded": "Asistentul gestionat este temporar indisponibil. Am revenit la modul standard.",
  "notAvailable": "Asistentul gestionat nu este disponibil pentru contul tău în Faza 2."
}
```

- [ ] **Step 2: Add the same keys to en.json**

```json
"managedAgent": {
  "pilotBadge": "Pilot — managed assistant mode",
  "degraded": "The managed assistant is temporarily unavailable. We switched back to the standard mode.",
  "notAvailable": "The managed assistant is not available for your account in Phase 2."
}
```

- [ ] **Step 3: Verify JSON is valid**

```bash
cd app && node -e "JSON.parse(require('fs').readFileSync('src/messages/ro.json', 'utf8')); JSON.parse(require('fs').readFileSync('src/messages/en.json', 'utf8')); console.log('OK')"
```

Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/messages/
git commit -m "feat(managed): add i18n keys for managed-agent pilot badge and degraded UI"
```

---

## Task 17: Final verification pass

- [ ] **Step 1: Run all managed tests**

```bash
cd app && npx vitest run tests/unit/managed tests/integration/managed
```

Expected: All tests pass.

- [ ] **Step 2: Run the full test suite to catch any V3 regressions**

```bash
cd app && npm run test
```

Expected: All tests pass. If any V3 test fails, the likely cause is the route.ts extraction — ensure `runV3WithSSE` preserves the exact previous logic.

- [ ] **Step 3: Run typecheck**

```bash
cd app && npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Run lint**

```bash
cd app && npm run lint
```

Expected: No new errors in `src/lib/ai/agent/managed/`, `src/app/api/ai/agent/route.ts`, or the test files.

- [ ] **Step 5: Verify layer rules (no cross-boundary imports)**

```bash
cd app && grep -r "from '.*runtime\.ts'" src/lib/ai/agent/managed/ 2>&1 || echo "OK: managed does not import from V3 runtime"
cd app && grep -r "from '.*managed/" src/lib/ai/agent/runtime.ts 2>&1 || echo "OK: V3 runtime does not import from managed"
cd app && grep -r "from '.*managed/" src/lib/ai/agent/tools/ 2>&1 || echo "OK: V3 tools does not import from managed"
```

Expected: three `OK` lines.

- [ ] **Step 6: Verify the feature flag is default off in the DB**

```bash
cd app && npm run db:studio
```

Inspect `feature_flags` → confirm `managed_agent_enabled` row exists with `enabled=false`.

- [ ] **Step 7: Smoke test locally with the flag on for one user**

```bash
# Find your dev user ID
cd app && npm run db:studio
# Find the users table, copy a user ID

# Flip the flag on for that user (replace <USER-ID>)
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = true, targeting = '{\"userIds\": [\"<USER-ID>\"]}'::jsonb WHERE key = 'managed_agent_enabled';"
```

Then run `npm run dev` and manually test a discovery turn. Verify:
- SSE events arrive in order
- `agent_messages` has rows with `runtime_mode='managed'`
- `application_agent_sessions` has a row for the session
- `last_turn_model` is populated

Revert the flag before committing:

```bash
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = false, targeting = '{}'::jsonb WHERE key = 'managed_agent_enabled';"
```

- [ ] **Step 8: Final commit (if any cleanup was needed)**

```bash
cd app && git status
# If there are cleanup commits, add + commit them
```

---

## Summary

| Task | Focus | Key deliverable |
|---|---|---|
| 1 | Schema | `runtime_mode` enum + `application_agent_sessions` table |
| 2 | Schema | Observability columns on `agent_messages` |
| 3 | Seed | `managed_agent_enabled` feature flag row (default off) |
| 4 | Infra | `getAnthropicClient()` factory |
| 5 | Infra | Circuit breaker singleton + DegradedReason union |
| 6 | Refactor | Export `inputShape`/`inputSchema` from Phase 1 handlers |
| 7 | Tool defs | `MANAGED_READ_ONLY_TOOLS` array (14 tools) |
| 8 | Translator | Anthropic stream → AgentEvent pure mapper |
| 9 | History | `loadManagedHistory` / `appendManagedMessage` helpers |
| 10 | Prompt | Phase 2 system prompt builder (RO + EN) |
| 11 | Executor | In-process tool dispatcher with ServiceError mapping |
| 12 | Runtime | Tool loop driver + happy-path integration test |
| 13 | Runtime | Multi-iteration, cap, tool error, write-block tests |
| 14 | Route | Feature flag + breaker + fallback + 4 route tests |
| 15 | Observability | Lazy-create `application_agent_sessions` + metadata updates |
| 16 | i18n | `managedAgent.*` RO/EN keys |
| 17 | Verification | Full test suite, lint, typecheck, layer rules, smoke test |
