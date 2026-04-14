# PR #5 Rubric Evidence — `/api/ai/match-grants` retirement

Date: 2026-04-14
Plan: `docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md` (PR #5)
Spec: `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` (Sections 1, 3)

## Section 1 — Runtime ownership / replacement capability

**Retired capability**: AI-powered grant matching — given a company profile, rank active funding calls by fit using an LLM scoring pass over the `callsForProposals` × `fundingPrograms` join.

**Inheritor**: V3 Agent MCP tools (spec Section 3):
- `search-calls` — discovery phase retrieval of candidate calls
- `score-fit` — rule-based fit scoring within the agent loop
- `run-eligibility` — deterministic eligibility pre-filter

The V3 runtime performs matching inside session state — audit-chained, phase-gated, and versioned — instead of through a stateless one-shot RPC. The retired route offered no integration with session state, policy matrix, or evidence ledger.

**Evidence of no in-product caller**: Frontend uses `useAgent` / `useOrchestrator` hooks. No page, server component, or client hook imports `/api/ai/match-grants`. Post-PR grep across `app/src` and `app/tests` returns zero.

## Section 2 — Scope discipline

- Touched: retiring route, `grant-matcher.ts` helper, 1 dedicated integration test (delete), 2 shared test files (surgical), 1 barrel line, 1 orphan schema + 1 inferred type, 2 CLAUDE.md narrative edits.
- `eu-ai-act.ts` deliberately **not** deleted — `sanitize.ts` still consumes it (plan Task 5.3).
- `companyProfileSchema` (transitively orphaned after `matchGrantsSchema` removal) left in place — plan scope listed only `matchGrantsSchema` + `MatchGrantsInput`. Flagged as future-sweep candidate in reference-sweep.md §4.
- e2e specs, CI workflows, MEMORY.md, agent-harness, plan, spec — untouched.
- `client.ts`, `@/lib/rules/eligibility` (transitive deps of grant-matcher) — both keepers with other consumers, untouched.

## Section 3 — Barrel hygiene

- `app/src/lib/ai/index.ts:8` (`matchGrants`, `MatchInput`, `MatchResult`, `FundingCall`) — barrel line removed.
- Zero barrel-keyed consumers across all 4 symbols in `app/src` / `app/tests` / `app/scripts` confirmed before deletion.
- No other barrel lines affected.

## Section 4 — Orphan schema cleanup

- `matchGrantsSchema` (schemas.ts:37) + `MatchGrantsInput` (schemas.ts:80) deleted in-PR (not deferred).
- Pre-deletion consumer set: retired route (only).
- Post-deletion grep across `app/src` + `app/tests`: zero hits.
- `companyProfileSchema` retained — out of plan scope (noted above).

## Section 5 — Test classification

| File | Before | After | Delta | Method |
|------|--------|-------|-------|--------|
| `match-grants-route.test.ts` | (file) | (gone) | -1 file | Full file delete (dedicated to retired route) |
| `critical-flows.test.ts` | 3 `it()` | 2 `it()` | -1 | Surgical remove of `grant matching flow returns matches…` block; preserved authorization-boundary + tenant-isolation tests |
| `security.test.ts` middleware-auth | 1 `it()` | 1 `it()` | 0 | URL-fixture migration: `/api/ai/match-grants` → `/api/ai/chat` (preserves middleware-allow-authenticated-AI-requests coverage) |

### Migration rationale for `security.test.ts:422`
The test exercises `middlewareFunc` directly to verify authenticated requests to `/api/ai/*` are not 401'd. The URL is a request fixture — the route does not need to exist for the middleware check. Same PR #4 precedent used for `ai-feature-rate-limit.test.ts`. `/api/ai/chat` chosen as the surviving AI route.

### Post-PR test suite health
- Total: **1002 passed / 15 skipped / 2 todo / 0 failed** (5.10s).
- Pre-existing failures (timeline-assignee, trial-notifications) unchanged — not triggered in this run.
- Zero new failures introduced.

## Section 6 — Verification (evidence before assertions)

```
$ rg -n "grant-matcher" app/src/lib/ai/index.ts
(zero)
$ rg -n "/api/ai/match-grants" app/src app/tests
(zero)
$ rg -n "matchGrantsSchema|MatchGrantsInput" app/src app/tests
(zero)
$ rg -n "eu-ai-act" app/src/lib/ai/
sanitize.ts:6:import { stripPII } from './eu-ai-act';
eu-ai-act.ts:10:const log = logger.child({ component: 'eu-ai-act' });
  ← only sanitize.ts consumes eu-ai-act, matching plan Task 5.3 expectation
$ npm run typecheck
(clean)
$ npm run build
(success; no /api/ai/match-grants in route manifest)
$ npm run test
166 files passed / 5 skipped; 1002 tests passed / 15 skipped / 2 todo / 0 failed
```

## Section 7 — Audit resourceType uniqueness

`resourceType: 'grant_match'` appears **only** in the retired route (`match-grants/route.ts:178`, now deleted). No other surviving route emits this value.

```
$ rg -n "'grant_match'" app/src
(zero after this PR)
```

Historical audit entries remain valid; the action will no longer be emitted.

## Section 8 — Projection to follow-on work

After this PR:
- **`eu-ai-act.ts`**: direct-path consumers = only `sanitize.ts` (via relative `./eu-ai-act`). Matches plan Task 5.3 projection. Retires alongside any future `sanitize.ts` refactor (out of this program's scope).
- **`GRANT_MATCHING` enum value** in `app/src/lib/ai/types.ts:18` (EU AI Act risk classification enum, value `'grant_matching'`): has **zero consumers** post-PR. Same pattern as PR #4's orphaned classification (handled in follow-up commit `64dc816`). Candidate for a short "drop orphaned match-grants EU AI Act classification" follow-up commit, same PR.
- **`companyProfileSchema`**: transitively orphaned. Future validation-schema sweep candidate.
- **`security.test.ts` middleware test**: now uses `/api/ai/chat` as fixture. If `/api/ai/chat` ever retires, a follow-up URL migration will be needed.
- **Next in plan sequence**: final orphan-AI cleanup PR (eu-knowledge-base + any remaining residue).
