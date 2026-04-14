# Phase 3a V3 Audit Report

**Date:** 2026-04-10
**Purpose:** Before adding service-layer policy gates in Phase 3a, verify that V3's existing mutation call sites already respect the same invariants upstream. Any divergence must be fixed in a separate PR before 3a merges.

## Call sites audited

| File:line | Field mutated | Upstream guard | Audit | Notes |
|---|---|---|---|---|
| `app/api/ai/agent/route.ts:77` | `agentSessions` insert (status, locale, userId) | `requireAuth()` + feature flag check | no | New session creation — no policy matrix entry covers this, OK |
| `runtime.ts:84` (`handleStructuredAction` → `applyTransition`) | `select_call` → `selectedCallId` | None beyond auth | no | **Divergence (Looser)**: matrix requires `status=active, outlineFrozen=false`; runtime has neither check |
| `runtime.ts:84` (`handleStructuredAction` → `applyTransition`) | `approve_outline` → `outlineFrozen=true` + phase | None beyond auth | no | **Divergence (Looser)**: matrix requires `status=active, selectedCallId!=null, eligibility.failCount=0, outlineFrozen=false`; runtime enforces none of these |
| `runtime.ts:84` (`handleStructuredAction` → `applyTransition`) | `accept_section` → section `status=accepted` | `outlineFrozen` check (line 378) + section must be `needs_review` (line 381–384) | no | Stricter than matrix (`needs_review` only vs matrix `draft|needs_review`); no audit emitted |
| `runtime.ts:84` (`handleStructuredAction` → `applyTransition`) | `regenerate_section` → section `status=stale` | None beyond auth | no | **Divergence (Looser)**: matrix requires `outlineFrozen=true`; V3 does not check |
| `runtime.ts:84` (`handleStructuredAction` → `applyTransition`) | `reject_section` → section `status=needs_review` | None beyond auth (no outlineFrozen check) | no | **Divergence (Looser)**: matrix requires `outlineFrozen=true, section.status ∈ {draft, needs_review, rejected}`; V3 enforces neither |
| `runtime.ts:84` (`handleStructuredAction` → `applyTransition`) | `mark_complete` → session `status=completed` | `checkPolicyGate('validate_application', …)` (line 395) which requires all mandatory sections accepted + freshnessConfidence ≥ 0.6 | no | Functionally stricter than matrix; no audit |
| `runtime.ts:199–202` (tool loop) | Policy gate for `generate_section` tool | `checkPolicyGate` in `policies.ts`: `outline != null`, `eligibility.failCount = 0`, `blueprint.structureConfidence ≥ 0.4` | no | Covers `saveSectionDraft` path via LLM tool; no audit |
| `runtime.ts:281` (tool loop `applyTransition`) | Tool-driven transitions (SET_PHASE, UPSERT_SECTION_DRAFT, etc.) | `checkPolicyGate(tool.name, …)` before execution | no | Gate only covers `generate_section` and `validate_application`; all other tool transitions pass through unguarded |
| `runtime.ts:344–347` (`persistSessionState` — end-of-turn) | All session fields including `stateVersion++` | Governed by the full turn execution (structured action checks above) | no | No audit emitted anywhere in the V3 turn path |
| `runtime.ts:412–425` (`persistSessionState`) | `agentSessions.set(…)` — status, selectedCallId, outlineFrozen, stateVersion | Called after in-memory transitions are applied (guards listed above) | no | No `logAudit` call anywhere in `persistSessionState` |
| `runtime.ts:429–461` (`persistSessionState`) | `agentSections` upsert for each section | No per-section guard in persist path; guards are upstream in `handleStructuredAction` | no | Sections written even for transitions that were not guarded |
| `history.ts:177–179` | `agentSessions.messageSummary` | No session ownership check; called from `compactIfNeeded(sessionId)` after ownership already established by route handler | no | Low risk — summary field only, not a policy-matrix mutation |
| `tools/generate-section.ts:190` (`db.insert(agentSections)`) | New `agentSections` row with `status=draft` | `checkPolicyGate('generate_section')` gate in runtime before tool execution: requires `outline != null, eligibility.failCount=0, structureConfidence ≥ 0.4`; no `outlineFrozen` check | no | **Divergence (Looser)**: matrix requires `outlineFrozen=true` for `saveSectionDraft`; this tool writes content without that check; no `logAudit` |
| `services/sections.ts:319–321` (`saveSectionDraft`) | `agentSections.content, status='draft'` | Ownership + stateVersion CAS guard | yes (`project.version_save`) | No session precondition checks (outlineFrozen, eligibility); 3a will add these |
| `services/sections.ts:425–427` (`approveSection`) | `agentSections.status='accepted', acceptedContent` | Ownership + stateVersion CAS; idempotent if already accepted | yes (`section.state_change`) | No outlineFrozen check, no section.status ∈ {draft, needs_review} guard; 3a will add these |
| `services/sections.ts:508–510` (`rollbackSection`) | `agentSections.content, status='draft'` | Ownership + stateVersion CAS | yes (`section.rollback`) | No outlineFrozen check; 3a will add this |
| `services/sections.ts:356–358` (`saveSectionDraft` tx) | `agentSessions.stateVersion++` | Same transaction as section upsert | yes (same audit entry) | Correct — part of the 5-step write contract |
| `services/sections.ts:430–432` (`approveSection` tx) | `agentSessions.stateVersion++` | Same transaction | yes | Correct |
| `services/sections.ts:513–515` (`rollbackSection` tx) | `agentSessions.stateVersion++` | Same transaction | yes | Correct |
| `services/application.ts:431–433` (`setApplicationStatus`) | `agentSessions.status, stateVersion++` | Ownership + stateVersion CAS; idempotent | yes (`project.status_change`) | **Divergence (Looser)**: matrix requires `completed` only when `validate_application` passes; service has no such check; 3a will add this |
| `app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts:90–98` | `agentSections.content, status='draft'` + `agentSessions.updatedAt` | Auth + ownership + `!TERMINAL_STATUSES.includes(session.status)` guard (completed/abandoned/error blocked) | no | **Divergence (Looser)**: no `outlineFrozen` check, no stateVersion guard, no `logAudit`; duplicates service rollback without using it |
| `app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route.ts:67–69` | `agentSections.status` (state machine transitions) | Auth + ownership + `!TERMINAL_STATUSES` + `ALLOWED_TRANSITIONS` map (`draft→accepted|needs_review`, `needs_review→accepted|draft`, `accepted→draft`) | no | **Divergence (Looser)**: no `outlineFrozen` check, no stateVersion guard, no `logAudit`; parallel mutation path exists alongside V3 structured actions |

## Findings

- **No divergence — runtime.ts:84 `accept_section`**: V3 requires `outlineFrozen=true` AND section `status=needs_review`. Matrix allows `draft|needs_review`. V3 is **stricter** than the matrix on status, equal on `outlineFrozen`. Safe.

- **No divergence — runtime.ts `mark_complete`**: `checkPolicyGate('validate_application')` enforces all mandatory sections accepted + freshness confidence ≥ 0.6. This exceeds the matrix requirement (`validate_application pass`). Safe.

- **No divergence — `history.ts:177`**: Only mutates `messageSummary`, a non-policy-matrix field. No action needed.

- **No divergence — `orchestrator/section-versions.ts`**: This file operates on `sectionVersions` / `workflowSessions` tables (old orchestrator schema), not `agentSections` / `agentSessions` (V3 schema). It is a separate code path with its own audit and optimistic locking. No overlap with the V3 policy matrix.

- **No divergence — services (sections, application)**: `saveSectionDraft`, `approveSection`, `rollbackSection`, `setApplicationStatus` in `services/` correctly implement the 5-step write contract with audit. They intentionally have no policy gate checks today — Phase 3a is specifically adding those gates. These missing checks are the planned work, not divergences that need pre-3a fixes.

- **Divergence (Looser) — `runtime.ts` `select_call`**: The `select_call` structured action in `handleStructuredAction` (runtime.ts:374) applies `SET_SELECTED_CALL` with no guard. Matrix requires `status=active, outlineFrozen=false`. V3 enforces neither. An active session with a frozen outline can have its call replaced via this path, invalidating the frozen state.

- **Divergence (Looser) — `runtime.ts` `approve_outline`**: The `approve_outline` structured action (runtime.ts:376) applies `FREEZE_OUTLINE` with no guard. Matrix requires `status=active, selectedCallId!=null, eligibility.failCount=0, outlineFrozen=false`. V3 enforces none: a session with eligibility failures, no selected call, or an already-frozen outline can be frozen again via this path.

- **Divergence (Looser) — `runtime.ts` `regenerate_section`**: The `regenerate_section` action (runtime.ts:389) marks a section stale with no `outlineFrozen` check. Matrix requires `outlineFrozen=true`.

- **Divergence (Looser) — `runtime.ts` `reject_section`**: The `reject_section` action (runtime.ts:391) applies `REJECT_SECTION` with no guard. Matrix requires `outlineFrozen=true, section.status ∈ {draft, needs_review, rejected}`. V3 enforces neither.

- **Divergence (Looser) — `tools/generate-section.ts:190`**: Tool inserts a new `agentSections` row when the section doesn't exist yet. The `checkPolicyGate('generate_section')` in the runtime loop requires `outline!=null, eligibility.failCount=0`, but does NOT require `outlineFrozen=true`. Matrix requires `outlineFrozen=true` for `saveSectionDraft`. Additionally, no `logAudit` is emitted in this path.

- **Divergence (Looser) — `rollback/route.ts:90–98`**: The REST rollback route mutates `agentSections` directly without using the `rollbackSection` service. It has no `outlineFrozen` check, no stateVersion guard, and no `logAudit`. This creates a parallel write path that bypasses all service-layer controls and the future 3a gates.

- **Divergence (Looser) — `state/route.ts:67–69`**: The REST section-state PATCH route mutates `agentSections.status` directly with its own `ALLOWED_TRANSITIONS` map (different from the matrix). It has no `outlineFrozen` check, no stateVersion guard, and no `logAudit`. This is another parallel write path that will bypass 3a policy gates entirely.

## Conclusion

**Divergence requires V3 fix — stop 3a until resolved.**

The audit found **six distinct divergence categories** where V3 enforces looser invariants than the Phase 3a policy matrix:

1. **`runtime.ts` structured actions missing session precondition guards** (`select_call`, `approve_outline`, `regenerate_section`, `reject_section`): these actions should check `status=active`, `outlineFrozen` state, `eligibility.failCount`, and `selectedCallId` as appropriate before applying transitions.

2. **`generate-section.ts` tool missing `outlineFrozen` gate**: the `checkPolicyGate` in `policies.ts` does not require `outlineFrozen=true`, allowing section content to be generated (and a row inserted) before the outline is frozen.

3. **`rollback/route.ts` is a parallel write path that bypasses the service layer entirely**: it performs direct Drizzle updates without going through `rollbackSection()`, has no stateVersion guard, no `outlineFrozen` check, and no `logAudit`. Once 3a adds policy gates to the service, this route will permanently bypass them.

4. **`state/route.ts` is a parallel write path for status transitions** with its own (different) transition table, no `outlineFrozen` check, no stateVersion guard, and no audit.

**Recommended fix PR title:** `fix(agent-v3): wire section mutation routes through service layer and add missing precondition guards`

**Minimum required changes before 3a merges:**
- `rollback/route.ts`: delegate to `services/sections.rollbackSection()` (removes duplicate logic, adds stateVersion + audit)
- `state/route.ts`: delegate to `services/sections.approveSection()` or add equivalent service method; remove direct Drizzle updates
- `runtime.ts` `handleStructuredAction`: add `status=active` guard to `select_call`; add `selectedCallId!=null + eligibility.failCount=0 + outlineFrozen=false` guard to `approve_outline`; add `outlineFrozen=true` guard to `regenerate_section` and `reject_section`
- `policies.ts` `checkPreGenerate`: add `outlineFrozen=true` requirement (or confirm that policy matrix allows pre-frozen generation; if so, document the exception)

Re-run Step 3 after the fix PR merges to confirm clean audit.
