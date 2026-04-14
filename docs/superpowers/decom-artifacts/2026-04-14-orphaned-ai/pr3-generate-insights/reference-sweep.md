# PR #3 Reference Sweep — `/api/ai/generate-insights` + `knowledge-engine.ts`

Date: 2026-04-14
Branch: `chore/decom-orphan-generate-insights`

## Route URL references (`/api/ai/generate-insights`)

- `app/src/app/api/ai/generate-insights/route.ts` — route file itself (deleted).
- `app/tests/integration/critical-flows.test.ts` (lines 101-102 pre-edit) — one `it(...)` block out of 5 in a multi-flow file.
- All remaining refs are in `docs/`, plan, and spec files (out of scope; retained as historical record).

## Route imports (pre-deletion snapshot)

```
@/lib/middleware/auth (withAIAuth)
@/lib/ai/knowledge-engine (generateKnowledgeRecommendations, quickQualityCheck) ← deleted with this PR
@/lib/ai/eu-knowledge-base (type EUProgramKey) ← keeper; fact-checker still consumes, defers to final cleanup PR
@/lib/errors
@/lib/legal/audit
@/lib/logger
@/lib/ai/sanitize ← keeper (many consumers)
@/lib/middleware/tier-gate
next/server, zod
```

## 4-part sweep for `knowledge-engine.ts` (barrel-aware)

1. **Direct-path imports** (`@/lib/ai/knowledge-engine`, `./knowledge-engine`, `../knowledge-engine`): only `route.ts` (hits zero after route delete).
2. **Relative imports inside `lib/ai/`**: none.
3. **Barrel re-export**: `app/src/lib/ai/index.ts` line 17 re-exported 10 symbols — `generateKnowledgeRecommendations`, `quickQualityCheck`, `KnowledgeRecommendations`, `KnowledgeEngineInput`, `ProposalEnhancement`, `BestPractice`, `LessonLearned`, `SuccessPattern`, `PitfallWarning`, `ExpertRecommendation`.
4. **Barrel consumers** (grep for each symbol imported via `@/lib/ai`): **zero** across all 10 symbols.

**Disposition**: helper + barrel re-export removed in one coordinated commit.

## Test classification

`app/tests/integration/critical-flows.test.ts` is a 5-`it()` multi-flow file. Only the block at pre-edit lines 80-113 (`it('idea enrichment flow logs user-bound audit events', ...)`) exercises `/api/ai/generate-insights`.

Decision: **surgical removal** of that `it(...)` block (plus its trailing blank line). Other 4 `it()` blocks (grant matching, proposal generation, auth boundary, tenant isolation) are unrelated and remain intact.

## `eu-knowledge-base.ts` post-PR #3 projection

Remaining consumers after this PR:
- `app/src/lib/ai/fact-checker.ts` (direct path `./eu-knowledge-base`).
- `app/src/lib/ai/index.ts` barrel re-export (line 16).

Still multi-consumer — **defer** per plan Task 3.3 note; retire in final cleanup PR after PR #4.

## Observability surface

`resourceType: 'knowledge_insights'` emitted by the retired route's `logAudit` call. Grep of `knowledge_insights` across the repo: 1 hit (route file itself, now deleted). Clean retirement of observability surface.
