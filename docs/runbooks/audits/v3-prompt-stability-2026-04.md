# V3 System-Prompt Stability Audit — 2026-04

**Purpose:** Verify that the V3 runtime's `systemPrompt` is stable across turns within a given `(sessionId, phase)` pairing, so that Anthropic prompt caching produces cache reads instead of churning writes.

**Source:** `app/src/lib/ai/agent/prompt.ts:buildSystemPrompt()`.

**Consumer:** `app/src/lib/ai/agent/runtime.ts:128` — the string is passed as the Anthropic `system` parameter (line 165). Note that `history.summary` is pushed as a separate `role: 'system'` message (line 134) and therefore is NOT part of the cached system prefix.

## 1. Inputs to `buildSystemPrompt(session, sections)`

Signature (prompt.ts:34):
```
export function buildSystemPrompt(session: AgentSession, sections: AgentSection[]): string
```

Every interpolation site in the returned template literal and its stability classification:

| Line | Expression | Source field | Stability within `(sessionId, phase)` |
|------|------------|--------------|----------------------------------------|
| 46 | `${session.currentPhase}` | `AgentSession.currentPhase` | Stable — by definition constant within a (sessionId, phase) pair. |
| 47 | `${bp?.callId ?? session.selectedCallId ?? 'none yet'}` | `AgentSession.blueprint.callId` / `selectedCallId` | Stable once the call is selected; a change either (a) mutates session state and bumps `stateVersion` or (b) transitions phase — either way the `(sessionId, phase)` key changes with it. |
| 48 | `${bp?.structureConfidence != null ? ... : 'N/A'}` | `CallBlueprint.structureConfidence` | Stable — set once when the blueprint is resolved; does not drift mid-phase. |
| 49 | `${formatEligibility(session.eligibility)}` | `AgentSession.eligibility` (null, or pass/warning/fail summary) | Phase-coupled — `run-eligibility` moves phase `research` → `structuring`, so a change within a phase would be an outlier. Within a frozen `(sessionId, phase)` it is stable. |
| 50 | `${knowledgeLine}` | `(session as SessionWithKnowledgeSummary)._knowledgeSummary`, assembled in `runtime.ts:118-126` from `getSessionKnowledge(session.id)` as `"N pages: kind1(count), kind2"` | **Potentially unstable across turns** — recomputed every turn from DB; will churn if the user uploads documents mid-phase. The kind-count iteration order depends on `Map` insertion order from `getSessionKnowledge`, which itself iterates DB rows — stable only if upstream ordering is stable. See §3. |
| 52 | `${formatSections(sections)}` | `AgentSection[]`, sorted by `documentOrder` ascending, formatted as `  - sectionKey: status` | Deterministic sort (`(a, b) => a.documentOrder - b.documentOrder`). Content changes across turns as section statuses evolve — but within `(sessionId, phase)` during `drafting`, section statuses change constantly (per-section generate → accept/reject). So this IS unstable across turns during `drafting`. See §3. |
| 54 | `${formatWarnings(session.warnings)}` | `AgentSession.warnings: Warning[]`, formatted as `  - [severity] message` in array order | Array order is persisted order. Stable across turns if no warnings are added/removed; changes whenever eligibility/validation tools run. |
| 65 | `${PHASE_GUIDANCE[session.currentPhase]}` | Frozen `Record<Phase, string>` at module top (prompt.ts:26) | Stable — static per phase. |

Constant prefix (lines 42-44, "You are FondEU..."): stable.
Rules block (lines 56-62): stable.

## 2. Grep results for non-stable content

`app/src/lib/ai/agent/prompt.ts`:
```
(no matches for: Date.now | new Date( | toISOString | randomUUID | crypto. | requestId | performance.now)
```

`app/src/lib/ai/agent/types.ts`:
```
212:  requestId: string
287:  requestId: string
```
Line 212 is on `ToolContext` and line 287 is on `AgentRequest`. Neither is fed into `buildSystemPrompt` — it only receives `AgentSession` and `AgentSection[]`. Confirmed not a prompt input.

`app/src/lib/ai/agent/policies.ts` and `transitions.ts`:
```
(no matches for: systemPrompt | prompt)
```
Neither module contributes text to the system prompt.

Only one caller of `buildSystemPrompt`:
```
app/src/lib/ai/agent/runtime.ts:7:import { buildSystemPrompt } from './prompt'
app/src/lib/ai/agent/runtime.ts:128:    const systemPrompt = buildSystemPrompt(session, sections)
```

## 3. Findings

- [x] No `Date.now()` / `new Date()` / timestamp interpolation — **CONFIRMED.** Zero hits in `prompt.ts`; `AgentSession.createdAt`/`updatedAt` exist but are not read by `buildSystemPrompt`.
- [x] No per-call UUIDs / request IDs — **CONFIRMED.** `requestId` lives on `ToolContext` and `AgentRequest` (types.ts:212, 287), neither of which is an input to `buildSystemPrompt`.
- [x] No user PII or per-call identifiers in the prompt prefix — **CONFIRMED.** `userId`, `projectId`, email, names do not appear. `session.id` and `session.userId` exist on the input object but are not interpolated.
- [x] Tool-list ordering is deterministic per phase — **CONFIRMED** (not relevant to the system prompt itself — tool schemas are passed separately via `tools` parameter at runtime.ts:147-154 from `getToolsForPhase`, which reads a phase-keyed registry in deterministic order). The system prompt does not list tools.
- [x] Policy matrix output is stable per phase — **CONFIRMED.** `policies.ts` never touches the prompt; `PHASE_GUIDANCE` in `prompt.ts:26-32` is a frozen static map.

**Intra-phase mutability (expected and unavoidable):**

1. **`## Current Session State` block mutates turn-to-turn during normal operation.** Fields that reliably change across turns within a single phase:
   - `formatSections(sections)` — drafting phase changes `status` per section on each accept/reject/regenerate.
   - `formatWarnings(session.warnings)` — eligibility / validation tool calls add/remove warnings.
   - `knowledgeLine` — changes any time a new document is ingested into session knowledge.
   - `bp.callId` / `eligibility` / `structureConfidence` are stable *within* their phase by policy, but change *at phase boundaries* (phase transitions are explicit `(sessionId, phase)` key changes, not cache invalidations).

2. **This is the whole reason PR 2 exists.** The current prompt structure interleaves the stable prefix ("You are FondEU...", rules, phase guidance) with the volatile session-state block. To get cache hits, PR 2 needs to either:
   - (a) Move the volatile block to a separate non-cached user/system message and keep a stable system prompt, or
   - (b) Restructure the prompt so the cache breakpoint falls between the stable prefix and the volatile tail (Anthropic `cache_control` on the stable portion).

   **Neither option requires removing non-stable CONTENT from the prompt module** — there is no `Date.now()`, no UUID, no request ID. The content that varies is all legitimate session state that the model needs. The fix is structural (where the cache breakpoint lives), not content-sanitization.

## 4. Required fixes (if any)

**None required at the prompt-source level.** The audit found zero accidental instability (no timestamps, UUIDs, request IDs, or PII interpolated into the prompt string). All variability is intentional session-state reporting.

The *structural* question — how to split the prompt so caching works — belongs to PR 2 planning. Recommendations for PR 2 (not implemented in PR 0):

1. Extract the stable prefix ("You are FondEU..." + Rules + PHASE_GUIDANCE for the current phase) as one chunk that lives BEFORE the cache breakpoint.
2. Put the volatile `## Current Session State` block AFTER the cache breakpoint — either as the non-cached tail of the same system prompt or as the first user-turn system-style message.
3. The cache key is `(sessionId, phase)` because `PHASE_GUIDANCE[currentPhase]` is part of the stable prefix. If PR 2 wants cache hits across phase transitions within a session, either move `PHASE_GUIDANCE` out of the cached prefix or accept per-phase cache warmup (spec expects the latter).

## 5. Cacheability verdict

- [x] **V3 system prompt is cache-stable within `(sessionId, phase)`** — proceed to PR 2.
- [ ] V3 system prompt has instability that must be fixed before PR 2.

The stable prefix (`You are FondEU...` through the Rules block, plus the per-phase guidance) is byte-identical for the lifetime of a `(sessionId, phase)` pair. The volatile portion is the session-state report, which is session-state by design. PR 2 can safely place a cache breakpoint between the stable prefix and the session-state tail without any source-level cleanup in `prompt.ts`.
