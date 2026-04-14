# PR #1 Bundle — Rubric Evidence

Plan: `docs/superpowers/plans/2026-04-14-decom-orphaned-ai-modules.md` — PR #1.
Spec: `docs/superpowers/specs/2026-04-09-managed-agents-architecture.md` (target runtime).
Branch: `chore/decom-orphan-bundle1` off `origin/master` @ `1097c1f`.

Scope: retire 4 zero-ref `/api/ai/*` routes + 2 helpers that become 0-ref after route deletion.

## 1. Runtime ownership

All four retired routes served pre-Managed-Agents capabilities that are now absorbed (or explicitly deprecated) under the Managed Agents + MCP tool surface described in the target runtime spec.

| Deleted route | Prior capability | New ownership |
|---|---|---|
| `/api/ai/generate-proposal-enhanced` | Multi-section proposal generation with fact-checking | Replaced by section-level drafting through the Managed Agents tool surface (`save_section_draft`, `retrieve_evidence`, `update_work_package`, `update_timeline_item`). No single monolithic generation endpoint in the new model; section-by-section drafting with evidence ledger integration. |
| `/api/ai/generate-report` | Financial/progress/risk/partner/compliance report generation | No direct replacement this quarter. Reporting is deferred until the post-drafting phase of the Managed Agents roadmap; no frontend ever consumed it. |
| `/api/ai/ghid-to-tasks` | Converted a Romanian call guide into structured tasks | Subsumed by the agent ingestion + evidence flow; task extraction happens via RAG/Qdrant retrieval and the agent toolset, not a one-shot HTTP endpoint. |
| `/api/ai/search-calls` | Semantic search over funding calls | Superseded by the agent tool `search-calls` at `lib/ai/agent/tools/search-calls` (distinct from the deleted HTTP route — same name, different surface). The HTTP endpoint had no frontend caller. |

## 2. Reference sweep

See `reference-sweep.md` (committed in this branch, first commit).

- All four route URLs: **zero** matches in `app/src`, `app/tests`, `app/e2e`, `app/scripts`. Only doc-level self-references in probe-04 / track-candidates / this plan. Bootstrap probe 04 confirmed.
- Four-part helper sweep (direct path, relative, barrel re-export, barrel consumer per symbol) on `enhanced-proposal-generator`, `reporting-engine`, `fact-checker`, `eu-knowledge-base`:
  - `enhanced-proposal-generator`: zero barrel consumers for all 4 exported symbols; only direct consumer is the route being deleted; deletable.
  - `reporting-engine`: zero barrel consumers for all 9 exported symbols; only direct consumer is the route being deleted; deletable.
  - `fact-checker`: still consumed by `/api/ai/generate-proposal` (retires in PR #4); leave.
  - `eu-knowledge-base`: still consumed by `/api/ai/generate-insights` route and two intra-`lib/ai/` callers (`knowledge-engine.ts`, `fact-checker.ts`); leave.

**Note on probe correction:** the pre-delete sweep on route URLs was silent on `app/tests/integration/ghid-to-tasks-route.test.ts`, because the test file imports the route via module path (`@/app/api/ai/ghid-to-tasks/route`) rather than containing the URL string literal. Bootstrap probe 04 / 09 both used URL-literal greps and thus missed this test. It surfaced in typecheck after the route deletion, was confirmed orphan (test only exists to exercise the deleted route), and was deleted in a separate commit `chore(decom): remove stale ghid-to-tasks route test`. No other tests affected.

## 3. Build / route-surface verification

- `npm ci`: succeeded (fresh install on worktree).
- `npm run typecheck` → `tsc --noEmit`: **PASS**, zero errors after stale test removal.
- `npm run build`: **PASS**. Route listing in build output no longer contains `/api/ai/generate-proposal-enhanced`, `/api/ai/generate-report`, `/api/ai/ghid-to-tasks`, `/api/ai/search-calls` (grep confirmed empty).
- `npm run test` (vitest): **191 test files passed, 5 skipped; 1123 tests passed, 15 skipped, 2 todo**. Zero failures. The pre-existing failures listed in MEMORY.md (`timeline-assignee-validation`, `trial-notifications-route`) did not fire in this run and nothing regressed.
- `app/src/middleware.ts` publicPaths: sweep for the four deleted route path strings returns zero — none of the four routes were ever in `publicPaths`, consistent with them being authenticated `withAIAuth` endpoints. No middleware edit required.

## 4. Feature flag / env var sweep

No feature flags scoped exclusively to these four routes. No env vars scoped exclusively to them either. Evidenced by bootstrap probes 07 (feature flag inventory) and 08 (env var inventory) under `docs/superpowers/decom-artifacts/2026-04-14-probe-outputs/`. The four routes inherited the shared `withAIAuth` / `AI_GATEWAY_*` env configuration only — no route-specific flags or vars to retire.

## 5. Test-surface cleanup

One stale test file found and removed: `app/tests/integration/ghid-to-tasks-route.test.ts`. Bootstrap probes 04 and 09 used URL-literal greps; this file referenced the route via import path, not URL string, so it fell through. Deletion confirmed safe: file contained only tests for the deleted `/api/ai/ghid-to-tasks` route handler.

Three other test files mention the string `search-calls` but refer to the distinct Managed-Agents-era tool `@/lib/ai/agent/tools/search-calls` (not the deleted HTTP route) and remain valid:
- `app/tests/integration/agent-session-messages.test.ts` (checks `toolName: 'search-calls'` in a session message fixture — agent tool, not route)
- `app/tests/unit/agent-tool-search-calls.test.ts` (imports `@/lib/ai/agent/tools/search-calls`)
- `app/tests/unit/agent-tool-registry.test.ts` (imports `@/lib/ai/agent/tools/search-calls`)

All four deleted routes contributed zero live tests after this cleanup.

## 6. Migration diff

**Routes:** zero frontend callers per the reference sweep — no migration needed. Any external caller (none known) would receive a 404 after deploy, which matches the "retire orphans" policy.

**Helpers:**
| Helper | Disposition | Reason |
|---|---|---|
| `enhanced-proposal-generator` | **Deleted this PR** | After route deletion, direct-path consumers = 0, barrel consumers per symbol = 0 for all 4 exported names. `app/src/lib/ai/index.ts` line 8 re-export removed in the same commit. |
| `reporting-engine` | **Deleted this PR** | After route deletion, direct-path consumers = 0, barrel consumers per symbol = 0 for all 9 exported names. `app/src/lib/ai/index.ts` line 18 re-export removed in the same commit. |
| `fact-checker` | **Deferred** | Still directly imported by `/api/ai/generate-proposal/route.ts` (line 10). That route retires in PR #4; `fact-checker` goes with it. |
| `eu-knowledge-base` | **Deferred** | Still directly imported by `/api/ai/generate-insights/route.ts` and by intra-`lib/ai/` callers `knowledge-engine.ts` and `fact-checker.ts`. Transitive re-probe after this PR's deletions confirms non-zero consumers remain. Retires in final cleanup after PRs #3 and #4 per plan. |

The helper `git rm` and the `index.ts` re-export-line removal are paired in a single commit so the tree is never in a broken intermediate state (index.ts would otherwise re-export a path that no longer exists, or a file would exist without being re-exported).

## 7. Observability sweep

- `logAudit` event types scoped to the four deleted routes: none. The audit entries these routes produced used generic event types (`'ai.proposal.generate'`, `'ai.report.generate'`, etc.) shared with surrounding AI routes; no event-type enum needed retirement.
- Sentry tags scoped exclusively to these routes: none.
- Metrics/Prometheus counters scoped exclusively: none.
- No dashboards, alerts, or SLO references scoped to these routes were found in `docs/` or `app/src/lib/monitoring/`.

No observability cleanup required.

---

## Commits in this PR

1. `chore(decom): PR #1 bundle reference sweep` — adds `reference-sweep.md`
2. `feat(decom): delete 4 zero-ref /api/ai/* routes` — `git rm` of the 4 route files
3. `feat(decom): delete orphan helpers enhanced-proposal-generator, reporting-engine` — helper `git rm` + `index.ts` edit together
4. `chore(decom): remove stale ghid-to-tasks route test` — removes orphaned vitest file missed by probe
5. `chore(decom): PR #1 bundle rubric evidence` — this file
