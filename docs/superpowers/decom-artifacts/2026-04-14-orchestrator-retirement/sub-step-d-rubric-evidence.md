# Sub-step (d) Rubric Evidence — Orchestrator Retirement

Plan: `docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md` sub-step (d).
Branch: `chore/decom-orchestrator-d`. Base: `origin/master` at `a852fdb` (post-PR #31).

## 1. Ownership

7 orchestrator route files retired; no replacement surface is introduced. The entire
orchestrator runtime is being dismantled wholesale (sub-step (e) handles
`app/src/lib/ai/orchestrator/`). Sub-step (a) already migrated the last runtime
consumer (`asistent-ai`); sub-step (c) deleted the `useOrchestrator` hook — no
frontend/backend caller remains.

Routes deleted:

- `app/src/app/api/ai/orchestrator/message/route.ts`
- `app/src/app/api/ai/orchestrator/messages/route.ts`
- `app/src/app/api/ai/orchestrator/sessions/route.ts`
- `app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts`
- `app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/state/route.ts`
- `app/src/app/api/ai/orchestrator/sessions/[sessionId]/sections/[sectionId]/versions/route.ts`
- `app/src/app/api/ai/orchestrator/stream/route.ts`

The empty `app/src/app/api/ai/orchestrator/` subtree was pruned.

## 2. Reference sweep

Pre-delete sweep results captured in `/tmp/orch-d-refs.txt` (local build artifact).
Key findings:

- Zero frontend (`app/src/`) references to any of the 7 route path literals.
- Zero non-test backend references to any of the 7 route path literals.
- All pre-existing references were inside the test files retired in this PR
  (see section 5 below), which exercised the deleted routes via `await import(...)`.
- Bulk check `rg "/api/ai/orchestrator/"` against `app/src/` and `app/tests/`
  returned only the test-file imports enumerated above.

## 3. Build + typecheck + test

Run from `/home/godja/Dev/EU-Funds-decom-orch-d/app`:

- `npm run typecheck` — PASS (tsc --noEmit, zero errors).
- `npm run build` — PASS (Next production build completes; orchestrator routes
  absent from the route manifest).
- `npm run test` — PASS: **177 test files passed, 5 skipped; 1045 tests passed,
  15 skipped, 2 todo**.

Expected delta from baseline (1123 passing before this PR): `-78 passing` across
14 deleted test files (≈5.5 tests/file), which matches observation.

## 4. Flag/env sweep

- `section_versioning` feature flag retired in this PR.
- New migration: `app/drizzle/0025_drop_section_versioning_flag.sql` — single
  statement `DELETE FROM feature_flags WHERE key = 'section_versioning'` (idempotent
  if the row was never seeded).
- Journal entry added at `app/drizzle/meta/_journal.json` (idx 25, tag
  `0025_drop_section_versioning_flag`, timestamp continues the `+86400000ms`
  spacing convention used by 0018–0024).
- Remaining reader in `app/src/lib/ai/orchestrator/engine.ts:195` is intentionally
  left alone — that file is in sub-step (e) scope and will be deleted wholesale
  with the rest of the orchestrator runtime. The flag reader is fail-closed
  (unknown/absent flag → `false`), so dropping the row is safe immediately.

## 5. Test-surface cleanup

Deleted test files (14 total):

Named in plan (orchestrator-runtime unit tests):

- `app/tests/unit/agent-build.test.ts` — imports `@/lib/ai/orchestrator/agents/build`.
- `app/tests/unit/agent-plan.test.ts` — imports `@/lib/ai/orchestrator/agents/plan`.
- `app/tests/unit/agent-research.test.ts` — imports `@/lib/ai/orchestrator/agents/research`.
- `app/tests/unit/agent-enhance.test.ts` — imports `@/lib/ai/orchestrator/agents/enhance`.
- `app/tests/unit/agent-edit.test.ts` — imports `@/lib/ai/orchestrator/agents/edit`.
- `app/tests/unit/agent-match.test.ts` — imports `@/lib/ai/orchestrator/agents/match`.
- `app/tests/unit/orchestrator-qa.test.ts` — imports `@/lib/ai/orchestrator/qa`.
- `app/tests/unit/orchestrator-types.test.ts` — type-level assertions against
  already-rehomed types (redundant post sub-step (b)).

Additional route-scoped integration tests (sole purpose: exercising a deleted route):

- `app/tests/integration/section-state-api.test.ts` — imports deleted `state/route`.
- `app/tests/integration/section-rollback-api.test.ts` — imports deleted `rollback/route`.
- `app/tests/integration/section-versions-api.test.ts` — imports deleted `versions/route`.
- `app/tests/integration/section-concurrency.test.ts` — imports deleted
  `state/route` and `rollback/route`.
- `app/tests/integration/orchestrator-sessions-filter.test.ts` — imports deleted
  `sessions/route`.
- `app/tests/integration/session-lock-failclosed.test.ts` — imports deleted
  `message/route`.

Each test was inspected before deletion; none exercised a keeper surface through
the deleted route (no migration candidates).

## 6. Migration diff

N/A for the runtime surface — the 7 routes had zero frontend/backend callers,
so there is no user-visible behaviour to preserve or migrate. The only migration
is the drizzle seed-row drop documented in section 4.

## 7. Observability sweep

`rg -n "logAudit\(" app/src/ | rg -i "orchestrator"` returns only three files,
all inside `app/src/lib/ai/orchestrator/` (sub-step (e) scope):

- `workspace.ts:342`
- `section-versions.ts:206,340,469`

None of the 7 deleted route handlers carried their own `logAudit()` call; audit
emission (where it happened) was delegated to the orchestrator library modules
above, which will be retired in sub-step (e). Consequently, no audit-stream
regression is possible from this PR on its own. Documented as negative result.
