# Legacy Retention Register

**Authority:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 6.
**Created:** 2026-04-14 by plan `2026-04-14-decom-program-bootstrap.md`.
**Maintenance:** entries with `last_verified` older than 60 days become presumptively invalid and must be re-justified before the next decommission PR touching that axis lands.

## Schema

Each entry has:

- `surface` — short name and reference (file glob, module path, or token-set name)
- `axis` — one of: route / visual / runtime / capability
- `category` — `bridge-legacy` (waiting on external workstream) or `temporary-retention` (blocker internal to an active retirement track)
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

---

## Temporary retention entries during active retirement

### Orchestrator-owned shared types

- **surface:** modules under `app/src/lib/ai/orchestrator/` re-exported as types/helpers (see `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-10-reexport-type-dependency.md`)
- **axis:** runtime
- **category:** temporary-retention
- **blocking_workstream:** internal — Plan 3 (`2026-04-14-decom-orchestrator-retirement.md`, deferred), sub-step (b) shared-type rehoming
- **replacement_spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md`
- **conversion_trigger:** last external import of `@/lib/ai/orchestrator/types` and `@/lib/ai/orchestrator/section-specs` removed (probe 10 returns zero)
- **last_verified:** 2026-04-14

---

## Adding new entries

Any retirement PR that produces a `needs to be retained for reason X` finding adds an entry here. The PR description must cite the entry. If the finding has no entry and no proposal to add one, the surface is a delete candidate by default per spec Section 6.
