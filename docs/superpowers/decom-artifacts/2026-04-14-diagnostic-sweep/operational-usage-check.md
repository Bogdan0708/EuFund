# `/api/ai/diagnostic` — Operational Usage Check

**Date:** 2026-04-14
**Branch:** `chore/decom-diagnostic-sweep`
**Route:** `app/src/app/api/ai/diagnostic/route.ts`

## Raw sweep output

```
## A. String references to /api/ai/diagnostic anywhere
(none)

## B. Dockerfile / cloudbuild / deploy manifests
(none)

## C. Health-check / probe configurations
cloudbuild.production.yaml:186:        HEALTH_JSON=$$(curl -sf "$_AI_GATEWAY_URL/health")
cloudbuild.production.yaml:187:        python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "healthy" else 1)' <<<"$$HEALTH_JSON"
cloudbuild.production.yaml:189:        READY_STATUS=$$(curl -s -o /tmp/gateway_ready.json -w "%{http_code}" \
cloudbuild.production.yaml:191:          "$_AI_GATEWAY_URL/ready")
cloudbuild.production.yaml:193:          python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("status") == "ready" else 1)' </tmp/gateway_ready.json
cloudbuild.production.yaml:195:          echo "Gateway /ready returned 404; continuing with health and chat checks against the live gateway contract"
cloudbuild.production.yaml:198:          cat /tmp/gateway_ready.json
cloudbuild.production.yaml:233:          HEALTH_JSON=$$(curl -sf "$${HEALTH_HEADER[@]}" "$$PROD_URL/api/health" || true)
cloudbuild.production.yaml:238:            HEALTHY=$$([ "$$STATUS" = "healthy" ] && [ "$$STORAGE" != "error" ] && [ "$$SENTRY" != "error" ] && echo yes || echo no)
cloudbuild.production.yaml:240:            HEALTHY=$$([ "$$STATUS" = "healthy" ] && echo yes || echo no)
cloudbuild.production.yaml:243:            echo "Production healthy"
cloudbuild.production.yaml:250:        echo "Production health check failed"

## D. Documentation
docs/superpowers/specs/2026-03-29-local-production-readiness-design.md:113:fondeu ai diagnose         # POST /api/ai/diagnostic
docs/superpowers/specs/agent4.md:311:  - File: src/app/api/ai/diagnostic/route.ts:12-13
docs/superpowers/specs/agent3.md:145:  File: app/src/app/api/ai/diagnostic/route.ts:12
docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md:83:- `app/src/app/api/ai/diagnostic/route.ts` — ops/diagnostic endpoint for DB, Redis, gateway, `aiGenerate`. Does **not** import orchestrator. May still be a delete candidate, but on its own evidence, not as part of orchestrator retirement.
docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md:175:- **Independent operational-endpoint sweep.** `app/src/app/api/ai/diagnostic/route.ts` is swept on its own evidence (ops/diagnostic usage patterns, not orchestrator dependency). Tracked as a single rubric-carrying PR separate from the two tracks above, so it cannot accidentally ride the orchestrator retirement's argument.
docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-11-public-surface.md:105:| `middleware.ts` `publicPaths` | Includes `/api/ai/diagnostic`, auth, onboarding, pricing, and reset-password paths; no stale `(app)` route references found in the declared array | Current public-path surface is mostly aligned; diagnostic endpoint remains publicly routed and belongs in Plan 5 review |
docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md:113:- Route: `app/src/app/api/ai/diagnostic/route.ts`
docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/track-candidates.md:116:- Public-surface note: `middleware.ts` still lists `/api/ai/diagnostic` in `publicPaths`
docs/superpowers/plans/2026-04-14-decom-program-bootstrap.md:521:| /api/ai/diagnostic | <count> | <count> | Independent sweep (Plan 5) — classify on its own evidence |
docs/superpowers/plans/2026-04-14-decom-program-bootstrap.md:1062:- Route: `app/src/app/api/ai/diagnostic/route.ts`
docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/probe-04-api-route-orphan.md:83:## Route: /api/ai/diagnostic (app/src/app/api/ai/diagnostic/route.ts)
docs/superpowers/plans/2026-03-29-local-production-readiness.md:364:curl -X POST http://localhost:3000/api/ai/diagnostic \
docs/superpowers/plans/2026-03-29-local-production-readiness.md:986:    """Check AI provider status (POST /api/ai/diagnostic)"""
docs/superpowers/plans/2026-03-29-local-production-readiness.md:1350:        ("POST", "/api/ai/diagnostic"),
```

(Plus references within `docs/superpowers/plans/2026-04-14-decom-diagnostic-sweep.md` itself — the plan file for this very sweep.)

## Analysis

- **A (code references):** Zero references in TS/TSX/JS/YAML/JSON/TOML/SH/TF configs or markdown outside docs.
- **B (deploy manifests):** Zero references in `Dockerfile`, `app/Dockerfile`, any `cloudbuild*.yaml`, or `.github/` (CI workflows).
- **C (Cloud Build health checks):** Production deploy health-check probes hit `/api/health` and the AI gateway's `/health` + `/ready`. None hit `/api/ai/diagnostic`.
- **D (documentation):**
  - All hits within `docs/superpowers/decom-artifacts/`, `docs/superpowers/plans/2026-04-14-decom-*`, `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md`, and the probe outputs are self-referential decom-program artifacts — they document the route's existence for classification, not operational consumption.
  - `docs/superpowers/specs/agent3.md:145` and `docs/superpowers/specs/agent4.md:311` reference `route.ts:12` / `route.ts:12-13` as examples of token-check patterns — structural citations, not consumers.
  - `docs/superpowers/plans/2026-03-29-local-production-readiness.md` (lines 364, 986, 987, 1350) and the matching spec file describe a `fondeu ai diagnose` CLI that would `POST /api/ai/diagnostic`. **Correction (post-review):** the original sweep was scoped to `app/src/` and `scripts/` and missed `app/agent-harness/`, where the CLI *does* exist: `app/agent-harness/fondeu/commands/ai.py` defined a `diagnose` Click command and `app/agent-harness/fondeu/commands/test.py` listed `("POST", "/api/ai/diagnostic")` in the smoke-test probe. Both were already broken before this PR because the route was GET-only while the CLI/probe used POST (returned 405). They are dead code, not operational consumers — the DELETE decision stands. Removed in this PR alongside the route deletion (see commit "feat(decom): remove orphan fondeu ai diagnose CLI + harness probe").
- **No monitoring alert, no runbook, no deploy probe, no CI step, no working CLI** uses this route. The orphan Python CLI referenced above was POST-to-GET broken and has been removed in this PR.

## Decision: DELETE

**Rationale:** Zero frontend refs, zero test refs (probe 04), zero operational consumers of any kind. The route's self-declared purpose — "Tests the full AI chain from Cloud Run" — is covered by existing `/api/health` and `/api/ready` for the app's own liveness/readiness, and by the AI Gateway's own `/health` + `/ready` endpoints which are already probed from `cloudbuild.production.yaml`. The only potential future consumer (the `fondeu ai diagnose` CLI in the March 29 readiness plan) was implemented as orphan dead code in `app/agent-harness/` but POSTed to a GET-only route (always returned 405); it has been removed in this PR. Deleting now removes an orphan public surface (token-protected, but publicly routed through `middleware.ts`) and reduces the attack surface. If a diagnostic probe is needed in the future, it will be re-added with a named consumer.
