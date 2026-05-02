# Session-to-Project Promotion — Design Spec

**Date:** 2026-05-02
**Status:** Draft (awaiting plan)
**Related:** `2026-04-18-deterministic-preselect-design.md`, `2026-04-29-ai-flow-stability-pr1-design.md`

## Problem

Project drafts started via the new agent flow are invisible. The deterministic-preselect path
and the V3 `setSelectedCall` mutation create or mutate `agent_sessions` rows without ever creating
a corresponding `projects` row, while `/proiecte`, `/api/v1/projects/*`, the export pipeline, the
compliance subsystem, MySMIS export, and the file/work-package surfaces all read strictly from
`projects`. As of 2026-05-02:

- 11 of 26 active sessions have a non-null `selectedCallId` and a null `projectId` (the rest are
  pre-commitment, in discovery).
- 0 sessions have `agent_sessions.projectId` populated.
- The `agent_sessions.projectId → projects.id` FK exists (schema.ts:883, `onDelete: 'set null'`)
  but is never written.
- Inspection of the 11 promotable orphans shows every `selectedCallId` is either a SHA-shaped
  Qdrant point sourceId or a smoke-test fixture label; none currently resolve to a row in
  `calls_for_proposals` by `id`, `call_code`, or `external_id`.

End-to-end project completions over the last month: zero.

## Mental Model

A `projects` row is **the canonical project shell**. It owns org context, title, lifecycle status,
and is what every existing downstream subsystem (compliance, export, MySMIS, files, work packages,
comments, versions, project_documents) reads from. An `agent_session` is **an AI drafting workspace
attached to a project** via `agent_sessions.projectId`. One project may have N sessions over time
(resumes, re-runs, retries); one session belongs to at most one project.

The forward path is for accepted/finalized `agent_sections` content to be synced into
`project_documents` snapshots so the existing `resolveProjectWorkspace` / Sections tab / export
pipeline keeps working unchanged. **That sync is out of scope for this PR** — see Follow-ups.

## PR Scope

Minimum viable promotion only:

1. Create or link a draft `projects` row whenever a session commits to a call. Trigger sites:
   - `initializeSession` paths: rank+select and confirm-new (preselect)
   - `setSelectedCall` paths: override-rerank, confirm-override, V3 tool calls
   - The idempotent same-callId path inside `setSelectedCall` when `projectId` is still null
2. Backfill the 11 promotable orphans via the same code path used live.
3. Surface `projectId` in preselect responses and in the `setSelectedCall` return shape so the
   client can link/route.
4. Detect a call change on an already-linked session and **sync** `projects.callId` + the
   call-related metadata fields (no title rewrite).

Out of scope (each tracked in Follow-ups, not as code TODOs):

- Teaching `resolveProjectWorkspace` / `/api/v1/projects/[id]/sections` to read from
  `agent_sections` (Sections tab continues to read workflow_sessions/snapshots only).
- Syncing accepted `agent_sections` into `project_documents` snapshots.
- Hiding agent sessions whose linked project is soft-deleted (filter on
  `projects.deletedAt IS NULL`) from the user-facing inbox query.
- Inline title rename UI on the detail page.

## Naming Conventions (B-oriented)

- Helper: `ensureProjectForSession`
- Title helper: `deriveProjectTitle`
- Org resolver (extracted): `resolveProjectOrgIdInTx`
- Audit action: `project.promoted_from_session` — must be added to the `AuditAction` union
  in `app/src/lib/legal/audit.ts` (under the `// Project` group); the project.* prefix means
  `inferLegalBasis` resolves to `contract` basis with no new branch needed there
- Project metadata keys (merged onto existing metadata, never replacing it):
  - `agentSessionId: string`
  - `rawSelectedCallId: string`
  - `resolvedCallTitle: string | null`
  - `selectedCallResolution: 'id' | 'callCode' | 'externalId' | 'unresolved'`
  - `titleSource: 'description' | 'messageSummary' | 'fallback'` (set on initial promotion only)
  - `promotedAt: ISO8601 string` (set on initial promotion only; not bumped on call-resync)

## Module Layout

```
app/src/lib/projects/
├── promotion.ts          NEW — ensureProjectForSession, deriveProjectTitle, resolveCall
└── org-resolver.ts       NEW — resolveProjectOrgIdInTx (extracted from projects route)

app/src/app/api/v1/projects/route.ts            MODIFIED — imports from org-resolver
app/src/lib/ai/agent/services/preselect.ts      MODIFIED — calls ensureProjectForSession after insert
app/src/lib/ai/agent/services/application.ts    MODIFIED — calls ensureProjectForSession after CAS;
                                                            tightened idempotent branch
app/src/app/api/v1/projects/preselect/route.ts  MODIFIED — forwards projectId in JSON responses
app/src/lib/preselect/client.ts                 MODIFIED — projectId on PreselectResponse
app/src/lib/monitoring/metrics.ts               MODIFIED — register project_promotion_total
app/src/lib/legal/audit.ts                      MODIFIED — add 'project.promoted_from_session'
                                                            to the AuditAction type union

app/scripts/backfill-session-projects.ts        NEW — one-shot dry-run/confirm script
```

## Helper Contract

```ts
// app/src/lib/projects/promotion.ts

export type CallResolution = 'id' | 'callCode' | 'externalId' | 'unresolved'
export type TitleSource    = 'description' | 'messageSummary' | 'fallback'

export type PromotionResult =
  | { promoted: true;  projectId: string; created: true;  titleSource: TitleSource;
      selectedCallResolution: CallResolution }
  | { promoted: true;  projectId: string; created: false; synced: boolean }
  | { promoted: false; reason: 'NO_SELECTED_CALL' | 'USER_NOT_FOUND' | 'SESSION_NOT_FOUND' }

export interface EnsureOpts { dryRun?: boolean }

export async function ensureProjectForSession(
  ctx: ServiceContext,             // existing { userId, sessionId?, requestId, now } —
                                   // requestId and now are REQUIRED on ServiceContext
                                   // (lib/ai/agent/services/types.ts:16)
  sessionId: string,
  opts?: EnsureOpts,
): Promise<PromotionResult>
```

Locale comes from the locked `agent_sessions.locale` column; **`ServiceContext` is not extended**.

## Transaction Shape

All steps run inside `withUserRLS(ctx.userId, async tx => …)`. `withUserRLS` is the existing
single-statement RLS-bound transaction wrapper (db/index.ts:57-65). Returning normally commits;
throwing rolls back.

```
1. SELECT id, user_id, project_id, selected_call_id, locale, message_summary, planning_artifact
   FROM agent_sessions
   WHERE id = $sid AND user_id = $userId
   FOR UPDATE
   • Not found → return { promoted: false, reason: 'SESSION_NOT_FOUND' }
   • projectId IS NULL    AND selectedCallId IS NULL → return { promoted: false, reason: 'NO_SELECTED_CALL' }
   • projectId IS NOT NULL                           → branch into "already linked" (step A)
   • else                                            → branch into "fresh promotion" (step B)

   The explicit user_id predicate is defensive belt-and-suspenders — RLS already enforces
   ownership but keeping the predicate in the SELECT makes the invariant obvious to readers.

A. ALREADY LINKED branch:
   A1. SELECT id, metadata, call_id FROM projects WHERE id = $projectId FOR UPDATE
       (Lock the project row to serialize concurrent setSelectedCall→sync calls.)
   A2. Compare session.selectedCallId vs project.metadata.rawSelectedCallId.
       • Equal           → return { promoted: true, projectId, created: false, synced: false }
       • rawSelectedCallId missing on the project metadata (e.g., the project predates
         promotion or was linked by some other code path) → treat as a sync to populate
         the metadata; fall through to the Different branch below.
       • Different       → call resolveCall (step B3 logic) and update:
           UPDATE projects
              SET call_id  = $newResolvedCallId,           -- nullable
                  metadata = $existingMetadata MERGED WITH {
                    agentSessionId, rawSelectedCallId, resolvedCallTitle,
                    selectedCallResolution
                  },                                       -- promotedAt left untouched
                  updated_at = now()
              WHERE id = $projectId
       Schedule audit kind: 'call_resynced'.
       Return { promoted: true, projectId, created: false, synced: true }.

B. FRESH PROMOTION branch:
   B1. Defensive user existence check (cheap; RLS may hide a row but FK guarantees existence
       when DB state is consistent — backfill skips this row instead of failing the script).
       SELECT 1 FROM users WHERE id = $userId LIMIT 1
       • Missing → return { promoted: false, reason: 'USER_NOT_FOUND' }
   B2. Resolve org via resolveProjectOrgIdInTx(tx, $userId).
       (May INSERT a Personal Workspace organization + admin org_member; matches existing
       behavior in POST /api/v1/projects.)
   B3. Resolve call (three-prong probe against calls_for_proposals):
       a. If selectedCallId matches UUID_RE:
            SELECT id, title_ro FROM calls_for_proposals WHERE id = $selectedCallId LIMIT 1
            (resolution='id' on hit)
       b. Else / on miss:
            SELECT id, title_ro FROM calls_for_proposals WHERE call_code = $selectedCallId LIMIT 1
            (resolution='callCode' on hit; column has a global UNIQUE index)
       c. Else / on miss:
            SELECT id, title_ro FROM calls_for_proposals WHERE external_id = $selectedCallId LIMIT 2
            • If exactly 1 → resolution='externalId'
            • If 0         → resolution='unresolved', resolvedCallId=null
            • If 2         → resolution='unresolved', resolvedCallId=null
              (external_id is unique only per source_connector_id, NOT globally — see
              schema.ts:301. Linking the wrong FK would be silently corrupting; refusing
              to link is the safe default.)
   B4. Derive title via deriveProjectTitle(session, locale):
       • description    := planningArtifact.preselect.description (when present and len ≥
                           MIN_DESCRIPTION_LENGTH after normalize) → normalize+truncate(120)
       • messageSummary := session.messageSummary  (when description missing/short)
       • fallback       := locale === 'en'
                              ? `Untitled project — ${selectedCallId.slice(0,12)}`
                              : `Proiect nou — ${selectedCallId.slice(0,12)}`
       Returns { title, source }.
   B5. INSERT INTO projects (
         org_id, user_id, call_id, created_by, title, status, current_version, metadata
       ) VALUES (
         $orgId, $userId, $resolvedCallId-or-null, $userId, $title, 'ciorna', 1,
         {
           agentSessionId, rawSelectedCallId, resolvedCallTitle, titleSource,
           selectedCallResolution, promotedAt: $now
         }
       ) RETURNING id
   B6. UPDATE agent_sessions SET project_id = $newProjectId, updated_at = now() WHERE id = $sid
       (No CAS on stateVersion — promotion does not change the agent's logical state, and the
       FOR UPDATE lock on this same row already serializes any racing promoter.)
       Schedule audit kind: 'promoted'.
       Return { promoted: true, projectId, created: true, titleSource, selectedCallResolution }.

8. If opts.dryRun === true, throw `new DryRunRollback(result)` to roll back the tx while
   carrying the would-be result through the catch outside withUserRLS. Otherwise return normally
   and the tx commits.

9. Outside the transaction, only on commit: replay the scheduled audit entries via logAudit().
   Same pattern as editProjectSection (workspace.ts:340-356) — collect pendingAudits inside the
   tx, replay after commit. Dry-run never reaches this seam.
```

`DryRunRollback` is a small custom error class in `promotion.ts`:

```ts
class DryRunRollback<T> extends Error {
  constructor(public readonly carried: T) { super('dry-run rollback') }
}
```

The outer wrapper:

```ts
try {
  return await withUserRLS(ctx.userId, async tx => { /* steps 1–8 */ })
} catch (e) {
  if (e instanceof DryRunRollback) return e.carried as PromotionResult
  throw e
}
```

## `resolveProjectOrgIdInTx`

Extracted from `app/src/app/api/v1/projects/route.ts:18-68`. Signature:

```ts
export async function resolveProjectOrgIdInTx(
  tx: DbTransaction,
  userId: string,
  requestedOrgId?: string,
): Promise<string>
```

Identical logic to today's `resolveProjectOrgId` — preferred org passed through, single-membership
shortcut, zero-membership auto-creates a Personal Workspace + admin org_member, multi-membership
without explicit `requestedOrgId` throws `FondEUError(CONFLICT)`. The route's existing
`resolveProjectOrgId` becomes a thin `withUserRLS(userId, tx => resolveProjectOrgIdInTx(tx, userId, requestedOrgId))`
wrapper so behavior is unchanged for the existing POST route. **Critical invariant: dry-run
rollback must undo Personal Workspace creation**, which is only possible because the helper now
runs inside the caller's transaction instead of opening its own.

## Trigger Site Integration

### `initializeSession` (preselect.ts)

After the `agentSessions` insert at line 163-172 and before the audit at line 174:

- Add `requestId: string` to `InitializeSessionParams`. The route already generates one
  (preselect/route.ts:166, 209, 254, 304); thread it through.
- Build `ServiceContext { userId, sessionId: row.id, requestId, now: new Date() }`.
- `try { await ensureProjectForSession(ctx, row.id) } catch (e) { log.error(...) }` — promotion
  failure must not unwind the session, which is already committed. The session-init audit still
  fires.
- Extend `InitializeSessionResult` to `{ sessionId, phase, blueprintKind, projectId: string | null }`.
  Read `projectId` from the helper's return (use `null` on promoted=false or thrown).
- Route forwards `projectId` in its JSON response (rank+select branch and confirm-new branch).

### `setSelectedCall` (application.ts:572-627)

Reshape into three explicit branches after the ownership + concurrency checks:

```
1. verifySessionOwnership                           (unchanged)
2. concurrency check (stateVersion CAS)             (unchanged)
3. THREE-WAY BRANCH on input.callId vs session:
   • selectedCallId === input.callId AND projectId IS NOT NULL
       → true no-op. Return { newStateVersion: session.stateVersion, projectId: session.projectId }.
   • selectedCallId === input.callId AND projectId IS NULL
       → SKIP policy gate, SKIP CAS update, SKIP audit. Call ensureProjectForSession.
         Return { newStateVersion: session.stateVersion, projectId: result.projectId-or-null }.
         Works even when outline is frozen (no logical reselection is happening).
   • selectedCallId !== input.callId
       → Existing flow: assertPolicy, CAS update, audit.
         Then call ensureProjectForSession (which sees projectId either null → fresh promotion,
         or non-null with changed callId → call-resync branch).
         Return { newStateVersion, projectId: result.projectId-or-null }.
```

Promotion is wrapped in try/catch in all three branches — failure logs but does not throw to the
caller. Return shape extension `{ newStateVersion: number; projectId: string | null }` is
forward-compatible (additive).

**Layer-rule note** at the new import site:

```ts
// LAYER NOTE: lib/projects/promotion is an intentional downstream dependency of this
// service — promotion is the post-commit hook for setSelectedCall and runs after the
// agent state mutation lands. Future cleanup of service dependencies should preserve this.
import { ensureProjectForSession } from '@/lib/projects/promotion'
```

Two callers of `setSelectedCall` in `preselect/route.ts` (override-confirm at line 178,
override-rerank at line 271) get updated to forward the new `projectId` field in their JSON
responses.

## Public Response & Type Changes

| Surface | Before | After |
|---|---|---|
| Preselect HTTP response (all 4 selected branches) | `{ kind:'selected', sessionId, selectedCallId, candidates, blueprintKind?, phase? }` | `+ projectId: string \| null` |
| `lib/preselect/client.ts` `PreselectResponse.selected` | as above | `+ projectId?: string \| null` |
| `setSelectedCall` return | `{ newStateVersion: number }` | `{ newStateVersion: number; projectId: string \| null }` |
| `InitializeSessionResult` | `{ sessionId, phase, blueprintKind }` | `+ projectId: string \| null` |
| `InitializeSessionParams` | (no requestId) | `+ requestId: string` |

`null` projectId means promotion was attempted but failed (logged on the server). Clients fall
back gracefully — the resume flow already routes by `sessionId`, not `projectId`.

## Backfill Script

Path: `app/scripts/backfill-session-projects.ts`. Modeled on the `direct-ingest-guides.ts` flag
pattern (CLAUDE.md emergency-script category).

**Behavior.**
- Default mode: **dry-run**. `--confirm` required to write.
- `--limit N` for staged rollout (default: no limit).
- Refuses to run without `DATABASE_URL` set (process exit nonzero on missing env).
- Candidate query (single SELECT, ordered by `created_at` for stable, replay-safe output):
  ```sql
  SELECT s.id, s.user_id, s.selected_call_id, s.locale, s.created_at,
         (u.id IS NOT NULL) AS user_exists
  FROM agent_sessions s
  LEFT JOIN users u ON u.id = s.user_id
  WHERE s.project_id IS NULL AND s.selected_call_id IS NOT NULL
  ORDER BY s.created_at;
  ```
- For each row:
  - If `!user_exists` → tally as `skippedMissingUser`, skip. (Belt-and-suspenders: the FK
    `agent_sessions.user_id → users.id` makes this state nominally unreachable, but the
    runtime check defends against future schema drift, post-incident states, and direct DB
    surgery. The branch is exercised at the unit level via mocks, not via fixtures that would
    violate the FK.)
  - Else: build `ServiceContext { userId, sessionId, requestId: crypto.randomUUID(), now }`
    and call `ensureProjectForSession(ctx, sessionId, { dryRun: !args.confirm })`.
  - Wrap each row in its own try/catch — failures don't poison the rest. Any caught error
    flips the script's exit code to nonzero.
- Per-row output: compact one-liner — `sessionId | userId | rawSelectedCallId | resolution |
  titleSource | outcome`.
- Summary footer: `promoted: N, alreadyLinked: N, syncedCall: N, skippedNoSelectedCall: N,
  skippedMissingUser: N, failed: N`.

**Local commands** (matching the project's existing tsx invocation pattern; package.json gets a
`script:backfill-session-projects` entry):

```bash
# Dry-run (default; safe to run any time)
npm run script:backfill-session-projects

# Apply
npm run script:backfill-session-projects -- --confirm
```

**Dry-run mechanics caveat (called out in `--help`).** Personal Workspace org creation may
appear to "happen" during dry-run (the helper takes the same code path), but the rollback
sentinel undoes all writes. Operators see no row in `organizations` and no audit-log entry
afterwards — this is correct behavior, not a silent failure.

## Observability

**Audit (post-commit).**

```ts
logAudit({
  userId: ctx.userId,
  action: 'project.promoted_from_session',
  resourceType: 'project',
  resourceId: $newProjectId,
  metadata: {
    agentSessionId: $sid,
    rawSelectedCallId,
    resolvedCallId: $resolvedCallId-or-null,
    selectedCallResolution,
    titleSource,                                       // 'promoted' kind only
    kind: 'promoted' | 'call_resynced',
    requestId: ctx.requestId,
  },
})
```

DryRunRollback path skips the audit collection seam naturally — sentinel is thrown before the
post-commit replay.

**Logging.** New child logger `logger.child({ component: 'project-promotion' })`.
- `info` on every successful outcome (promoted / synced / already-linked-no-op).
- `warn` on the three not-promotable returns.
- `error` on caught infra exceptions inside the live trigger sites' try/catch.

**Metrics.** Register at module load in `lib/monitoring/metrics.ts`:

```ts
metrics.counter('project_promotion_total', 'Session-to-project promotion outcomes');

export function trackProjectPromotion(
  outcome: 'promoted' | 'already_linked' | 'synced'
         | 'no_selected_call' | 'user_missing' | 'session_missing' | 'failed',
): void {
  metrics.inc('project_promotion_total', { outcome });
}
```

Single low-cardinality `outcome` label. **Tracked only on committed helper outcomes** — the
helper invokes `trackProjectPromotion(...)` after a normal return (i.e., the path that ran
through to commit), but **not** when the carried result is delivered via `DryRunRollback`.
Operator dry-runs print outcomes to the script's stdout for inspection but must not pollute
production counters scraped to dashboards/alerts. The live trigger sites and the backfill
script invoke `trackProjectPromotion('failed')` from their own try/catch on infra exceptions.

## Test Plan

**Unit.**
- `deriveProjectTitle`: four-step fallback exhaustively (description present, description short,
  description absent + messageSummary present, both absent → fallback for ro and en).
- Call resolver: each prong (UUID/callCode/externalId), miss path, **externalId LIMIT 2 → unresolved**.
- `resolveProjectOrgIdInTx`: 0/1/many membership cases, explicit `requestedOrgId` short-circuit.
- DryRunRollback wrapping: thrown inside tx, carried result preserved across catch.

**Integration (Vitest, real Postgres in test container or shared dev DB).**
- `ensureProjectForSession`:
  - Fresh promotion: session with selectedCallId, no project → project row created, agent_session
    linked, audit emitted, metrics incremented.
  - Already-linked no-op: same callId in session metadata → returns synced=false, no DB writes,
    no audit.
  - Call-change sync: callId differs → `projects.callId` and call metadata updated, title
    untouched, `updated_at` bumped, audit emitted with `kind: 'call_resynced'`.
  - No selected call: returns `NO_SELECTED_CALL`, no writes.
  - Session missing: returns `SESSION_NOT_FOUND`, no writes.
  - Race-loser: two concurrent FOR UPDATE waiters → second sees the first's projectId, returns
    already-linked.
  - Dry-run: full happy-path in dryRun mode → no rows in projects, organizations, or audit_log
    after; the project_promotion_total counter is also unchanged; result still describes what
    would have happened.
- `initializeSession`: returns projectId; failed promotion does not unwind the session insert.
- `setSelectedCall` three-branch matrix:
  - same callId + linked → no-op return
  - same callId + unlinked → promotion runs, no CAS bump, no audit (works under outline-frozen)
  - different callId + unlinked → fresh promotion via the standard CAS+audit path
  - different callId + linked → CAS+audit + call-resync via the helper

**Script.**
- Vitest covering the script's outcome tally against a seeded fixture (3 promotable + 1 already
  linked + 1 no-selected-call); missing-user tally tested via a mocked helper invocation rather
  than a FK-violating fixture.
- Exit code: 0 on all-success/dry-run, nonzero if any row failed.

**Contract.**
- One Vitest covering the preselect HTTP response shape (`projectId` present in all four selected
  branches; null vs string).

**Out of scope for tests.**
- Sections-tab read path (unchanged — covered by existing tests).
- E2E browser flow — would just verify the existing `/proiecte` list query, which already works
  the moment a `projects` row exists.

## Migration

No schema changes. The `agent_sessions.projectId` column already exists (schema.ts:883). No new
indexes — existing `idx_projects_org`, `idx_projects_call`, and the agent_sessions indexes are
sufficient for the read patterns this PR introduces.

## Rollout

- All changes are additive and feature-flag-free. The trigger sites' new behavior is gated only
  by the existence of `selected_call_id` on the session — there is no off switch.
- Backfill is operator-driven (manual script run after PR merges to master).
- If the helper raises infra errors at scale, both live trigger sites are wrapped in try/catch
  so the worst-case behavior is "silent regression to today's broken state, with error logs and
  `outcome='failed'` metric counter increments to detect it."

## Concurrency Analysis

The only race surface is two writers attempting to promote the same session simultaneously:

- Two concurrent `setSelectedCall` calls with same callId + null projectId: both reach
  `ensureProjectForSession`. First takes FOR UPDATE on `agent_sessions.id`, completes promotion,
  commits. Second blocks at FOR UPDATE, then sees projectId is non-null, returns
  already-linked / synced=false.
- One `setSelectedCall` racing with the post-commit promotion call from `initializeSession` is
  not actually possible — `initializeSession` runs at session-create time, before any
  `setSelectedCall` can be invoked.
- Backfill racing with a live trigger: same story — first holds FOR UPDATE, second sees the
  result and returns already-linked.
- Call-change sync against another sync: FOR UPDATE on the project row itself (step A1) serializes.

No advisory locks, no CAS retries, no compensating actions. The cost is per-session
serialization during promotion, which fires at most a few times in any session's lifetime.

## Soft-Delete Behavior (Spec Note, Not Implemented Here)

`projects.deletedAt IS NOT NULL` does **not** cascade or null `agent_sessions.projectId`. This
PR makes no change to delete semantics. The follow-up that hides agent sessions whose linked
project is soft-deleted should:

- Filter `/api/ai/agent/sessions` (sessions/route.ts) on `LEFT JOIN projects WHERE
  projects.deletedAt IS NULL` for the standard list query.
- Allow direct-by-sessionId resume to bypass the filter (so support / recovery flows still work).
- `projects.deletedAt` is set; `agent_sessions.projectId` stays populated; the user just loses
  the session from their inbox. Hard delete (admin-only) still nulls it via the existing FK
  ON DELETE behavior.

## Follow-ups

1. **Section sync.** Teach `resolveProjectWorkspace` (workspace.ts:73) to read from
   `agent_sections` when the project has a linked `agent_sessions.id`. Or: add a sync step to
   `application.ts` that mirrors accepted `agent_sections` content into a `project_documents`
   snapshot when a section transitions to `accepted`.
2. **Soft-delete filter.** As above — filter agent inbox by `projects.deletedAt IS NULL`,
   bypass when querying by sessionId directly.
3. **Title rename UI.** Inline rename on `/proiecte/[id]`. The PUT endpoint already supports
   title updates (route.ts:129).
4. **Auto-acronym derivation.** Optional: derive `projects.acronym` from the title at promotion
   time (first letters of capitalized words, capped at 50 chars). Keeping null for now — user
   can edit later.
5. **Workflow_sessions retirement.** With the section-sync follow-up, the legacy
   `workflow_sessions` table becomes a vestigial read path. Plan a separate decommissioning PR.

## Open Questions

None remaining. All design decisions surfaced during brainstorming have been resolved (see
brainstorming transcript 2026-05-02).
