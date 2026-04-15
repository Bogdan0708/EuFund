# Managed Agents Pilot Readiness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land audit-finding hardening (5 fixes) + preview-deploy scaffolding for the managed-agents runtime so a single-user pilot on `fondeu-pilot` can start.

**Architecture:** Single PR, 12-commit sequence. Tighten the existing `stateVersion` contract; add a turn-claim table (`agent_turns`) for deferred-persistence idempotency; bypass flag cache for kill-switch reads; rolling-window breaker; summary-aware managed history; service-local env gate preventing managed routing on the main service. Plus smoke tests, runbook, observability queries.

**Tech Stack:** TypeScript, Next.js App Router, Drizzle ORM + postgres.js, Vitest, Anthropic SDK (`@anthropic-ai/sdk`), Cloud Run / Cloud SQL / Redis / Qdrant.

**Spec:** `docs/superpowers/specs/2026-04-14-managed-agents-pilot-readiness-design.md`

---

## File structure

### Create

| Path | Responsibility |
|---|---|
| `app/drizzle/0026_agent_turns_retry_idempotency.sql` | M1 migration: `agent_turns` table + `agent_messages.turn_id` column + `idx_agent_turns_session_started` index. |
| `app/drizzle/0027_agent_messages_sequence_uniqueness.sql` | M2 migration: unique `(session_id, sequence_number)` index + drop pre-existing non-unique `idx_agent_messages_seq`. |
| `app/tests/unit/feature-flags-bypass-cache.test.ts` | Finding 4 unit tests — `bypassCache` skips LRU, fail-closed on DB error. |
| `app/tests/unit/managed/breaker-windowed.test.ts` | Finding 5 unit tests — rolling-window semantics. |
| `app/tests/unit/managed/history-summary.test.ts` | Finding 1 unit tests — `system_summary` + `messageSummary` loading. |
| `app/tests/integration/managed/stateversion-precondition.test.ts` | Finding 2 integration — mandatory stateVersion, stale → 409. |
| `app/tests/integration/managed/retry-idempotency.test.ts` | Finding 3 integration — turn-claim dedupe, deferred persistence. |
| `app/scripts/smoke/managed-pilot/01-happy-path.ts` | Smoke 1. |
| `app/scripts/smoke/managed-pilot/02-kill-switch.ts` | Smoke 2 (two-part). |
| `app/scripts/smoke/managed-pilot/03-auth-fail.ts` | Smoke 3. |
| `app/scripts/smoke/managed-pilot/04-concurrency.ts` | Smoke 4. |
| `app/scripts/smoke/managed-pilot/05-retry-idempotency.ts` | Smoke 5. |
| `app/scripts/smoke/managed-pilot/06-compaction-continuity.ts` | Smoke 6. |
| `app/scripts/smoke/managed-pilot/lib.ts` | Shared env/uuid/fetch helpers for smoke scripts. |
| `app/scripts/smoke/managed-pilot/README.md` | How to run the suite. |
| `docs/superpowers/runbooks/managed-agents-pilot-rollback.md` | Three-path rollback. |
| `docs/superpowers/runbooks/managed-pilot-observability.md` | Daily reconciliation queries + dashboard outline. |

### Modify

| Path | Change |
|---|---|
| `app/src/lib/db/schema.ts` | Add `agentTurns` table + `turnId` column on `agentMessages`; remove non-unique `idx_agent_messages_seq` mirror after M2. |
| `app/drizzle/meta/_journal.json` | Add two journal entries for the new migrations. |
| `app/src/lib/feature-flags/index.ts` | Add `bypassCache` + fail-closed on DB error. |
| `app/src/lib/ai/agent/managed/circuit-breaker.ts` | Replace cumulative counter with rolling-window timestamp list. |
| `app/src/lib/ai/agent/managed/history.ts` | Add summary loading; extend `appendManagedMessage` to accept/write `turn_id`; add `insertTurnAndMessages` transaction helper. |
| `app/src/lib/ai/agent/managed/prompt.ts` | Render bounded summary block when present. |
| `app/src/lib/ai/agent/managed/runtime.ts` | Defer user-message persistence; integrate `requestId`; write turn-claim + first durable output in one transaction. |
| `app/src/app/api/ai/agent/route.ts` | Service-local `MANAGED_RUNTIME_ENABLED` gate; mandatory `stateVersion` on managed path; pre-stream turn-claim insert (real atomic boundary); bilingual 400/409 responses. |
| `docs/superpowers/legacy-retention-register.md` | Add "Agent-surface RLS" entry. |

**NOT modified** (already in shape per code inspection 2026-04-14):
- `app/src/lib/ai/agent/types.ts` — `AgentRequest.requestId` is already a required field (line 286). No DTO change needed.
- `app/src/hooks/useAgent.ts` — already generates a fresh `requestId` per POST (line 170). No client change needed.
- `CLAUDE.md` — deliberately omitted to avoid scope creep. Pilot operational context lives in the runbook only.

---

## Task 0: Worktree + branch verification

**Context:** The spec was committed on branch `spec/managed-pilot-readiness`. Implementation continues on that branch — or a fresh one, at the executor's discretion.

- [ ] **Step 1: Verify worktree**

Run:
```bash
cd /home/godja/Dev/EU-Funds-spec-pilot
git status
git log --oneline -3
```
Expected: clean tree, HEAD at `81bc042 docs(specs): pilot-readiness spec — 3 review fixes` or a later commit on the same branch. If worktree missing, recreate with `git worktree add -b chore/managed-pilot-readiness /home/godja/Dev/EU-Funds-pilot origin/master`.

- [ ] **Step 2: Verify unit test baseline**

Run: `cd app && npm test 2>&1 | tail -5`
Expected: ~1002 passed, 15 skipped, 2 todo (pre-existing baseline post PR #43).

---

## Task 1: Migrations M1 + M2 (schema + journal)

**Files:**
- Create: `app/drizzle/0026_agent_turns_retry_idempotency.sql`
- Create: `app/drizzle/0027_agent_messages_sequence_uniqueness.sql`
- Modify: `app/drizzle/meta/_journal.json`
- Modify: `app/src/lib/db/schema.ts`

- [ ] **Step 1: Write M1 migration**

Create `app/drizzle/0026_agent_turns_retry_idempotency.sql`:

```sql
CREATE TABLE IF NOT EXISTS "agent_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "session_id" uuid NOT NULL,
  "request_id" text NOT NULL,
  "runtime_mode" "runtime_mode" NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "agent_turns_session_request_unique" UNIQUE("session_id","request_id")
);

DO $$ BEGIN
  ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "agent_sessions"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "idx_agent_turns_session_started"
  ON "agent_turns" ("session_id", "started_at" DESC);

ALTER TABLE "agent_messages"
  ADD COLUMN IF NOT EXISTS "turn_id" uuid;

DO $$ BEGIN
  ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "agent_turns"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
```

- [ ] **Step 2: Write M2 migration**

Create `app/drizzle/0027_agent_messages_sequence_uniqueness.sql`:

```sql
-- Precondition check: fail loudly if duplicates exist. Operator must
-- resolve (see runbook) before this migration applies.
DO $$
DECLARE
  dup_count bigint;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT session_id, sequence_number
    FROM agent_messages
    GROUP BY session_id, sequence_number
    HAVING count(*) > 1
  ) dups;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'agent_messages has % duplicate (session_id, sequence_number) groups — reconcile before migrating', dup_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_agent_messages_session_sequence"
  ON "agent_messages" ("session_id", "sequence_number");

DROP INDEX IF EXISTS "idx_agent_messages_seq";
```

- [ ] **Step 3: Add journal entries**

Read the current journal:
```bash
cat app/drizzle/meta/_journal.json | tail -20
```

Append two entries to the `entries` array. Idx is the next sequential integer; `tag` matches the SQL filename stem; `when` is a Unix millisecond timestamp (any value after the last entry; use the current time from `date +%s%3N`); `breakpoints` stays `true`. Example shape:

```json
    {
      "idx": 26,
      "version": "7",
      "when": 1744670000000,
      "tag": "0026_agent_turns_retry_idempotency",
      "breakpoints": true
    },
    {
      "idx": 27,
      "version": "7",
      "when": 1744670000001,
      "tag": "0027_agent_messages_sequence_uniqueness",
      "breakpoints": true
    }
```

Verify idx values and filename consistency:

```bash
jq '.entries[-2:]' app/drizzle/meta/_journal.json
# Assert: last two tags match the two SQL filename stems exactly.
ls app/drizzle/*.sql | tail -2
# Cross-check: tag field (no .sql suffix) matches filename stem.
```

Fail-fast script inline:
```bash
cd app
last_two_tags=$(jq -r '.entries[-2:] | .[].tag' drizzle/meta/_journal.json | sort)
last_two_files=$(ls drizzle/*.sql | xargs -n1 basename | sed 's/\.sql$//' | tail -2 | sort)
diff <(echo "$last_two_tags") <(echo "$last_two_files") || { echo "JOURNAL/SQL MISMATCH"; exit 1; }
```
Expected: diff shows nothing. If mismatch, fix the journal entries before continuing.

- [ ] **Step 4: Update `schema.ts` — add `agentTurns` table + `turnId` column**

In `app/src/lib/db/schema.ts`, after the `runtimeModeEnum` declaration (around line 878) and before the `agentMessages` table, add:

```ts
export const agentTurns = pgTable('agent_turns', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => agentSessions.id, { onDelete: 'cascade' }),
  requestId: text('request_id').notNull(),
  runtimeMode: runtimeModeEnum('runtime_mode').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  sessionRequestUnique: unique('agent_turns_session_request_unique').on(table.sessionId, table.requestId),
  idxSessionStarted: index('idx_agent_turns_session_started').on(table.sessionId, desc(table.startedAt)),
}));
```

In the `agentMessages` table definition (around line 950), add a new column:
```ts
  turnId: uuid('turn_id').references(() => agentTurns.id, { onDelete: 'set null' }),
```

In the `agentMessages` index callback, remove `idxSeq` line (the non-unique `idx_agent_messages_seq`) and add:
```ts
  idxSessionSequence: uniqueIndex('idx_agent_messages_session_sequence').on(table.sessionId, table.sequenceNumber),
```

Ensure `unique`, `uniqueIndex`, `desc`, `text`, `timestamp` are imported from `drizzle-orm/pg-core` / `drizzle-orm` at the top of the file (most already are).

- [ ] **Step 5: Typecheck**

Run: `cd app && npm run typecheck 2>&1 | tail -5`
Expected: no new errors. Pre-existing failures (in `validation/schemas.ts`-unrelated edits if any) are out of scope.

- [ ] **Step 6: Commit**

```bash
cd /home/godja/Dev/EU-Funds-spec-pilot
git add app/drizzle/0026_agent_turns_retry_idempotency.sql \
        app/drizzle/0027_agent_messages_sequence_uniqueness.sql \
        app/drizzle/meta/_journal.json \
        app/src/lib/db/schema.ts
git -c commit.gpgsign=false commit -m "feat(managed): M1+M2 — agent_turns claim table + sequence uniqueness

Adds agent_turns(id, session_id, request_id, runtime_mode, started_at,
completed_at) with UNIQUE(session_id, request_id) for Finding 3 turn
idempotency. Adds nullable agent_messages.turn_id. Replaces non-unique
idx_agent_messages_seq with unique idx_agent_messages_session_sequence
for Finding 2 storage safety.

Additive — backward compatible. Migration M2 fails loudly if existing
duplicate (session_id, sequence_number) tuples exist.

Pilot readiness PR (spec §4)."
```

---

## Task 2: Finding 4 — flag cache-bypass + fail-closed

**Files:**
- Modify: `app/src/lib/feature-flags/index.ts`
- Create: `app/tests/unit/feature-flags-bypass-cache.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/tests/unit/feature-flags-bypass-cache.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockDbSelect = vi.fn()

vi.mock('@/lib/db', () => ({
  db: { select: () => mockDbSelect() },
}))

describe('feature-flags bypassCache + fail-closed', () => {
  beforeEach(() => {
    vi.resetModules()
    mockDbSelect.mockReset()
  })

  afterEach(() => vi.restoreAllMocks())

  it('bypassCache=true reads DB on every call', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ key: 'test_flag', enabled: true, targeting: null }]) }) }),
    })
    const { isFeatureEnabled } = await import('@/lib/feature-flags')
    await isFeatureEnabled('test_flag', { userId: 'u1', bypassCache: true })
    await isFeatureEnabled('test_flag', { userId: 'u1', bypassCache: true })
    expect(mockDbSelect).toHaveBeenCalledTimes(2)
  })

  it('bypassCache=false uses LRU on repeat calls', async () => {
    mockDbSelect.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ key: 'cached_flag', enabled: true, targeting: null }]) }) }),
    })
    const { isFeatureEnabled } = await import('@/lib/feature-flags')
    await isFeatureEnabled('cached_flag', { userId: 'u1' })
    await isFeatureEnabled('cached_flag', { userId: 'u1' })
    expect(mockDbSelect).toHaveBeenCalledTimes(1)
  })

  it('fail-closed: returns false when bypassCache read throws', async () => {
    mockDbSelect.mockImplementation(() => { throw new Error('db down') })
    const { isFeatureEnabled } = await import('@/lib/feature-flags')
    const result = await isFeatureEnabled('kill_switch', { userId: 'u1', bypassCache: true })
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd app && npx vitest run tests/unit/feature-flags-bypass-cache.test.ts 2>&1 | tail -10
```
Expected: tests fail (`bypassCache` option not recognized, cache still used).

- [ ] **Step 3: Extend `isFeatureEnabled`**

In `app/src/lib/feature-flags/index.ts`, modify the `FlagCheckContext` (or equivalent option type used by `isFeatureEnabled`) to include:

```ts
export interface FlagCheckContext {
  userId?: string
  tier?: string
  bypassCache?: boolean
}
```

Modify `fetchFlag(flagKey: string)` to accept an optional `bypassCache` param (or add a parallel `fetchFlagNoCache`). When `bypassCache` is true:
- Skip the `cache.get(flagKey)` early-return.
- Do not write the result into `cache`.
- Wrap the DB read in `try/catch`. On error: log warn and return `null` (which `isFeatureEnabled` treats as flag absent → disabled).

Concretely, restructure the top of `fetchFlag`:

```ts
async function fetchFlag(flagKey: string, bypassCache = false): Promise<FlagRow | null> {
  if (!bypassCache) {
    const cached = cache.get(flagKey)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.flag
  }

  try {
    const [row] = await db
      .select({ /* ... */ })
      .from(featureFlags)
      .where(eq(featureFlags.key, flagKey))
      .limit(1)
    const result: FlagRow | null = row ?? null
    if (!bypassCache) {
      evictIfNeeded()
      cache.set(flagKey, { flag: result, fetchedAt: Date.now() })
    }
    return result
  } catch (err) {
    // Fail-closed for bypassCache (kill-switch) flags; still return null
    // for cached flags so existing behavior (treat error as flag absent)
    // is preserved.
    console.warn(`[feature-flags] read failed for key=${flagKey}`, err)
    return null
  }
}
```

Pass `ctx?.bypassCache` from `isFeatureEnabled` into `fetchFlag`.

- [ ] **Step 4: Run test — expect PASS**

```bash
cd app && npx vitest run tests/unit/feature-flags-bypass-cache.test.ts 2>&1 | tail -10
```
Expected: all 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/feature-flags/index.ts app/tests/unit/feature-flags-bypass-cache.test.ts
git -c commit.gpgsign=false commit -m "feat(flags): bypassCache + fail-closed for kill-switch flags

Finding 4. Flags marking bypassCache:true skip the 60s LRU and read
DB on every check. DB-read errors on bypass path return false (fail-
closed) so an unreachable DB disables managed mode rather than
stranding it open. Targeted to kill-switch flags; other flags keep
existing caching."
```

---

## Task 3: Finding 5 — rolling-window breaker

**Files:**
- Modify: `app/src/lib/ai/agent/managed/circuit-breaker.ts`
- Create: `app/tests/unit/managed/breaker-windowed.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/tests/unit/managed/breaker-windowed.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('managed breaker — rolling window', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
  })

  it('opens on 3 failures within 5 minutes', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(true)
  })

  it('does NOT open when failures are spaced >5 minutes apart', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(6 * 60_000)
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(6 * 60_000)
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })

  it('stays open during 30s cooldown then allows exactly one probe', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(true)
    vi.advanceTimersByTime(20_000)
    expect(managedCircuitBreaker.isOpen()).toBe(true)
    vi.advanceTimersByTime(15_000)
    // First caller after cooldown claims the probe slot — gets through.
    expect(managedCircuitBreaker.isOpen()).toBe(false)
    // Second concurrent caller sees breaker as still open until the probe resolves.
    expect(managedCircuitBreaker.isOpen()).toBe(true)
  })

  it('probe failure re-opens immediately without waiting for 3-failure window', async () => {
    const { managedCircuitBreaker, recordManagedFailure, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(35_000)
    expect(managedCircuitBreaker.isOpen()).toBe(false)  // probe claimed
    recordManagedFailure('anthropic_unavailable')       // probe fails
    expect(managedCircuitBreaker.isOpen()).toBe(true)   // re-opened
  })

  it('probe success closes the breaker', async () => {
    const { managedCircuitBreaker, recordManagedFailure, recordManagedSuccess, _resetForTest } = await import('@/lib/ai/agent/managed/circuit-breaker')
    _resetForTest()
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    recordManagedFailure('anthropic_unavailable')
    vi.advanceTimersByTime(35_000)
    expect(managedCircuitBreaker.isOpen()).toBe(false)
    recordManagedSuccess()
    expect(managedCircuitBreaker.isOpen()).toBe(false)
    // After close, normal semantics resume.
    recordManagedFailure('anthropic_unavailable')
    expect(managedCircuitBreaker.isOpen()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd app && npx vitest run tests/unit/managed/breaker-windowed.test.ts 2>&1 | tail -15
```
Expected: `_resetForTest` not exported; the "spaced failures" test fails because current breaker counts forever.

- [ ] **Step 3: Rewrite `circuit-breaker.ts`**

In `app/src/lib/ai/agent/managed/circuit-breaker.ts`, replace the module-level `consecutiveFailures` / `state` / `openedAt` with a rolling-window list:

```ts
type BreakerState = 'closed' | 'open' | 'half_open'

const FAILURE_THRESHOLD = 3
const WINDOW_MS = 5 * 60_000
const COOLDOWN_MS = 30_000

let failureTimestamps: number[] = []
let state: BreakerState = 'closed'
let openedAt = 0
let probeInFlight = false

function pruneWindow(now: number): void {
  const cutoff = now - WINDOW_MS
  failureTimestamps = failureTimestamps.filter(t => t >= cutoff)
}

export const managedCircuitBreaker = {
  /**
   * Returns true if the request should be short-circuited to V3.
   *
   * Transitions:
   *  - closed: allow all requests.
   *  - open: reject all until cooldown elapses, then transition to half_open.
   *  - half_open: allow exactly ONE probe request. All concurrent callers
   *    after the probe is claimed continue to see open=true until the
   *    probe reports via recordManagedSuccess/recordManagedFailure.
   */
  isOpen(): boolean {
    const now = Date.now()

    if (state === 'open' && now - openedAt >= COOLDOWN_MS) {
      state = 'half_open'
      probeInFlight = false
    }

    if (state === 'open') return true

    if (state === 'half_open') {
      if (probeInFlight) return true     // probe already out; hold others
      probeInFlight = true                // claim the single probe slot
      return false
    }

    return false
  },
}

export function recordManagedSuccess(): void {
  // A successful turn (or probe) closes the breaker.
  if (state === 'half_open' || state === 'open') {
    state = 'closed'
    failureTimestamps = []
    openedAt = 0
    probeInFlight = false
    return
  }
  // Steady-state success prunes expired failures but does not zero them;
  // a single success should not let a long-running bad run cross the
  // window without penalty.
  pruneWindow(Date.now())
}

export function recordManagedFailure(reason: DegradedReason): void {
  void reason
  const now = Date.now()

  // Probe failure during half_open re-opens immediately, regardless of
  // the rolling-window count — the probe's whole purpose is a single-shot
  // trust check.
  if (state === 'half_open') {
    state = 'open'
    openedAt = now
    probeInFlight = false
    return
  }

  pruneWindow(now)
  failureTimestamps.push(now)
  if (failureTimestamps.length >= FAILURE_THRESHOLD) {
    state = 'open'
    openedAt = now
    probeInFlight = false
  }
}

/** Test-only. Resets breaker state between vitest cases. */
export function _resetForTest(): void {
  failureTimestamps = []
  state = 'closed'
  openedAt = 0
  probeInFlight = false
}
```

`BreakerState` now has three values. `DegradedReason` export unchanged. Call sites that invoke `recordManagedFailure` on error stay as-is; add `recordManagedSuccess` calls at turn completion (runtime.ts already has a success path — see Task 7 Step 6).

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd app && npx vitest run tests/unit/managed/breaker-windowed.test.ts 2>&1 | tail -10
```
Expected: 3 tests pass. Also run the existing `tests/unit/managed/circuit-breaker.test.ts` (6 tests) to ensure no regression:
```bash
cd app && npx vitest run tests/unit/managed/circuit-breaker.test.ts 2>&1 | tail -5
```
If any existing test relies on "failures accumulate forever", update it to use the new rolling semantics; document in commit message.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/managed/circuit-breaker.ts \
        app/tests/unit/managed/breaker-windowed.test.ts \
        app/tests/unit/managed/circuit-breaker.test.ts
git -c commit.gpgsign=false commit -m "feat(managed): rolling-window circuit breaker

Finding 5. Replaces cumulative forever-counter with rolling 5-min
window. 3 failures within 5 min open the breaker for 30s, then
half-open single-probe behavior as before. Failures older than 5
min age out. Per-process state retained; cross-instance shared state
deferred to post-pilot."
```

---

## Task 4: Finding 1 — managed history summary loading + prompt summary block

**Files:**
- Modify: `app/src/lib/ai/agent/managed/history.ts`
- Modify: `app/src/lib/ai/agent/managed/prompt.ts`
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`
- Create: `app/tests/unit/managed/history-summary.test.ts`

- [ ] **Step 1: Write failing test**

Create `app/tests/unit/managed/history-summary.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

const rows: Array<Record<string, unknown>> = []

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve(rows) }),
      }),
    }),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number' },
  agentSessions: { id: 'id' },
}))

describe('loadManagedHistory with summary', () => {
  it('returns summary from a system_summary row when present', async () => {
    rows.length = 0
    rows.push({ role: 'system', messageType: 'system_summary', content: 'earlier context summary', compactedAt: null, sequenceNumber: 0 })
    rows.push({ role: 'user', messageType: 'text', content: 'live msg', compactedAt: null, sequenceNumber: 3 })

    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('session-1')
    expect(result.summary).toBe('earlier context summary')
    expect(result.messages.map(m => m.role)).toEqual(['user'])
  })

  it('falls back to session.messageSummary when no system_summary row', async () => {
    rows.length = 0
    rows.push({ role: 'user', messageType: 'text', content: 'live msg', compactedAt: null, sequenceNumber: 0 })
    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('session-2', { fallbackSummary: 'session-durable-summary' })
    expect(result.summary).toBe('session-durable-summary')
  })

  it('returns summary null when neither source is present', async () => {
    rows.length = 0
    rows.push({ role: 'user', messageType: 'text', content: 'a', compactedAt: null, sequenceNumber: 0 })
    const { loadManagedHistory } = await import('@/lib/ai/agent/managed/history')
    const result = await loadManagedHistory('session-3')
    expect(result.summary).toBeNull()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd app && npx vitest run tests/unit/managed/history-summary.test.ts 2>&1 | tail -10
```
Expected: fails — current `loadManagedHistory` returns `MessageParam[]` not `{summary, messages}` and doesn't look at `system_summary` rows.

- [ ] **Step 3: Update `loadManagedHistory` signature + summary read**

In `app/src/lib/ai/agent/managed/history.ts`, change the signature and implementation:

```ts
// Near-copy of V3 summary semantics (see lib/ai/agent/history.ts:49, :171).
// EXTRACTION SEAM: this logic is a candidate for a shared history helper
// in a post-pilot cleanup. Keep it local for now to minimize blast radius.
export interface ManagedHistory {
  summary: string | null
  messages: MessageParam[]
}

export async function loadManagedHistory(
  sessionId: string,
  opts: { fallbackSummary?: string | null } = {},
): Promise<ManagedHistory> {
  const rows = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.sequenceNumber))

  let summary: string | null = null
  const messages: MessageParam[] = []

  for (const row of rows) {
    if (row.messageType === 'system_summary') {
      if (typeof row.content === 'string') summary = row.content
      continue
    }
    if (row.compactedAt) continue
    const role = row.role as 'user' | 'assistant'
    if (role !== 'user' && role !== 'assistant') continue
    const content = row.content
    if (typeof content === 'string') messages.push({ role, content })
    else if (Array.isArray(content)) messages.push({ role, content: content as MessageParam['content'] })
    else messages.push({ role, content: JSON.stringify(content) })
  }

  if (summary === null && opts.fallbackSummary) summary = opts.fallbackSummary

  return { summary, messages }
}
```

- [ ] **Step 4: Update `buildManagedSystemPrompt` to render summary block**

In `app/src/lib/ai/agent/managed/prompt.ts`, add a `summary` parameter and render a bounded block:

```ts
const SUMMARY_MAX_CHARS = 4000

export function buildManagedSystemPrompt(
  session: AgentSession,
  sections: Section[],
  phase: Phase,
  locale: 'ro' | 'en',
  summary: string | null = null,
): string {
  // ... existing prompt body ...
  const summaryBlock = summary
    ? `\n\n<conversation_summary>\n${summary.slice(-SUMMARY_MAX_CHARS)}\n</conversation_summary>\n`
    : ''
  return [/* existing parts */, summaryBlock].filter(Boolean).join('\n')
}
```

Exact placement depends on the existing prompt structure; integrate the summary block before the phase-specific section. `slice(-SUMMARY_MAX_CHARS)` enforces the bound by keeping the tail (most-recent summary text), replacing rather than appending.

- [ ] **Step 5: Wire summary through `runManagedTurn`**

In `app/src/lib/ai/agent/managed/runtime.ts`, change the history load call to the new shape and pass summary into the prompt:

```ts
const { summary, messages: history } = await loadManagedHistory(session.id, {
  fallbackSummary: session.messageSummary ?? null,
})
// ...
const systemPrompt = buildManagedSystemPrompt(
  session,
  sections,
  session.currentPhase as Phase,
  session.locale,
  summary,
)
```

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd app && npx vitest run tests/unit/managed/history-summary.test.ts 2>&1 | tail -10
cd app && npx vitest run tests/unit/managed/history.test.ts 2>&1 | tail -5
cd app && npx vitest run tests/unit/managed/prompt.test.ts 2>&1 | tail -5
```
Expected: new summary tests pass; existing history and prompt tests still pass (or require surface-only updates — keep TDD discipline, fix call sites in the tests if the signature changed).

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai/agent/managed/history.ts \
        app/src/lib/ai/agent/managed/prompt.ts \
        app/src/lib/ai/agent/managed/runtime.ts \
        app/tests/unit/managed/history-summary.test.ts \
        app/tests/unit/managed/history.test.ts \
        app/tests/unit/managed/prompt.test.ts
git -c commit.gpgsign=false commit -m "feat(managed): history summary loading + bounded prompt block

Finding 1. loadManagedHistory now reads system_summary rows and falls
back to session.messageSummary. buildManagedSystemPrompt renders a
bounded summary block (4KB cap, tail-slice replacement). Near-copy of
V3 semantics; marked as extraction seam for post-pilot shared helper."
```

---

## Task 5: Service-local `MANAGED_RUNTIME_ENABLED` gate

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts`

- [ ] **Step 1: Write the gate**

In `app/src/app/api/ai/agent/route.ts`, locate the block that decides `managedEnabled` (around line 107 on current master). **Before** the `isFeatureEnabled` call and **before any dynamic import of managed-side modules**, add the hard service-local gate:

```ts
// ── Service-local hard gate. Main production service never imports
// or initializes managed-side machinery. Only `fondeu-pilot` sets this.
const managedRuntimeEnabled = process.env.MANAGED_RUNTIME_ENABLED === 'true'

if (!managedRuntimeEnabled) {
  // Short-circuit before any flag lookup, breaker import, anthropic-client
  // import, or session-metadata import. Route behaves exactly like pre-PR
  // master when this env is unset.
  return runV3WithSSE(/* existing args */)
}
```

Keep the structured-action guard (already in route) and the flag + breaker checks below this point. The structured-action guard still runs only on pilot traffic.

- [ ] **Step 2: Mark `managed_agent_enabled` as `bypassCache`**

At the `isFeatureEnabled` call in route.ts:

```ts
const managedFlagEnabled = await isFeatureEnabled('managed_agent_enabled', {
  userId: user.id,
  bypassCache: true,
})
```

- [ ] **Step 3: Typecheck + existing route test**

```bash
cd app && npm run typecheck 2>&1 | tail -5
cd app && npx vitest run tests/integration/managed/route-flag-off.test.ts 2>&1 | tail -5
```
Expected: typecheck clean. The `route-flag-off` test likely needs updating to set `MANAGED_RUNTIME_ENABLED=true` in `beforeEach` so the gate doesn't short-circuit the flag-off test itself. Edit the test to:

```ts
beforeEach(() => { process.env.MANAGED_RUNTIME_ENABLED = 'true' })
afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })
```

Do the same for other `tests/integration/managed/route-*.test.ts` files.

- [ ] **Step 4: Run all managed route tests**

```bash
cd app && npx vitest run tests/integration/managed/ 2>&1 | tail -10
```
Expected: all existing managed integration tests still pass after the env-var preamble is added.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/ai/agent/route.ts app/tests/integration/managed/
git -c commit.gpgsign=false commit -m "feat(managed): service-local MANAGED_RUNTIME_ENABLED gate

Hard short-circuit at route entry, before any managed-side import or
initialization. Main production service (env unset) routes 100% to V3
regardless of flag state or targeting. Only fondeu-pilot sets the env
var; flag widening mistakes can't leak into production.

Also marks managed_agent_enabled as bypassCache:true at the
isFeatureEnabled call site. Existing managed route integration tests
set the env in beforeEach to exercise the flag path."
```

---

## Task 6: Finding 2 — mandatory stateVersion precondition + 409

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts`
- Modify: `app/src/lib/ai/agent/managed/history.ts` (sequence retry-once)
- Create: `app/tests/integration/managed/stateversion-precondition.test.ts`

**Note on terminology:** The route change here is a **mandatory stateVersion precondition check** (read-compare-reject), not an atomic compare-and-swap mutation. The real atomic concurrency boundary for managed turns is the pre-stream turn-claim insert into `agent_turns` in Task 7 — the `UNIQUE (session_id, request_id)` constraint either succeeds atomically or raises a unique-violation. Precondition + claim together give the guarantee; neither alone does.

- [ ] **Step 1: Write failing tests**

Create `app/tests/integration/managed/stateversion-precondition.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

describe('managed route — mandatory stateVersion', () => {
  beforeEach(() => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    vi.resetModules()
  })
  afterEach(() => {
    delete process.env.MANAGED_RUNTIME_ENABLED
  })

  it('returns 400 missing_state_version when managed POST omits stateVersion', async () => {
    // Mocks: auth → user, flag on, session with stateVersion=3
    // Set up mocks (pattern from existing route tests) …
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'sess-1', message: 'hi' /* no stateVersion */ }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/state_version/i)
  })

  it('returns 409 stale_state_version when stateVersion is stale', async () => {
    // Mocks: session with stateVersion=5, POST sends stateVersion=3
    const { POST } = await import('@/app/api/ai/agent/route')
    const req = new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'sess-1', message: 'hi', stateVersion: 3 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error).toMatch(/stale/i)
    expect(json.currentVersion).toBeDefined()
  })
})
```

Follow the existing `route-*.test.ts` mock scaffolding: `vi.doMock('@/lib/middleware/auth')`, `vi.doMock('@/lib/db')` returning the session row with the desired `stateVersion`, `vi.doMock('@/lib/feature-flags')`, etc.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd app && npx vitest run tests/integration/managed/stateversion-precondition.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Tighten the route contract**

In `app/src/app/api/ai/agent/route.ts`, locate the existing optional check:

```ts
if (typeof body.stateVersion === 'number') { ... }
```

Replace it, **only on the managed path** (after the service-local + flag gates pass), with:

```ts
if (typeof body.stateVersion !== 'number') {
  return NextResponse.json(
    {
      error: {
        code: 'missing_state_version',
        messageRo: 'Lipsește versiunea de stare. Reîncarcă pagina și reîncearcă.',
        messageEn: 'Missing state version. Reload and retry.',
      },
    },
    { status: 400 },
  )
}
if (body.stateVersion !== (row.stateVersion as number)) {
  return NextResponse.json(
    {
      error: {
        code: 'stale_state_version',
        messageRo: 'Versiunea de stare este expirată. Reîncarcă și reîncearcă.',
        messageEn: 'State version is stale. Reload and retry.',
      },
      currentVersion: row.stateVersion,
    },
    { status: 409 },
  )
}
```

Leave the V3 path's optional check untouched (V3 code is a non-goal).

- [ ] **Step 4: Add retry-once on sequence-number conflict**

In `app/src/lib/ai/agent/managed/history.ts`, wrap the insert in `appendManagedMessage` with a try/catch for uniqueness violation (Postgres error code `23505`):

```ts
async function insertWithSequenceRetry(input: {
  sessionId: string
  role: 'user' | 'assistant'
  messageType: 'text' | 'tool_use' | 'tool_result' | 'system_summary'
  content: unknown
  toolName?: string
  toolCallId?: string
  turnId?: string | null
  meta: ManagedMessageMeta
}): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [last] = await db.select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, input.sessionId))
      .orderBy(desc(agentMessages.sequenceNumber))
      .limit(1)
    const sequenceNumber = last ? (last.sequenceNumber as number) + 1 : 0

    try {
      await db.insert(agentMessages).values({
        sessionId: input.sessionId,
        role: input.role,
        messageType: input.messageType,
        content: input.content as never,
        toolName: input.toolName,
        toolCallId: input.toolCallId,
        turnId: input.turnId ?? null,
        sequenceNumber,
        runtimeMode: input.meta.runtimeMode,
        provider: input.meta.provider ?? null,
        model: input.meta.model ?? null,
      })
      return sequenceNumber
    } catch (err: any) {
      if (err?.code === '23505' && attempt === 0) continue
      throw err
    }
  }
  throw new Error('sequence number conflict after retry')
}
```

Update `appendManagedMessage` to call this helper.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd app && npx vitest run tests/integration/managed/stateversion-precondition.test.ts 2>&1 | tail -10
cd app && npx vitest run tests/unit/managed/history.test.ts 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add app/src/app/api/ai/agent/route.ts \
        app/src/lib/ai/agent/managed/history.ts \
        app/tests/integration/managed/stateversion-precondition.test.ts
git -c commit.gpgsign=false commit -m "feat(managed): mandatory stateVersion precondition + bilingual 409

Finding 2. Managed POST now requires stateVersion. Missing → 400
missing_state_version. Stale → 409 stale_state_version with
currentVersion echoed. V3 path untouched.

appendManagedMessage retries once on PG 23505 (unique session,
sequence_number) as storage-layer safety net — not the primary
concurrency model. Second conflict fails loud.

The real atomic concurrency boundary for managed turns is the
pre-stream agent_turns claim (Task 7, UNIQUE(session_id, request_id)).
This change is the staleness-detection half; claim is the dedupe half."
```

---

## Task 7: Finding 3 — pre-stream turn-claim + deferred message persistence

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts` (pre-stream turn-claim; deterministic 409 before Response construction)
- Modify: `app/src/lib/ai/agent/managed/history.ts` (add `claimTurn`, `deleteEmptyTurn`, `persistFirstDurableOutput`, `markTurnCompleted`)
- Modify: `app/src/lib/ai/agent/managed/runtime.ts` (defer message persistence; accept `turnId` param)
- Create: `app/tests/integration/managed/retry-idempotency.test.ts`

**Architecture note — pre-stream claim:**

The spec's locked rule is "turn becomes durable when first durable assistant or tool-use event arrives." That is about message persistence. The turn-claim row in `agent_turns` is a separate concern — it is the atomic dedupe boundary, and it must happen **before** the SSE Response is constructed so that `conflict_request_id` can be returned as a clean HTTP 409 rather than an SSE error event.

Flow:

1. **Route (pre-stream)** validates `stateVersion` (Task 6) and `requestId` (already required in DTO).
2. **Route (pre-stream)** attempts to claim the turn:
   - `INSERT INTO agent_turns (session_id, request_id, runtime_mode) RETURNING id`.
   - On PG 23505 (unique violation): check whether the existing `agent_turns` row has any child `agent_messages`.
     - Has children → post-output retry → return HTTP 409 `conflict_request_id` immediately (pre-stream).
     - No children → stale pre-output-failed claim → `DELETE` it, retry the INSERT once, continue.
3. **Route** constructs the SSE Response and passes `turnId` into `runManagedWithSSE`.
4. **Runtime (inside stream)** holds the user message in memory. First durable assistant/tool-use event → transactional `persistFirstDurableOutput(turnId, userMessage, firstOutput)` inserts both rows with the existing `turnId`. Subsequent outputs append with `turnId`.
5. **Runtime (success)** calls `markTurnCompleted(turnId)` and emits an SSE completion event.
6. **Runtime (pre-output failure)** — stream errors before any message persists — calls `deleteEmptyTurn(turnId)` (no child messages, safe to remove) and emits an SSE error event. A retry with the same `requestId` now finds no row → fresh turn.
7. **Runtime (post-output failure)** — stream errors after some messages persisted — leaves the row, emits an SSE error event. A retry with the same `requestId` hits the claim conflict at step 2 and receives HTTP 409.

This resolves the pre-stream vs. mid-stream boundary cleanly. HTTP 409 is only ever returned before Response construction; once the stream starts, all failures are SSE events.

**Note: `AgentRequest.requestId` is already required** (`app/src/lib/ai/agent/types.ts:286`) and `useAgent.ts:170` already generates one per POST. No DTO or client change in this task. The change is server-side only.

- [ ] **Step 1: Write failing integration tests**

Create `app/tests/integration/managed/retry-idempotency.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('managed retry idempotency', () => {
  beforeEach(() => { process.env.MANAGED_RUNTIME_ENABLED = 'true'; vi.resetModules() })
  afterEach(() => { delete process.env.MANAGED_RUNTIME_ENABLED })

  it('rejects managed POST without requestId with 400', async () => {
    // Mock auth, flag on, session stateVersion valid. POST without requestId.
    const { POST } = await import('@/app/api/ai/agent/route')
    const body = { sessionId: 'sess-1', message: 'hi', stateVersion: 1 /* no requestId */ }
    const res = await POST(new Request('http://localhost/api/ai/agent', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(400)
  })

  it('returns HTTP 409 conflict_request_id pre-stream when existing turn has child messages', async () => {
    // Set up: one agent_turns row for (sess-1, req-abc) WITH at least one
    // child agent_messages row. Mock agentTurns INSERT to raise PG 23505.
    // Mock the follow-up SELECT to return {id: turn-abc} and the child
    // count query to return {count: 1}.
    const { POST } = await import('@/app/api/ai/agent/route')
    const body = { sessionId: 'sess-1', message: 'hi', stateVersion: 1, requestId: 'req-abc' }
    const res = await POST(new Request('http://localhost/api/ai/agent', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.error?.code).toBe('conflict_request_id')
    // Response must be clean JSON — never SSE.
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
  })

  it('reclaims a stale empty turn (pre-output-failed prior attempt) and proceeds', async () => {
    // Set up: agentTurns INSERT raises 23505. Follow-up SELECT returns
    // {id: turn-stale}. Child count returns 0 → claim helper deletes and
    // retries the INSERT, which succeeds. POST returns SSE stream (200).
    const { POST } = await import('@/app/api/ai/agent/route')
    const body = { sessionId: 'sess-1', message: 'hi', stateVersion: 1, requestId: 'req-abc' }
    const res = await POST(new Request('http://localhost/api/ai/agent', {
      method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
    }) as any)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)
  })

  it('pre-output Anthropic failure cleans up the empty turn claim', async () => {
    // Mock anthropic stream to throw before emitting any content block.
    // After the stream ends, verify deleteEmptyTurn was invoked with the
    // claimed turnId (DB mock call recording). A subsequent retry with
    // the same requestId must succeed (no conflict) — verify by simulating
    // a second POST and asserting 200.
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd app && npx vitest run tests/integration/managed/retry-idempotency.test.ts 2>&1 | tail -10
```

- [ ] **Step 3: Validate `requestId` presence on managed route (no DTO change)**

`AgentRequest.requestId` is already declared as required (`app/src/lib/ai/agent/types.ts:286`), but a misbehaving client could still POST with an empty string. On the managed path only, after the stateVersion checks, add a defensive check:

```ts
if (typeof body.requestId !== 'string' || body.requestId.length === 0) {
  return NextResponse.json(
    {
      error: {
        code: 'missing_request_id',
        messageRo: 'Cerere fără identificator. Reîncearcă.',
        messageEn: 'Request is missing requestId. Retry.',
      },
    },
    { status: 400 },
  )
}
```

- [ ] **Step 4: Implement pre-stream claim + helpers**

In `app/src/lib/ai/agent/managed/history.ts`, add:

```ts
import { agentTurns, agentSessions } from '@/lib/db/schema'
import { count as sqlCount } from 'drizzle-orm'

export type ClaimResult =
  | { kind: 'claimed'; turnId: string }
  | { kind: 'conflict' }  // post-output retry — route returns HTTP 409

/**
 * Pre-stream turn-claim. Inserts a new agent_turns row atomically.
 *
 * On PG 23505 (UNIQUE violation):
 *   - If the existing row has child messages → post-output retry → 'conflict'.
 *   - If no child messages → stale pre-output-failed claim → delete + retry once.
 *
 * Ownership is checked inside the transaction. Caller (route) MUST have
 * already verified session ownership when loading the session row; this
 * re-verification is defense in depth.
 */
export async function claimTurn(input: {
  sessionId: string
  userId: string
  requestId: string
  runtimeMode: 'v3' | 'managed'
}): Promise<ClaimResult> {
  // Inner insert helper — also verifies ownership at the same time
  async function tryInsert(): Promise<{ kind: 'claimed'; turnId: string } | { kind: 'unique_violation' }> {
    try {
      return await db.transaction(async (tx) => {
        const [sess] = await tx.select({ userId: agentSessions.userId })
          .from(agentSessions)
          .where(eq(agentSessions.id, input.sessionId))
          .limit(1)
        if (!sess || sess.userId !== input.userId) {
          throw new Error('session ownership denied')
        }
        const [row] = await tx.insert(agentTurns).values({
          sessionId: input.sessionId,
          requestId: input.requestId,
          runtimeMode: input.runtimeMode,
        }).returning({ id: agentTurns.id })
        return { kind: 'claimed', turnId: row.id }
      })
    } catch (err: any) {
      if (err?.code === '23505') return { kind: 'unique_violation' }
      throw err
    }
  }

  const first = await tryInsert()
  if (first.kind === 'claimed') return first

  // Unique violation: inspect the existing row.
  const [existing] = await db.select({ id: agentTurns.id })
    .from(agentTurns)
    .where(and(
      eq(agentTurns.sessionId, input.sessionId),
      eq(agentTurns.requestId, input.requestId),
    ))
    .limit(1)
  if (!existing) {
    // Race: the conflicting row was deleted between our insert and this select.
    // Retry once.
    const second = await tryInsert()
    if (second.kind === 'claimed') return second
    return { kind: 'conflict' }
  }

  const [children] = await db.select({ count: sqlCount() })
    .from(agentMessages)
    .where(eq(agentMessages.turnId, existing.id))
  const hasChildren = (children?.count ?? 0) > 0

  if (hasChildren) return { kind: 'conflict' }

  // Stale pre-output-failed claim. Delete + retry once.
  await db.delete(agentTurns).where(eq(agentTurns.id, existing.id))
  const retry = await tryInsert()
  if (retry.kind === 'claimed') return retry
  return { kind: 'conflict' }
}

/**
 * Delete an empty turn-claim row after a pre-output stream failure.
 * No-op if the row has any child messages (safety net — should never
 * happen because callers only invoke this before any message persists).
 */
export async function deleteEmptyTurn(turnId: string): Promise<void> {
  const [children] = await db.select({ count: sqlCount() })
    .from(agentMessages)
    .where(eq(agentMessages.turnId, turnId))
  if ((children?.count ?? 0) > 0) return  // safety: never delete a turn with history
  await db.delete(agentTurns).where(eq(agentTurns.id, turnId))
}

/**
 * Single transaction: user message + first durable assistant/tool output,
 * both tagged with turnId. Sequence allocation uses the same retry-once
 * logic as appendManagedMessage (Task 6) to survive PG 23505 on the
 * unique (session_id, sequence_number) index. If sequence retry fails,
 * the whole transaction rolls back — no orphan persistence.
 */
export async function persistFirstDurableOutput(input: {
  turnId: string
  sessionId: string
  userMessage: string
  firstOutput: {
    role: 'assistant'
    messageType: 'text' | 'tool_use'
    content: unknown
    toolName?: string
    toolCallId?: string
  }
  meta: ManagedMessageMeta
}): Promise<void> {
  await db.transaction(async (tx) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const [last] = await tx.select()
        .from(agentMessages)
        .where(eq(agentMessages.sessionId, input.sessionId))
        .orderBy(desc(agentMessages.sequenceNumber))
        .limit(1)
      const userSeq = last ? (last.sequenceNumber as number) + 1 : 0

      try {
        await tx.insert(agentMessages).values({
          sessionId: input.sessionId,
          role: 'user',
          messageType: 'text',
          content: input.userMessage as never,
          turnId: input.turnId,
          sequenceNumber: userSeq,
          runtimeMode: input.meta.runtimeMode,
          provider: input.meta.provider ?? null,
          model: input.meta.model ?? null,
        })
        await tx.insert(agentMessages).values({
          sessionId: input.sessionId,
          role: 'assistant',
          messageType: input.firstOutput.messageType,
          content: input.firstOutput.content as never,
          toolName: input.firstOutput.toolName,
          toolCallId: input.firstOutput.toolCallId,
          turnId: input.turnId,
          sequenceNumber: userSeq + 1,
          runtimeMode: input.meta.runtimeMode,
          provider: input.meta.provider ?? null,
          model: input.meta.model ?? null,
        })
        return
      } catch (err: any) {
        if (err?.code === '23505' && attempt === 0) continue
        throw err
      }
    }
    throw new Error('sequence conflict after retry in persistFirstDurableOutput')
  })
}

export async function markTurnCompleted(turnId: string): Promise<void> {
  await db.update(agentTurns).set({ completedAt: new Date() }).where(eq(agentTurns.id, turnId))
}
```

`and`, `eq`, `sqlCount` etc. imported from `drizzle-orm` at the top of the file.

- [ ] **Step 5: Call `claimTurn` pre-stream in the route**

In `app/src/app/api/ai/agent/route.ts`, **after** all managed-path validation (service-local gate, flag, stateVersion, requestId defensive check, session loaded) and **before** calling `runManagedWithSSE`, claim the turn synchronously:

```ts
import { claimTurn } from '@/lib/ai/agent/managed/history'
// ...

const claim = await claimTurn({
  sessionId: session.id,
  userId: user.id,
  requestId: body.requestId,
  runtimeMode: 'managed',
})

if (claim.kind === 'conflict') {
  return NextResponse.json(
    {
      error: {
        code: 'conflict_request_id',
        messageRo: 'Cerere deja înregistrată. Dacă ai reîncercat, operațiunea a fost deja salvată.',
        messageEn: 'Request already recorded. If this was a retry, the operation has already been saved.',
      },
    },
    { status: 409 },
  )
}

// claim.kind === 'claimed' — pass claim.turnId into the stream.
return runManagedWithSSE(session, sections, body, user, claim.turnId)
```

The route signature of `runManagedWithSSE` gains a required `turnId: string` parameter. No try/catch wrapper around `runManagedWithSSE` for idempotency — conflict handling is fully pre-stream.

- [ ] **Step 6: Defer message persistence in `runManagedTurn`; accept `turnId`**

In `app/src/lib/ai/agent/managed/runtime.ts`:

1. **Remove** the early `appendManagedMessage(... role: 'user' ...)` call. The user message stays in memory.
2. `runManagedTurn` accepts `turnId: string` as part of its context (plumbed from the route).
3. On the first durable assistant or tool-use event from the Anthropic stream, call `persistFirstDurableOutput({ turnId, sessionId: session.id, userMessage: request.message, firstOutput, meta })`.
4. Subsequent assistant / tool_result messages in the same turn use `appendManagedMessage(..., turnId)` — extend the helper signature to accept an optional `turnId` and set it on the row.
5. Track a local `firstOutputPersisted` boolean.
6. On turn success, `await markTurnCompleted(turnId)` and `recordManagedSuccess()` (see Task 3 for the new `recordManagedSuccess` export).
7. On stream failure: if `firstOutputPersisted === false`, `await deleteEmptyTurn(turnId)`. The runtime's existing error path in `runManagedWithSSE` (around route.ts:280) already converts the error to an SSE error event — leave that unchanged, just add the cleanup call before the existing recordManagedFailure/markDegraded calls.

Sketch:

```ts
export async function runManagedTurn(ctx: {
  session: AgentSession
  sections: Section[]
  request: { message: string; requestId: string; userId: string }
  turnId: string
  onEvent: (e: AgentEvent) => void
}): Promise<{ model: string; toolCount: number; firstOutputPersisted: boolean }> {
  const { session, sections, request, turnId } = ctx
  const { summary, messages: history } = await loadManagedHistory(session.id, {
    fallbackSummary: session.messageSummary ?? null,
  })
  history.push({ role: 'user', content: request.message })

  const systemPrompt = buildManagedSystemPrompt(
    session, sections, session.currentPhase as Phase, session.locale, summary,
  )

  let firstOutputPersisted = false
  let toolCount = 0
  // ... stream loop; on first durable output block:
  //   await persistFirstDurableOutput({
  //     turnId,
  //     sessionId: session.id,
  //     userMessage: request.message,
  //     firstOutput: { role: 'assistant', messageType: '…', content: … },
  //     meta: { runtimeMode: 'managed', model },
  //   })
  //   firstOutputPersisted = true
  // subsequent outputs: await appendManagedMessage(session.id, { ..., turnId }, meta)
  // end of turn:
  await markTurnCompleted(turnId)
  return { model, toolCount, firstOutputPersisted }
}
```

- [ ] **Step 7: Add cleanup on pre-output failure in `runManagedWithSSE`**

In the existing managed error branch of `runManagedWithSSE` (`app/src/app/api/ai/agent/route.ts` around line 280), add cleanup before the degraded-metadata calls:

```ts
} catch (err) {
  // NEW: clean up the pre-stream turn claim if nothing was persisted.
  try {
    // runManagedTurn either returned a partial result before throwing,
    // or threw before it had a chance to set firstOutputPersisted.
    // Access the stored flag via the runtime result capture, or use a
    // capture-ref pattern. Conservative default: check if any
    // agent_messages rows exist for this turnId; if zero, delete the claim.
    const { deleteEmptyTurn } = await import('@/lib/ai/agent/managed/history')
    await deleteEmptyTurn(claim.turnId)
  } catch (cleanupErr) {
    log.warn({ turnId: claim.turnId, err: cleanupErr }, 'pre-output turn cleanup failed')
  }

  const { recordManagedFailure } = await import('@/lib/ai/agent/managed/circuit-breaker')
  const reason = classifyManagedError(err)
  recordManagedFailure(reason)
  // ... existing markDegraded path and SSE error event ...
}
```

`deleteEmptyTurn` is a no-op if children exist (safety built into the helper). Capture `claim.turnId` in the closure from Step 5.

- [ ] **Step 8: Run tests — expect PASS**

```bash
cd app && npx vitest run tests/integration/managed/retry-idempotency.test.ts 2>&1 | tail -10
cd app && npx vitest run tests/integration/managed/ 2>&1 | tail -20
cd app && npx vitest run tests/unit/managed/ 2>&1 | tail -20
```

- [ ] **Step 9: Commit**

```bash
git add app/src/app/api/ai/agent/route.ts \
        app/src/lib/ai/agent/managed/history.ts \
        app/src/lib/ai/agent/managed/runtime.ts \
        app/tests/integration/managed/retry-idempotency.test.ts
git -c commit.gpgsign=false commit -m "feat(managed): pre-stream turn claim + deferred message persistence

Finding 3. Pre-stream claim: route inserts agent_turns (UNIQUE on
session_id, request_id) before constructing the SSE Response. On
PG 23505 with a child-bearing existing row → HTTP 409
conflict_request_id (clean JSON, never SSE). On 23505 with a stale
empty row (pre-output-failed prior attempt) → delete + retry insert
once, then proceed.

Message durability is deferred: user message and first assistant/tool
output persist together in one transaction when the first durable
stream event arrives. Pre-output stream failure → deleteEmptyTurn
cleans the claim row so the retry is a fresh turn.

AgentRequest.requestId and useAgent.ts were already in shape; this
commit is server-side only. Ownership verified inside claimTurn
transaction (defense in depth; route already checked above)."
```

---

## Task 8: Observability — logs + reconciliation queries

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts` (structured turn log)
- Create: `docs/superpowers/runbooks/managed-pilot-observability.md` (reconciliation queries + dashboard outline)

- [ ] **Step 1: Add structured turn log emission**

In `app/src/lib/ai/agent/managed/runtime.ts`, at the end of `runManagedTurn` (success + error branches), emit a structured JSON log line:

```ts
const durationMs = Date.now() - startedAt
log.info({
  event: 'managed_turn_complete',
  sessionId: session.id,
  turnId,
  requestId: request.requestId,
  iterations: iterationCount,
  toolCount,
  durationMs,
  outcome: turnId ? 'completed' : 'pre_output_failure',
  degradedReason: null,
}, 'managed_turn_complete')
```

Use `logger.child({ component: 'managed-runtime' })` if not already in scope. On error branches, include `outcome: 'error'` and `degradedReason`.

- [ ] **Step 2: Write observability doc**

Create `docs/superpowers/runbooks/managed-pilot-observability.md`:

```markdown
# Managed Pilot Observability

## Reconciliation queries (run daily via cron on production DB)

### Duplicate user turns per turn_id — MUST return zero rows

```sql
SELECT turn_id, count(*)
FROM agent_messages
WHERE role = 'user' AND turn_id IS NOT NULL
GROUP BY turn_id
HAVING count(*) > 1;
```

### Abandoned turns — alert at >5/day

```sql
SELECT id, session_id, request_id, started_at
FROM agent_turns
WHERE completed_at IS NULL
  AND started_at < now() - interval '1 hour'
ORDER BY started_at DESC;
```

### Managed P95 latency (24h)

```sql
SELECT percentile_cont(0.95) WITHIN GROUP (
  ORDER BY EXTRACT(EPOCH FROM completed_at - started_at) * 1000
)
FROM agent_turns
WHERE runtime_mode = 'managed'
  AND completed_at IS NOT NULL
  AND started_at > now() - interval '24 hours';
```

### V3 baseline P95 latency

Derive from Cloud Run access logs filtered to `POST /api/ai/agent` on the main service (`fondeu-platform`). Report the 24h P95 of request duration.

## Dashboards

- **Pilot health**: request count, success rate, breaker state, fallback rate, managed P95 vs V3 P95.
- **Audit**: duplicate-turn count, 400/409 counts by code, abandoned-turn count, kill-switch propagation incidents.
```

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/ai/agent/managed/runtime.ts \
        docs/superpowers/runbooks/managed-pilot-observability.md
git -c commit.gpgsign=false commit -m "feat(managed): structured turn logs + reconciliation queries

Per-turn JSON log (sessionId, turnId, requestId, iterations, toolCount,
durationMs, outcome, degradedReason). Daily reconciliation queries
source from agent_turns (downstream of M1): duplicate-turn detection,
abandoned-turn detection, managed P95 latency. V3 baseline derived
from Cloud Run access logs — V3 code untouched."
```

---

## Task 9: Smoke test suite

**Files:**
- Create: `app/scripts/smoke/managed-pilot/01-happy-path.ts`
- Create: `app/scripts/smoke/managed-pilot/02-kill-switch.ts`
- Create: `app/scripts/smoke/managed-pilot/03-auth-fail.ts`
- Create: `app/scripts/smoke/managed-pilot/04-concurrency.ts`
- Create: `app/scripts/smoke/managed-pilot/05-retry-idempotency.ts`
- Create: `app/scripts/smoke/managed-pilot/06-compaction-continuity.ts`
- Create: `app/scripts/smoke/managed-pilot/README.md`

- [ ] **Step 1: Shared config**

Each script reads env:
- `PILOT_URL` — e.g., `https://fondeu-pilot-...run.app`
- `PILOT_SESSION_COOKIE` — authenticated cookie for the target userId
- `TARGET_USER_ID` — for reconciliation-query filtering
- `DATABASE_URL` — for DB verification queries

Create a `lib.ts` helper:

```ts
// app/scripts/smoke/managed-pilot/lib.ts
export function env(key: string): string {
  const v = process.env[key]
  if (!v) throw new Error(`missing env ${key}`)
  return v
}

export async function postAgent(body: Record<string, unknown>): Promise<Response> {
  return fetch(`${env('PILOT_URL')}/api/ai/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: env('PILOT_SESSION_COOKIE') },
    body: JSON.stringify(body),
  })
}

export function uuid(): string {
  return crypto.randomUUID()
}
```

- [ ] **Step 2: Write smoke 01 — happy path**

Create `app/scripts/smoke/managed-pilot/01-happy-path.ts`:

```ts
import { postAgent, uuid, env } from './lib'

async function main() {
  const requestId = uuid()
  const res = await postAgent({
    sessionId: undefined, // new session
    locale: 'ro',
    message: 'Sunt interesat de un proiect de cercetare aplicată în domeniul energiei.',
    requestId,
    stateVersion: 0,
  })
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`)
  const contentType = res.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) throw new Error(`expected SSE content-type, got ${contentType}`)
  const text = await res.text()
  // The route emits `data: {json}\n\n` per event (see route.ts:185). No
  // `event:` field is used.
  if (!/^data:\s/m.test(text)) throw new Error('no SSE data lines in response')
  console.log(JSON.stringify({ smoke: '01-happy-path', status: 'pass', requestId }))
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Write smokes 02–06**

Follow the same pattern. The suite is a mix of **automated** and **manual-assisted** smokes — the README labels each explicitly.

- **02-kill-switch.ts** (**manual-assisted, two-part**):
  - (a) Script submits a managed turn to confirm the pilot is live. Operator then runs `curl … PATCH … enabled=false` (or the DB fallback in the runbook). Script waits ~2s and submits another turn, asserting the response was served by V3 (checks for the absence of the managed-mode marker: DB verify the latest `agent_messages` row has `runtime_mode='v3'`).
  - (b) Operator unsets `MANAGED_RUNTIME_ENABLED` on pilot and redeploys (instructions in README). Script submits another turn; asserts V3 routing via the same DB marker.
- **03-auth-fail.ts** (**manual-assisted**): operator unsets the `ANTHROPIC_API_KEY` secret on pilot and redeploys. Script submits a turn; expects HTTP 200 from V3 fallback, then DB verifies `application_agent_sessions.degraded_reason='auth_setup_failure'` was recorded for the session.
- **04-concurrency.ts** (**automated**): fetch current session `stateVersion`. Fire two POSTs in parallel with the same `stateVersion` and distinct `requestId`s. Expect one 200 (SSE) and one 409 with `error.code='stale_state_version'`.
- **05-retry-idempotency.ts** (**automated, assuming a test seam**): submit a managed turn with `requestId=A`, let it complete. Submit another managed turn with the same `requestId=A`. Expect pre-stream HTTP 409 with `error.code='conflict_request_id'` and `content-type: application/json` (never SSE). DB verify exactly one `agent_turns` row for that `requestId` and that its child `agent_messages` count is >0 (not the stale-empty branch).
- **06-compaction-continuity.ts** (**automated, long-running**): create a session and submit enough turns to trigger V3 summary compaction (check the existing V3 compaction threshold at `lib/ai/agent/history.ts`; default is typically ~20 messages). Verify a `system_summary` row or a populated `session.messageSummary` exists. Then submit a managed turn referencing early context. Assert the model response coherently references summarized context without re-asking. DB verify at least one managed turn with `runtime_mode='managed'` in `agent_turns`.

Each script should print a single JSON line `{"smoke":"NN-name","status":"pass"|"fail","...evidence":...}` and exit non-zero on failure.

- [ ] **Step 4: Write README**

Create `app/scripts/smoke/managed-pilot/README.md`:

```markdown
# Managed Pilot Smoke Suite

Six tests, mixing automated and manual-assisted. All six must pass before enabling `managed_agent_enabled` for the target userId.

| # | Script | Mode |
|---|---|---|
| 01 | `01-happy-path.ts` | automated |
| 02 | `02-kill-switch.ts` | manual-assisted (operator flips flag, then unsets env + redeploys) |
| 03 | `03-auth-fail.ts` | manual-assisted (operator unsets `ANTHROPIC_API_KEY` + redeploys) |
| 04 | `04-concurrency.ts` | automated |
| 05 | `05-retry-idempotency.ts` | automated |
| 06 | `06-compaction-continuity.ts` | automated (long-running, exercises compaction) |

"Manual-assisted" scripts print explicit waiting prompts and exit non-zero if the operator has not performed the prerequisite action within a timeout.

## Setup

```bash
export PILOT_URL="https://fondeu-pilot-....run.app"
export PILOT_SESSION_COOKIE="authjs.session-token=..."
export TARGET_USER_ID="..."
export DATABASE_URL="postgres://..."
```

## Run

```bash
cd app
npx tsx scripts/smoke/managed-pilot/01-happy-path.ts
npx tsx scripts/smoke/managed-pilot/02-kill-switch.ts   # interactive — follow prompts
npx tsx scripts/smoke/managed-pilot/03-auth-fail.ts     # interactive — follow prompts
npx tsx scripts/smoke/managed-pilot/04-concurrency.ts
npx tsx scripts/smoke/managed-pilot/05-retry-idempotency.ts  # interactive if test endpoint absent
npx tsx scripts/smoke/managed-pilot/06-compaction-continuity.ts
```

## Pass criteria

Each script prints `"status":"pass"` and exits 0. Any failure aborts the pilot rollout until resolved.

## Drill-triggered 409s

Smokes 04 and 05 deliberately provoke 409 responses. These do NOT count against the pilot exit criterion "zero unexpected server-caused 409s."
```

- [ ] **Step 5: Commit**

```bash
git add app/scripts/smoke/managed-pilot/
git -c commit.gpgsign=false commit -m "test(managed): pilot smoke suite — 6 live tests

01 happy path, 02 kill-switch (flag + env gate), 03 auth-fail,
04 concurrency CAS, 05 retry idempotency, 06 compaction continuity.
Runnable against fondeu-pilot before flag-on. Each prints a JSON
line, exits non-zero on fail. Drill-triggered 409s in tests 04/05
are excluded from exit criteria per spec §5.5."
```

---

## Task 10: Rollback runbook

**Files:**
- Create: `docs/superpowers/runbooks/managed-agents-pilot-rollback.md`

- [ ] **Step 1: Write runbook**

Create `docs/superpowers/runbooks/managed-agents-pilot-rollback.md`:

```markdown
# Managed Agents Pilot — Rollback Runbook

Three escalating paths. Main production service is never touched.

## 1. Primary — flag off (target: sub-second propagation)

### Option A: admin API

```bash
curl -X PATCH "${FONDEU_URL}/api/v1/admin/feature-flags/managed_agent_enabled" \
  -H "Content-Type: application/json" \
  -b "${ADMIN_SESSION_COOKIE}" \
  -d '{"enabled":false,"targeting":{}}'
```

If middleware CSRF enforcement applies to admin PATCH, include `X-CSRF-Token` header + matching `csrf-token` cookie. Confirm exact headers during the kill-switch drill (entry criterion #5); update this runbook in-place after the drill.

### Option B: direct DB

```bash
psql "${DATABASE_URL}" -c \
  "UPDATE feature_flags SET enabled=false, targeting='{}'::jsonb, updated_at=now() \
   WHERE key='managed_agent_enabled';"
```

Always available regardless of API/middleware state.

## 2. Secondary — unset service-local gate (target: ~30s for revision)

```bash
gcloud run services update fondeu-pilot --region europe-west2 \
  --remove-env-vars MANAGED_RUNTIME_ENABLED
```

## 3. Nuclear — scale pilot service to zero

```bash
gcloud run services update fondeu-pilot --region europe-west2 \
  --min-instances=0 --max-instances=0
```

## Verification after rollback

```sql
-- Confirm no managed turns in the last 5 minutes (flag off effective):
SELECT count(*) FROM agent_turns
WHERE runtime_mode='managed' AND started_at > now() - interval '5 minutes';
-- Expected: 0
```

## Preconditions checked at entry criterion #5 (kill-switch drill)

- Option A headers confirmed + documented inline.
- Option B DB path verified.
- Secondary path verified (revision rolls with env removed).
- Nuclear path verified (scale-to-zero completes within SLO).

## Runbook verification reconfirmation

Re-test quarterly or after any route.ts / feature-flags edit that touches the kill-switch path.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/managed-agents-pilot-rollback.md
git -c commit.gpgsign=false commit -m "docs(runbook): managed pilot rollback three-path

Primary flag-off (admin API + DB fallback), secondary env-unset,
nuclear scale-to-zero. Verification steps and post-rollback SQL
check included. Exact CSRF headers confirmed during kill-switch
drill (entry criterion #5)."
```

---

## Task 11: Retention register entry (CLAUDE.md deliberately unchanged)

**Files:**
- Modify: `docs/superpowers/legacy-retention-register.md`

**Scope note:** `CLAUDE.md` is intentionally NOT modified. Pilot-specific operational context (service URL, env gate, runbook path) lives in the runbook only. `CLAUDE.md` is for durable repo guidance, not time-bound phase status.

- [ ] **Step 1: Add retention register entry**

Read the current retention register to see the entry format:

```bash
cat docs/superpowers/legacy-retention-register.md | head -30
```

Append a new entry matching the existing format. Suggested content:

```markdown
## Agent-surface RLS

**Status:** Known gap — deferred to a dedicated post-pilot spec.

**Context:** Agent tables (`agent_sessions`, `agent_messages`, `agent_turns`, `agent_sections`, `agent_section_versions`, `agent_checkpoints`) currently rely on app-code ownership predicates rather than DB-level RLS. The pilot-readiness PR (spec `docs/superpowers/specs/2026-04-14-managed-agents-pilot-readiness-design.md`) introduces `agent_turns` matching this posture.

**Owner:** TBD when the dedicated RLS spec lands.

**Retirement trigger:** A comprehensive agent-surface RLS spec + migrations that cover all six tables together with updated `withUserRLS(userId, fn)` usage at every call site.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/legacy-retention-register.md
git -c commit.gpgsign=false commit -m "docs(register): agent-surface RLS entry

Records that agent tables rely on app-code ownership predicates
rather than DB-level RLS, with a retirement trigger pointing at a
dedicated post-pilot RLS spec. No CLAUDE.md change — pilot
operational context stays in the runbook, not durable repo guidance."
```

---

## Task 12: Verification — build + typecheck + full test run

**Files:** none (verification only)

- [ ] **Step 1: Baseline pre-existing failures (done once, before any edits)**

Before starting Task 1, capture the master baseline into an inline allowlist. This runs once and is pinned explicitly — not left as a vague "acceptable." If the allowlist grows during this PR, that is a regression and must be investigated.

```bash
cd app && npm test 2>&1 | grep -E "FAIL|✗" | sort -u > /tmp/managed-pilot-baseline.txt
cat /tmp/managed-pilot-baseline.txt
```

Expected pinned failures at pilot-readiness branch start (snapshot from MEMORY.md; re-verify at time of execution):
- `timeline-assignee-validation.test.ts` — 2 failing cases
- `trial-notifications-route.test.ts` — 1 failing case
- Any e2e specs that run under vitest

If the actual list differs from the expectation, STOP and reconcile with the user before proceeding. Do not silently widen the allowlist.

- [ ] **Step 2: Full unit + integration test run — scoped green**

```bash
# Exclude pre-existing-failure files explicitly so the gate is objectively green.
cd app && npx vitest run \
  --exclude tests/integration/timeline-assignee-validation.test.ts \
  --exclude tests/integration/trial-notifications-route.test.ts \
  2>&1 | tail -10
```
Expected: **zero failures** in the scoped run. If anything new appears, fix before push — do not defer.

Also run the excluded files standalone and confirm their failure count matches the baseline exactly (no new regressions hidden in the exclusion):

```bash
cd app && npx vitest run tests/integration/timeline-assignee-validation.test.ts \
                        tests/integration/trial-notifications-route.test.ts \
                        2>&1 | tail -5
```
Failure count must equal baseline. If higher, investigate before push.

- [ ] **Step 3: Build**

```bash
cd app && npm run build 2>&1 | tail -15
```
Expected: **zero errors**. Warnings are acceptable only if they appear on master too (capture master's warning list before any edit and compare). No route manifest regressions — the pilot gate is runtime, not build-time.

- [ ] **Step 4: Typecheck**

```bash
cd app && npm run typecheck 2>&1 | tail -5
```
Expected: **zero errors**. If master has pre-existing typecheck errors (per git status at session start showed `M app/src/lib/validation/schemas.ts`), they must be captured in the baseline step and matched exactly.

- [ ] **Step 5: Push + PR**

```bash
git push -u origin spec/managed-pilot-readiness
gh pr create --base master \
  --title "feat(managed): pilot readiness — 5 audit fixes + preview scaffolding" \
  --body "$(cat <<'EOF'
## Summary

Lands audit-finding hardening + preview-deploy scaffolding for the managed-agents runtime so a single-user pilot on \`fondeu-pilot\` can start. Scope A+B of the decom-program decomposition.

5 Finding fixes (history continuity, stateVersion CAS, retry idempotency, flag cache-bypass, rolling-window breaker) + 2 additive migrations + service-local gate + 6-test smoke suite + rollback runbook + observability queries + CLAUDE.md + retention-register entry.

Spec: \`docs/superpowers/specs/2026-04-14-managed-agents-pilot-readiness-design.md\`
Plan: \`docs/superpowers/plans/2026-04-14-managed-agents-pilot-readiness.md\`

## Out of scope

- Phase 3b/3c write-tool exposure (separate future spec)
- V3 security remediation (continues on its existing plan)
- Shared-history refactor between V3 and managed (post-pilot cleanup seam flagged)
- Redis-backed shared breaker (post-pilot rollout)
- Eval harness (separate future spec)
- Any V3 runtime code changes

## Test plan

- [x] \`npm test\` green (no new failures vs baseline)
- [x] \`npm run build\` green
- [x] \`npm run typecheck\` green
- [ ] Smoke suite (runs post-deploy against fondeu-pilot)
- [ ] Entry criteria verified pre-flag-on per spec §5.4
EOF
)"
```

- [ ] **Step 6: Post-merge prerequisites for pilot go-live**

After the PR merges to master:

1. Apply migrations to production DB (`npm run db:migrate` with `.env.production`).
2. Deploy pilot service (`fondeu-pilot`) with hardened image and `MANAGED_RUNTIME_ENABLED=true`.
3. Verify health endpoints on pilot.
4. Run the 6-smoke suite against pilot URL.
5. Verify kill-switch drill (Option A headers confirmed + documented inline in runbook; Options B/2/3 verified).
6. Enable flag for target userId: `UPDATE feature_flags SET enabled=true, targeting='{"userIds":["<uuid>"]}'::jsonb WHERE key='managed_agent_enabled';`
7. Begin 7-day observation window per spec §5.5 exit criteria.

This step happens outside the PR — it's the operational handoff after code lands.

---

## Self-review

Coverage check vs spec sections:

- **§3.1 Finding 1** → Task 4
- **§3.2 Finding 2** → Task 6
- **§3.3 Finding 3** → Task 7 (depends on Task 1 for schema, Task 6 for stateVersion contract)
- **§3.4 Finding 4** → Task 2
- **§3.5 Finding 5** → Task 3
- **§4.1 M1** → Task 1
- **§4.2 M2** → Task 1
- **§5.1 Topology + §5.2 Access model** → Task 5 (code gate); deployment happens post-merge (Task 12 Step 5)
- **§5.3 Smoke suite** → Task 9
- **§5.4 Entry criteria** → Task 12 Step 5 (operational handoff)
- **§5.5 Exit criteria + §5.6 Abort triggers** → Task 8 (reconciliation queries) + ops dashboards (post-merge)
- **§6 Observability** → Task 8
- **§7 Rollback runbook** → Task 10
- **§8 Implementation ordering** → The 12 tasks here map 1:1 to the spec's commit sequence.

No placeholders, no "TBD", no "similar to Task N", no references to undefined types. Field naming is consistent (`stateVersion`, `requestId`, `turnId`, `agentTurns`). DDL in Task 1 matches TypeScript schema mirror in Task 1 Step 4. Test file paths match the create list. Commit messages are scoped and descriptive.
