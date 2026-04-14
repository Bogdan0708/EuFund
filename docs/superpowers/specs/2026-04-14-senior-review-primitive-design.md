# Senior Review Primitive — Selective Opus Escalation for V3 Agent

> A runtime-owned escalation service that consults a stronger reasoning model at a small number of high-stakes gates in V3. Policy lives outside the executor, not inside it. Anthropic's native Advisor tool is treated as a possible future backend, not the primitive itself.

**Date:** 2026-04-14
**Status:** Draft — pending implementation plan
**Runtime scope:** V3 agent (`lib/ai/agent/`) only in v1. Managed Agents adoption is explicitly deferred.
**Parent architecture:** `docs/superpowers/specs/2026-04-03-agent-v3-design.md`
**Relationship to Managed Agents:** Senior Review PRs sequence **after** Managed Phase 3 work merges. Do not parallelize these stacks.
**Spec authors:** Human + Claude Opus 4.6

---

## 1. Goals / Non-goals

### Objective ordering

1. **Primary — quality improvement at high-stakes gates.** EuFund's expensive failures are bad strategic judgments (wrong call chosen, weak outline, false confidence on eligibility, sections locally fine but globally misaligned). Selective Opus-grade reasoning at the gates that matter.
2. **Secondary — governance and auditability.** Explicit, logged escalation records. "The system escalated because X signal crossed Y threshold" beats "the model decided so."
3. **Tertiary — cost shaping.** Opus-grade judgment only where it matters, not as a default model for every turn. Cost benefit is a bonus of a disciplined escalation policy, not the reason the feature exists.
4. **Quaternary — strategic experimentation.** Understand Advisor-style patterns before Anthropic's managed runtime exposes them, so we aren't caught flat-footed.

### Goals

1. A single runtime-owned service `requestSeniorReview(stage, payload) → review` is the only path by which escalation enters V3.
2. Four named gates: `call_selection`, `outline_freeze`, `eligibility_verdict`, `section_recovery`. No others.
3. Policy is declarative and runtime-enforced. The executor has no ability to invoke or skip Senior Review.
4. Escalation decisions are audit-grade: one logical review per consult, retry attempts recorded separately.
5. Mandatory gates truly gate (fail-closed on consult failure after bounded retries). Conditional gates never hold the workflow hostage (fail-open with audit flag).
6. Ship with three explicit exit criteria — operational, behavioral, outcome — that decide whether v1 succeeds.
7. Independently revertible rollout: five PRs, each shippable on its own.
8. Backend swappability preserved. Today's implementation is a direct `messages.create` call to Opus via the AI Gateway. Tomorrow's could be Anthropic's native Advisor tool, a specialist critic, or another provider — without changing callers.

### Non-goals

- **No Anthropic native Advisor tool in v1.** It is executor-initiated, fights our governance principle, bypasses the AI Gateway, and is beta. It may become a backend for `requestSeniorReview()` later. It is not the v1 mechanism.
- **No executor-owned self-escalation.** No `request_senior_review` tool in the executor registry. No prompt instruction telling the model when to consult. Escalation is a runtime decision, always.
- **No Managed Agents integration.** Managed Agents Phase 3 is in flight. Senior Review lands in V3 only. Managed adoption is the first post-v1 follow-up, not v1 scope.
- **No per-gate model differentiation.** Opus for all four gates. Per-gate model tiering is a Phase 2 question once we have consult-quality data.
- **No "request a senior review" user button.** The primitive is runtime-owned; user-initiated consult is a product question for later.
- **No advisor-to-advisor chaining, no cross-session consult caching, no streaming of advisor output, no batch/async consults.**
- **No new enforcement surface beyond the four named gates.** The contradiction override (§4) is informational-only and does not gate commits.

### Success criteria (v1)

v1 succeeds when all three fire:

1. **Operational health.** Bypass rate < 5%, block rate < 10%, p95 consult latency < 7s, malformed-response rate < 2% (on adequate sample volume).
2. **Behavioral evidence.** Either meaningful non-`proceed` share on mandatory gates, *or* human-rubric / downstream-churn evidence that a high `proceed` rate reflects correct validation rather than ceremony.
3. **Outcome signal.** Human rubric passes the §8.3 bar **and** at least one §8.2 downstream signal shows directionally-positive effect on the triggered cohort vs. not-triggered cohort.

Missing all three → disable, re-evaluate premise.
Missing one or two → keep pilot, iterate.
Hitting all three → ship enabled-by-default, consider extending to Managed Agents.

---

## 2. Core invariants

These rule every decision below. Violations are bugs, not refinements.

1. **Runtime-owned escalation.** Senior Review fires because the system can explain why, not because the model vaguely wanted help.
2. **Service layer is authoritative.** Senior Review lives *inside* the service mutation function (or tool post-processor for the pre-narration gate), not in the route handler, not in the runtime orchestrator. It shares the CAS-on-stateVersion contract with the underlying mutation.
3. **Decision preparation, not raw commit.** Inside a service function the sequence is: assert invariants → build candidate decision payload → run senior review via the gate helper → normalize final decision → CAS commit. The gate helper owns the middle two steps (payload → review → normalized decision). Invariant checks stay in the service function. The CAS commit itself stays pure and narrow.
4. **The executor doesn't invoke Senior Review.** No executor tool, no prompt escalation instruction. Policy lives outside the model.
5. **Declarative gate configuration, separate from the policy matrix.** `lib/ai/agent/policy/matrix.ts` answers "can this mutation run at all?" Senior Review config answers "given it can run, does it need senior consult first?" Different axes. Single lookup point in `gate.ts` so engineers don't hunt in two places.
6. **Modify outputs are narrow.** Each stage defines exactly which fields `modify` may alter. Any `modify` output must validate against the same canonical stage schema used by the original candidate decision. Freeform model invention is out of scope.
7. **Mandatory means mandatory.** Consult failure on mandatory gates blocks the mutation after bounded retries. Conditional gate consult failure proceeds with an audit bypass flag.
8. **Gate 3 pre-narration gate never silently overwrites tool semantics.** For eligibility, Senior Review may annotate, reframe, highlight risk, recommend cautious wording — it must not replace the underlying deterministic tool outputs.
9. **Contradiction override is informational-only in v1.** May influence the next executor turn via context injection. Cannot alter mutation legality, mutate session state, or replace validator outputs. The four named gates remain the authoritative enforcement surface.
10. **Stage names and mutation names stay distinct.** A stage is a decision domain (`call_selection`, `outline_freeze`, `eligibility_verdict`, `section_recovery`). A mutation is a service function (`setSelectedCall`, `freezeOutline`, `saveSectionDraft`). Audit records carry both.

---

## 3. Architecture

### 3.1 Module layout

```
app/src/lib/ai/agent/senior-review/
  service.ts        requestSeniorReview() — orchestrates retries, timeouts, audit, budget
  schemas.ts        Stage payload + review response Zod schemas
  prompts.ts        Shared system prompt frame + per-stage descriptors
  gate.ts           withSeniorReviewMutation() + withSeniorReviewToolResult() helpers
  config.ts         Per-stage policy, thresholds, retry budgets, caps — hot-tunable
  backend/
    opus-gateway.ts Today's backend: Anthropic provider via AI Gateway
```

### 3.2 The primitive

```ts
type Stage = 'call_selection' | 'outline_freeze' | 'eligibility_verdict' | 'section_recovery' | 'contradiction_override';

type ReviewVerdict = 'proceed' | 'modify' | 'block';

interface SeniorReview<M = unknown> {
  verdict: ReviewVerdict;
  reasons: { ro: string; en: string }[];
  riskFlags: string[];
  modifiedInput?: M;              // narrow per-stage shape, schema-validated server-side
  advisoryNarrative?: { ro: string; en: string };  // Gate 3 only
  rewriteStrategy?: 'tighten' | 'restructure' | 'evidence_repair' | 'scope_reduce';  // Gate 4 only
  auditRef: string;               // logical review id, joins to attempt rows
  schemaVersion: string;          // see §10.8 (schema drift risk)
}

async function requestSeniorReview<M>(stage: Stage, payload: unknown): Promise<SeniorReview<M>>;
```

`requestSeniorReview()` is the only entry point. Callers don't manage retries, timeouts, budget accounting, or audit — those live inside.

### 3.3 Gate helpers

Two helpers, symmetric intent, different call sites:

```ts
// Mutation pre-commit (Gates 1, 2, 4)
function withSeniorReviewMutation<Input, M>(
  stage: Stage,
  candidate: Input,
  buildPayload: (input: Input) => unknown,
  gateConfig: GateConfig
): Promise<{ finalInput: Input; auditRef: string }>;

// Tool result pre-narration (Gate 3)
function withSeniorReviewToolResult<ToolResult, M>(
  stage: Stage,
  result: ToolResult,
  buildPayload: (r: ToolResult) => unknown,
  gateConfig: GateConfig
): Promise<{ annotatedResult: ToolResult; auditRef: string }>;
```

The mutation helper enforces fail-closed/fail-open per `gateConfig.policyType`. The tool-result helper always fails open (Gate 3 is conditional) and appends the advisor annotation to the executor's context without mutating the underlying tool result.

### 3.4 Example: service-layer wiring

```ts
// lib/ai/agent/services/application.ts
export async function setSelectedCall(input: SetSelectedCallInput) {
  await assertPolicy('setSelectedCall', input);
  const { finalInput, auditRef } = await withSeniorReviewMutation(
    'call_selection',
    input,
    buildCallSelectionPayload,
    GATE_CONFIG.call_selection
  );
  return commitSetSelectedCall(finalInput, auditRef);
}
```

### 3.5 Relationship to existing systems

- **Policy matrix** (`lib/ai/agent/policy/matrix.ts`): unchanged. No new fields. Senior Review is a separate concern consulted *after* `assertPolicy()` passes.
- **Audit hash chain** (`lib/legal/audit.ts`): unchanged. Senior Review creates its own audit rows in `agent_senior_reviews` / `agent_senior_review_attempts`; the normal mutation audit event still fires when the mutation commits and references `auditRef`.
- **CAS on `stateVersion`**: unchanged. Senior Review runs before the CAS write. If a stale-read is detected at commit, the consult result is discarded and the caller retries, producing a new consult.
- **AI Gateway** (`mitch-ai-services`): Senior Review's backend uses the existing Anthropic provider adapter with new telemetry tags (`feature=senior_review`, `stage=<stage>`, `tenant=fondeu-platform`).

---

## 4. Gate-by-gate mapping

Three of four gates are mutation pre-commit. **Gate 3 is a pre-narration gate** attached to tool results — architecturally different but runtime-owned.

### 4.1 Gate 1 — `call_selection` (mandatory, fail-closed)

**Trigger surface:** `setSelectedCall` service function, pre-commit.
**Fires:** every invocation.

**Consult payload** (`buildCallSelectionPayload`):
- `candidateCallId` + top-3 alternatives with `score-fit` results
- Eligibility summary per candidate (pass/fail/ambiguous per criterion) from `run-eligibility`
- Project summary snapshot (declared goals, budget range, sector, geography)
- Organization profile relevant to eligibility (size, track record flags)
- Evidence freshness per candidate (from `refresh-call-freshness`)
- User-declared rationale, if any

**Response:** standard `SeniorReview` shape.
**Modify allowed to alter:** `selectedCallId`, `confidenceClass`, `rationaleSummary` only. Nothing else in session state.

### 4.2 Gate 2 — `outline_freeze` (mandatory, fail-closed)

**Trigger surface:** `freezeOutline` service function, pre-commit.
**Fires:** every invocation.

**Consult payload:**
- Outline to be frozen (section structure, titles, order)
- Call blueprint (required sections, scoring weights, word-count targets)
- Project summary
- Deterministic coverage map: which blueprint requirements each outline section claims to cover
- Detected gaps or duplications from the coverage pre-check

**Response:** standard `SeniorReview`.
**Modify allowed to alter:** section titles, section order, section add/remove *tagged with blueprint requirement IDs*. No freeform structural invention. Any modify must re-pass the coverage pre-check.
**Block:** returns concrete missing-requirement list, surfaced to user as actionable (see §6 UX).

### 4.3 Gate 3 — `eligibility_verdict` (conditional, fail-open, pre-narration)

**Trigger surface:** post-processor in the MCP tool dispatcher for `run-eligibility` and `score-fit`. Runtime-owned; no executor involvement. The advisor's output is appended to the executor's context as an annotated tool-result block, **never replacing** the underlying deterministic result.

**Thresholds (OR'd; all tunable in `config.ts`):**
- `run-eligibility` returns `ambiguous` for any hard criterion
- `run-eligibility` conflict count ≥ 2 (source documents disagree)
- `score-fit` returns confidence < 0.65 AND score ≥ 0.55 — **dangerous near-positives** (borderline-but-plausible, not just uniformly low-signal)
- Evidence freshness of any hard criterion > 45 days

**Consult payload:**
- Tool result verbatim
- Source excerpts by chunk ID (not full documents; Opus can `retrieve-evidence` if needed)
- Project declared facts
- Organization profile

**Response:** standard `SeniorReview` with `advisoryNarrative` populated. No `modifiedInput` — the tool result is not mutated.

**Executor handling:** system prompt instructs the executor to reflect `advisoryNarrative` in user-facing wording without contradicting deterministic tool outputs. Per §2.8, advisor output annotates; it does not replace.

### 4.4 Gate 4 — `section_recovery` (conditional, fail-open)

**Trigger surface:** `saveSectionDraft` service function, pre-commit, **only on recovery paths**. First-pass drafts do not consult.

**Thresholds (any of):**
- Section has ≥ 2 prior versions where `validate-section` returned structural issues
- Evidence conflict detected (retrieved sources contradict on a load-bearing claim)
- Section is in the high-importance set AND first-pass `validate-section` returned ≥ 3 issues
- Prior rollback exists on this section

**High-importance section set:** `methodology`, `budget_justification`, `impact`, `sustainability`. Hardcoded in v1; moves to blueprint/program metadata in Phase 2 (§11 non-commitments).

**Consult payload:**
- Current draft text
- Validation issues list from `validate-section`
- Section blueprint requirement (word count, required sub-elements)
- Relevant retrieved evidence
- Prior version diffs (last 2 only, per §5.3 payload discipline)

**Response:** standard `SeniorReview` with `rewriteStrategy` populated (`tighten` | `restructure` | `evidence_repair` | `scope_reduce`).
**Modify allowed to alter:** draft text only.
**Block:** returns actionable revision instructions surfaced through the existing section feedback UI.

### 4.5 Contradiction override — informational-only

**Not** a fifth enforcement gate.

**Trigger:** validators (not mutation wrappers) invoke `requestSeniorReview('contradiction_override', ...)` when they detect a catastrophic contradiction — e.g., `validate-application` flags an eligibility contradiction, or `retrieve-evidence` returns mutually-contradicting load-bearing chunks.

**Scope in v1:** persisted and attached as context to the next executor turn. Does **not** block any mutation. Does **not** auto-mutate state. Counts against the conditional soft-cap to prevent validator spam.

---

## 5. Consult mechanics

### 5.1 Prompt structure

One shared system prompt frame, stage-specialized via a stage descriptor:

- **Role:** "senior reviewer for EU funding applications in the EuFund platform"
- **Constraints:** Romanian + English outputs; verdict ∈ {proceed, modify, block}; `modifiedInput` must validate against stage schema (enforced server-side after response)
- **Non-mandate:** "you advise — the runtime commits"

Stage-specific content is appended as structured context, not chain-of-thought instruction. Response format is **a structured tool-call response enforced by the runtime contract** — phrased provider-neutrally on purpose, because the backend abstraction must survive provider swaps. Today the backend uses Anthropic's tool-use mechanism; that's an implementation detail of `backend/opus-gateway.ts`, not a spec commitment.

Zod validates the returned structured payload. Validation failure is non-retryable, counts as `malformed_response`, and fails terminally (fail-closed for mandatory, fail-open + audit flag for conditional).

### 5.2 Model

Opus 4.6 (`claude-opus-4-6`) for all four gates in v1. Routed through the AI Gateway with telemetry tags `feature=senior_review`, `stage=<stage>`, `tenant=fondeu-platform`. Per-gate model differentiation is explicitly out of scope for v1.

### 5.3 Payload size discipline

Senior Review payloads must include:
- Normalized summaries, not raw documents
- Top-N evidence excerpts by chunk ID
- Last 2 diffs only (for section recovery history)
- No raw full-document stuffing

Timeout reliability is partly a payload-shaping problem. Payload builders enforce these limits; oversize payloads are a programming error, not a runtime fallback.

### 5.4 Retry and timeout

Per-attempt:
- **Timeout:** 5s
- **Max attempts:** 3 (1 initial + 2 retries)
- **Backoff:** 300ms, 1000ms
- **Worst-case wall time:** ~16.3s (5 + 0.3 + 5 + 1.0 + 5)
- **Typical completion:** 2–4s on first attempt for well-shaped payloads

Retryable errors: timeout, 429, 5xx, network. Non-retryable: 4xx validation, schema-invalid response (logged as `malformed_response`).

### 5.5 Per-session budget

- Mandatory gates: always fire, not budgeted. Each runs at most once per session (`setSelectedCall` once, `freezeOutline` once).
- Conditional gates: **soft cap 8 consults per session**, **hard cap 12**.
  - Beyond soft cap: threshold firing logs `budget_warning` audit but still consults.
  - Beyond hard cap: conditional consults are suppressed with `status: suppressed_budget`.
- Caps are conservative v1 defaults and may be lowered if recovery loops prove more common than expected. Tunable in `config.ts`.

### 5.6 Consult status enum

```ts
type SeniorReviewStatus =
  | 'completed'
  | 'failed_blocked'      // mandatory gate, fail-closed after retries exhausted
  | 'failed_bypassed'     // conditional gate, fail-open after retries exhausted
  | 'suppressed_budget';  // hard cap hit, consult did not run
```

### 5.7 Audit identity

Distinguish **logical review identity** from **consult attempt identity**:

- `agent_senior_reviews` — one row per logical review event. Holds verdict, status, stage, triggering signals, `auditRef`, total attempts, total latency.
- `agent_senior_review_attempts` — child table, foreign-keyed to the review row. One row per actual backend call attempt. Holds attempt index, latency, outcome, failure reason.

This keeps audit reconstruction clean on retries.

---

## 6. UX surface in v1

Deliberately minimal. Senior Review is runtime quality/governance infrastructure, not a product feature.

| Verdict | User-visible behavior |
|---|---|
| `proceed` | No user-facing surface. Invisible. Audit-only. |
| `modify` (Gates 1, 2) | Explanatory message: *"After an additional review, we adjusted [X] because [reasons]."* Phrased system-owned, not anthropomorphic. User can accept or override via existing flows. |
| `modify` (Gate 3) | Executor narrates through the advisor's framing; no explicit "senior review said X" chrome. Influences wording, not UI surface. |
| `modify` (Gate 4) | Section draft shown with `rewriteStrategy` tag visible in internal dashboards; not as a consumer-facing badge. Rationale in expandable revision metadata. |
| `block` (mandatory, fail-closed) | Actionable error: *"[reason]. [Suggested next action]."* Not generic "try again." |
| `block` (conditional, fail-open) | Executor still narrates; user sees cautionary framing in wording. No UI friction. |
| **Consult in progress** | "Senior review in progress…" indicator appears past **1.5s** on mandatory gates only. Success is seamless; failure surfaces retryable action. |

**Not exposed in v1:**
- "Request a senior review" button
- Raw advisor reasoning (summary in audit; user copy constructed from `reasons`)
- Per-session "consulted N times" counter (internal dashboards only)

---

## 7. Feature flags and rollout control

### 7.1 Flags

Via `lib/feature-flags`, fail-closed:

- `senior_review_enabled` — master flag. Percentage rollout, tier targeting. Start with internal/pilot orgs.
- `senior_review_shadow_mode` — when on instead of enabled, runtime issues consults but doesn't act on verdicts. Executor proceeds as if no consult ran; consult result is logged only. For pre-rollout calibration and counterfactual measurement.

### 7.2 Per-stage kill switches

Config-key driven (not flags), hot-tunable:

```
senior_review.stage.call_selection.enabled       (bool, default true)
senior_review.stage.outline_freeze.enabled       (bool, default true)
senior_review.stage.eligibility_verdict.enabled  (bool, default true)
senior_review.stage.section_recovery.enabled     (bool, default true)
```

Lets us kill one gate in production without disabling the whole system. Essential for incident response.

### 7.3 Shadow-to-enforcing flip

**Gates 1 and 2 ship with shadow mode enabled by default in config.** The config flip from shadow → enforcing is operationally conditional: dashboard review of ≥1 week of shadow data per gate is required before the flip. Not "flag available" — "dashboard review happened and was signed off." Named reviewers recorded in the flip commit.

---

## 8. Observability and evaluation

Three tiers. Tier 1 is automatic, Tier 2 low-cost, Tier 3 deliberate. Tier 3 is the experiment's real answer.

### 8.1 Tier 1 — operational metrics

Prometheus, via `lib/monitoring/metrics.ts`:

```
senior_review_consults_total{stage, verdict, status, policy_type}
senior_review_consult_duration_ms{stage}                  histogram
senior_review_consult_attempts_total{stage, outcome}       outcome=success|retried|failed
senior_review_retry_reason_total{reason}
senior_review_malformed_responses_total{stage}
senior_review_budget_events_total{kind, stage}             kind=warning|suppressed
senior_review_gate_bypassed_total{stage, reason}           conditional fail-open only
senior_review_gate_blocked_total{stage, reason}            mandatory fail-closed only
senior_review_decision_changed_total{stage, change_type}   change_type=confidence_downgraded|selected_call_swapped|outline_modified|draft_modified|blocked
senior_review_active_consults                              gauge
```

**Alerts:**
- `rate(malformed_responses) > 2%` over 15m **with minimum sample floor of 20 consults in window** → warning (prevents noisy pages on tiny traffic)
- `rate(gate_blocked{reason='failed_blocked'}) > 5%` over 15m → critical
- `p95(consult_duration_ms)` reviewed **per gate**, not aggregate — mandatory gate latency has tighter UX tolerance than section recovery
- `rate(budget_suppressed) > 0.5/hour` → warning

### 8.2 Tier 2 — behavioral telemetry

Audit-grade raw tables (`agent_senior_reviews`, `agent_senior_review_attempts`) plus a read-only analytics view with non-PII fields.

**Dashboards:**
- Verdict distribution per stage
- Conditional trigger attribution (which threshold fires most?)
- Consults-per-session histogram (cap proximity)
- Override invocation rate

### 8.3 Tier 3 — outcome evaluation

**8.3.1 Downstream signals (automatic).** Per-gate proxy outcomes, joined against triggered vs. not-triggered cohorts for regression-discontinuity-style comparison on sessions near threshold boundaries:

| Stage | Outcome signal | Window |
|---|---|---|
| `call_selection` | User-initiated call change after initial selection; application abandonment | Session lifetime |
| `outline_freeze` | Post-freeze structural revision count (rollbacks touching outline-level concerns) | Session lifetime |
| `eligibility_verdict` | Downstream user contradiction (weak proxy alone) + later tool evidence contradicting original narrative + internal correction events (firmer signals) | Session lifetime |
| `section_recovery` | Did recovered draft pass `validate-section` on next attempt? Rollback rate afterward? | Next 3 section actions |

Eligibility's "user contradiction" is explicitly weak — relied on only when paired with a firmer signal (later tool contradiction or internal correction).

**8.3.2 Shadow-mode calibration (optional).** `senior_review_shadow_mode` lets us measure counterfactual intervention rate pre-rollout. Useful for calibration; not shipped on as default.

**8.3.3 Human rubric (20-session sample).** Methodology matches Managed Agents Phase 3 §9.4. Rate each reviewed decision on:
- Call selection: did advisor surface a better fit, or correctly validate the original?
- Outline coverage: did advisor's changes improve blueprint requirement coverage?
- Eligibility calibration: did advisor's framing better reflect tool-result ambiguity?
- Section recovery: did rewrite strategy address the validation failure?

**Pass rule:** ≥70% "advisor added value" or "advisor correctly validated", <10% "advisor added noise or introduced error."

### 8.4 Behavioral criterion — softened interpretation

High `proceed` rate on mandatory gates is **not automatically a failure signal**. A mandatory gate can prove value two ways:

1. Changes/blocks/modifies often enough to show it catches real issues.
2. Rarely changes decisions, but reliably validates already-good decisions in a domain where false positives are costly.

The criterion: a very high `proceed` rate requires explanation — either strong human-rubric evidence that the gate is correctly validating important decisions, or very low downstream error/churn indicating the gate is acting as a successful safeguard. Without either, the gate is ceremonial and should be reconsidered.

---

## 9. Database schema

New tables. Migration file: `app/drizzle/NNNN_senior_review_audit.sql` (number allocated at implementation time).

```sql
CREATE TABLE agent_senior_reviews (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL REFERENCES agent_sessions(id),
  stage                 text NOT NULL,
  invoking_mutation     text,               -- present for mutation-gated
  invoking_tool_result  text,               -- present for eligibility_verdict
  policy_type           text NOT NULL,      -- 'mandatory' | 'conditional'
  triggered_by          jsonb,              -- threshold attribution for conditional
  verdict               text,               -- 'proceed' | 'modify' | 'block' | null if failed
  status                text NOT NULL,      -- SeniorReviewStatus enum
  failure_reason        text,
  total_attempts        int NOT NULL,
  total_latency_ms      int NOT NULL,
  review_summary        text,               -- truncated advisor reasoning
  schema_version        text NOT NULL,      -- see §10.8
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_senior_review_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id       uuid NOT NULL REFERENCES agent_senior_reviews(id) ON DELETE CASCADE,
  attempt_index   int NOT NULL,              -- 0-based
  latency_ms      int NOT NULL,
  outcome         text NOT NULL,             -- 'success' | 'timeout' | 'rate_limit' | 'gateway_degraded' | 'network' | 'malformed_response'
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_senior_reviews_session ON agent_senior_reviews(session_id);
CREATE INDEX idx_senior_reviews_stage_status ON agent_senior_reviews(stage, status);
CREATE INDEX idx_senior_review_attempts_review ON agent_senior_review_attempts(review_id);
```

RLS policies follow the existing `agent_*` table pattern (tenant isolation via `app.current_user_id`).

---

## 10. Risks

### 10.1 Prompt injection via consult payload

User-supplied project descriptions, retrieved evidence, and prior inputs flow into the advisor prompt. Mitigation: reuse `lib/rag/pipeline.ts` chunk-poisoning validation on any user-sourced text embedded in payloads. Payload size discipline (§5.3) enforces summaries over raw documents.

### 10.2 Mandatory-gate latency perception

Adds 2–4s typical, up to ~16s worst-case to critical user actions. Mitigation: shadow-first rollout observes real latency distributions before users feel them; p95 alert per gate; UX spinner past 1.5s with actionable retry on failure.

### 10.3 Cost variance pre-launch

Opus call cost × unknown session frequency. Mitigation: per-session hard cap (§5.5); tier-limited rollout (pilot orgs first); AI Gateway tenant-level cost alerting already exists.

### 10.4 Threshold miscalibration at launch

Defaults in §4 are informed guesses. Explicit expectation that thresholds tune in weeks 1–4 post-rollout based on Tier 2 telemetry. Config-only tuning, no code deploys required.

Additionally, the Gate 3 thresholds assume specific output shapes from existing MCP tools (`run-eligibility` returns `ambiguous` verdicts and conflict counts; `score-fit` returns numeric score + confidence; freshness is queryable per criterion). The implementation plan must validate each threshold input against the current tool signatures in PR 4 — if a signal isn't currently emitted in the required shape, it's a prerequisite tool change, not a Senior Review change.

### 10.5 Executor respecting Gate 3 annotations

The executor is still a model — it may ignore advisor framing under adversarial user prompting. Mitigation: executor system prompt hardened to treat advisor annotations as authoritative for tool-result interpretation. This is a prompt-engineering risk requiring eval coverage, not a code mitigation.

### 10.6 Ceremonial-gate drift

If mandatory gates almost always say `proceed`, social pressure may hollow out the gate (bypasses added, skipped under latency pressure). Mitigation: softened behavioral criterion (§8.4) explicitly requires high-proceed rates to be justified by rubric/churn evidence. Defends the original rationale from drift over time.

### 10.7 Collision with Managed Agents Phase 3 in-flight work

Senior Review touches service-layer mutation functions; so does Phase 3. Mitigation: Senior Review PRs sequence **after** Phase 3 PR 4 merges. Do not parallelize these stacks.

### 10.8 Schema drift

If payload builders, stage schemas, and mutation input schemas evolve independently, `modify` outputs may become invalid or semantically stale. Mitigation:
- Contract tests per gate exercising builder → consult → validator round-trip.
- `schemaVersion` tagged on every review record.
- Terminal failure on version mismatch, treated as `malformed_response`.

### 10.9 Managed Agents adoption path deferred

v1 is V3-only by design. If Managed Phase 3 ships and traffic migrates, Senior Review's value stays V3-only until the primitive extends to Managed. Explicit non-goal; first post-v1 follow-up.

---

## 11. Post-v1 non-commitments

Explicit scope defense. These are **not** v1 scope:

- Extending Senior Review to Managed Agents runtime
- Per-gate model differentiation (Opus for critical gates, cheaper tiers elsewhere)
- User-initiated "request a senior review" button
- Cross-session advisor caching (same payload → time-bounded cached review)
- Advisor-to-advisor chaining for multi-stage deliberation
- Specialist advisors (e.g., eligibility-specialist model fine-tuned on program docs)
- Migrating "high-importance sections" list from hardcoded config to blueprint/program metadata
- Anthropic native Advisor tool as the backend

---

## 12. Rollout — 5 PRs

Each PR is independently revertible. No partial-state branches merged.

### PR 1 — Foundation, no gates wired

- `lib/ai/agent/senior-review/` skeleton (service, schemas, prompts, gate, config, backend)
- Migration: `agent_senior_reviews` + `agent_senior_review_attempts`
- `requestSeniorReview()` with retry/timeout/audit/budget, fully unit-testable in isolation
- `senior_review_enabled` + `senior_review_shadow_mode` flags registered (default off)
- Prometheus metric scaffolding registered
- Unit tests: retry behavior, timeout, malformed response, budget caps, audit persistence, attempt/review identity split
- No user-visible change

### PR 2 — Gate 1: `call_selection` on `setSelectedCall`

- `withSeniorReviewMutation()` helper lands here (first caller)
- Call-selection payload builder, stage schema, stage prompt
- Service-layer integration inside `setSelectedCall` with CAS boundary
- Shadow mode enabled by default in config; enforcing mode requires the §7.3 conditional flip
- Integration + contract tests with mocked Opus response
- Dashboard: call-selection verdict distribution, triggered-vs-not downstream cohort panel

### PR 3 — Gate 2: `outline_freeze` on `freezeOutline`

- Outline-freeze payload builder (with blueprint-coverage heuristic), stage schema, stage prompt
- Same shadow-first rollout discipline
- Dashboard: outline-freeze verdict distribution + structural-churn downstream signal

### PR 4 — Gate 3: `eligibility_verdict` as tool post-processor

- `withSeniorReviewToolResult()` helper lands here
- Post-processor hook in MCP tool dispatcher for `run-eligibility` and `score-fit`
- Threshold evaluator in `config.ts`
- Executor system prompt updated to respect advisor annotations without overwriting deterministic tool parts (§2.8)
- Dashboard: threshold-attribution panel

### PR 5 — Gate 4 + contradiction override + exit-criteria dashboards

- Section-recovery trigger conditions on `saveSectionDraft` (recovery paths only)
- `rewriteStrategy` field and payload builder
- Contradiction override invoked by validators (informational-only per §4.5)
- Exit-criteria dashboard stack: operational + behavioral + outcome panels (§8)

Expected cadence: one PR per week if calibration is clean; longer if shadow-mode data surfaces prompt or threshold issues. No automatic gate activation — each mandatory gate flips shadow → enforcing via explicit config change, only after ≥1 week of shadow data review (§7.3).

---

## 13. Future-option preservation

Senior Review is the product primitive. Its backend is swappable. Concretely:

- If Anthropic's native Advisor tool matures and the AI Gateway supports it cleanly, `backend/opus-gateway.ts` can gain a sibling `backend/anthropic-advisor.ts` without changing `requestSeniorReview()` callers.
- If a specialist critic model proves useful for one gate (e.g., eligibility), per-gate backend selection can be added to `config.ts` without restructuring.
- If Managed Agents gain configurable escalation policies, the same `requestSeniorReview()` primitive can be invoked from Managed service wrappers.

This is the durable design decision: **make Senior Review the primitive. Do not make any specific provider mechanism the primitive.**
