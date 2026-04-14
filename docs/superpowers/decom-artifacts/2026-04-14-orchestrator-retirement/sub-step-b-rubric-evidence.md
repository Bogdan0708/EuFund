# Sub-step (b) — Rehome orchestrator-owned shared types and helpers

Plan: `docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md` sub-step (b).
Branch: `chore/decom-orchestrator-b`
Base: `origin/master` @ `32c6d49`

## 1. Ownership

The four type/helper groups are now canonically owned by `@/lib/ai/agent/`:

| Group | Identifiers | Canonical home |
|-------|-------------|----------------|
| 1 | `CallBlueprint`, `SectionSpec` | `@/lib/ai/agent/types` |
| 2 | `SectionResult` | `@/lib/ai/agent/types` |
| 3 | `SubmissionDocument`, `SubmissionDocumentProvenance` | `@/lib/ai/agent/types` |
| 4 | `DEFAULT_SECTIONS`, `buildSectionSpecs`, `compactPreviousSections` | `@/lib/ai/agent/section-specs` |

`@/lib/ai/orchestrator/types` retains a re-export shim for the four moved type identifiers, plus the canonical declarations of types **not** in scope for this sub-step (`WorkflowContext`, `EnhancedIdea`, `MatchedCall`, `ActionPlan`, `UploadedFile`, `QAResult`, `ProjectCompletionStatus`, `AgentResult`, `CheckpointData`, `SSEEvent`, `SSEEventPayload`, `SSEStream`, `GatewayClient`, `AgentFn`, `SectionVersion`, `FreshnessProvenance`, `FreshnessResult`, `STEP_LABELS`). Those will be addressed in subsequent decom sub-steps.

`@/lib/ai/orchestrator/section-specs` is a pure re-export shim retained because three orchestrator-internal files (`orchestrator/agents/build.ts`, `orchestrator/agents/research.ts`, `orchestrator/prompts/build-section.ts`) and `orchestrator/engine.ts` import it via relative paths (`./section-specs`, `../section-specs`). Modifying those files is sub-step (e)'s scope.

## 2. Reference sweep

External importers of the old paths (i.e., any source file outside `@/lib/ai/orchestrator/types.ts` and `@/lib/ai/agent/types.ts` itself):

```
$ rg -n "from ['\"]@/lib/ai/orchestrator/(types|section-specs)" app/src/ app/tests/
(no output — zero remaining)
```

Internal references (intentional — re-export plumbing only):

```
app/src/lib/ai/agent/types.ts:43:} from '@/lib/ai/orchestrator/types'
app/src/lib/ai/agent/types.ts:44:export { STEP_LABELS } from '@/lib/ai/orchestrator/types'
```

These are the agent-side re-exports of the non-moved orchestrator types listed in §1.

## 3. Build/typecheck/test

- `npm run typecheck`: PASS (zero errors)
- `npm run build`: PASS — production build completes; full route table emitted
- `npm run test`: PASS — `Test Files 191 passed | 5 skipped (196)`, `Tests 1123 passed | 15 skipped | 2 todo (1140)`. Matches master baseline of 1123 passing tests.

## 4. Flag/env

N/A — type definitions and section-spec helpers carry no runtime configuration.

## 5. Test-surface cleanup

Mechanical sed updates rewrote the import path from `@/lib/ai/orchestrator/types` (and `…/section-specs` — none in tests) to `@/lib/ai/agent/types`. Test files touched:

- `app/tests/unit/agent-build.test.ts`
- `app/tests/unit/agent-edit.test.ts`
- `app/tests/unit/agent-enhance.test.ts`
- `app/tests/unit/agent-match.test.ts`
- `app/tests/unit/agent-plan.test.ts`
- `app/tests/unit/agent-research.test.ts`
- `app/tests/unit/export-docx.test.ts`
- `app/tests/unit/orchestrator-qa.test.ts`
- `app/tests/unit/orchestrator-types.test.ts`
- `app/tests/unit/section-specs.test.ts`
- `app/tests/unit/services/blueprint.test.ts`

No test logic was changed; only the import path. All tests still pass.

## 6. Migration diff

Per group, identifiers moved (declaration relocated from `@/lib/ai/orchestrator/types` or `…/section-specs` to `@/lib/ai/agent/types` or `…/section-specs`):

- **Group 1 (commit `2a34700`):** `CallBlueprint`, `SectionSpec`
- **Group 2 (commit `f7a5132`):** `SectionResult`
- **Group 3 (commit `24f4913`):** `SubmissionDocument`, `SubmissionDocumentProvenance` (transitive dependency)
- **Group 4 (commit `f36635c`):** `DEFAULT_SECTIONS`, `buildSectionSpecs`, `compactPreviousSections`
- **Importer redirect (commit `7d42bac`):** mechanical sed across 31 files (test + src) plus an additive re-export block in `agent/types.ts` for non-moved orchestrator types so consumers can use a single canonical import path.

Structural identity is preserved — every moved declaration is byte-for-byte identical to its previous form (verified by git diff: the source file removed exactly the lines the target file added).

## 7. Observability

N/A — no telemetry surfaces are introduced or modified by type-definition relocation.
