# Sub-step (b2) Rubric Evidence

**Plan:** `docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md` sub-step (b2)
**Branch:** `chore/decom-orchestrator-b2`
**Base:** `origin/master` @ `54cfb0e`

## 1. Scope & Intent

Rehome three orchestrator runtime modules that contain keeper-surface code (consumed by V1 API routes and discovery pipeline) to non-orchestrator paths so sub-step (e) can delete `app/src/lib/ai/orchestrator/` cleanly. Also drop the 17-symbol pass-through re-export block that sub-step (b) left in `app/src/lib/ai/agent/types.ts` as a sed-redirect courtesy — zero external consumers confirmed.

**Moves:**

| From | To |
|---|---|
| `app/src/lib/ai/orchestrator/gateway.ts` | `app/src/lib/ai/gateway.ts` |
| `app/src/lib/ai/orchestrator/workspace.ts` | `app/src/lib/workspace.ts` |
| `app/src/lib/ai/orchestrator/section-versions.ts` | `app/src/lib/section-versions.ts` |

## 2. Approach

One commit per physical move, plus one commit for the re-export cleanup, plus one commit for this evidence file. Each move:

1. `git mv` the file.
2. Fix the moved file's own relative imports (`./types`, `./pubsub`, `./section-versions`) to absolute paths.
3. Update every external importer (static + dynamic) from `@/lib/ai/orchestrator/<mod>` to the new absolute path via scripted sed.
4. Typecheck clean before committing.

Intra-orchestrator callers of the moved modules (`engine.ts`'s `persistSectionChanges` import) were minimally updated to absolute paths so the interim typecheck stayed green — `engine.ts` retires with sub-step (e).

## 3. Importers Enumerated (pre-move)

### gateway (3 files, all dynamic)
- `app/src/lib/discovery/pipeline.ts`
- `app/tests/unit/orchestrator-gateway.test.ts`
- `app/tests/unit/discovery-pipeline.test.ts`

### section-versions (2 static + 4 test files dynamic)
- `app/src/app/api/v1/projects/[id]/sections/[sectionId]/route.ts`
- `app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts`
- `app/tests/unit/orchestrator-engine.test.ts`
- `app/tests/unit/section-versions.test.ts`
- `app/tests/integration/sections-api.test.ts`
- `app/tests/integration/section-integrity-mismatch.test.ts`

### workspace (6 static API routes + 2 test files dynamic)
- `app/src/app/api/v1/workspace/route.ts`
- `app/src/app/api/v1/projects/[id]/sections/route.ts`
- `app/src/app/api/v1/projects/[id]/sections/[sectionId]/route.ts`
- `app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts`
- `app/src/app/api/v1/projects/[id]/sections/[sectionId]/export/route.ts`
- `app/src/app/api/v1/projects/[id]/export/route.ts`
- `app/tests/integration/sections-api.test.ts`
- `app/tests/integration/workspace.test.ts`

## 4. Re-Export Block Analysis (agent/types.ts)

17 symbols re-exported from `@/lib/ai/orchestrator/types` via `@/lib/ai/agent/types`:

```
STEP_LABELS, WorkflowContext, EnhancedIdea, MatchedCall, SectionVersion,
FreshnessProvenance, FreshnessResult, ActionPlan, UploadedFile, QAResult,
ProjectCompletionStatus, AgentResult, CheckpointData, SSEEvent,
SSEEventPayload, SSEStream, GatewayClient, AgentFn
```

**Per-symbol consumer sweep** (agent/types importers excluding self + `orchestrator/types.ts`):

| Symbol | Consumers via agent/types |
|---|---|
| All 17 symbols | **0** each |

**Decision:** drop entire re-export block. The block was a sed-redirect courtesy (sub-step (b) aligned `agent/types.ts` imports for `CallBlueprint` and `SectionSpec` by moving the definitions; the other 17 types remained in `orchestrator/types` and were re-exported to allow future importers a single canonical path, but no importer adopted them). They retire with sub-step (e).

Product-code importers of `@/lib/ai/orchestrator/types` directly remain (expected — sub-step (b) intentionally did not rewrite direct orchestrator/types imports because those types are still defined there; they move or delete in later sub-steps).

## 5. Final Probe

Zero external imports from the three retired paths:

```
$ grep -rn "from ['\"]@/lib/ai/orchestrator/\(workspace\|section-versions\|gateway\)" app/src app/tests
(none)

$ grep -rn "import(['\"]@/lib/ai/orchestrator/\(workspace\|section-versions\|gateway\)" app/src app/tests
(none)
```

Remaining `@/lib/ai/orchestrator/*` references in product code (excluding types, which retires separately):

```
app/src/lib/workspace.ts:9:import { persistAndPublishSectionUpdatedEvent } from '@/lib/ai/orchestrator/pubsub';
```

One link (`workspace.ts` → orchestrator `pubsub`). `pubsub.ts` is orchestrator-internal and retires with sub-step (e). This link will become a broken import at that point and must be resolved by (e) — either by moving `pubsub.ts` too, inlining its function into `workspace.ts`, or rewiring to a new home. Flagged for sub-step (e) planning.

## 6. Verification

- `tsc --noEmit`: **clean** (no errors)
- `next build`: **succeeds** (all routes compiled)
- `npm run test`: **177 files passed, 1045 tests passed, 15 skipped, 2 todo, 0 failed**

## 7. Rollback

Revert the four commits on `chore/decom-orchestrator-b2`. No schema, infra, or config changes.

Commits:
- `8121f92` refactor(ai): rehome gateway.ts
- `3a141aa` refactor(sections): rehome section-versions.ts
- `42a1e25` refactor(workspace): rehome workspace.ts
- `250497d` refactor(agent): drop pass-through re-exports
