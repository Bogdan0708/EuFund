# Managed Agents Phase 2 — Read-Only Pilot Design

**Date:** 2026-04-10
**Status:** Draft — pending engineering review
**Phase:** 2 of 5 (Managed Agents migration)
**Prerequisite:** Phase 1 — MCP Tool Extraction (merged on `feature/mcp-tool-extraction`)
**Parent architecture:** `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md`

---

## 1. Goals and Non-Goals

### Framing principle

**Managed runtime owns orchestration, but persisted truth still lives in the existing DB model.** Anthropic controls turn-by-turn planning and tool sequencing within one request. PostgreSQL remains the authoritative store for sessions, sections, messages, and audit events. Tool calls from the managed runtime read and write through the Phase 1 service layer that V3 already uses — no parallel state.

### Goals

1. **Route a feature-flagged subset of users to a managed runtime** that uses Anthropic's Messages API for turn planning and tool sequencing, while calling the Phase 1 service layer in-process for tool execution.
2. **Preserve the existing SSE `AgentEvent` contract** so the frontend `useAgent()` hook and all dashboard components work without changes.
3. **Keep V3 as a fully working fallback** for users not on the flag, for users hit by the circuit breaker, and for resumption after a managed failure.
4. **Restrict the pilot to read + rules tools** (9 read + 5 rules = 14 tools) and to the discovery → research phases. No write tools are exposed through the managed path in Phase 2.
5. **Instrument the managed path** for observability: per-message runtime mode, per-turn model, tool counts, degradation reasons, breaker state.

### Non-goals

- **Remote MCP over HTTP.** Phase 2 calls the service layer directly in-process. The Phase 1 `/api/mcp/*` routes stay built but unused. The `mcp-client-2025-11-20` beta header is NOT added in Phase 2.
- **Write tools through the managed path.** Any attempt to call a known write tool (`save_section_draft`, `approve_revision`, `rollback_section`, `save_call_blueprint`, `set_application_status`, `create_export_snapshot`) returns an `isError: true` tool result with an explanatory message.
- **Structuring / drafting / review phases.** The managed agent can search, retrieve evidence, get blueprints, run eligibility, and score fit. It cannot advance the session to structuring, drafting, or review. V3 handles those phases.
- **Parallel tool execution.** Phase 2 executes multi-tool messages sequentially in emitted order.
- **Shared circuit breaker across Cloud Run instances.** In-process breaker only. Redis-backed state is deferred.
- **Thinking/reasoning surface.** `thinking_delta` events are suppressed in Phase 2. If extended thinking is enabled in a future phase, the runtime must preserve any required thinking continuity across tool-use continuation calls, but Phase 2 does not surface or persist thinking.
- **Custom skills as code.** The four skills from §7 of the parent architecture spec are embedded as prompt instructions in `managed/prompt.ts`, not as separately packaged Anthropic Skills.
- **Frontend changes.** Zero new frontend code. SSE contract is preserved.

---

## 2. Architecture

### 2.1 Overview

```
POST /api/ai/agent (route.ts)
    │
    ├─── requireAuth() ─── isFeatureEnabled('managed_agent_enabled', { userId })
    │                              │
    │                    ┌─────────┴─────────┐
    │                    │                   │
    │              flag OFF or             flag ON
    │              breaker OPEN          and breaker CLOSED
    │                    │                   │
    │                    ▼                   ▼
    │         ┌──────────────────┐  ┌────────────────────┐
    │         │ runAgentTurn()   │  │ runManagedTurn()   │
    │         │ (V3 runtime.ts)  │  │ (managedRuntime.ts)│
    │         └──────────────────┘  └──────────┬─────────┘
    │                                          │
    │                               tool_use block
    │                                          │
    │                                          ▼
    │                               ┌────────────────────┐
    │                               │ executeManagedTool │
    │                               │ (executor.ts)      │
    │                               └──────────┬─────────┘
    │                                          │
    │                                          ▼
    │                               ┌────────────────────┐
    │                               │ services/*.ts      │
    │                               │ (Phase 1 layer)    │
    │                               └────────────────────┘
    │
    ▼
SSE stream of AgentEvent (same format for both runtimes)
```

### 2.2 Routing policy

On each `POST /api/ai/agent`, the handler evaluates — **in order, before the `ReadableStream` is constructed** — the following decision tree:

```
if not isFeatureEnabled('managed_agent_enabled', { userId })   → V3
else if managedCircuitBreaker.isOpen()                         → V3
else if getAnthropicClient() throws (setup failure)            → V3, record breaker failure
else                                                            → managed
```

**Key property:** the decision is made exactly once per request, before any SSE byte is written. A single request uses exactly one runtime. There is no mid-stream switching.

### 2.3 Fallback boundary

Three failure regions, mapped to three response patterns:

| Region | Boundary | Response |
|---|---|---|
| **Pre-construction** | Before `new ReadableStream(...)` is called | Same-request fallback to V3. User experience is seamless. |
| **Post-construction, pre-first-byte** | Inside `start(controller)` but before any `controller.enqueue` call | Emit one `error` SSE event with `retryable: true`. Client retries; the next request is re-evaluated by the routing policy and may hit V3 if the breaker has tripped, or may attempt managed again if the single failure did not cross the threshold. |
| **Mid-stream** | After any `controller.enqueue` call (aka "post-first-byte") | Emit one `error` SSE event with `retryable: true`. Mid-stream runtime switching is impossible because the frontend has already committed to the current runtime's output. |

**Implementation hook:** the runtime tracks a `firstByteFlushed: boolean` variable set to `true` on the first `emit()` call. This variable disambiguates the second and third regions for logging and ops visibility, even though the user-facing behavior is identical.

### 2.4 What stays untouched

- `app/src/lib/ai/agent/runtime.ts` — V3 runtime, fully intact
- `app/src/lib/ai/agent/tools/` — V3 tool registry
- `app/src/lib/ai/agent/services/` — Phase 1 service layer, shared by both runtimes
- `app/src/lib/ai/agent/mcp/` — Phase 1 MCP handlers, built but unused in Phase 2
- Frontend `useAgent` hook and all dashboard components — SSE contract unchanged

---

## 3. Components and Files

### 3.1 New files

| File | Purpose | LOC (estimate) |
|---|---|---|
| `app/src/lib/ai/agent/managed/runtime.ts` | `runManagedTurn()` — one-turn driver against Anthropic beta messages API. Loads history, builds system prompt, calls `anthropic.beta.messages.stream(...)`, consumes stream, delegates tool calls to executor, persists new messages, emits `AgentEvent` to caller. | ~350 |
| `app/src/lib/ai/agent/managed/executor.ts` | `executeManagedTool(block, ctx)` — in-process tool dispatcher. Maps tool name → Phase 1 service function. Returns `{ content, isError, toolName, latencyMs, truncated? }`. | ~250 |
| `app/src/lib/ai/agent/managed/tools.ts` | Tool definitions for the Anthropic Messages API. Reuses Zod schemas exported from Phase 1 MCP handlers. Exports `MANAGED_READ_ONLY_TOOLS: BetaTool[]` and `MANAGED_TOOL_NAMES: Set<string>`. | ~150 |
| `app/src/lib/ai/agent/managed/translator.ts` | `translateAnthropicEvent(event, tctx)` — side-effect-free mapping from Anthropic stream events to `AgentEvent` with caller-owned context. | ~120 |
| `app/src/lib/ai/agent/managed/circuit-breaker.ts` | `managedCircuitBreaker` singleton + `recordManagedFailure(reason)` / `recordManagedSuccess()` / `DegradedReason` union. | ~50 |
| `app/src/lib/ai/agent/managed/prompt.ts` | `buildManagedSystemPrompt(session, sections, phase, locale)` — fresh system-prompt builder for Phase 2 discovery → research scope. Does not import from V3's `prompt.ts`. | ~180 |
| `app/src/lib/ai/agent/managed/history.ts` | `loadManagedHistory(sessionId)` and `appendManagedMessage(sessionId, msg, meta)` — thin helpers over `agent_messages` that convert rows to Anthropic `MessageParam` and back. Sets `runtime_mode='managed'`, `provider`, `model`. | ~150 |
| `app/src/lib/ai/anthropic-client.ts` | `getAnthropicClient()` factory — lazy module-level singleton. Tests stub this factory. | ~30 |
| `app/drizzle/NNNN_runtime_mode_and_app_agent_sessions.sql` | Drizzle migration: new `runtime_mode` enum + `application_agent_sessions` table. | ~30 |
| `app/drizzle/NNNN_agent_messages_observability.sql` | Drizzle migration: add `runtime_mode`, `provider`, `model` columns to `agent_messages`. | ~10 |
| `app/tests/unit/managed/translator.test.ts` | Unit tests for translator (11 cases). | ~200 |
| `app/tests/unit/managed/executor.test.ts` | Unit tests for executor (14 happy paths, 6 write-tool blocks, unknown tool, error mapping, ctx.now propagation). | ~280 |
| `app/tests/unit/managed/circuit-breaker.test.ts` | Unit tests for breaker state transitions. | ~100 |
| `app/tests/unit/managed/prompt.test.ts` | Unit tests for prompt builder (locale, phase gating, tool list consistency). | ~120 |
| `app/tests/unit/managed/history.test.ts` | Unit tests for message round-trip conversion. | ~150 |
| `app/tests/integration/managed/runtime-happy-path.test.ts` | Integration: one tool_use → service call → end_turn. | ~200 |
| `app/tests/integration/managed/runtime-multi-iteration.test.ts` | Integration: 3 tool iterations in one turn. | ~200 |
| `app/tests/integration/managed/runtime-iteration-cap.test.ts` | Integration: iteration cap triggers controlled stop. | ~150 |
| `app/tests/integration/managed/runtime-tool-error.test.ts` | Integration: ServiceError → tool_result with isError. | ~180 |
| `app/tests/integration/managed/runtime-write-tool-blocked.test.ts` | Integration: write tool call blocked. | ~150 |
| `app/tests/integration/managed/route-pre-stream-fallback.test.ts` | Integration: setup error → V3 fallback. | ~180 |
| `app/tests/integration/managed/route-mid-stream-failure.test.ts` | Integration: mid-stream Anthropic error → error SSE. | ~200 |
| `app/tests/integration/managed/route-breaker-open.test.ts` | Integration: breaker open → V3. | ~150 |
| `app/tests/integration/managed/route-flag-off.test.ts` | Integration: flag off → V3, no managed row. | ~120 |

### 3.2 Modified files

| File | Change | LOC delta |
|---|---|---|
| `app/src/app/api/ai/agent/route.ts` | Add routing policy + pre-stream fallback + stream construction for managed path. | +60 |
| `app/src/lib/db/schema.ts` | Add `runtimeModeEnum`, `applicationAgentSessions` table, observability columns on `agentMessages`. | +50 |
| `app/src/lib/ai/agent/mcp/read/*.ts` | Promote existing input Zod schemas to `export`s so `managed/tools.ts` can import them. No logic changes. | +14 export keywords |
| `app/src/lib/ai/agent/mcp/rules/*.ts` | Same: promote input schemas to exports. | +5 export keywords |
| `app/src/messages/ro.json` + `en.json` | Add `managedAgent.degraded`, `managedAgent.notAvailable`, `managedAgent.pilotBadge` keys. | +6 |

### 3.3 Directory layout

```
app/src/lib/ai/agent/
├── runtime.ts            ← V3, untouched
├── prompt.ts             ← V3, untouched
├── tools/                ← V3 tool registry, untouched
├── services/             ← Phase 1 services, shared
├── mcp/                  ← Phase 1 MCP handlers, unused in Phase 2
└── managed/              ← NEW — Phase 2
    ├── runtime.ts
    ├── executor.ts
    ├── tools.ts
    ├── translator.ts
    ├── prompt.ts
    ├── history.ts
    └── circuit-breaker.ts
```

---

## 4. Data Flow

### 4.1 Happy path — new managed session, discovery turn

1. Browser: `POST /api/ai/agent` with `{ requestId, locale: 'ro', message: '...' }`.
2. `route.ts`: `requireAuth()` → `user`.
3. `route.ts`: `isFeatureEnabled('managed_agent_enabled', { userId: user.id })` → `true`.
4. `route.ts`: `managedCircuitBreaker.isOpen()` → `false`.
5. `route.ts`: decision locked to `'managed'`.
6. `route.ts`: load or create `agent_sessions` row (existing V3 logic, unchanged).
7. `route.ts`: try to build `getAnthropicClient()`. On throw → pre-construction fallback to V3 with `recordManagedFailure('auth_setup_failure')`.
8. `route.ts`: lazy-create `application_agent_sessions` row with `runtime_mode='managed'`, `created_with_flag=true`. Ownership is `user_id = user.id`.
9. `route.ts`: construct `new ReadableStream({ start(controller) { runManagedTurn(...) } })`.
10. Inside `runManagedTurn`:
    - `history = loadManagedHistory(sessionId)` → reads `agent_messages`, converts to `BetaMessageParam[]`.
    - `systemPrompt = buildManagedSystemPrompt(session, sections, phase='discovery', locale='ro')`.
    - `appendManagedMessage(sessionId, { role: 'user', content: input.message }, { runtimeMode: 'managed', provider: 'anthropic', model: null })`.
    - `stream = anthropic.beta.messages.stream({ model, system, tools: MANAGED_READ_ONLY_TOOLS, messages: [...history, userMsg], max_tokens: 4096 })`.
    - For each stream event: `agentEvent = translateAnthropicEvent(event, tctx)`. If non-null, `emit(agentEvent)` (sets `firstByteFlushed = true`).
    - On `content_block_stop` of a `tool_use` block: parse accumulated input JSON, call `executeManagedTool(block, serviceCtx)`, emit `{ type: 'tool_result', ... }`.
    - When `message_stop` arrives with `stop_reason === 'tool_use'`: continue tool loop by calling `anthropic.beta.messages.stream(...)` again with the assistant message and tool results appended.
    - When `message_stop` arrives with `stop_reason === 'end_turn'`: exit tool loop.
    - Persist final assistant message(s) to `agent_messages` with `runtime_mode='managed'`, `provider='anthropic'`, `model=tctx.messageModel`.
    - Emit `{ type: 'state_update', patch }` and `{ type: 'done', finalState }`.
    - Call `recordManagedSuccess()` and bump `application_agent_sessions.last_turn_at`, `last_turn_model`, `last_turn_tool_count`, `updated_at`.
11. `route.ts`: stream closes, response ends.

### 4.2 Multi-step tool-use loop

A single browser request can span multiple Anthropic `beta.messages.stream()` subcalls while remaining a single SSE stream to the frontend. The loop is:

```
while iteration < ITERATION_CAP (8):
  stream = anthropic.beta.messages.stream({ messages: [...history, ...accumulated] })
  for await event of stream:
    if text_delta: emit text_delta
    if tool_use start: emit tool_start
    if tool_use stop:
      result = executeManagedTool(block)
      emit tool_result
      accumulate tool_result block for next iteration
  if stop_reason === 'end_turn': break
  if stop_reason === 'tool_use':
    append assistant message to accumulated
    append user message with tool_result blocks to accumulated
    iteration++
    continue
  if stop_reason === 'max_tokens': emit error, break
if iteration >= ITERATION_CAP: emit text_delta ("reached iteration limit, please clarify"), log WARN, break
emit state_update
emit done
```

**Healthy-turn expectation:** discovery/research flows should typically complete in 1–4 tool iterations (e.g., `search_calls` → `get_call_blueprint` → `retrieve_evidence` → `run_eligibility`). The 8-iteration cap is a hard safety ceiling, not a target. Hitting the cap is treated as a controlled stop, not an error.

### 4.3 Pre-construction fallback

```
1. Flag check passes, breaker check passes.
2. try { getAnthropicClient() } catches → recordManagedFailure('auth_setup_failure'), markDegraded, delegate to handleV3Path() in same request.
3. Client code never sees anything different. No SSE is emitted from the managed path.
```

### 4.4 Post-construction, pre-first-byte failure

```
1. ReadableStream constructed.
2. Inside start(controller), runManagedTurn begins.
3. First await on stream iterator throws (e.g., Anthropic 401, 429, 5xx, connection refused).
4. firstByteFlushed is still false.
5. recordManagedFailure with the matching DegradedReason; markDegraded.
6. controller.enqueue(error SSE event with retryable=true).
7. controller.close().
8. Client receives one error event; retries.
9. Next request: managedCircuitBreaker may be open (depends on failure count) → V3, or still closed → another managed attempt.
```

### 4.5 Mid-stream failure

```
1. Stream has already emitted text_delta + tool_start events.
2. firstByteFlushed is true.
3. Anthropic drops connection or returns overloaded_error block.
4. recordManagedFailure('stream_disconnect'), markDegraded.
5. controller.enqueue(error SSE event).
6. controller.close().
7. Frontend error handler shows toast, offers retry.
8. User clicks retry → new request → routing policy re-evaluated; hits V3 if the breaker has tripped, otherwise retries managed.
```

### 4.6 Resume flow

```
1. POST /api/ai/agent with body.sessionId.
2. route.ts: load agent_sessions row → verify ownership → check stateVersion.
3. route.ts: evaluate routing policy (flag + breaker + setup) → decision for this request.
4. If decision is 'managed' and application_agent_sessions row exists with runtime_mode='managed':
     dispatch to runManagedTurn (continues history from agent_messages).
5. If decision is 'v3' (flag off, breaker open, or setup failed):
     dispatch to runAgentTurn (V3). History is still in agent_messages, visible to V3 via existing loadContext.
```

**Key property:** `runtime_mode` on `application_agent_sessions` is a **hint**, not a **lock**. A session can be resumed under either runtime without data loss, because all state lives in `agent_sessions` + `agent_messages` + `agent_sections`.

### 4.7 Interrupt flow

```
1. Client disconnects or aborts (request.signal.aborted).
2. runManagedTurn detects abort → calls stream.abort().
3. Any in-flight tool execution is allowed to finish (Phase 2 tools are read-only, so no DB writes are at risk).
4. Partial assistant output (if any) is NOT persisted to agent_messages.
5. application_agent_sessions.status stays 'active'.
6. Next resume picks up from the last persisted assistant message.
```

**Intentional divergence from V3:** V3 sometimes persists partial assistant messages. Phase 2 is stricter — we drop partial content to preserve clean history semantics during pilot evaluation.

---

## 5. Database Schema

### 5.1 New enum: `runtime_mode`

```sql
CREATE TYPE runtime_mode AS ENUM ('v3', 'managed');
```

### 5.2 New table: `application_agent_sessions`

Minimal metadata table. Created lazily on the first request routed to the managed runtime path, including requests that degrade to V3 before the stream is constructed. Never stores conversation content.

```sql
CREATE TABLE application_agent_sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          UUID NOT NULL UNIQUE REFERENCES agent_sessions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id),

  runtime_mode        runtime_mode NOT NULL DEFAULT 'managed',
  created_with_flag   BOOLEAN NOT NULL DEFAULT false,

  status              agent_session_status NOT NULL DEFAULT 'active',

  degraded_at         TIMESTAMPTZ,
  degraded_reason     TEXT,

  last_turn_at        TIMESTAMPTZ,
  last_turn_model     VARCHAR(50),
  last_turn_tool_count INTEGER NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at           TIMESTAMPTZ
);

CREATE INDEX idx_app_agent_sessions_user_status
  ON application_agent_sessions (user_id, status, updated_at DESC);
```

**Ownership rule:** all reads and writes to `application_agent_sessions` must be scoped by `session_id` AND `user_id = ctx.userId` in the service layer. No direct unscoped access. No new RLS policy — follows existing V3 convention of application-layer ownership enforcement.

**`last_turn_tool_count` semantics:** count of tool calls in the most recent **successful** managed turn. Reset on each successful turn, not cumulative across the session.

**`degraded_reason` controlled vocabulary** (application-side TypeScript union, DB column is TEXT for forward flexibility):

```typescript
export type DegradedReason =
  | 'circuit_open'
  | 'anthropic_unavailable'  // 401, 429, 5xx
  | 'anthropic_timeout'
  | 'stream_disconnect'
  | 'auth_setup_failure'
```

**`updated_at` discipline:** bumped on every managed attempt (success or failure) and on every degrade event.

### 5.3 Migration: observability columns on `agent_messages`

```sql
ALTER TABLE agent_messages
  ADD COLUMN runtime_mode runtime_mode NOT NULL DEFAULT 'v3',
  ADD COLUMN provider VARCHAR(20),
  ADD COLUMN model VARCHAR(50);

CREATE INDEX idx_agent_messages_runtime
  ON agent_messages (runtime_mode, created_at DESC);
```

Existing rows get `runtime_mode='v3'` via the `DEFAULT` clause. `provider` and `model` are NULL for historical rows. New managed-path inserts set all three explicitly.

### 5.4 Feature flag seed

Inserted via a one-off admin SQL or migration seed. Note: the `feature_flags` table stores targeting as a JSONB column, and `isFeatureEnabled()` fails closed when `enabled=false`:

```sql
INSERT INTO feature_flags (key, enabled, targeting, description)
VALUES (
  'managed_agent_enabled',
  false,
  '{}'::jsonb,
  'Route POST /api/ai/agent to the managed runtime for allowlisted users. Phase 2 pilot — discovery/research only, no writes.'
);
```

Default `enabled=false` means the flag returns `false` for all users. To allowlist a user, update to `enabled=true` and set `targeting={"userIds": ["<user-id>"]}`:

```sql
UPDATE feature_flags
SET enabled = true,
    targeting = '{"userIds": ["<dev-user-id>"]}'::jsonb
WHERE key = 'managed_agent_enabled';
```

### 5.5 No changes to

- `agent_sessions` (no new columns)
- `agent_sections`, `agent_section_versions` (untouched)
- `agent_checkpoints` (untouched)
- RLS policies (none added or modified)

---

## 6. Tool Executor

### 6.1 Phase 2 tool list

14 tools: 9 read + 5 rules.

| Tool | Service function | Category | Guards |
|---|---|---|---|
| `search_calls` | `evidence.searchCalls` | read | none |
| `get_call_blueprint` | `blueprint.lookupBlueprint` | read | none |
| `retrieve_evidence` | `evidence.retrieveEvidence` | read | none |
| `get_application_state` | `application.getApplicationState` | read | session owner |
| `list_sections` | `sections.listSections` | read | session owner |
| `get_section` | `sections.getSection` | read | session owner |
| `get_validation_report` | `application.validateApplication` (read view) | read | session owner |
| `get_project_summary` | `projects.getProjectSummary` | read | project owner |
| `list_uploaded_documents` | `projects.listUploadedDocuments` | read | project owner |
| `run_eligibility` | `eligibility.runEligibility` | rules | none |
| `score_fit` | `eligibility.scoreFit` | rules | none |
| `validate_section` | `sections.validateSection` | rules | session owner |
| `validate_application` | `application.validateApplication` | rules | session owner |
| `check_missing_annexes` | `application.checkMissingAnnexes` | rules | session owner |

All ownership guards are already implemented in the Phase 1 service layer via `NotFoundError` / `AuthorizationError` throws. The executor maps these to `isError: true` tool results.

**Tool descriptions are written for the model, not for humans.** Example corrections to prior drafts:

- `get_call_blueprint` — "Returns cached blueprint, or a cache-miss result containing raw evidence for extraction."

### 6.2 Executor contract

```typescript
export interface ExecutorResult {
  content: string          // JSON-stringified service result, or human-readable error message
  isError: boolean
  toolName: string
  latencyMs: number
  truncated?: boolean      // true if output was reduced to fit the 16KB cap
}

export async function executeManagedTool(
  block: BetaToolUseBlock,
  ctx: ServiceContext,
): Promise<ExecutorResult>
```

### 6.3 Execution rules

1. **Allowlist check.** If `block.name` is not in `MANAGED_TOOL_NAMES`, return `isError: true`. If `block.name` is in `KNOWN_WRITE_TOOLS`, return `isError: true` with message "Write tools are not available in Phase 2. The managed agent can only read and evaluate. To save, approve, or export, please use the standard workflow."
2. **Zod parse.** Input is parsed with the schema imported from Phase 1 MCP handlers. Parse failures return `isError: true` with the Zod error message.
3. **Dispatch.** A switch statement maps `name → service function call`. Each case constructs the service arguments from the parsed input and passes `ctx` through.
4. **Error mapping.** Catches:
   - `NotFoundError` → `isError: true`, content `"NOT_FOUND: <message>"`
   - `AuthorizationError` → `isError: true`, content `"AUTHORIZATION: Access denied to requested session"` (avoids existence-leak phrasing like "Session X not owned by you")
   - `ValidationError` → `isError: true`, content `"VALIDATION: <message>"`
   - `ConcurrencyError` → `isError: true`, content `"CONCURRENCY: <message>"` — retained for shared service-layer compatibility; Phase 2 exposes no write tools so this mapping is dormant
   - `ExternalDependencyError` → `isError: true`, content `"EXTERNAL_DEPENDENCY: <service> unavailable"`
   - Any other `Error` → `isError: true`, content `"Internal tool error"` (safe — no stack trace leaked to model).
5. **Sequential execution.** If a single assistant message contains multiple `tool_use` blocks, Phase 2 executes them sequentially in emitted order and returns tool results in the same order.
6. **Size cap.** Tool results are capped at 16KB serialized. Results exceeding the cap are reduced to a structured truncated form that preserves the highest-value fields and sets `truncated: true`; they are not rejected solely for size. Per-tool truncation strategies:
   - `retrieve_evidence` → keep top N chunks by score, drop remainder
   - `search_calls` → keep top N matches by score
   - `validate_application` → keep summary + top issues
   - `list_uploaded_documents` → keep first N documents + count of remainder
   - Other tools → safe string truncation as fallback if result exceeds cap
7. **Timeout.** Each tool call is wrapped in `Promise.race` with a 15s timeout. Timeout → `isError: true` with message "Tool timed out after 15s".

### 6.4 ServiceContext semantics

```typescript
const serviceCtx: ServiceContext = {
  userId: user.id,
  sessionId: agentSession.id,
  organizationId: undefined,
  projectId: agentSession.projectId ?? undefined,
  requestId: request.requestId,
  now: new Date(),  // request start time
}
```

`ctx.now` represents **request start time**, not per-tool wall-clock time. This is intentional: consistency across tool calls within a single managed turn is more valuable than per-tool accuracy. Documented here so nobody later assumes `ctx.now` updates between tool calls.

---

## 7. Event Translator

### 7.1 Translator shape

```typescript
export interface TranslatorContext {
  messageModel: string | null
}

export function createTranslatorContext(): TranslatorContext {
  return { messageModel: null }
}

export function translateAnthropicEvent(
  event: BetaRawMessageStreamEvent,
  tctx: TranslatorContext,
): AgentEvent | null
```

Side-effect-free mapping function with caller-owned context. The only state the translator touches is `tctx.messageModel`, written once when `message_start` is observed so the runtime can later use it for `agent_messages.model` and `application_agent_sessions.last_turn_model`. No DB access, no logging, no service calls.

### 7.2 Event mapping

| Anthropic event | Sub-type | AgentEvent emitted | Notes |
|---|---|---|---|
| `message_start` | — | none | Captures `event.message.model` into `tctx.messageModel` |
| `content_block_start` | `text` | none | Text content arrives via deltas |
| `content_block_start` | `tool_use` | `tool_start` with `input: {}` | Intentional UX-first divergence from V3 (see §7.3) |
| `content_block_delta` | `text_delta` | `text_delta` with `content: event.delta.text` | Direct mapping |
| `content_block_delta` | `input_json_delta` | none | Accumulated by runtime for tool dispatch |
| `content_block_delta` | `thinking_delta` | none | Suppressed in Phase 2 |
| `content_block_delta` | `signature_delta` | none | Internal to Anthropic's thinking flow |
| `content_block_delta` | `citations_delta` | none | Not used in Phase 2 |
| `content_block_stop` | — | none | Runtime handles tool_use dispatch on observing this |
| `message_delta` | `stop_reason: 'max_tokens'` | `error` with `retryable: true` | Message: "Response truncated: model hit max token limit." |
| `message_delta` | other stop reasons | none | Consumed by runtime loop for continuation decisions |
| `message_stop` | — | none | Runtime decides continuation vs `done` |

### 7.3 Intentional divergence: `tool_start` with empty input

The translator emits `tool_start` at the start of a `tool_use` content block, before the model has finished streaming the tool input JSON. Therefore `tool_start.input` is `{}` in Phase 2. This preserves immediate UI feedback (spinner appears as soon as the model commits to a tool call) and is acceptable because the frontend only uses the tool name for spinner state.

V3 emits `tool_start` with full input because V3's runtime has the input before the tool executes (non-streaming). Matching V3 parity here would delay the spinner by the input-streaming duration. Rejected — UX responsiveness wins.

### 7.4 Runtime-emitted events (NOT from translator)

Some `AgentEvent` types need service-layer data or cross-stream state and are emitted by the runtime, not the translator:

| AgentEvent | Emitted by | Trigger |
|---|---|---|
| `tool_result` | runtime | After `executeManagedTool` returns |
| `state_update` | runtime | After tool result changes session state (re-reads from DB, emits patch) |
| `phase_changed` | runtime | If a tool result caused a phase transition. Phase 2 does not expect to fire this event — the runtime is plumbed for it so Phase 3 can enable phase advancement without touching the translator or runtime loop. |
| `done` | runtime | At end of entire turn (after all tool iterations complete) |
| `error` | runtime | Pre-stream fallback, mid-stream Anthropic failure, iteration cap reached (iteration cap emits a `text_delta` + `done`, not `error`) |

---

## 8. Error Handling and Circuit Breaker

### 8.1 Error taxonomy

| Class | Source | Where | Runtime response |
|---|---|---|---|
| **Setup error** | `getAnthropicClient()` throws | Before `ReadableStream` construction | Pre-construction fallback to V3. `recordManagedFailure('auth_setup_failure')`. Log WARN. |
| **Initial Anthropic rejection** | 401/429/5xx on first stream call | Post-construction, pre-first-byte | Emit `error` SSE event with `retryable: true`. `recordManagedFailure('anthropic_unavailable'` or `'anthropic_timeout')`. Log WARN. |
| **Mid-stream disconnect** | TCP drop or `overloaded_error` block after first byte | Mid-stream | Emit `error` SSE event with `retryable: true`. `recordManagedFailure('stream_disconnect')`. Do NOT persist partial assistant message. Log ERROR. |
| **Tool execution failure** | Service layer throws `ServiceError` | Inside tool loop | Map to `isError: true` tool result, inject back into conversation, model continues turn. Not a runtime-level error. Log WARN. |
| **Iteration cap hit** | Model called tools beyond 8 iterations | At cap | Emit `text_delta` ("reached tool iteration limit; please clarify your request") + `done`. Controlled stop. Log WARN (not ERROR — this is a controlled stop, not infrastructure failure). |

### 8.2 Circuit breaker

`app/src/lib/ai/agent/managed/circuit-breaker.ts`:

```typescript
import { CircuitBreaker } from '@/lib/errors'

export const managedCircuitBreaker = new CircuitBreaker({
  name: 'managed-agent',
  failureThreshold: 3,
  resetTimeoutMs: 30_000,
  monitoringPeriodMs: 10_000,
})

export type DegradedReason =
  | 'circuit_open'
  | 'anthropic_unavailable'  // 401, 429, 5xx
  | 'anthropic_timeout'
  | 'stream_disconnect'
  | 'auth_setup_failure'

export function recordManagedFailure(reason: DegradedReason): void {
  managedCircuitBreaker.recordFailure()
}

export function recordManagedSuccess(): void {
  managedCircuitBreaker.recordSuccess()
}
```

**Breaker semantics:** 3 consecutive failures within a 10s window → open for 30s → half-open probe → close on success, reopen on failure.

**Breaker scope:** per-process, in-memory. In Cloud Run with multiple instances, each instance tracks its own failures. Acceptable for a feature-flagged pilot — concurrent failures across instances hint at a real Anthropic outage, and each instance independently converges to the same state.

If the existing `CircuitBreaker` class in `@/lib/errors` has a different method signature, the wrapper in `managed/circuit-breaker.ts` adapts. The wrapper is the only place in the managed code that touches the underlying class directly.

### 8.3 Timeouts

- **Anthropic request timeout:** 60s per stream call, set on the SDK client. Longer than V3's 30s because a managed turn can span multiple sub-streams in the tool loop.
- **Tool execution timeout:** 15s per tool call, enforced via `Promise.race` in the executor.
- **Max tool iterations per turn:** 8 (hard safety ceiling).
- **No automatic retries on Anthropic failures.** Single attempt; failure → breaker record → fall back. Retry logic would conflict with breaker semantics and make tests flaky.

---

## 9. Logging and Observability

All logs use `logger.child({ component: 'managed-runtime' })`.

| Level | When | Fields |
|---|---|---|
| INFO | Managed turn start | `sessionId`, `userId`, `requestId`, `model`, `runtimeMode: 'managed'` |
| INFO | Managed turn success | `sessionId`, `requestId`, `toolCount`, `iterationCount`, `latencyMs`, `model` |
| INFO | Tool executed | `sessionId`, `requestId`, `toolName`, `latencyMs`, `isError`, `truncated?` |
| WARN | Service error in tool | `sessionId`, `requestId`, `toolName`, `serviceErrorCode`, `message` |
| WARN | Setup failure | `sessionId`, `requestId`, `reason: 'auth_setup_failure'` |
| WARN | Post-construction, pre-first-byte failure | `sessionId`, `requestId`, `reason` |
| WARN | Iteration cap hit | `sessionId`, `requestId`, `attemptedTools: string[]` |
| ERROR | Mid-stream failure | `sessionId`, `requestId`, `reason`, `iterationsCompleted`, `toolsExecuted` |

**Ops queries supported by this logging:**

- "How many managed turns succeeded today?" → count INFO success events
- "What's the p95 latency of managed turns?" → histogram on `latencyMs`
- "Which tools are called most often?" → count INFO tool events by `toolName`
- "Are we seeing truncation?" → count INFO tool events with `truncated=true`
- "Why did managed degrade?" → count WARN/ERROR events by `reason`

A Phase 3 Prometheus metrics layer can be built on top of these logs.

---

## 10. Testing

### 10.1 Test layers

**Unit tests** (no DB, no network):

| File | Scope |
|---|---|
| `tests/unit/managed/translator.test.ts` | 11 event cases + full synthetic stream → expected event sequence |
| `tests/unit/managed/executor.test.ts` | 14 happy paths, 6 write-tool blocks, unknown tool, 5 ServiceError mappings, unexpected error → "Internal tool error", ctx.now propagation |
| `tests/unit/managed/circuit-breaker.test.ts` | Closed → open → half-open → closed transitions; failure counting; reset timeout |
| `tests/unit/managed/prompt.test.ts` | Phase-gating text presence, tool list matches `MANAGED_READ_ONLY_TOOLS`, locale switches produce correct language, no Romanian in English prompt and vice versa |
| `tests/unit/managed/history.test.ts` | Round-trip: `agent_messages` row → `BetaMessageParam` → `agent_messages` row; `runtime_mode`, `provider`, `model` tagging on writes |

**Integration tests** (vitest + DB + mocked Anthropic SDK):

| File | Scope |
|---|---|
| `tests/integration/managed/runtime-happy-path.test.ts` | One tool iteration, end_turn, assert SSE event order + DB state |
| `tests/integration/managed/runtime-multi-iteration.test.ts` | 3 iterations: search → blueprint → eligibility → end_turn |
| `tests/integration/managed/runtime-iteration-cap.test.ts` | Model never emits end_turn, assert cap triggers `text_delta` + `done` at iteration 8, log WARN |
| `tests/integration/managed/runtime-tool-error.test.ts` | Service throws `NotFoundError`, assert tool_result has isError, model continues |
| `tests/integration/managed/runtime-write-tool-blocked.test.ts` | Mock model calls `save_section_draft`, assert blocked message returned, service never invoked |
| `tests/integration/managed/route-pre-stream-fallback.test.ts` | Stub `getAnthropicClient()` to throw, assert V3 path runs, breaker records failure |
| `tests/integration/managed/route-mid-stream-failure.test.ts` | Mock stream to throw after first text_delta, assert error SSE event, `degraded_at` set |
| `tests/integration/managed/route-breaker-open.test.ts` | Manually open breaker, assert V3 runs even with flag on |
| `tests/integration/managed/route-flag-off.test.ts` | Flag off, assert V3 runs, no `application_agent_sessions` row created |

### 10.2 Mocking strategy

- **Anthropic SDK** is mocked at `vi.mock('@anthropic-ai/sdk')`. Tests construct synthetic `BetaRawMessageStreamEvent[]` arrays and push them through an async generator that simulates the stream API.
- **`getAnthropicClient()`** is stubbed via `vi.mock('@/lib/ai/anthropic-client')` so tests inject the mocked SDK.
- **Service functions** are NOT mocked in integration tests — they run against a real test DB. This catches regressions in service behavior.
- **Feature flags** mocked via `vi.mock('@/lib/feature-flags')`.

### 10.3 E2E (out of scope)

Real Anthropic API calls gated behind `RUN_MANAGED_E2E=1` env var. Not in CI. Run manually before merging Phase 2. Single scenario: "Vreau fonduri UE pentru panouri solare" → verify SSE event ordering and final state.

---

## 11. Rollout

```
1. Merge Phase 2 code with feature flag default OFF.
2. Run DB migrations on staging + production:
     npm run db:generate
     npm run db:migrate
3. Verify: `npm run build && npm run test` passes.
4. Verify production DB: application_agent_sessions table exists, agent_messages has new columns.
5. Add ANTHROPIC_API_KEY to Cloud Run env for the managed runtime.
6. Flip flag ON for exactly one test user (developer's own account):
     UPDATE feature_flags
     SET enabled = true,
         targeting = '{"userIds": ["<dev-user-id>"]}'::jsonb
     WHERE key = 'managed_agent_enabled';
7. Test a discovery turn. Verify:
     - SSE events arrive in correct order
     - agent_messages has rows with runtime_mode='managed'
     - application_agent_sessions has a row for the session
     - last_turn_model is populated
     - last_turn_tool_count matches observed tool calls
8. Monitor breaker metrics (logs) for 24h.
9. Add 2-3 more allowlisted users. Gather feedback.
10. Decide: expand allowlist further, stay in pilot, or revert.
```

---

## 12. Rollback

Three rollback levels, in order of preference:

1. **Soft rollback (preferred):** Flip feature flag `enabled=false` or clear `targeting.userIds`. All new sessions route to V3 immediately. Existing managed sessions can be resumed under V3 (resume flow respects current flag state, not the session's original runtime mode). Zero code deploy needed.
2. **Hard rollback:** Revert the merge commit. DB migrations stay in place — no destructive changes — but the code path reading the new columns is gone. Safe because the new columns and table are additive only.
3. **DB rollback (not recommended):** Drop `application_agent_sessions` and remove columns from `agent_messages`. Only needed if migrations broke something at the DB level. Manual SQL, not a Drizzle migration.

The design prioritizes soft rollback. No destructive DB changes, no frontend coupling, no V3 runtime modifications.

---

## 13. Appendix: Future-Proofing Notes

These are intentionally non-goals for Phase 2 but documented here so Phase 3+ implementers don't have to rediscover them:

1. **Extended thinking.** If thinking is enabled in a future phase, the runtime must preserve any thinking blocks in the assistant messages passed back on tool-use continuation calls. Anthropic's docs frame tool_use as the continuation condition within a single assistant turn; thinking blocks are part of that turn and must not be dropped.
2. **Remote MCP.** When the app goes live and Phase 3 introduces remote MCP, add the `mcp-client-2025-11-20` beta header to the `betas` array on `beta.messages.stream()` calls, and populate `mcp_servers` with `BetaRequestMCPServerURLDefinition` entries pointing to `/api/mcp/read`, `/api/mcp/rules`, etc. The existing Phase 1 MCP handlers are already built and will be reachable once the deployment is public.
3. **Redis-backed circuit breaker.** Phase 3 or 4 may want shared breaker state across Cloud Run instances. The `managed/circuit-breaker.ts` wrapper is the only place that needs to change; callers use `recordManagedFailure` / `recordManagedSuccess` / `managedCircuitBreaker.isOpen()` abstractions.
4. **Parallel tool execution.** Phase 2 executes tools sequentially. If Phase 3+ enables parallel execution, update the executor to run `Promise.all` over tool_use blocks, and ensure `tool_result` blocks are emitted in a deterministic order for the follow-up Anthropic message (order doesn't matter semantically but determinism helps debugging).
5. **Write tools.** Phase 3 adds write tools to the managed path. The `KNOWN_WRITE_TOOLS` set and the "write tools blocked" executor check are the only things that need to change. The service layer and audit logging are already in place.
6. **Skills as packaged artifacts.** Phase 2 embeds skill instructions in the system prompt. If Phase 3+ moves to Anthropic's Skills API (`beta.skills`), the `managed/prompt.ts` builder can split the static instructions into uploaded skills and a slimmer per-request prompt. This is an optimization, not a correctness change.
