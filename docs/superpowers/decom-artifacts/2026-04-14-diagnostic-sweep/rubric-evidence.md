# `/api/ai/diagnostic` Sweep — Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-diagnostic-sweep.md`
**Spec:** `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 3.
**Date:** 2026-04-14
**Branch:** `chore/decom-diagnostic-sweep`
**Decision:** DELETE — zero frontend refs, zero test refs, zero operational consumers (no deploy probe, no monitoring alert, no runbook, no committed CLI).

## 1. Runtime ownership declaration

Route is removed; no replacement. The capability (DB / Redis / AI-gateway ping, `aiGenerate` smoke test) is covered by existing `/api/health` and `/api/ready` for the app's own liveness/readiness, plus the AI Gateway's own `/health` and `/ready` endpoints which are already probed from `cloudbuild.production.yaml` (lines 186–198). If a specific diagnostic probe is needed in the future, it is re-added with a named consumer.

## 2. Reference sweep

See `operational-usage-check.md` for the full raw output. Summary:

- Section A (code `/api/ai/diagnostic` in TS/TSX/JS/YAML/JSON/TOML/SH/TF/MD outside docs): **0 hits**.
- Section B (`Dockerfile`, `app/Dockerfile`, `cloudbuild*.yaml`, `app/cloudbuild*.yaml`, `.github/`): **0 hits**.
- Section C (production health/probe config): Cloud Build hits `/api/health` and the AI Gateway's `/health`+`/ready`; zero references to `/api/ai/diagnostic`.
- Section D (docs): Only decom-program artifacts (this sweep's own plan, probe-04, probe-11, track-candidates, the parent spec) plus a defunct `fondeu ai diagnose` CLI proposal in `docs/superpowers/plans/2026-03-29-local-production-readiness.md` that was never implemented (grep for `fondeu ai diagnose` returns no code hits; the CLI proposed POST while the handler is GET-only).

Also: probe-04 shows 0 frontend + 0 test refs; probe-11 listed the `middleware.ts` publicPaths entry (now removed).

## 3. Build and route-surface verification

- `next build`: **PASS** — built successfully (89.5 kB shared JS, middleware 37.3 kB). No errors in `/tmp/diagnostic-build.log`. The only stderr lines are pre-existing `DYNAMIC_SERVER_USAGE` logs from unrelated routes using `headers()` at prerender time. `/api/ai/diagnostic` does not appear in the built route manifest.
- `tsc --noEmit`: **PASS** — clean, zero output.
- `npm run test`: **1124 passed, 15 skipped, 2 todo / 0 failed** across 192 test files (5 skipped). No new failures introduced by this change. (MEMORY.md-listed pre-existing failures `timeline-assignee-validation.test.ts` and `trial-notifications-route.test.ts` were not observed in this run — either fixed upstream on master or flaky; either way the delta from this PR is zero.)
- `/api/ai/diagnostic` removed from `middleware.ts` publicPaths: verified via `rg -n "/api/ai/diagnostic" app/src/middleware.ts` returning no matches.

## 4. Feature flag / env var sweep

No flags or env vars scoped exclusively to this route (probe 07, probe 08). The route used `HEALTHCHECK_AUTH_TOKEN`, `AI_GATEWAY_API_KEY`, `AI_GATEWAY_KEY`, `AI_GATEWAY_URL`, `AI_GATEWAY_TENANT_ID`, `REDIS_URL`, `DATABASE_URL`, `NODE_ENV` — all shared with other runtime code (`AI_GATEWAY_*` by `lib/ai/client.ts`, `DATABASE_URL` by `lib/db/index.ts`, `REDIS_URL` by `lib/redis/client.ts`, `HEALTHCHECK_AUTH_TOKEN` not scoped to this route). Nothing to prune.

## 5. Test-surface cleanup

Probe 04 reported 0 test references. Confirmed: no tests import or exercise this route (section A of the usage sweep returned no hits in `tests/` either). Nothing to clean up.

## 6. Migration diff

No behavioural migration. The capability was already orphaned — no frontend caller, no test, no deploy probe, no runbook. `/api/health`, `/api/ready`, and the AI Gateway's own `/health` + `/ready` cover the operational-check use case.

## 7. Observability sweep

No dedicated logs, metrics, Sentry tags, or audit-log event types found scoped to this route. The route never called `logAudit(`, emitted no custom Prometheus metrics under `lib/monitoring/metrics.ts`, and carried no Sentry tag unique to `/api/ai/diagnostic`. `rg` against `app/src/lib/errors/`, `app/src/lib/monitoring/`, and `logAudit(` returned no matches scoped to this route. Nothing to remove.
