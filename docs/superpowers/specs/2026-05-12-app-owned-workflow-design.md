# App-Owned Workflow Design

**Date:** 2026-05-12
**Status:** Approved — ready for writing-plans
**Scope:** One spec, five phased PRs.
**Authors:** brainstormed with godjabogdan

## Motivation

The AI/business flow is over-agentic. Core product steps — select call, load blueprint, run eligibility, build outline, freeze outline, draft, validate, accept — are currently delegated to chat/model turns. The app feels slow because "generate something" is several model-planning hops away from the first user input.

Concrete failures from the April 2026 audit:

1. After deterministic preselect picks a call, the UI immediately sends the same description into the agent, creating an extra LLM turn before useful output (`NewProjectView.tsx:97`).
2. Preselect stores `blueprint` and advances `phase`, but does not store `outline` (`services/preselect.ts:173`). The state route only returns persisted `agent_sections`, so the outline UI can be empty even though the blueprint exists (`api/ai/agent/state/route.ts`).
3. The managed runtime snapshot has the same outline-visibility gap (`managed/runtime.ts:612`).
4. `save_call_blueprint` advances to structuring but does not persist outline (`managed/executor.ts:466`).
5. `freezeOutline` policy checks selected call + eligibility, not outline presence — can move to drafting with no sections to draft (`policy/matrix.ts:56`).
6. Managed exposes a broad tool surface (24 tools with writes), V3 uses Opus on every tool-loop planning turn (up to 5 iterations) before synthesis; managed allows 8.
7. No first-class `generate_section` product command; generation is model-authored inside a write tool argument.

## Goal

Make the app the workflow engine. Make the model a writer and research assistant.

> **Workflow mutations only happen through deterministic REST/SSE commands. Chat can write content only to the app-selected focused section.**

That sentence is the architectural invariant. The rest of this document operationalizes it.

## Target Flow

```
User describes project
  ↓
[Preselect — deterministic] picks call (existing)
  ↓
App shows: selected call + outline preview + "Generate next section" button
  ↓
User clicks Generate
  ↓
[Backend, one request] ensureDraftingReady() = eligibility + freeze + generate + persist
  ↓
Section appears (streaming) — no model "planning" turns
```

Chat is still available for clarification ("what does the call say about match funding?") and section revision ("rewrite this paragraph more formally"). Chat never owns workflow.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  UI (NewProjectView)                                          │
│  ┌──────────────────────┐  ┌─────────────────────────────┐   │
│  │ Chat panel           │  │ Workspace panel             │   │
│  │ (clarification +     │  │ Buttons: Generate, Freeze,  │   │
│  │  section revision)   │  │  Accept, Change-Call        │   │
│  └──────────┬───────────┘  └────────────┬────────────────┘   │
│             │ chat msgs                  │ deterministic       │
└─────────────┼─────────────────────────────┼────────────────────┘
              │                             │
              ▼                             ▼
   ┌────────────────────┐    ┌────────────────────────────────┐
   │ /api/ai/agent      │    │ /api/v1/agent-sessions/:id/    │
   │ (V3 + managed)     │    │   actions/* (REST)             │
   │                    │    │ /api/v1/agent-sessions/:id/    │
   │ Read tools (10)    │    │   sections/generate (SSE)      │
   │ Rule tools (5)     │    │                                │
   │ Write tool (1):    │    │ Deterministic:                 │
   │   save_section_    │    │   - validate preconditions     │
   │   draft (focused   │    │   - mutate via service layer   │
   │   section only)    │    │   - call model ONCE (generate) │
   └─────────┬──────────┘    └──────────────┬─────────────────┘
             │                              │
             ▼                              ▼
         ┌────────────────────────────────────────┐
         │  Service layer (lib/ai/agent/services) │
         │  Policy matrix enforces invariants     │
         │  agent_sessions / agent_sections       │
         └────────────────────────────────────────┘
```

**Two invariants:**

1. **Workflow mutations** (selectedCallId, outline, phase, outlineFrozen, application status, section status) — only `/actions/*` and `/sections/generate` can change these. The model has no chat tools that touch them.
2. **Content** (section draft text) — only `save_section_draft` writes it. The model only ever passes `{ content }`; backend injects sessionId, focusedSectionKey (validated against `session.outline`), expectedStateVersion, and user identity. The model cannot choose target section.

Both runtimes (V3 + managed) are in scope; the new endpoints sit outside both. Endpoints are session-scoped (project promotion is not guaranteed at preselect time); project aliases can be added later.

## Section 1: Bootstrap fix — stop re-sending description after preselect

**Today** (`NewProjectView.tsx:97-125` and the candidate-pick handler at `:210`):

```
preselect succeeds → adoptSession(newId) → sendMessage(description)
                                            ^^^ wasted Opus turn
```

That `sendMessage` triggers `/api/ai/agent`, which initializes a `research` or `structuring` session and runs a planning turn whose first move is loading the (already-loaded) blueprint.

**Change:**

1. After `preselect` returns `kind: 'selected'`, UI calls `adoptSession(newId)` and **stops**. No `sendMessage`. Same for the new-session candidate-pick path (`:210`). The override-existing-session path is untouched (it already doesn't send).
2. UI's first paint reads session state from `/api/ai/agent/state?sessionId=...` (which §2 fixes to project a virtual outline).
3. Chat panel renders a **static local welcome** string from `messages/ro|en.json` — no model call. Example:
   > *"Am selectat apelul. Apasă „Generează schiță" pentru a începe sau scrie-mi întrebări despre cerere."*
4. The "Generate next section" button (§5) is the only path required to produce first user-visible content.

**Unaffected:**
- Resume flow (`initialSessionId` set): preselect skipped, sendMessage path unchanged.
- Hero query pre-fill: pre-populates the input box, does not auto-send.
- Preselect-disabled fallback (flag off): `sendMessage` still the entry point.

**Removed code:**
- `await agent.sendMessage(description)` on `NewProjectView.tsx:125` and `:210`.

**Test surface:**
- E2E: preselect-selected creates/adopts session → UI renders selected call + Generate button + **static local welcome only** → no `/api/ai/agent` SSE traffic → DB has no `agent_turns` row for the session until Generate/chat is explicitly invoked.

## Section 2: Outline persistence + centralized state projection

Two problems, one fix per side: writes always populate outline; reads always go through one helper.

### 2a. Writes — outline is persisted on every path that knows the blueprint

| Code path | Today | After |
|---|---|---|
| `services/preselect.ts:173` (cached blueprint structured path) | `outline = null` | `outline = outlineFromBlueprint(blueprintPayload)` |
| `managed/executor.ts:466` (`save_call_blueprint` write tool) | sets `blueprint + currentPhase`, no outline | same conditional WHERE update also sets `outline = outlineFromBlueprint(...)` |

V3's `resolve_call` → `SET_OUTLINE` → `persistSessionState` chain is unchanged — it already writes outline when the blueprint resolves at turn time.

`outlineFromBlueprint` is a one-line wrapper in `services/blueprint.ts` reusing existing `materializeCachedSections`:

```ts
export function outlineFromBlueprint(blueprint: CallBlueprint): SectionSpec[] {
  return materializeCachedSections(
    blueprint.normalized.requiredSections,
    blueprint.structureConfidence,
  )
}
```

No new slugging path. Defensive against partial-blueprint shapes (the helper passes through full `SectionSpec` rows unchanged via `isFullSectionSpec`).

`session.outline` remains `SectionSpec[] | null`. The 12 existing fields (`id`, `title`, `description`, `order`, `generationOrder`, `importance`, `expectedLength`, `dependsOn`, `modelHint`, `evaluationWeight?`, `mandatory`, `confidence`) are preserved — existing consumers like `regenerate-section.ts:39` that call `outline.find(s => s.id === sectionKey)` keep working.

`setSelectedCall` is **not** modified — preselect override paths depend on its narrow scope. Change-call reset semantics live in §4's dedicated `changeCall()` service.

### 2b. Reads — `projectSessionState` helper

New file `lib/ai/agent/state-projection.ts`:

```ts
export function projectSessionState(
  session: AgentSession,
  sectionRows: AgentSection[],
): UIStateSnapshot
```

Per-section resolution order:

1. For each `SectionSpec` in `session.outline`, find the `agent_sections` row with `sectionKey === spec.id`.
2. Row exists → project from row: `{ sectionKey, title, status: row.status, documentOrder: row.documentOrder, content: row.acceptedContent ?? row.content }`.
3. No row → project virtual section: `{ sectionKey: spec.id, title: spec.title, status: 'pending', documentOrder: spec.order, content: null }`.
4. `session.outline === null` and `session.blueprint !== null` → defensive: derive `outlineFromBlueprint(session.blueprint)`, re-enter step 1.
5. Both null → empty sections array. UI renders "outline pending".

**Status enum:** virtual sections use the existing `pending` value of `agent_section_status`. No enum migration.

Four consumers swap their hand-rolled mapping for `projectSessionState(session, sectionRows)`:

| Consumer | File |
|---|---|
| `GET /api/ai/agent/state` | `app/api/ai/agent/state/route.ts:32-47` |
| V3 runtime snapshot on `done` | `lib/ai/agent/runtime.ts` (current inline mapper) |
| Managed runtime snapshot on completion | `lib/ai/agent/managed/runtime.ts:612` |
| New session-scoped action endpoints | §4/§5 — every action returns `projectSessionState(...)` after mutation |

### 2c. Backfill

Idempotent JS script (not pure SQL, because `materializeCachedSections` slugifies titles for partial rows):

```
scripts/backfill-session-outline.ts
```

Selects `agent_sessions WHERE blueprint IS NOT NULL AND outline IS NULL`, calls `outlineFromBlueprint`, UPDATEs in batches of 100 with RLS context. Logged + auditable. Re-runs are no-ops (WHERE clause). Documented in `DEPLOYMENT_CHECKLIST.md`; run once post-deploy.

### 2d. Test surface

- Unit: `outlineFromBlueprint` on a blueprint with full SectionSpec rows → unchanged; on partial cached rows → materialized via existing helper.
- Unit: `projectSessionState` covers all four resolution branches; virtual sections come back with `status: 'pending'`.
- Integration: preselect cached-blueprint path → state route returns full virtual outline with zero `agent_sections` rows.
- Integration: managed `save_call_blueprint` → snapshot exposes virtual outline.
- Integration: backfill script on a fixture session populates outline; second run is a no-op.

## Section 3: Freeze-outline policy + saveSectionDraft outline-key invariant

### 3a. Policy matrix extension

Add two declarative fields to the existing `PolicyRule` shape (`lib/ai/agent/policy/matrix.ts`):

```ts
export interface PolicyRule {
  // ... existing fields
  requiresOutlinePresent?: boolean
  requiresSectionKeyInOutline?: boolean
}

export interface PolicyErrorCodes {
  // ... existing
  outlineMissing?: string
  sectionNotInOutline?: string
}
```

`assertPolicy()` implementation extends to check both. Codes stay in the `POLICY_*` family at the service layer:

```ts
freezeOutline: {
  // ... existing
  requiresOutlinePresent: true,
  errorCodes: {
    // ... existing
    outlineMissing: 'POLICY_OUTLINE_NOT_READY',
  },
},
saveSectionDraft: {
  // ... existing
  requiresOutlinePresent: true,
  requiresSectionKeyInOutline: true,
  errorCodes: {
    // ... existing
    outlineMissing: 'POLICY_OUTLINE_NOT_READY',
    sectionNotInOutline: 'POLICY_SECTION_NOT_IN_OUTLINE',
  },
},
```

Bilingual messages added to `messages/ro|en.json` under `agent.errors.POLICY_OUTLINE_NOT_READY` / `agent.errors.POLICY_SECTION_NOT_IN_OUTLINE`. REST envelope (§4) re-maps `POLICY_*` to UI-friendly codes (e.g., `OUTLINE_NOT_READY`) at the boundary.

### 3b. Invariants (JSDoc above `POLICY_MATRIX`)

Three written invariants, JSDoc-annotated near the policy matrix (proximity matters — these are code-enforced):

1. **Outline-before-freeze:** `outlineFrozen === true` ⇒ `outline !== null && outline.length >= 1`.
2. **Outline-before-section:** every `agent_sections.sectionKey` value matches some `SectionSpec.id` in `agent_sessions.outline` for the same session. Enforced by `saveSectionDraft` policy.
3. **Phase-monotonic-frozen:** once `outlineFrozen === true`, phase cannot regress below `drafting`. Already implicit; restated for clarity.

### 3c. Test surface

- Unit: `assertPolicy` rejects null outline / empty outline / unknown sectionKey with correct `POLICY_*` code.
- Integration: freeze-outline tool on a session with `outline = null` returns `POLICY_OUTLINE_NOT_READY`; managed activity row shows bilingual message; no state change.
- Integration: freeze-outline with outline ≥ 1 entry succeeds → `outlineFrozen = true`, `stateVersion` bumped.
- Integration: `save_section_draft` with a sectionKey not in outline returns `POLICY_SECTION_NOT_IN_OUTLINE`.

## Section 4: Deterministic product commands — `/actions/*`

### 4a. Endpoint inventory

| Endpoint | Method | Body | Notes |
|---|---|---|---|
| `/api/v1/agent-sessions/:id/actions/run-eligibility` | POST | `{ projectSummary?, expectedStateVersion }` | Falls back to `session.planningArtifact.preselect.description` + org profile. Missing inputs → 409 `ELIGIBILITY_INPUT_REQUIRED { missing: [...] }`. |
| `/api/v1/agent-sessions/:id/actions/freeze-outline` | POST | `{ expectedStateVersion }` | Still explicit (manual-flow power users); `/sections/generate` also calls underlying service. |
| `/api/v1/agent-sessions/:id/actions/change-call` | POST | `{ newCallId, expectedStateVersion }` | Calls dedicated `changeCall()` — see 4c. |
| `/api/v1/agent-sessions/:id/actions/accept-section` | POST | `{ sectionKey, expectedStateVersion }` | |
| `/api/v1/agent-sessions/:id/actions/reject-section` | POST | `{ sectionKey, reason, expectedStateVersion }` | |
| `/api/v1/agent-sessions/:id/actions/rollback-section` | POST | `{ sectionKey, targetVersion, expectedStateVersion }` | `targetVersion` required — matches existing `rollbackSection` contract. |
| `/api/v1/agent-sessions/:id/actions/export` | POST | `{}` | |

Focus is UI state, not workflow state — there is no `/actions/set-focused-section` endpoint. Chat passes `focusedSectionKey` with each message (§6b).

### 4b. Common envelope

Every endpoint:

1. `requireAuth()` + session ownership check via RLS.
2. Validate body with Zod schema (`@/lib/validation/schemas.ts`).
3. CSRF via `csrfFetch` on client side.
4. Rate-limit per user (existing `withRateLimit`).
5. Mutation through the service layer — `assertPolicy` runs first.
6. Service errors mapped to REST envelope: `{ error: { code, messageRo, messageEn, missing? } }`. 409 for policy/concurrency; 400 for validation; 404 for unknown session.
7. Audit log fires using the matrix's existing `auditAction` strings (or new `session.call_changed` for change-call).
8. On success, response body ends with `projectSessionState(...)` for UI re-render.

The `POLICY_OUTLINE_NOT_READY` → UI `OUTLINE_NOT_READY` mapping happens at the REST envelope boundary so the model never sees the UI-friendly code and the UI never sees the `POLICY_` prefix.

### 4c. Dedicated `changeCall()` service

New service in `services/application.ts` (or `services/change-call.ts` if isolation preferred):

```ts
async function changeCall(
  ctx: ServiceContext,
  args: { sessionId: string; newCallId: string; expectedStateVersion: number }
): Promise<{ session: AgentSession; sectionsDiscarded: number }>
```

Single transaction, single CAS, single `stateVersion` bump, single audit entry:

1. CAS on `expectedStateVersion`.
2. Reject if `session.outlineFrozen === true` → `POLICY_OUTLINE_ALREADY_FROZEN` (supersede flow is out of scope).
3. Reject if `args.newCallId === session.selectedCallId` → `VALIDATION_NO_OP`.
4. Validate the call exists (three-prong probe, same as preselect confirm).
5. Look up cached blueprint via `lookupBlueprint(newCallId)`.
6. UPDATE `agent_sessions`:
   - `selectedCallId = newCallId`
   - `blueprint = newBlueprint OR null`
   - `outline = outlineFromBlueprint(newBlueprint) OR null`
   - `eligibility = null`
   - `warnings = []`
   - `currentPhase = structured? 'structuring' : 'research'`
   - `outlineFrozen = false` (already enforced as precondition)
   - `stateVersion = stateVersion + 1`
7. DELETE `agent_sections` for this session (safe — outline not frozen).
8. Audit: new `AuditAction` string `session.call_changed` with `{ previousCallId, newCallId, sectionsDiscarded, blueprintSource: 'cached' | 'none' }`. Legal basis inferred from `session.*` prefix → `contract`.

`setSelectedCall` keeps its narrow scope and remains the path used by preselect override.

### 4d. Test surface

- Unit: `changeCall()` happy path resets atomically; CAS conflict aborts; outline-frozen rejection.
- Integration: each `/actions/*` endpoint enforces ownership, CAS, policy gates, returns `projectSessionState(...)`.
- Integration: `change-call` audit row has `session.call_changed` with previous/new call IDs.
- Integration: `rollback-section` requires `targetVersion`; missing → 400.

## Section 5: `/sections/generate` SSE endpoint

### 5a. `ensureDraftingReady()` saga

One click → backend runs the chain. Each step CAS-safe; if any step needs user input, the chain returns a deterministic error before calling the model.

```
ensureDraftingReady(ctx, { sessionId, sectionKey?, projectSummary?, expectedStateVersion })

Step 1: Outline present?
  - session.outline === null → 409 OUTLINE_NOT_READY

Step 2: Section selection
  - body.sectionKey → use it; validate it's in outline + status === 'pending'
  - else → pick first outline[i] with sectionStatus(i.id) === 'pending', ordered by generationOrder
  - none → 409 NO_SECTION_TO_GENERATE

Step 3: Eligibility ready?
  - session.eligibility !== null AND eligibility.score >= threshold → continue
  - session.eligibility === null:
      → inputs = { projectSummary: body.projectSummary ?? planningArtifact.preselect.description, orgProfile }
      → run rule engine
      → missing fields → 409 ELIGIBILITY_INPUT_REQUIRED { missing: [...] }
      → persist eligibility (own CAS, stateVersion + 1)
      → re-evaluate: score >= threshold ? continue : 409 ELIGIBILITY_FAILED { details }
  - session.eligibility exists but score < threshold → 409 ELIGIBILITY_FAILED

Step 4: Freeze if needed
  - session.outlineFrozen === false → freezeOutlineService (own CAS, stateVersion + 1)

Step 5: Pre-fetch context
  - prior accepted section content, ordered by documentOrder
  - retrieve_evidence service call: query = `${spec.title}. ${spec.description}`, k = 8

Step 6: One model call, streamed
  - model = Opus if section.modelHint === 'heavy' else Sonnet
  - zero tools

Step 7: Persist
  - validate output (min length, not a refusal pattern)
  - saveSectionDraftService (own CAS — uses post-freeze stateVersion)

Step 8: Emit done event with projectSessionState(...)
```

Worst-case stateVersion bumps: 3 (eligibility, freeze, save). Each step's CAS uses the version it bumped from, not the caller's original `expectedStateVersion`. The endpoint only requires the caller to pass the version current when they clicked Generate.

### 5b. Error envelope and UI mapping

Every 409 returns `{ error: { code, messageRo, messageEn, missing? } }`.

| Code | UI handling |
|---|---|
| `OUTLINE_NOT_READY` | "Blueprint not loaded yet, try again in a moment" |
| `NO_SECTION_TO_GENERATE` | "All sections are drafted" |
| `ELIGIBILITY_INPUT_REQUIRED` | Opens form with missing fields |
| `ELIGIBILITY_FAILED` | Shows failed rules + retry-with-changes UX |
| `GENERATION_INVALID` | Shows reason; no draft persisted |
| `GENERATION_TIMEOUT` | Retry button |
| `PROVIDER_ERROR` | Retry button; original status code preserved |
| `CONCURRENCY_CONFLICT` | UI re-fetches and prompts re-generate |

### 5c. Transport — fetch streaming, not EventSource

Browser `EventSource` is GET-only. Reuse existing `hooks/useAgent.ts` pattern:

```ts
const res = await csrfFetch(url, { method: 'POST', body: JSON.stringify(...) })
const reader = res.body!.getReader()
// SSE parser: split on \n\n, parse `event:` and `data:` lines
```

Extract the SSE parser inside `useAgent.ts` into a shared `lib/sse/parse.ts` so both `/api/ai/agent` and `/sections/generate` consume it identically.

### 5d. Cost / observability

Every model call routes through `lib/ai/providers/router.ts` so cost telemetry, prompt caching, and retry contract all apply as-is. No new pricing surface.

### 5e. Test surface

- Unit: `ensureDraftingReady` step matrix — every branch returns the right deterministic error or proceeds.
- Integration: happy path streams deltas → persists → emits 1 `start`, N `delta`, 1 `done`.
- Integration: eligibility null + no projectSummary + no preselect description → 409 `ELIGIBILITY_INPUT_REQUIRED { missing: ['projectSummary'] }`.
- Integration: eligibility failed → 409 `ELIGIBILITY_FAILED`; no model call made.
- E2E: bootstrap → click "Generate first section" → deltas stream → section renders as `draft`. No intermediate Freeze click required.

## Section 6: Chat tool surface + iteration caps

### 6a. Chat tool surface

**Removed from the model's chat tool surface entirely:**

| Tool | Replaced by |
|---|---|
| `save_call_blueprint` | Preselect (deterministic) |
| `freeze_outline` | `/actions/freeze-outline` |
| `setSelectedCall` / change-call tools | `/actions/change-call` |
| `setApplicationStatus` | `/actions/set-status` (or specific moves) |
| `approve_section` / `reject_section` / `rollback_section` / `mark_section_stale` | `/actions/*` |
| `create_export_snapshot` | `/actions/export` |

**Kept in chat tool surface (16 tools total):**

- 10 read tools (`search_calls`, `get_call_blueprint`, `get_application_state`, `list_sections`, `get_section`, `get_validation_report`, `get_project_summary`, `list_uploaded_documents`, `retrieve_evidence`, plus refresh).
- 5 rule tools (`run_eligibility`, `validate_section`, `validate_application`, `check_missing_annexes`, `score_fit`) — **read-only adapters**. They execute the rule engine and return the verdict, but do **not** write `session.eligibility` etc. Persistence happens only via the deterministic `/actions/run-eligibility` endpoint.
- 1 write tool: `save_section_draft({ content })`. Backend injects `sectionKey: ctx.focusedSectionKey`, `expectedStateVersion`, user identity. Model cannot redirect the write.

### 6b. Focused-section handling (chat path)

Chat POST to `/api/ai/agent` carries `focusedSectionKey?: string`. Runtime contract:

1. Validate `focusedSectionKey` appears in `session.outline` if present — else 400 `INVALID_FOCUSED_SECTION`.
2. Pass `focusedSectionKey` into the tool executor's context.
3. When the model invokes `save_section_draft({ content })`, the executor injects `sectionKey: ctx.focusedSectionKey`. If null → tool_result error `NO_SECTION_FOCUSED`.
4. Tool definition the model sees: `save_section_draft({ content: string })` — no sectionKey field.

### 6c. Iteration caps and model choice

| Surface | Today | After |
|---|---|---|
| V3 chat loop | 5 iterations, Opus | **3 iterations, Sonnet** |
| Managed chat loop | 8 iterations, Sonnet | **3 iterations, Sonnet** |
| `/sections/generate` | N/A | 0 tools, 1 call, Sonnet or Opus by `section.modelHint` |

### 6d. Test surface

- Integration: chat with model attempting `freeze_outline` → tool not registered, model produces text response.
- Integration: chat with `focusedSectionKey` not in outline → 400 before model call.
- Integration: chat with `focusedSectionKey` null + model invokes `save_section_draft` → tool_result error `NO_SECTION_FOCUSED`; no DB write.
- Integration: V3 chat hits 3-iteration cap → existing cap-hit handling fires; `iteration_cap_hit_total{runtime='v3'}` increments.

## Section 7: `useAgent` extension

- `agent.runAction(name, body)` — POST to `/actions/<name>`, awaits JSON snapshot, merges into local state via existing `applyServerSnapshot()`.
- `agent.generateSection({ sectionKey?, projectSummary? })` — POST to `/sections/generate` + stream parser. Applies `delta` events to the focused section incrementally; on `done`, merges the snapshot.
- `agent.focusedSectionKey` — local `useState`, not a server round-trip. UI sets it when the user clicks into a section.
- `agent.sendMessage(message)` — extended to include `focusedSectionKey` in the POST body to `/api/ai/agent`.

## Section 8: Rollout and PR sequencing

### 8a. PR sequence

| # | Title | Behavior change | Flag |
|---|---|---|---|
| 1 | Outline persistence + state projection | None visible — fixes "empty workspace despite blueprint" | none (pure fix) |
| 2 | Bootstrap + freeze-outline invariant + saveSectionDraft outline-key invariant | Preselect no longer triggers a model turn; freeze rejects without outline | `preselect_no_auto_send` |
| 3 | Deterministic `/actions/*` endpoints + `changeCall()` service + UI buttons | New buttons drive workflow; chat path still works as fallback | `deterministic_actions_enabled` |
| 4 | Chat tool-surface trim + iteration caps + Sonnet downgrade + focusedSectionKey injection | Model loses navigation tools; chat lighter and cheaper | `chat_tools_trimmed` |
| 5 | `/sections/generate` SSE endpoint + `ensureDraftingReady()` saga + Generate button | One click drafts a section; no Freeze click required | `generate_section_endpoint_enabled` |

PRs 2–5 ship to staging in flag-off mode and exercise behind a query-param override before any production flip.

### 8b. Flag rollout cadence (per PR 2–5)

1. Merge with flag `false`.
2. Deploy behind the flag.
3. Enable for staff/test orgs via flag userId targeting. Soak ≥ 3 days.
4. Percentage rollout 10% → 50% → 100% with ≥ 24h between steps.
5. After ≥ 2 weeks at 100%, flag becomes default-on; legacy path deleted in follow-up cleanup PR.

Kill-switch flags read with `bypassCache: true` (per CLAUDE.md gotcha) — LRU would otherwise delay an emergency disable up to 60s.

### 8c. Backwards compatibility

| Scenario | Behavior |
|---|---|
| Session with `blueprint != null, outline = null` | Backfill script fills outline. `projectSessionState` step 4 falls back to `outlineFromBlueprint(blueprint)` as defense in depth. |
| Session mid-flow at PR 2 deploy | Existing in-flight turn completes. Next page load with flag on: no new auto-send fires. |
| Existing chat invoking removed tools (PR 4 flag on) | Tool absent from surface; model picks a different path. |
| Iteration cap reduction (PR 4) | Monitor `iteration_cap_hit_total` for a week. Raise cap before defaulting on if non-zero. |
| Sessions in `drafting` phase already | Unaffected. Redesign targets bootstrap and pre-drafting flow. |
| Resume flow (`initialSessionId` set) | Unaffected. Preselect skipped. After PR 4 flag-on, resumed sessions inherit narrower tool surface (intended). |
| `setSelectedCall` callers (preselect override) | Unchanged. `changeCall()` is a new path. |

### 8d. New telemetry

- `policy_violation_total{rule, code}` — counter on every `assertPolicy` rejection. PR 1.
- `generate_section_total{outcome, reason?}` — outcomes: `success`, `eligibility_required`, `eligibility_failed`, `generation_invalid`, `timeout`, `conflict`, `provider_error`. PR 5.
- `generate_section_latency_seconds` — histogram. PR 5.
- `iteration_cap_hit_total{runtime}` — PR 4.
- `change_call_total{from_blueprint, to_blueprint, sections_discarded_bucket}` — PR 3.

### 8e. Data ops

| Action | When | Owner |
|---|---|---|
| No Drizzle migration needed — `outline` column already exists | PR 1 | — |
| Backfill script | After PR 1 production deploy | Ops; documented in `DEPLOYMENT_CHECKLIST.md` |
| Feature-flag seed migrations | One per PR, pattern of `0030_preselect_feature_flag.sql` | Each PR |
| Audit-action union extension (`session.call_changed`) | PR 3 | Same PR; `inferLegalBasis` already covers `session.*` |
| Tool-registry pruning | PR 4 | Update `READ_TOOL_NAMES` etc. in `managed/tools.ts`; V3 phase registry edits |

### 8f. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tool removal breaks a chat workflow (PR 4) | Medium | Flag + staged rollout + `iteration_cap_hit_total` + manual QA of every UI button path |
| Eligibility input requirements fail more often than expected (PR 5) | Medium | Track `generate_section_total{reason='eligibility_required'}`; build project-profile form in follow-up if high |
| `changeCall()` race with concurrent chat write to old call's section | Low | CAS rejects concurrent write; UI re-fetches |
| Backfill misclassifies a partial blueprint | Low | Reuses existing `materializeCachedSections`; dry-run flag on script |
| State route response-shape change breaks UI (PR 1) | Low | Additive: virtual sections show up where none did; renderer handles `pending` already |
| Audit hash chain disrupted by new action string | Very low | Existing `inferLegalBasis` covers `session.*`; `verifyAuditChainIntegrity` in tests |

### 8g. Out of scope

- "Supersede" flow for change-call when outline is already frozen.
- Auto-pilot "generate all remaining sections" — one click per section by design.
- Project-profile form for structured eligibility inputs — only built if PR 5 telemetry shows `ELIGIBILITY_INPUT_REQUIRED` is frequent.
- V3 runtime retirement — tracked separately.
- Senior Review primitive integration with the new endpoints — see `project_senior_review.md`; deferred until that primitive lands.

## Open Items (None)

All decisions locked during brainstorming. Implementation plan is the next artifact (`writing-plans` skill).
