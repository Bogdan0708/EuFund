# Deterministic Preselect — Design

**Date**: 2026-04-18
**Status**: Design approved; implementation plan pending.
**Feature flag**: `deterministic_preselect_enabled` (default off).

## Context & problem

Current behavior: on a new project, the user describes their project in the first message at `/ro/proiecte/nou`. The managed agent runtime drives the full workflow — including **which funding call to select** and **which outline to freeze** — as conversational decisions mediated by Claude Sonnet 4.6.

Empirical measurement (run #4, 2026-04-18, session `2228fcd6-7fb7-459d-925c-b05ad3b82b42`):

- 5 agent turns, 31 tool calls (search + blueprint + evidence lookups all succeeding).
- Total cost: **$0.43**, driven primarily by a single $0.143 tool-heavy turn followed by four gate-keeping turns refusing to proceed without administrative org data.
- Final phase: still `discovery`. No call selected.
- Prior run with filter bug present: $1.75 to do the same discovery-only work.

Root cause: the LLM is performing three distinct categories of work in one loop. Ranked selection (which call?) and structural assembly (which outline sections?) are deterministic problems — `score_fit` rules and `get_call_blueprint` payloads both return the answers already. Content generation (the Romanian prose inside each section) is the real LLM job. When the runtime gives the LLM write tools for call selection, RLHF-trained caution makes it hesitate ("I need more information before I irreversibly select a call"), and we pay ~$0.15–$1.75 per project for decisions that deterministic code could make in under a second.

The codebase's Senior Review primitive spec (`docs/superpowers/specs/2026-04-14-senior-review-primitive-design.md`) already identified call selection and outline freeze as gates requiring stronger control than conversational generation — it proposed escalating to a larger model. This design argues the cleaner answer is deterministic code, not a second LLM.

## Goal (Phase 1)

Move call selection and initial session bootstrap out of the LLM:

1. On first-message dispatch with no `sessionId`, client calls a new `POST /api/v1/projects/preselect` endpoint with the user's project description.
2. Server runs vector search → per-call aggregation → deterministic three-branch policy (selected / ambiguous / no_match).
3. On `selected`: server creates the `agent_session` with `selectedCallId` set, blueprint pre-fetched when available, phase set to `structuring` (if blueprint structured) or `research` (if raw evidence only).
4. Client then posts to `/api/ai/agent` with the returned `sessionId` and the same description as the first user message — the standard in-session flow, now starting from a pre-selected call.

The LLM is never asked to select a call or bootstrap a session. It enters a session that is already correctly initialized.

### Success criteria

- New-project first-turn cost materially below current baseline (qualitative; exact target is a post-launch measurement, not a test gate).
- Agent does not call `search_calls` on its first turn in a preselected session.
- Override affordance lets a user change the selected call before `freezeOutline`, through the same deterministic mechanism.
- Existing sessions continue unchanged.

## Scope & non-goals

### In scope (Phase 1)

- New endpoint `POST /api/v1/projects/preselect` with three request modes (rank / confirm / override).
- New service `app/src/lib/ai/agent/services/preselect.ts` owning ranking, branching, and session initialization.
- Client-side changes scoped to `/proiecte/nou` page and its colocated components.
- `SelectedCallBanner`, `CandidatePicker`, `NoMatchGuidance` UI components colocated under `/proiecte/nou/components/`.
- Managed system prompt delta: new `phaseBootstrapBlock` in both locales.
- Feature flag `deterministic_preselect_enabled` (DB-backed, default off).
- Audit log entry per preselect completion.

### Out of scope (deferred)

- SSE-based preselect event stream (the "polished" UX variant discussed as Phase 2 / option (c)). Phase 1 uses plain JSON.
- Analytics persistence for `no_match` descriptions.
- Per-org or per-tier feature flag ramps (percentage ramp is sufficient for Phase 1).
- Visual regression tests for the new components.
- `score_fit` integration as a ranking signal (requires applicant org data the user hasn't provided yet; Phase 2 concern).
- Chunk-repeat bonus on the ranker. Phase 1 uses pure max-score per callId; add a bonus only with empirical evidence of single-chunk false positives.

## Architecture

### Endpoint

**`POST /api/v1/projects/preselect`** — the single session-bootstrap endpoint. Thin route handler in `app/src/app/api/v1/projects/preselect/route.ts`.

Three request modes:

| Mode | Distinguished by | Behavior |
|---|---|---|
| **rank** | `sessionId` absent, `confirmCandidateId` absent | Runs full ranker + decision. Creates a session on `kind: 'selected'`. Returns `candidates[]` only on `ambiguous`. Returns guidance on `no_match`. |
| **confirm** | `sessionId` absent, `confirmCandidateId` present | Skips ranking. Server validates that `confirmCandidateId` is a real indexed call. Creates session with that call selected. Used by the ambiguous-picker UI after user picks. |
| **override** | `sessionId` present, `expectedStateVersion` required | Re-runs ranker (with `excludeCallIds` applied). On `kind: 'selected'`, calls `setSelectedCall(sessionId, newCallId, expectedStateVersion)` on the existing session. Policy matrix's `outlineFrozen` lock applies unchanged. |

### Request contract

```ts
interface PreselectRequest {
  description: string;              // user's project description, min length enforced
  locale: 'ro' | 'en';
  sessionId?: string;               // present → override mode
  expectedStateVersion?: number;    // required when sessionId present
  confirmCandidateId?: string;      // present (without sessionId) → confirm mode
  excludeCallIds?: string[];        // used by override path to re-rank without rejected calls
}
```

### Response contract

```ts
type PreselectResponse =
  | {
      kind: 'selected';
      sessionId: string;
      selectedCallId: string;
      candidates: Candidate[];                // top-3, for UI caching / "Change" affordance
      blueprintKind: 'structured' | 'raw_evidence' | 'none';  // selected call only
      phase: 'structuring' | 'research';
    }
  | {
      kind: 'ambiguous';
      candidates: Candidate[];                // top-3 for picker
      // no session created, no blueprintKind (selected call is unknown at this point)
    }
  | {
      kind: 'no_match';
      reason: string;                         // machine code, e.g. 'below_score_floor'
      // no session created
    };

interface Candidate {
  callId: string;
  title: string;
  score: number;
  program?: string;
  sourceUrl?: string;
  // NOTE: no blueprintKind here in Phase 1.
  // blueprintKind is a top-level field on the 'selected' response and applies only to
  // the chosen call — we deliberately do not compute it per-candidate, because that
  // would require an extra blueprint lookup for each of the top-5 candidates on every
  // preselect call. The UI picker does not currently need per-candidate blueprintKind.
  // If Phase 2 adds a "ready/needs-research" badge to the picker, it should use a
  // cheap batch DB existence check against the blueprint cache table — NOT per-call
  // lookupBlueprint().
}
```

### Ownership split

| Concern | Location |
|---|---|
| Vector search | Existing `searchCalls()` in `services/evidence.ts` |
| Per-call aggregation + scoring (max score, top-5 cutoff) | New `rankCandidates()` in `services/preselect.ts` |
| Three-branch decision (no_match / selected / ambiguous) | New `decideSelection()` in `services/preselect.ts` |
| Blueprint prefetch | Existing `lookupBlueprint()` in `services/blueprint.ts` |
| Session row creation with seeded state | New `initializeSession()` in `services/preselect.ts` |
| Override mutation on existing session | Existing `setSelectedCall()` in `services/application.ts` |
| Route composition | New `app/src/app/api/v1/projects/preselect/route.ts` |

Route handler contains no business logic — strictly auth (via `requireAuth()` from `@/lib/auth/helpers`), rate limit (via `withRateLimit()` — this is a workflow endpoint, not an AI-feature endpoint, so it does **not** go through `withAIAuth()` even though it internally calls `aiEmbed`), validation, service composition, response shaping.

### Unchanged

- `/api/ai/agent` POST handler, its streaming SSE contract, and the managed runtime itself.
- `useAgent.sendMessage()` and its SSE consumption logic.
- `setSelectedCall` service, policy matrix, audit hash chain.
- Existing phase-gated tool registry.

## Selection logic & persistence

### Ranking (`rankCandidates`)

`searchCalls()` in `app/src/lib/ai/agent/services/evidence.ts:65` already deduplicates by `callId` (Qdrant returns chunks in descending score order; the `seen` Set keeps the first — i.e. highest-scoring — chunk per call). Phase 1 uses that output directly. No separate per-chunk aggregation step is needed.

```ts
async function rankCandidates(
  ctx: ServiceContext,
  description: string,
  excludeCallIds: string[] = [],
): Promise<CallMatch[]> {
  // searchCalls already returns one CallMatch per callId, score-descending.
  // Overfetch slightly (10) so exclusions don't leave us short.
  const { matches } = await searchCalls(ctx, description, { maxResults: 10 });
  return matches
    .filter(m => !excludeCallIds.includes(m.callId))
    .slice(0, 5);
}
```

Pure max-score per `callId` is the Phase 1 signal. No chunk-repeat bonus, no extra aggregation layer. Phase 2 may introduce either — with empirical justification — but only if traces show a specific failure mode (single-chunk false positives, or rank inversions where the top-1 chunk wasn't the best signal for its call). Phase 2 changes would likely require a new lower-level raw-chunk search helper exposed underneath `searchCalls`.

### Decision (`decideSelection`)

```ts
const SCORE_FLOOR = 0.35;         // rollout-tunable; tune against real traces after 20–50 sessions
const AMBIGUITY_EPSILON = 0.05;   // rollout-tunable; same

function decideSelection(candidates: RankedCandidate[]): SelectionDecision {
  if (candidates.length === 0 || candidates[0].score < SCORE_FLOOR) {
    return { kind: 'no_match', reason: 'below_score_floor' };
  }
  const top = candidates[0];
  const runner = candidates[1];
  if (runner && top.score - runner.score < AMBIGUITY_EPSILON) {
    return { kind: 'ambiguous', candidates: candidates.slice(0, 3) };
  }
  return { kind: 'selected', callId: top.callId, candidates: candidates.slice(0, 3) };
}
```

Constants live in a single exported block at the top of `services/preselect.ts` with a docstring marking them as rollout-tunable defaults pending empirical trace analysis.

### Phase decision

Deterministic:

```ts
const phase =
  blueprintResult.kind === 'structured' ? 'structuring' : 'research';
```

- **structuring**: blueprint cached with `confidence >= 0.4`. Server also writes the blueprint into `session.blueprint`. Agent's first turn is outline generation using the already-seeded blueprint.
- **research**: blueprint cache miss (raw evidence only) or lookup failed. Server leaves `session.blueprint` null. Agent's first turn is blueprint extraction via `get_call_blueprint` / `retrieve_evidence`.

Blueprint lookup failure is a **degraded success**, not a preselect failure:
- Session is still created with `selectedCallId` set.
- `phase = 'research'`, `blueprint = null`, `planningArtifact.preselect.blueprintKind = 'none'`.
- Warning is logged with a stable reason code (`blueprint_lookup_failed`).
- Audit metadata includes `blueprintLookupFailed: true`.

### Persistence (`planning_artifact`)

Reuses the existing `agent_sessions.planning_artifact jsonb` column (currently unused in the managed flow). Schema:

```ts
interface PreselectArtifact {
  preselect: {
    version: 1;                        // for future migrations
    rankedAt: string;                  // ISO timestamp
    description: string;               // original first-message text; enables recompute fallback on override if stored list is corrupt
    selectedCallId: string;
    selectedScore: number;
    candidates: Candidate[];           // top-3, what the UI shows on "Change"
    selectionKind: 'selected';         // only 'selected' sessions get persisted; ambiguous/no_match don't create sessions
    blueprintKind: 'structured' | 'raw_evidence' | 'none';
    excludeCallIdsApplied: string[];   // empty on first preselect; populated on override
  };
}
```

Written in `initializeSession()` as part of the `INSERT INTO agent_sessions` — single DB round-trip.

### Audit log

One `logAudit()` call after successful session creation:

- `action: 'session.preselect_completed'` (new legacy-safe action string; added to the audit action allow-list)
- `metadata`: `{ selectedCallId, selectedScore, candidateCount, blueprintKind, phase, blueprintLookupFailed?: boolean }`
- Tied to the user + session for hash-chain continuity.

## Client & UX

### `useAgent` hook

No SSE consumption changes. One internal guard added: `sendMessage()` with `sessionId === null` becomes a dev-mode assertion — first message must go through preselect. The hook never calls preselect itself; it stays strictly focused on agent SSE lifecycle.

### Preselect client

A small dedicated helper — not a hook method, not in `useAgent`. Either inline in the page or `app/src/lib/preselect/client.ts` (small file, pure fetch wrapper). Scope: serialize request, POST to `/api/v1/projects/preselect`, parse the discriminated union, surface errors. No state of its own.

### `/proiecte/nou` page states

| State | Condition | UI |
|---|---|---|
| `idle` | initial mount, no active request | Composer visible; placeholder: "Descrie proiectul tău…" |
| `matching` | preselect request in flight | Composer locked; inline "Caut cel mai potrivit apel…" spinner |
| `selected` | preselect returned `kind: 'selected'` | `SelectedCallBanner` above composer; `useAgent.sendMessage(description)` dispatched automatically; from here it's the standard agent conversation UI |
| `ambiguous` | preselect returned `kind: 'ambiguous'` | `CandidatePicker` renders 3 candidates; click → preselect in confirm mode with `confirmCandidateId` → transitions to `selected` |
| `no_match` | preselect returned `kind: 'no_match'` | `NoMatchGuidance` with refinement prompt; composer re-enabled |

### Component colocation

Under `app/src/app/[locale]/(dashboard)/proiecte/nou/components/`:

- **`SelectedCallBanner.tsx`** — pill above the composer. Reads from session state. "Change" button visible only when `session.outlineFrozen === false`. (Not `currentPhase !== 'drafting'` — phase can reach `review` post-freeze, and gating on phase would incorrectly re-open the change affordance. `outlineFrozen` is the authoritative freeze signal in the schema and the policy matrix.) Clicking triggers preselect in override mode with `excludeCallIds: [currentCallId]` and the session's `expectedStateVersion`.
- **`CandidatePicker.tsx`** — renders `candidates[]` from an ambiguous response. Each row: title, program badge, score visualization (bar, not raw number). Click → preselect in confirm mode.
- **`NoMatchGuidance.tsx`** — localized guidance. Pure presentation.

Components are colocated rather than under `components/workspace/`: their reuse outside `/proiecte/nou` is unproven. Extract to shared location if a second call site appears.

### Conversation history semantics

Preselect writes **nothing** to `agent_messages`. After `kind: 'selected'`, the client calls `/api/ai/agent` with the same description as the first user message. Rationale:

- `/api/ai/agent` POST contract unchanged — no "continue-without-new-user-input" branch.
- `useAgent.sendMessage()` unchanged.
- Conversation history is natural: user's first message is the description, first assistant reply is the outline.
- The redundant `description` bytes sent on two requests are architecturally irrelevant (sub-kilobyte JSON) compared to the handler simplicity.

The `selectedCallId` + `blueprint` are already present in session state when `/api/ai/agent` handles the first POST. The managed prompt's state block surfaces them; the new bootstrap block (below) instructs the agent not to re-run call selection.

## Managed prompt delta

Existing state block already renders `Apel selectat: ${session.selectedCallId ?? '(niciunul)'}`. The delta adds a conditional instruction block, rendered before the "Fazele acoperite" block:

```ts
const phaseBootstrapBlock = phase === 'structuring'
  ? `## Punct de pornire

Apelul ${session.selectedCallId} a fost deja selectat prin preselectare deterministă.
Blueprint-ul complet al apelului este deja disponibil în stare.
Nu re-căuta apeluri. Începe cu generarea outline-ului.`
  : phase === 'research'
  ? `## Punct de pornire

Apelul ${session.selectedCallId} a fost deja selectat prin preselectare deterministă.
Blueprint-ul structurat nu este încă disponibil în cache — extrage-l folosind \`get_call_blueprint\` și \`retrieve_evidence\`, apoi treci la structurare.`
  : '';
```

English mirror in `buildEnglishPrompt`.

Scope guardrails:

- Does not remove the broader "full flow" language from the allowWrites block — targeted clause only.
- `discovery` phase renders no bootstrap block (current behavior preserved).
- `structuring` copy deliberately avoids telling the agent to call `get_call_blueprint` — blueprint is already in state; instructing otherwise would encourage a redundant fetch.

## Error handling

All error codes are machine-stable constants (not free-form strings).

| Failure point | HTTP | Error code | Client behavior |
|---|---|---|---|
| Qdrant unreachable during rank | 503 | `PRESELECT_UNAVAILABLE` | Composer re-enabled, toast: "Sistemul de căutare este momentan indisponibil" |
| OpenAI embed call fails (after 1 retry) | 503 | `PRESELECT_UNAVAILABLE` | Same |
| `lookupBlueprint` fails after selection | — | degraded success, `blueprintKind: 'none'`, `phase: 'research'` | Transparent to user; logged operationally |
| `setSelectedCall` returns `POLICY_OUTLINE_ALREADY_FROZEN` (override) | 409 | `OUTLINE_FROZEN` | Toast: "Outline-ul este înghețat, nu mai poți schimba apelul" |
| `expectedStateVersion` mismatch (override) | 409 | `CONCURRENCY_CONFLICT` | Client refetches state, retries once; surfaces error on second fail |
| `confirmCandidateId` not a real indexed call | 400 | `INVALID_CALL_ID` | Should not occur in practice; log + alert |
| `description.length < MIN_DESCRIPTION_LENGTH` | 400 | `DESCRIPTION_TOO_SHORT` | Composer error: "Descrie proiectul mai în detaliu" |
| Unauthenticated | 401 | `UNAUTHORIZED` | Standard auth redirect |
| Feature flag disabled for user | 404 | `PRESELECT_DISABLED` | Frontend falls back to current cold-start flow (flag-gated client logic should not make the call in the first place; 404 is defense-in-depth) |
| Rate limit exceeded | 429 | `RATE_LIMITED` | Standard rate-limit toast |

No fail-open behaviors. Preselect failure always surfaces to the user. The cold-start agent flow is not a silent fallback — if the flag is on and preselect fails, the user sees an error, not a quiet degradation to the expensive flow.

### Description validation

Phase 1: minimum length check only. Exported constant:

```ts
const MIN_DESCRIPTION_LENGTH = 40;   // rollout-tunable; tune alongside SCORE_FLOOR
```

Non-whitespace density check is deferred to Phase 2. The error code `DESCRIPTION_TOO_SHORT` covers both future variants.

## Rollout

### Feature flag

`deterministic_preselect_enabled` — DB-backed, default `false`. Targeting via existing `feature_flags.targeting` JSONB.

**Hard dependency: `managed_agent_writes_enabled` must also be enabled for the user.** The current managed prompt (`app/src/lib/ai/agent/managed/prompt.ts:51-57`) in read-only mode explicitly tells the model "only discovery and research are covered; structuring/drafting/review are handled by the standard workflow." If we preselect a session into `phase: 'structuring'` with writes disabled, the prompt contradicts the session state and the agent cannot progress regardless (write-gated tools like `freeze_outline` / `save_section_draft` return `POLICY_WRITES_DISABLED`). Enforcing this dependency keeps the preselect feature coherent with the runtime's actual capabilities.

- **Server-side check**: `/proiecte/nou` page (RSC) reads BOTH flags via `isFeatureEnabled(...)`, passes the combined boolean `preselectEnabled = presElectFlag && writesFlag` to the client component as a single prop.
- **Route enforcement**: `POST /api/v1/projects/preselect` also checks both flags at request time (defense-in-depth). If either is off, returns 404 `PRESELECT_DISABLED`.
- **Client behavior**: if `preselectEnabled` false → first-message dispatch goes directly to `/api/ai/agent` (current cold-start path). If true → client calls preselect first.
- **`bypassCache: true` not required** — this is a rollout flag, not a kill switch. 60s cache latency is acceptable.

### Ramp plan

1. Admin-only (`targeting.userIds: [<admin ids>]`) — internal smoke test.
2. 10% rollout (`targeting.percentage: 10`) — canary window, 2-5 days.
3. 50% rollout (`targeting.percentage: 50`) — scale test.
4. 100% rollout (`targeting.percentage: 100`) — full enable.

Targeting key name `percentage` matches the existing flag-evaluator contract in `app/src/lib/feature-flags/index.ts`. Do not use `rolloutPercentage` — the evaluator would silently ignore it.

Per-org or per-tier ramps are not used in Phase 1. Percentage rollout with an admin canary is sufficient.

### Kill switch

Setting `enabled=false` stops new preselect dispatches within ~60s (cache expiry). Not security-critical; worst case is a short window of extra LLM discovery turns on the old flow.

### Existing sessions

Grandfathered. The flag only gates new-session bootstrap. Any session already created (with the current cold-start flow) continues unchanged. State-machine compatibility is preserved — the only new thing is the combination `selectedCallId + phase=structuring|research`, which is already valid post-discovery state in the current architecture.

## Testing strategy

### Unit tests

All new files under `app/tests/unit/preselect/` and one in `app/tests/unit/managed/`.

**`rank-candidates.test.ts`** — `searchCalls()` is mocked to return `CallMatch[]`; tests exercise `rankCandidates`'s thin filter-and-slice logic.
- `searchCalls` returns empty → `[]`
- `excludeCallIds` filters correctly, including when it removes the top-1 match
- Top-5 cutoff when `searchCalls` returns more than 5 `CallMatch` entries
- Output preserves `searchCalls`'s score-descending order (no resorting bug)
- (Chunk-aggregation tests are **not** part of this suite — `searchCalls` owns that responsibility; Phase 2 will add separate tests if a raw-chunk helper is introduced.)

**`decide-selection.test.ts`**
- Empty candidates → `kind: 'no_match'`, reason `below_score_floor`
- Top score < `SCORE_FLOOR` → `kind: 'no_match'`
- Single candidate above floor → `kind: 'selected'`
- Top-1 and top-2 within `AMBIGUITY_EPSILON` → `kind: 'ambiguous'` with 3 candidates returned
- Top-1 clearly above top-2 → `kind: 'selected'` with 3 candidates returned

**`initialize-session.test.ts`**
- Structured blueprint → session created with `phase: 'structuring'`, `blueprint` populated, `planningArtifact.preselect.version === 1`
- Raw-evidence blueprint → `phase: 'research'`, `blueprint: null`, `planningArtifact.preselect.blueprintKind === 'raw_evidence'`
- `lookupBlueprint` throws → degraded success: `phase: 'research'`, `blueprintKind: 'none'`, warning logged with code `blueprint_lookup_failed`, audit entry includes `blueprintLookupFailed: true`
- Audit entry includes `selectedScore`, `candidateCount`, `phase`

**`managed/prompt-phase-bootstrap.test.ts`**
- Phase `structuring` → Romanian prompt includes "Blueprint-ul complet al apelului este deja disponibil în stare" clause; does not mention `get_call_blueprint`
- Phase `research` → Romanian prompt includes extraction instruction referencing `get_call_blueprint` + `retrieve_evidence`
- Phase `discovery` → no bootstrap block present
- English mirrors all three
- Clause renders above the existing "Fazele acoperite" block

### Integration tests

Under `app/tests/integration/`.

**`preselect-route.test.ts`** — route handler with DB + mocked vector store + mocked auth.

Happy paths:
- Rank mode → `kind: 'selected'`, session created, `planningArtifact` persisted
- Rank mode with ambiguous fixtures → `kind: 'ambiguous'`, no session created
- Rank mode with low-score fixtures → `kind: 'no_match'`, no session created
- Confirm mode → session created with `confirmCandidateId`, ranker not invoked
- Override mode (existing session, pre-freeze) → `setSelectedCall` invoked, session mutated, `planningArtifact.preselect.excludeCallIdsApplied` updated

Request-mode validation:
- `confirmCandidateId` with `sessionId` absent → confirm mode behavior
- `sessionId` present without `expectedStateVersion` → 400
- Conflicting combinations (e.g. `sessionId` + `confirmCandidateId`) → 400 with stable code

Edge cases:
- `excludeCallIds` removes the only strong candidate → result transitions from `selected` to `ambiguous` or `no_match` depending on runner-up score

Error paths:
- Unauthenticated → 401
- `description.length < MIN_DESCRIPTION_LENGTH` → 400 `DESCRIPTION_TOO_SHORT`
- Vector store throws → 503 `PRESELECT_UNAVAILABLE` after one retry
- Override on frozen outline → 409 `OUTLINE_FROZEN`
- `expectedStateVersion` mismatch on override → 409 `CONCURRENCY_CONFLICT`
- Confirm with invalid callId → 400 `INVALID_CALL_ID`
- Flag off → 404 `PRESELECT_DISABLED`

**`agent-bootstrap-phase.test.ts`** — validates the managed runtime, given a session with `phase: 'structuring'` + `selectedCallId` + `blueprint` seeded, does not call `search_calls` on its first turn.
- Setup: create session with seeded state via `initializeSession()`
- Stub Anthropic streaming with a scripted response
- Assert first-turn tool calls do not include `search_calls`

### E2E (Playwright)

One new spec: `app/e2e/preselect-new-project.spec.ts`.

- Login, navigate to `/ro/proiecte/nou`
- Type a description chosen to deterministically match a known Qdrant-indexed call
- Submit
- Assert: "Caut cel mai potrivit apel…" state appears
- Assert: `SelectedCallBanner` renders with a call title
- Assert: agent's first turn streams (first `text_delta` within 30s)
- Assert: `agent_sessions.planningArtifact.preselect` populated (DB inspection via existing helper, if stable; else defer to integration)

Deferred to Phase 2 E2E: ambiguous picker flow, no-match flow, override "Change" button flow.

### Cost regression

**Not** an automated test assertion. Per-turn cost is too dependent on prompt size, cache state, and model behavior to be a reliable gate. The useful invariants are structural (no discovery loop on first turn; agent advances without gate-keeping) and are covered by the integration tests above. Cost observability belongs in dashboards, not CI gates.

## Open questions / future work

- **Thresholds tuning**: `SCORE_FLOOR = 0.35` and `AMBIGUITY_EPSILON = 0.05` are initial rollout values. Tune against real traces after the first 20–50 preselect sessions. Add observability to log `top-1 score`, `top-1 − top-2`, and `kind` for each preselect so the tuning data is available without a custom query path.
- **Chunk-repeat bonus**: Phase 1 ships pure max-score. If post-launch traces show single-chunk false positives (a call ranking high purely because one chunk happened to match well), Phase 2 may add `score += 0.02 × min(extra_chunks, 3)`. Needs empirical justification before landing.
- **Unified SSE handshake (Approach 3 from brainstorm)**: Phase 2 may collapse preselect into the `/api/ai/agent` SSE pipe once Phase 1 correctness is validated. Would enable `matching_started` / `call_preselected` progress events for a richer UX. Explicitly deferred because it conflates architectural correction with UX polish.
- **`score_fit` integration**: once applicant org data is gathered (later in the flow), the ranker could re-rank with the existing `score_fit` deterministic rule output. Phase 2.
- **`no_match` analytics**: persistent log of descriptions that fall below floor, for tuning. UX implications (consent, retention) need their own review.
