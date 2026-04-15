# Legacy Retention Register

**Authority:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 6.
**Created:** 2026-04-14 by plan `2026-04-14-decom-program-bootstrap.md`.
**Maintenance:** entries with `last_verified` older than 60 days become presumptively invalid and must be re-justified before the next decommission PR touching that axis lands.

## Schema

Each entry has:

- `surface` — short name and reference (file glob, module path, or token-set name)
- `axis` — one of: route / visual / runtime / capability
- `category` — one of `bridge-legacy` (waiting on an external replacement workstream), `temporary-retention` (blocker internal to an active retirement track, retires when the track closes), or `operational-retention` (kept because deploy/ops infrastructure consumes the surface, no product-side replacement planned)
- `blocking_workstream` — the replacement program this retention waits on
- `replacement_spec` — URL or path to the spec scoping the workstream, or `none` (with note)
- `conversion_trigger` — the concrete observable event that converts surface from bridge to delete candidate
- `last_verified` — ISO date

---

## Bridge-legacy entries

### V1 dark-glass tokens

- **surface:** files matching `g-card | glass-panel | #06060A | liquid-glass` (see `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-06-design-token-coexistence.md`, V1-only set)
- **axis:** visual
- **category:** bridge-legacy
- **blocking_workstream:** V2 visual completion
- **replacement_spec:** none (not yet written as of 2026-04-14)
- **conversion_trigger:** every file in probe 06's V1-only set is off the list
- **last_verified:** 2026-04-14

### V3 runtime

- **surface:** `app/src/lib/ai/agent/runtime.ts`, `app/src/lib/ai/agent/tools/*`, `app/src/lib/ai/agent/policies.ts`, `app/src/lib/ai/agent/transitions.ts`, `app/src/hooks/useAgent.ts`, `app/src/app/api/ai/agent/route.ts`
- **axis:** runtime
- **category:** bridge-legacy
- **blocking_workstream:** Managed Agents Phase 3
- **replacement_spec:** referenced in `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md` Section 5 (Phase 3 not yet scoped in a standalone spec)
- **conversion_trigger:** Managed write tools land, `agent_v3_enabled=false` holds for one release with circuit breaker closed
- **last_verified:** 2026-04-14

### Agent-surface RLS

- **surface:** `agent_sessions`, `agent_messages`, `agent_turns`, `agent_sections`, `agent_section_versions`, `agent_checkpoints` — all ownership enforced by app-code predicates rather than DB-level RLS
- **axis:** capability
- **category:** bridge-legacy
- **blocking_workstream:** dedicated post-pilot agent-surface RLS spec (not yet written)
- **replacement_spec:** none yet — pilot-readiness spec `docs/superpowers/specs/2026-04-14-managed-agents-pilot-readiness-design.md` introduces `agent_turns` matching the existing posture and calls out RLS as out-of-scope
- **conversion_trigger:** a comprehensive agent-surface RLS spec + migrations covering all six tables, with `withUserRLS(userId, fn)` applied at every call site
- **last_verified:** 2026-04-14

### Managed-path summary writes

- **surface:** `app/src/lib/ai/agent/managed/` runtime path — READS `system_summary` rows and `session.messageSummary` but never writes them. V3's `app/src/lib/ai/agent/history.ts` compaction writer stays the sole producer.
- **axis:** capability
- **category:** bridge-legacy
- **blocking_workstream:** Managed Agents Phase 3b/3c writer surface
- **replacement_spec:** referenced in `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md` Section 5 (Phase 3b/3c not yet scoped standalone)
- **conversion_trigger:** Phase 3b/3c writer surface lands with a managed-path compaction trigger mirroring V3's, and fully-managed sessions cease growing toward the context window without summary rotation
- **last_verified:** 2026-04-14

---

## Temporary retention entries during active retirement

_(none currently — "Orchestrator-owned shared types" entry closed 2026-04-14; see "Closed entries" below.)_

---

## Closed entries

Historical log of retention entries whose conversion triggers fired and surfaces were retired. Kept for auditability of the register's lifecycle.

### Orchestrator-owned shared types — CLOSED 2026-04-14

- **surface:** modules formerly under `app/src/lib/ai/orchestrator/`
- **axis:** runtime
- **category:** temporary-retention (originally)
- **blocking_workstream:** Plan 3 orchestrator retirement (`docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md`)
- **conversion_trigger:** last external import of `@/lib/ai/orchestrator/*` removed
- **closed_reason:** sub-step (e) (PR #35) deleted the entire `lib/ai/orchestrator/` folder; sub-steps (a), (b), (b2), (c), (d) removed all external runtime and type dependencies. Final probe at PR #35 merge confirmed zero `@/lib/ai/orchestrator/*` imports anywhere in `app/src/` and `app/tests/`. Sub-step (f) (`client-v2.ts` sweep) was a no-op — the file had already been deleted by earlier work (commit log shows it gone pre-bootstrap).
- **closed_at:** 2026-04-14

---

## Adding new entries

Any retirement PR that produces a `needs to be retained for reason X` finding adds an entry here. The PR description must cite the entry. If the finding has no entry and no proposal to add one, the surface is a delete candidate by default per spec Section 6.

---

## Informational notes (not retention entries)

Context recorded for the managed-agents pilot that does NOT carry a retirement trigger and therefore is not subject to the 60-day re-verification rule. These are explicitly accepted tradeoffs for the pilot window.

### Managed-pilot operational risks

- **Fail-closed flag reads** (pilot-readiness spec §3 Finding 4): A transient DB hiccup on the pilot service returns `managed_agent_enabled = false` and kicks users to V3. Acceptable for a safety-first pilot; revisit if DB flakiness is observed during the 7-day window.
- **Nuclear rollback collateral**: scaling `fondeu-pilot` to zero disrupts any dev/test workload pointing at it. Runbook labels it nuclear; primary and secondary paths are preferred.
- **Smoke-suite cookie dependency**: `app/scripts/smoke/managed-pilot/` requires a session cookie for the target userId. If the pilot environment uses IP-bound or very short-lived sessions, refresh the cookie at the start of each smoke run.
- **Client 409 UX**: the server returns `stale_state_version` and `conflict_request_id` with bilingual envelopes, but `app/src/hooks/useAgent.ts` currently treats 409s as generic failures. A small client follow-up (auto-refresh `stateVersion` from `currentVersion`, toast the bilingual message) is recommended but not required for pilot.
