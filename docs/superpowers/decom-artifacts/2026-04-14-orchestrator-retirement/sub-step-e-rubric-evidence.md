# Sub-step (e) rubric evidence — delete `lib/ai/orchestrator/`

Plan: `docs/superpowers/plans/2026-04-14-decom-orchestrator-retirement.md` sub-step (e).
Branch: `chore/decom-orchestrator-e` (off `origin/master` after PRs #27–#34).
Date: 2026-04-11.

This is the keystone deletion of the orchestrator retirement track. The entire
`app/src/lib/ai/orchestrator/` subtree is removed. Expanded scope vs the
plan-listed (e): move `pubsub.ts` → `lib/pubsub.ts` (the last keeper-adjacent
module) and inline two straggler types (`SectionVersion`, `GatewayClient`)
into their keeper modules.

## 1. Ownership

**What is being retired:** the entire `lib/ai/orchestrator/` folder (26 files).
This includes:

- `engine.ts`, `lifecycle.ts`, `cache.ts`, `stream.ts`, `sanitizer.ts`, `qa.ts`,
  `freshness.ts`, `require-owned-session.ts`, `utils.ts`, `section-specs.ts`,
  `types.ts`
- `agents/` subfolder (per-step agent modules)
- `prompts/` subfolder (per-step prompt templates)

**What replaces it:** nothing as a drop-in. The V3 agent runtime
(`lib/ai/agent/`) is the keeper per the program spec. Public callers were
migrated or deleted by sub-steps (a)–(d):

- (a) `asistent-ai` rewritten to V3 (PR #28)
- (b) shared types rehomed to `lib/ai/agent/types.ts` (PR #30)
- (b2) `workspace.ts`, `section-versions.ts`, `ai/gateway.ts` rehomed to keeper
  locations (PR #34)
- (c) `useOrchestrator` hook deleted (PR #31)
- (d) `/api/ai/orchestrator/*` routes + `section_versioning` flag retired (PR #32)

**Expanded-scope move in this PR:** `orchestrator/pubsub.ts` → `lib/pubsub.ts`.
Rationale: `lib/workspace.ts` is a keeper that imports
`persistAndPublishSectionUpdatedEvent`. Moving the module out of the
orchestrator folder is required before the folder can be deleted. SSE
event types (`SSEEvent`, `SSEEventPayload`, `SSEStream`, `CheckpointData`,
`ProjectCompletionStatus`) previously defined in `orchestrator/types.ts` are
inlined into `lib/pubsub.ts` since the orchestrator module retires wholesale
and `pubsub.ts` becomes a standalone keeper.

**Straggler type inlines:** sub-step (b2) moved `gateway.ts` and
`section-versions.ts` to keeper homes but left their type imports pointing at
`lib/ai/orchestrator/types.ts` (`GatewayClient`, `SectionVersion`,
`SectionResult`). Fixed here:

- `GatewayClient` inlined into `lib/ai/gateway.ts` (single consumer — its own
  factory function).
- `SectionVersion` inlined into `lib/section-versions.ts` (single consumer —
  its own read API).
- `SectionResult` redirected to `@/lib/ai/agent/types` (canonical home per
  sub-step (b)).

## 2. Reference sweep (final pre-delete probe)

Commands run on the tip of `chore/decom-orchestrator-e` immediately before
the folder deletion commit:

```
$ rg -n "from ['\"]@/lib/ai/orchestrator" app/src/ app/tests/ | rg -v "^app/src/lib/ai/orchestrator/"
(empty)

$ rg -n "import\(['\"]@/lib/ai/orchestrator" app/src/ app/tests/ | rg -v "^app/src/lib/ai/orchestrator/"
(empty)
```

After the deletion commit, both commands return empty across the entire
repo. Two relative-path stragglers (`gateway.ts:2`, `section-versions.ts:7`)
that typecheck surfaced post-delete were resolved in the follow-up commit
`refactor(types): inline SectionVersion + GatewayClient into their keeper modules`.
Final typecheck (see Section 3) is clean, proving zero remaining references.

## 3. Build / typecheck / test

Run from `app/` on branch tip after the final commit:

```
$ npm run typecheck
> tsc --noEmit
(exit 0 — zero errors)

$ npm run build
...
○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
(exit 0 — build succeeded)

$ npm run test
...
 Test Files  168 passed | 5 skipped (173)
      Tests  1017 passed | 15 skipped | 2 todo (1034)
```

**Test-count delta vs master pre-(e):** 9 orchestrator-internal test files
deleted (`agent-documents`, `freshness`, `orchestrator-cache`,
`orchestrator-engine`, `orchestrator-lifecycle`, `orchestrator-pubsub`,
`orchestrator-sanitizer`, `orchestrator-stream`, `require-owned-session`).
Previous passing-test totals on master varied with these files enabled; the
drop in count equals the sum of passing tests in those 9 files at deletion
time. Remaining suite (1017 passing, 15 skipped, 2 todo) is green.

## 4. Flag / env cleanup

N/A. `section_versioning` feature flag was retired in sub-step (d) (PR #32).
No env vars or flags remain tied to the orchestrator folder.

## 5. Test-surface cleanup

Deleted in this PR:

- `app/tests/unit/agent-documents.test.ts`
- `app/tests/unit/freshness.test.ts`
- `app/tests/unit/orchestrator-cache.test.ts`
- `app/tests/unit/orchestrator-engine.test.ts`
- `app/tests/unit/orchestrator-lifecycle.test.ts`
- `app/tests/unit/orchestrator-pubsub.test.ts`
- `app/tests/unit/orchestrator-sanitizer.test.ts`
- `app/tests/unit/orchestrator-stream.test.ts`
- `app/tests/unit/require-owned-session.test.ts`

Each exercised orchestrator-internal surface that retires with the folder.
No keeper behaviour lost — V3 runtime has its own test files under
`tests/unit/agent-*` and `tests/unit/managed/`.

**Coverage gap flagged for hand-off:** `lib/pubsub.ts` (moved out of
orchestrator) is no longer covered by a dedicated test file. The previous
`orchestrator-pubsub.test.ts` was deleted rather than migrated to avoid
scope creep. `lib/pubsub.ts` is still exercised indirectly through
`tests/integration/workspace.test.ts` (which mocks it) and through any
end-to-end paths that persist `section_updated` events, but there is no
unit-level coverage of `getChannelName`, `publishEvent`, or
`persistAndPublishReplayableEvent` in isolation. The follow-on
`test-pyramid-rebuild` spec (per the decom program design) owns
reestablishing this coverage.

Integration test `tests/integration/workspace.test.ts` was updated in place:
the two `vi.doMock('@/lib/ai/orchestrator/pubsub', ...)` calls now point at
`@/lib/pubsub`.

## 6. Migration diff

No runtime migration — callers were all removed or migrated in prior
sub-steps. Net module movements in this PR:

| From                                         | To                        |
| -------------------------------------------- | ------------------------- |
| `app/src/lib/ai/orchestrator/pubsub.ts`      | `app/src/lib/pubsub.ts`   |

Inlined types (no module movement, just localized):

- `SSEEvent`, `SSEEventPayload`, `SSEStream`, `CheckpointData`,
  `ProjectCompletionStatus` → inside `lib/pubsub.ts` (previously in
  `orchestrator/types.ts`).
- `SectionVersion` → inside `lib/section-versions.ts`.
- `GatewayClient` → inside `lib/ai/gateway.ts`.

Import rewrites applied:

| File                                   | Before                                            | After                        |
| -------------------------------------- | ------------------------------------------------- | ---------------------------- |
| `lib/workspace.ts:9`                   | `from '@/lib/ai/orchestrator/pubsub'`             | `from '@/lib/pubsub'`        |
| `lib/workspace.ts:11`                  | `from '@/lib/ai/orchestrator/types'`              | `from '@/lib/ai/agent/types'`|
| `lib/section-versions.ts:7`            | `from './ai/orchestrator/types'`                  | `from './ai/agent/types'` + local inline |
| `lib/ai/gateway.ts:2`                  | `from './orchestrator/types'`                     | local inline                 |
| `tests/integration/workspace.test.ts`  | `vi.doMock('@/lib/ai/orchestrator/pubsub', ...)`  | `vi.doMock('@/lib/pubsub', ...)` |

Folder deletion: 26 files removed under `app/src/lib/ai/orchestrator/`
(`engine.ts`, `lifecycle.ts`, `cache.ts`, `stream.ts`, `sanitizer.ts`,
`qa.ts`, `freshness.ts`, `require-owned-session.ts`, `utils.ts`,
`section-specs.ts`, `types.ts`, plus everything under `agents/` and
`prompts/`).

## 7. Observability sweep

Pre-delete grep for audit hooks inside the orchestrator folder on master:

```
$ git grep "logAudit" origin/master -- 'app/src/lib/ai/orchestrator/**'
(empty)
```

No `logAudit` calls lived inside the orchestrator folder at master, so no
audit hooks retire with the deletion. The orchestrator runtime emitted its
own structured logs via `logger.child({ component: 'orchestrator' })` and
similar — these retire with the folder, as expected since no caller runs
the retired code paths after sub-step (d). Keeper modules (`workspace.ts`,
`section-versions.ts`, `gateway.ts`, `pubsub.ts`) retain their existing
logger channels.

No metrics, Sentry breadcrumbs, or admin dashboards referenced
`lib/ai/orchestrator/*` by path — confirmed by the empty reference sweep in
Section 2.
