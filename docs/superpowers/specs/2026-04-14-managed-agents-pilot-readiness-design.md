# Managed Agents Pilot Readiness — Design Spec

**Date:** 2026-04-14
**Track:** A + B (audit-finding hardening + preview deploy). Not Phase 3b/3c.
**Preceding context:** `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md`, `docs/superpowers/specs/2026-04-10-managed-agents-phase2-design.md`, `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md` (Phase 3a hardening shipped via PR #18).

## 1. Problem statement

An independent audit of the managed runtime on master surfaced five defects that block a dependable pilot rollout and contradict the operational guarantees the Phase 2 design implies:

1. **History continuity loss** — `loadManagedHistory` skips all compacted rows and never restores the persisted `system_summary` message or `session.messageSummary` column. V3 uses those surfaces during compaction. Sessions that degrade to V3 and later return to managed silently lose context.
2. **Sequence-number race** — `appendManagedMessage` reads the current max `sequence_number` and inserts later with no lock or uniqueness constraint. The route treats `stateVersion` as optional. Concurrent turns produce duplicate or out-of-order sequence numbers.
3. **Retry non-idempotency** — `runManagedTurn` persists the user message before any model output, then returns a retryable error on failure. No request-id dedupe. A transient Anthropic failure + client retry produces duplicate user turns in history and biases the next completion.
4. **Kill-switch staleness** — `isFeatureEnabled` caches flag state for 60 s in-process. `managed_agent_enabled` routes through this cache. Emergency disable has a one-minute stale window per instance, inadequate for a canary kill switch.
5. **Breaker weakness** — the circuit breaker counts failures forever until a success and is per-process. A single failure from two weeks ago plus two from today opens the breaker identically to three failures in five minutes. Cross-instance divergence is also accepted-but-unbounded.

No preview deploy has happened. The managed runtime has never run against the real Anthropic API in a deployed environment. The rollout plan recorded in `project_managed_agents.md:84` is unexecuted.

This spec closes both gaps together, because they share one rollout gate: fix the hardening items, then deploy a preview, then smoke-test, then enable the flag for a single user.

## 2. Goals and non-goals

### In scope

- Audit Finding fixes 1–5.
- Two additive migrations:
  - **M1 (retry idempotency):** `agent_turns` claim table + `turn_id` column on `agent_messages` + partial unique index `(session_id, request_id)` at the turn level.
  - **M2 (history ordering integrity):** unique index `(session_id, sequence_number)` on `agent_messages`, with the pre-existing non-unique index dropped.
- Preview deploy: new `fondeu-pilot` Cloud Run service against the production data plane.
- Service-local gate (`MANAGED_RUNTIME_ENABLED` env var) to prevent accidental managed routing on the main service.
- Smoke test suite (6 tests) runnable against the pilot service.
- Observability, rollback runbook, entry/exit criteria, and abort triggers.

### Explicit non-goals

- **Phase 3b/3c write-tool exposure** — separate future spec.
- **V3 security remediation plan** (`docs/superpowers/plans/2026-04-14-v3-security-remediation.md`) — continues on its existing track.
- **Shared-helper refactor** between V3 and managed history loading — flagged for post-pilot. Managed mirrors V3 semantics near-copy for now, with a code comment marking the extraction seam.
- **Redis-backed shared circuit breaker** — flagged as post-pilot rollout work once traffic scales and multiple instances are routinely warm.
- **Dual-runtime eval harness** (Spec 3 in the decomposition) — separate future spec.
- **Any change to V3 runtime code** — V3 stays untouched.
- **Agent-surface RLS** — agent tables currently rely on app-code ownership predicates; DB-level RLS is a dedicated spec post-pilot. Recorded as a new entry in `docs/superpowers/legacy-retention-register.md`.
- **First-class half-open breaker state + transitions instrumentation** — current implementation treats half-open as implicit probe behavior inside `isOpen()`. Expanding the state model is post-pilot.

## 3. Fix architecture

### Finding 1 — history continuity (fast parallel fix)

**Touches:** `app/src/lib/ai/agent/managed/history.ts`, `runtime.ts`, `prompt.ts`.

`loadManagedHistory` extends to read compacted `system_summary` rows first, falling back to `session.messageSummary` when no row exists. Returns `{ summary: string | null, messages: MessageParam[] }`. `runManagedTurn` passes `summary` into `buildManagedSystemPrompt`. The prompt renders a bounded summary block when non-null, with a fixed character/token cap and oldest-summary replacement rather than append-and-grow. Semantics are a near-copy of V3's `lib/ai/agent/history.ts:49` and `:171`.

Code comment marks the helper as an extraction candidate for a post-pilot shared `history-shared.ts` module.

### Finding 2 — mandatory stateVersion CAS + DB uniqueness

**Touches:** `app/src/app/api/ai/agent/route.ts`, `app/src/lib/ai/agent/managed/runtime.ts`, new index from M2.

Contract on the managed POST:

- `expectedStateVersion` required on every managed POST.
- Missing → `400 request validation error: missing_state_version` (bilingual message).
- Stale → `409 ConcurrencyError: stale_state_version` (bilingual message).
- Route stops treating the check as conditional.

Session state mutation uses atomic CAS on `agent_sessions.state_version`, matching Phase 3a's write-service discipline. Second concurrent submission fails loud with 409 rather than silently interleaving.

M2's unique index on `(session_id, sequence_number)` enforces storage-layer integrity. `appendManagedMessage` performs one internal retry on a uniqueness conflict (compute max, insert), then fails loudly on the second conflict. This is a safety net, not the primary concurrency model.

Frontend `useAgent` hook already tracks `stateVersion` from the state payload; one line to include it in POST body.

### Finding 3 — deferred persistence + requestId dedupe

**Touches:** `app/src/lib/ai/agent/managed/runtime.ts`, `app/src/lib/ai/agent/managed/history.ts`, new table + column + index from M1.

Contract on the managed POST:

- `requestId` required on every managed POST. Client (`useAgent` hook) generates a fresh UUID per POST.

Runtime changes:

- `runManagedTurn` stops persisting the user message on entry.
- The user message is accumulated in memory.
- A managed turn becomes durable when **the first durable assistant or tool-use event arrives from the Anthropic stream** (unambiguous for non-text-first turns where a tool call can precede any text block).
- At that moment, a single transaction inserts: (i) one row in `agent_turns` with `(session_id, request_id)`, (ii) the user message row with `turn_id`, (iii) the first assistant content row with the same `turn_id`.
- The `UNIQUE (session_id, request_id)` constraint on `agent_turns` enforces idempotency at the claim moment.

Route behavior on retry:

- Same `requestId`, no prior durability → fresh turn (claim insert succeeds; nothing to dedupe).
- Same `requestId`, prior durability exists → claim insert fails with conflict → **deterministic `409 ConcurrencyError: conflict_request_id` response**. The route does **not** attempt to resume streaming from persisted state in this PR; that is explicitly deferred scope.

Ownership enforcement:

- App-code ownership check runs on both **create** paths (before claim insert) and **conflict/readback** paths (before returning 409 / reading existing turn state). Consistent with the rest of the agent-surface ownership posture.

### Finding 4 — cache-bypass for kill-switch flags, fail-closed

**Touches:** `app/src/lib/feature-flags/index.ts` and the flag registration site.

`isFeatureEnabled` gains a `bypassCache` boolean. Flags opting in skip the LRU and read the DB on every call. `managed_agent_enabled` (and, when created by a later spec, `managed_agent_writes_enabled`) mark themselves `bypassCache: true`. DB read error → return `false` + log at `WARN`. Fail-closed: an unreadable flag means managed mode is disabled on that request.

Targeted, not global — all other feature flags retain the 60 s LRU.

### Finding 5 — time-windowed per-process breaker

**Touches:** `app/src/lib/ai/agent/managed/circuit-breaker.ts`.

Replace the cumulative failure counter with a rolling list of failure timestamps. Rule:

> 3 managed-runtime failures within a rolling 5-minute window open the breaker for 30 seconds. Failures older than 5 minutes age out of the window. Half-open behavior stays the implicit-probe pattern already in place.

Per-process state retained. Cross-instance shared breaker state is post-pilot work.

## 4. Database changes

### M1 — retry idempotency

Turn-level claim surface. Per-message uniqueness on `agent_messages` would conflict with the multi-row-per-turn write pattern (user + assistant + tool_use + tool_result), so a dedicated turn table is the correct shape.

```sql
CREATE TABLE agent_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  runtime_mode runtime_mode NOT NULL,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  UNIQUE (session_id, request_id)
);

CREATE INDEX idx_agent_turns_session_started
  ON agent_turns (session_id, started_at DESC);

ALTER TABLE agent_messages
  ADD COLUMN turn_id uuid REFERENCES agent_turns(id) ON DELETE SET NULL;
```

Backward compatible: `turn_id` is nullable, existing V3 rows stay NULL. A future spec can require V3 turns to populate it too.

The `idx_agent_turns_session_started` index supports "latest turn per session" lookups; a partial-index variant `WHERE completed_at IS NULL` for "latest open turn per session" is a post-pilot optimization not needed at this scale.

**No RLS policy** added for `agent_turns` in this PR — matches the existing agent-table posture. Ownership is enforced in app code on both create and readback paths.

### M2 — history ordering integrity

Unique index on `(session_id, sequence_number)` with the old non-unique index removed.

```sql
-- Pre-check: must return zero rows
SELECT session_id, sequence_number, count(*)
FROM agent_messages
GROUP BY session_id, sequence_number
HAVING count(*) > 1;

CREATE UNIQUE INDEX idx_agent_messages_session_sequence
  ON agent_messages (session_id, sequence_number);

DROP INDEX IF EXISTS idx_agent_messages_seq;
```

Schema mirror in `app/src/lib/db/schema.ts` updated in the same PR. Runbook handles reconciliation if the pre-check returns rows (rename one of the duplicates via `sequence_number = (SELECT MAX(sequence_number) FROM agent_messages WHERE session_id = $1) + 1` for the newer row, then apply).

### Sequence numbering and deploy order

Two migrations, next free numbers after `0024_agent_section_versions_rollback.sql`. Hand-written per the precedent established by 0020–0024. Journal entries added to `app/drizzle/meta/_journal.json` with deterministic timestamps.

Deploy order:

1. Apply M1 + M2 to the production DB.
2. Deploy `fondeu-pilot` Cloud Run service with the hardened branch.
3. Forward-only additive — rollback path is "leave in place; nullable column stays NULL; indexes stay harmless."

## 5. Pilot rollout

### 5.1 Topology

- New Cloud Run service `fondeu-pilot` in the same GCP project (`eufunding`), same region (`europe-west2`).
- Points at production Cloud SQL, Redis (`fondeu-redis-recovery`), Qdrant (via `fondeu-vpc-connector` at `10.154.0.3:6333`).
- Scoped env: separate `ANTHROPIC_API_KEY` secret binding (can be unset for the auth-fail drill without affecting main service), separate log stream, separate metric dashboard.
- Env var `MANAGED_RUNTIME_ENABLED=true` set **only** on `fondeu-pilot`.
- Main production service: env var unset (or explicit `MANAGED_RUNTIME_ENABLED=false`).
- Codebase = hardened pilot-readiness branch, same image built for both services but gated by env.

### 5.2 Access model and service-local gate

Route handler (`app/src/app/api/ai/agent/route.ts`) gains a hard service-local check. This check short-circuits before any managed-side import or initialization on the main service:

```ts
if (process.env.MANAGED_RUNTIME_ENABLED !== 'true') {
  return runV3WithSSE(...);
}
// flag check continues as before, now with bypassCache + fail-closed semantics
```

Effect:

- **Pilot service**: env gate passes → flag gate decides. Allowlisted user → managed; others → V3.
- **Main production service**: env gate fails → V3 always, regardless of flag state or `targeting.userIds`.

The allowlisted user hitting the main service still gets V3. Flag widening mistakes cannot leak into production until `MANAGED_RUNTIME_ENABLED` is set there deliberately.

Only the target userId is added to `managed_agent_enabled.targeting.userIds`. All other production traffic stays on V3.

### 5.3 Smoke test suite (6 tests against `fondeu-pilot`)

Run before enabling the flag. Expected drill-triggered 409s (tests 4, 5) do not count against the exit criteria's "zero server-caused 409s" gate.

1. **Happy-path discovery turn** — managed runtime completes a discovery turn; `agent_messages` rows show `runtime_mode='managed'` with `turn_id` populated; `agent_turns` row exists with `completed_at` set; `application_agent_sessions.last_turn_model` populated.
2. **Kill-switch drill (two-part)** —
   (a) Flip `managed_agent_enabled.enabled = false` mid-session; next turn routes to V3 within 1 turn (validates Finding 4 cache-bypass + fail-closed).
   (b) Unset `MANAGED_RUNTIME_ENABLED` on pilot service, redeploy revision; submit turn; routes to V3 even if flag still targets the allowlisted user (validates the service-local gate).
3. **Auth-fail fallback** — temporarily unset `ANTHROPIC_API_KEY` on `fondeu-pilot`; submit turn; request completes via V3 with `application_agent_sessions.degraded_reason='auth_setup_failure'` recorded.
4. **Concurrency drill** — submit two overlapping POSTs with the same `expectedStateVersion`; second returns `409 stale_state_version` (validates Finding 2).
5. **Retry idempotency drill** — simulate mid-stream Anthropic failure after first assistant output block; client retries with the same `requestId`; second request returns deterministic `409 conflict_request_id`; no duplicate user turn in `agent_messages`; `agent_turns` has exactly one row for that `requestId` (validates Finding 3 + M1).
6. **Compaction continuity drill** — build a session with enough history to trigger summary compaction (producing a `system_summary` message row and/or `session.messageSummary`); submit a managed turn; verify the system prompt passed to Anthropic includes the bounded summary block; turn completes coherently without re-asking for summarized context. **Validates the Finding 1 hardening** — not a regression smoke on current behavior.

Smoke test scripts live under `app/scripts/smoke/managed-pilot/`, runnable against a configured pilot service URL.

### 5.4 Entry criteria

All must be green before adding the target userId to `managed_agent_enabled.targeting.userIds`:

1. All 5 Finding fixes merged, unit + integration tests green.
2. Migrations M1 + M2 applied to production DB.
3. `fondeu-pilot` deployed, healthy, log/metric dashboards configured (see §6).
4. All 6 smoke tests pass against `fondeu-pilot`.
5. Kill-switch drill verified live (both parts of smoke test 2).
6. Rollback runbook committed to `docs/superpowers/runbooks/managed-agents-pilot-rollback.md` and tested end-to-end.

### 5.5 Exit criteria — widening gate

All must be green simultaneously:

- At least **7 days** elapsed since flag-on **AND** at least **50 successful managed turns** (both required, not either).
- **Zero duplicate-user-turn artifacts** in history (reconciliation query on `agent_messages` grouped by `turn_id` + `role='user'`).
- **Zero unexpected server-caused 409 concurrency errors** (drill-triggered 409s excluded; definition distinguishes expected drills from organic faults).
- **Breaker opens ≤ 1 per 24 h**, each with a reviewed root cause.
- **P95 managed latency ≤ 125% of V3 baseline** for comparable read-only turns (see §6 for measurement).
- **Zero data-corruption incidents.**
- **Zero kill-switch failures** during the observation window.

Widening decision is data-backed, not a judgment call.

### 5.6 Abort triggers

Any one trips an immediate flag-off:

- Any data corruption.
- Any confirmed duplicate-user-turn artifact.
- Breaker opens **> 3 per 24 h**.
- Managed P95 latency **> 2× V3 baseline** sustained for ≥ 1 hour.
- Kill switch fails to disable within one turn.
- Any continuity regression from compaction or resume observed in production.

### 5.7 Spec sentence

> Pilot widening requires a minimum 7-day observation window, at least 50 successful managed turns, and all reliability thresholds green: zero duplicate-turn artifacts, zero unexpected server-caused concurrency conflicts, acceptable breaker behavior, and P95 latency within 125% of the V3 baseline. Any data corruption, duplicate-turn artifact, kill-switch failure, or sustained severe latency regression aborts the pilot.

## 6. Observability

### 6.1 Structured per-turn logs

Emitted at turn completion on the pilot service, tagged `service=fondeu-pilot`:

```json
{ "sessionId", "turnId", "requestId", "iterations", "toolCount", "durationMs", "outcome", "degradedReason" }
```

### 6.2 Metrics and counters

- Managed turn count, success rate, fallback-to-V3 rate.
- **Breaker open events and cooldown probe outcomes** — matching the current closed/open state model. Transition-level instrumentation (first-class half-open state) is post-pilot.
- Response-status classification, kept separate:
  - **400 request validation**: `missing_request_id`, `missing_state_version`.
  - **409 concurrency conflict**: `stale_state_version` (Finding 2), `conflict_request_id` (Finding 3).
- Kill-switch propagation latency (drill-time measurement only).

### 6.3 Scheduled reconciliation queries

Daily cron against production DB. **Source of truth for managed latency and duplicate-turn detection is `agent_turns` (M1 output), not `agent_messages`** — the observability surface is downstream of M1.

- **Duplicate user turns per turn_id**:
  ```sql
  SELECT turn_id, count(*)
  FROM agent_messages
  WHERE role = 'user' AND turn_id IS NOT NULL
  GROUP BY turn_id
  HAVING count(*) > 1;
  ```
  Must return zero rows.

- **Abandoned turn rows** (`agent_turns` where `completed_at IS NULL AND started_at < now() - interval '1 hour'`):
  Expected ~0 in steady state; alert at > 5/day.

- **P95 managed turn latency** (24 h window):
  ```sql
  SELECT percentile_cont(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM completed_at - started_at) * 1000
  )
  FROM agent_turns
  WHERE runtime_mode = 'managed' AND completed_at IS NOT NULL
    AND started_at > now() - interval '24 hours';
  ```

- **V3 baseline P95 latency** — derived from Cloud Run request-duration access logs filtered to `POST /api/ai/agent` on the main service. Keeps V3 code untouched (non-goal respected).

The ratio (managed P95 / V3 baseline P95) is tracked daily; exit criterion §5.5 requires ≤ 1.25.

### 6.4 Dashboards

Two dashboards in the same observability tool (e.g., Cloud Monitoring):

- **Pilot health** — request count, success rate, breaker state, fallback rate, latency distribution vs V3 baseline.
- **Audit** — duplicate-turn count, 409 counts by cause, abandoned turns, kill-switch propagation incidents.

## 7. Rollback runbook

Committed to `docs/superpowers/runbooks/managed-agents-pilot-rollback.md`. Three escalating paths.

### 7.1 Primary — flag off (target: sub-second propagation)

```bash
# Option A: admin API (CSRF handling to be verified during kill-switch drill #5)
curl -X PATCH "$FONDEU_URL/api/v1/admin/feature-flags/managed_agent_enabled" \
  -H "Content-Type: application/json" \
  -b "$ADMIN_SESSION_COOKIE" \
  -d '{"enabled":false,"targeting":{}}'
```

```bash
# Option B: direct DB (bypasses API auth; for true emergencies)
psql "$DATABASE_URL" -c \
  "UPDATE feature_flags SET enabled=false, targeting='{}'::jsonb, updated_at=now() \
   WHERE key='managed_agent_enabled';"
```

Both options are documented. Option A's exact header and cookie requirements are confirmed during the kill-switch drill (entry criterion #5); if middleware CSRF applies to admin PATCH, the runbook will note the specific headers. Option B is always available regardless of middleware state.

### 7.2 Secondary — unset service-local gate (target: ~30 s for Cloud Run revision)

```bash
gcloud run services update fondeu-pilot --region europe-west2 \
  --remove-env-vars MANAGED_RUNTIME_ENABLED
```

### 7.3 Nuclear — scale pilot service to zero

```bash
gcloud run services update fondeu-pilot --region europe-west2 \
  --min-instances=0 --max-instances=0
```

Main production service is never touched during any rollback path.

## 8. Implementation ordering

Single PR, not a stack. The five Finding fixes interlock (Finding 2 and 3 share the route-refactor surface; M1 and Finding 3 runtime are one unit of thought). Review cost is lower as one coherent change than as five interdependent micro-PRs.

Commit sequence within the PR:

1. **Migrations M1 + M2** (`agent_turns` + `turn_id` column + sequence uniqueness index + drop redundant non-unique index).
2. **Finding 4** — flag cache-bypass + fail-closed.
3. **Finding 5** — breaker rolling-window (smallest, self-contained).
4. **Finding 1** — managed history summary loading + prompt summary block.
5. **Service-local gate** — `MANAGED_RUNTIME_ENABLED` short-circuit at route entry, before any managed-side import or initialization.
6. **Finding 2** — mandatory `expectedStateVersion` CAS + bilingual 409 + DB uniqueness retry-once fallback.
7. **Finding 3** — deferred persistence + `requestId` + turn-claim transaction + deterministic 409 on conflict + ownership checks on both create and conflict/readback paths.
8. **Observability instrumentation** — logs, metrics, reconciliation queries. Downstream of M1: queries source from `agent_turns`, not `agent_messages.latency_ms`.
9. **Smoke test suite** — scripts in `app/scripts/smoke/managed-pilot/`, runnable against pilot URL.
10. **Rollback runbook** — `docs/superpowers/runbooks/managed-agents-pilot-rollback.md`.
11. **CLAUDE.md note** — pilot operational status (flag default-off, targeted when live).
12. **Retention register entry** — "Agent-surface RLS: agent tables rely on app-code predicates; add DB-level RLS in a dedicated spec post-pilot."

Each commit is standalone-testable where the underlying schema allows. Migrations apply before deploy; subsequent commits keep production green regardless of deploy-vs-migrate ordering.

## 9. Cross-references

- Phase 2 design: `docs/superpowers/specs/2026-04-10-managed-agents-phase2-design.md`
- Phase 3 design (3a shipped; 3b/3c deferred): `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md`
- Overall architecture: `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md`
- Retention register: `docs/superpowers/legacy-retention-register.md`
- V3 security remediation plan (parallel track): `docs/superpowers/plans/2026-04-14-v3-security-remediation.md`
