# Orchestrator Retirement Sub-step (c) — Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md` sub-step (c).
**Spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 3.
**Branch:** `chore/decom-orchestrator-c`.

## 1. Runtime ownership declaration

Deletion: `app/src/hooks/useOrchestrator.ts`. No replacement — callers migrated in sub-step (a) to the V3 `useAgent` hook.

## 2. Reference sweep

`rg -n "useOrchestrator" app/src/ app/tests/ app/e2e/ | rg -v "app/src/hooks/useOrchestrator\.ts"` → zero matches (run pre-delete on commit 25e5509's parent; confirmed zero).

## 3. Build and route-surface verification

- `next build`: PASS (full route manifest produced; middleware 37.3kB; shared JS 89.5kB)
- `tsc --noEmit`: PASS (no output, clean exit)
- `npm run test`: 1123 passed, 15 skipped, 2 todo across 191 files (5 files skipped). Zero failures.
- Route surface: N/A (hook deletion, no URL change).

## 4. Feature flag / env var sweep

N/A — no flag or env var exclusively gated useOrchestrator.

## 5. Test-surface cleanup

`rg -l useOrchestrator app/tests/ app/e2e/` → zero hits. No test-surface cleanup required. (Note: `tests/unit/orchestrator-sanitizer.test.ts`, `tests/unit/orchestrator-cache.test.ts`, `tests/unit/orchestrator-lifecycle.test.ts` reference server-side orchestrator modules, not the client `useOrchestrator` hook — they all pass.)

## 6. Migration diff

Hook file deleted (532 lines removed). No replacement surface; callers already migrated in (a).

## 7. Observability sweep

Pre-delete inspection of `app/src/hooks/useOrchestrator.ts` for `Sentry|metrics|logger|console.(log|warn|error)` → zero matches. The hook was a thin client-side SSE consumer with no custom telemetry emissions. Nothing to retire observability-wise; server-side SSE producer telemetry is unaffected.
