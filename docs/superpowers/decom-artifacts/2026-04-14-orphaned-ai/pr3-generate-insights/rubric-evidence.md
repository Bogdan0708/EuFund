# PR #3 Rubric Evidence — retire `/api/ai/generate-insights` + `knowledge-engine.ts`

Date: 2026-04-14
Branch: `chore/decom-orphan-generate-insights`
Commit: `5c63a37e2bbaa0c7de215bf0d49b147f5dcec583`

## 1. Runtime ownership / replacement

The capability exposed by `/api/ai/generate-insights` — AI-generated knowledge recommendations, best practices, lessons learned, expert insights, pitfall warnings, and a quick quality check — is absorbed by the V3 agent's research + rules MCP tool surface (see spec `docs/superpowers/specs/2026-04-11-legacy-decommissioning-design.md` Section 3, Axis 4).

Specifically, V3 MCP tools replacing this surface:
- `research/*` (refresh-call-freshness, verify-deadline, check-call-page-updates) — knowledge freshness and authoritative source recency, previously simulated by the helper's best-practice prompts.
- `rules/*` (run-eligibility, validate-section, validate-application, check-missing-annexes, score-fit) — deterministic quality and readiness scoring, previously approximated by `quickQualityCheck` and `overallQualityScore` in `generateKnowledgeRecommendations`.
- `read/*` (retrieve-evidence, get-application-state, get-project-summary) — contextual insight retrieval, previously hardcoded into the `knowledge-engine` helper.

**No direct replacement route** — capability moves inside the V3 agent session loop instead of a one-shot POST.

## 2. Reference sweep

See `reference-sweep.md` in this directory. Summary:
- Route URL: 1 test block (removed surgically) + route file itself; remaining refs are in docs/spec/plan (out of scope).
- `knowledge-engine.ts`: 4-part barrel-aware sweep confirmed zero external consumers of the barrel re-export; single direct-path import (the route).
- `eu-knowledge-base.ts`: deferred — still consumed by `fact-checker.ts`.

## 3. Build / typecheck / test output

### `tsc --noEmit`
```
> app@0.1.0 typecheck
> tsc --noEmit
```
(clean, no diagnostics)

### `next build`
```
ƒ Middleware                                                          37.3 kB
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```
(build succeeded; no errors)

### `vitest run`
```
 Test Files  167 passed | 5 skipped (172)
      Tests  1011 passed | 15 skipped | 2 todo (1028)
   Duration  5.40s
```

Targeted check on `tests/integration/critical-flows.test.ts`:
```
 Test Files  1 passed (1)
      Tests  4 passed (4)
```
Pre-PR count was 5 `it()` blocks; post-PR count is 4. Delta is exactly the surgically removed `idea enrichment flow logs user-bound audit events` block. No other failures introduced.

## 4. Feature flags / env vars

None scoped to this surface. The retired route consumed no dedicated feature flag or environment variable; it shared `withAIAuth` tier gating (`assertTier(user.tier, 'pro')`) which is used pervasively elsewhere. Nothing to retire.

## 5. Test surface

Surgical removal of a single `it(...)` block from `app/tests/integration/critical-flows.test.ts` (pre-edit lines 80-113). The multi-flow file retains 4 unrelated `it()` blocks (grant matching, proposal generation, auth boundary, tenant isolation) — verified still passing by the targeted vitest run above. No fixture, helper, or imports needed cleanup beyond the removed block.

## 6. Frontend migration

Zero frontend references to `/api/ai/generate-insights`. No UI component, hook, or page invoked this route. No migration needed.

## 7. Observability

Retired route's `logAudit` call emitted `resourceType: 'knowledge_insights'`. Grep of the repo for `knowledge_insights`:
```
app/src/app/api/ai/generate-insights/route.ts   (deleted in this PR)
```
One hit pre-deletion, unique to the retired route. Observability surface retires cleanly — no dashboards, queries, or alerting rules elsewhere reference this `resourceType`.
