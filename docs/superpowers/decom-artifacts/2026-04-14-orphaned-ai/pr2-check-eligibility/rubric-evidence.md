# Rubric Evidence — PR #2 `/api/ai/check-eligibility`

Date: 2026-04-14
Branch: `chore/decom-orphan-check-eligibility`
Base: `master` @ `94c4b2e`

## 1. Runtime ownership

The retired route implemented a deterministic eligibility pre-filter via
`runEligibilityRules` from `@/lib/rules/eligibility`. That capability is now
owned by the V3 agent's `run-eligibility` MCP rules tool:

- `app/src/lib/ai/agent/mcp/rules/run-eligibility.ts`
- Design reference: `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` §3.

The V3 runtime is the canonical eligibility entry point; no user-facing
surface depended on `/api/ai/check-eligibility` (orphan per probe-04).

## 2. Reference sweep

See `docs/superpowers/decom-artifacts/2026-04-14-orphaned-ai/pr2-check-eligibility/reference-sweep.md`.

Summary: only the route itself and its dedicated integration test are in
scope. `app/e2e/ai-assistant.spec.ts` has 1 reference — out of program scope
(`app/e2e/*` untouched); accepted fallout since e2e is non-blocking per the
April 2026 e2e-gate rollback.

## 3. Build / typecheck / test evidence

### `npm run build` (tail)

```
├ ƒ /api/v1/user/preferences                                          0 B                0 B
├ ƒ /api/v1/workspace                                                 0 B                0 B
├ ƒ /api/webhooks/stripe                                              0 B                0 B
├ ○ /pricing                                                          155 B          89.7 kB
├ ○ /robots.txt                                                       0 B                0 B
└ ○ /sitemap.xml                                                      0 B                0 B
+ First Load JS shared by all                                         89.5 kB
  ├ chunks/2117-710818536b992250.js                                   31.9 kB
  ├ chunks/fd9d1056-c66439d2a62f7fbd.js                               53.6 kB
  └ other shared chunks (total)                                       4.02 kB

ƒ Middleware                                                          37.3 kB

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

Build: green. No `/api/ai/check-eligibility` in the route manifest.

### `npm run typecheck` (tail)

```
> app@0.1.0 typecheck
> tsc --noEmit
```

Typecheck: green (no output = success).

### `npm run test` (tail)

```
 Test Files  167 passed | 5 skipped (172)
      Tests  1012 passed | 15 skipped | 2 todo (1029)
   Duration  5.34s
```

All tests pass. No new failures vs master baseline. (Plan anticipated up to
3 pre-existing failures in timeline-assignee-validation and
trial-notifications-route — none observed locally this run.)

## 4. Feature flags / env vars

No feature flag or env var was scoped solely to this route. Nothing to clean up.

## 5. Test artifacts

`app/tests/integration/check-eligibility-route.test.ts` deleted in this PR.
Its mocks targeted only the route's direct collaborators
(`@/lib/auth`, `@/lib/legal/audit`, `@/lib/monitoring/metrics`, `@/lib/logger`)
— no shared fixtures to clean up elsewhere.

## 6. Frontend migration

Zero frontend references to `/api/ai/check-eligibility`. No migration needed.

The `app/e2e/ai-assistant.spec.ts` test referencing the route will now 404
post-deployment. This is out of program scope per plan rules (no `app/e2e/*`
edits) and accepted as e2e is non-blocking per the April 2026 e2e-gate
rollback.

## 7. Observability surface

The route emitted `logAudit({ action: 'ai.compliance_check', resourceType: 'eligibility_check', ... })`.
Grep confirmation that this resourceType was unique to the retired route:

```
$ rg -n "eligibility_check" app/src
app/src/app/api/ai/check-eligibility/route.ts:42:      resourceType: 'eligibility_check',
```

(Single hit, inside the file being deleted.) Post-deletion no emitter remains.
The observability slice retires cleanly with the route — no dashboards or
alerts reference `resourceType: 'eligibility_check'`.
