# Rubric Evidence — PR #6: retire `eu-knowledge-base` helper

Final cleanup PR of Plan 4 (orphaned AI modules retirement). Retires the now-unreachable static-metadata helper after PRs #1/#3/#4 removed every direct and transitive importer.

## 1. Capability retirement — what goes, what absorbs it

**Retired module**: `app/src/lib/ai/eu-knowledge-base.ts` (419 lines).

The helper exposed hard-coded EU-programme metadata — a static `EU_PROGRAMS` map (horizon_europe, life_plus, interreg, erdf, pocidif, pnrr, general) and six lookup functions (`getProgramInfo`, `getEvaluationCriteria`, `getBudgetCategories`, `getProposalSections`, `getRomanianAdvantages`, `findBestProgram`) plus the `EUProgramKey` type. Consumers were the retired AI helpers: `enhanced-proposal-generator` (PR #1), `knowledge-engine` + `/api/ai/generate-insights` (PR #3), and `fact-checker` (PR #4). When those landed, this module became unreachable.

**Capability absorption**: the V3 agent's MCP toolchain already replaces this surface with live data:

- `search-calls` + `get-call-blueprint` services read the live `funding_programs` table (seeded by `scripts/seed-programs.ts`) instead of a hard-coded map — the source of truth for programme metadata, budget categories, and proposal sections.
- Qdrant RAG (`eu_legislation` collection) supplies evaluation criteria and programme narrative context via `retrieve-evidence` / `get-section-context` tools, backed by ingested real programme documents rather than curated strings.
- The eligibility rules engine (`lib/rules/eligibility.ts`) replaces `findBestProgram` heuristics with deterministic, auditable matching.

The retired helper's values were product-of-its-time curated data — the live path is strictly more accurate and maintainable.

## 2. Reference sweep

See [`reference-sweep.md`](./reference-sweep.md) for the four-probe sweep confirming zero external consumers:

- Direct-path (`@/lib/ai/eu-knowledge-base`) importers: 0
- Relative (`./eu-knowledge-base`) importers inside `lib/ai/`: only the barrel itself
- Barrel consumers of all 8 re-exported symbols: 0
- CLAUDE.md stale references: 0

## 3. Verification

Branch: `chore/decom-orphan-cleanup` @ commit `c224d73` (base `abda73c`).

```
$ npm run build | tail
... (all routes built) ...
ƒ Middleware                                                          37.3 kB
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

```
$ npm run typecheck
> tsc --noEmit
(no errors)
```

```
$ npm run test
 Test Files  166 passed | 5 skipped (171)
      Tests  1002 passed | 15 skipped | 2 todo (1019)
```

Zero delta vs master expected for test counts (the helper had no direct tests). Confirmed: no tests retired, no new failures.

## 4. Feature flags / env vars

None retired. The helper was a pure static-data module with no runtime toggles, no env-var reads, and no provider or gateway configuration.

## 5. Test files retired

None. `eu-knowledge-base.ts` was not directly covered at this layer — its behaviour was exercised transitively through the AI helpers retired in PRs #1/#3/#4, and those helpers' tests already retired alongside them.

## 6. Frontend / migration

None. No frontend component, hook, API route, or external contract touched `EU_PROGRAMS` or the re-exported lookup functions. Pre-existing zero-ref status means no user-visible change and no migration step.

## 7. Observability

The helper emitted no audit events, no metrics, no Sentry spans — it was a pure in-process lookup table. No observability cleanup required. Downstream audit/metric emissions on the live path (`search-calls`, rules engine) are unchanged.

## Closing — Plan 4 program complete

This PR closes the Plan 4 orphaned-AI-modules decommissioning programme:

- PR #1: `enhanced-proposal-generator` + routes
- PR #2: supporting route/helper cleanup
- PR #3: `knowledge-engine` + `/api/ai/generate-insights`
- PR #4: `fact-checker` + consumers
- PR #5: prior consolidation
- **PR #6 (this)**: `eu-knowledge-base` — the last orphan

Axis 4 of the four-axis legacy decommissioning (per spec §1, §3) is retired.
