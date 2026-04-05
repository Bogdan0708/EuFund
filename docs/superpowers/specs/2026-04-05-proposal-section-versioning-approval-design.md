# Proposal section versioning + approval — Phase 1 design

**Date:** 2026-04-05
**Status:** Draft — awaiting user approval before planning
**Scope:** One phase of a three-phase effort to turn the AI-generated proposal output into a trustworthy, compliant, submittable artifact. See "Relationship to later phases" at the bottom.

---

## 1. Context and motivation

The current Proposal tab (`app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx:408`) displays `SectionResult[]` from `workflow_sessions.context.projectSections` as stacked read-only cards with `max-h-48` inner scroll. The only interactive affordances are "Improve section" and "Regenerate section", both of which post a chat message to the orchestrator. There is no history, no approval state, no rollback, no way to know which sections the user has signed off on, and no way to recover from a bad regeneration.

For users preparing EU funding applications, the output screen needs to function as a **trust surface**: they have to be able to read something, decide it is correct, mark it as correct, and later prove they made that decision. The current model has none of that infrastructure.

This spec defines the data model, state machine, engine changes, API surface, and UI changes required to make each proposal section versioned and approvable. It is the first of three phases; Phase 2 builds compliance overlay on top of versioned sections, Phase 3 builds MySMIS-compliant export on top of approved versions.

## 2. Phase 1 scope

**In scope:**
- Per-section version history, append-only, hash-chained.
- Per-section review state machine: `draft` → `reviewed` → `approved`.
- Rollback a section to any previous version (creates a new version, resets state).
- Regeneration of an approved section auto-resets state to `draft`.
- Failed sections (`source === 'failed'`) are blocked from `reviewed` / `approved` transitions.
- Audit log entries for every state transition and every version creation, using the existing SHA-256 hash chain in `@/lib/legal/audit`.
- UI: progress header, state-aware section cards, inline history expansion with diff view, rollback confirmation.
- Feature flag gate (`section_versioning`) for safe rollout.

**Out of scope** (each explicitly decided during brainstorming):
- Whole-proposal snapshots.
- Multi-user approval roles (data model supports it; UI ships single-user).
- Compliance check results per section → Phase 2.
- MySMIS XML export → Phase 3.
- Inline rich-text editor (explicitly rejected; AI-rewrite-only).
- Partial content recovery from failed AI generations.
- A `needs_rewrite` state (Phase 2 surfaces this as a warning flag, not a state).
- Retention policy for old versions.
- Cross-project queries over sections.

## 3. Data model

### 3.1 New table: `section_versions`

Append-only archive of every version of every section across every session. Rows are never deleted except via `ON DELETE CASCADE` from `workflow_sessions`.

```
section_versions
├── id                UUID PK, default gen_random_uuid()
├── session_id        UUID NOT NULL, FK → workflow_sessions.id ON DELETE CASCADE
├── section_id        TEXT NOT NULL                          -- matches SectionSpec.id ("context", "buget", ...)
├── version           INTEGER NOT NULL                       -- monotonic per (session_id, section_id), starts at 1
├── content           TEXT NOT NULL
├── content_hash      VARCHAR(64) NOT NULL                   -- SHA-256 hex of content
├── title             TEXT NOT NULL                          -- snapshotted (blueprints can rename sections)
├── metadata          JSONB NOT NULL DEFAULT '{}'            -- model, provider, tokens, latency, fallbackUsed, etc.
├── reason            TEXT NOT NULL DEFAULT ''               -- user prompt, 'initial_generation', rollback reason, etc.
├── state_at_capture  TEXT NOT NULL                          -- 'draft' for any new version (always starts there)
├── created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
├── created_by        UUID NOT NULL, FK → users.id
└── UNIQUE (session_id, section_id, version)

Indexes:
  idx_section_versions_session_section  (session_id, section_id)
  idx_section_versions_created_at       (created_at DESC)
```

**Design rationale:**
- `section_id` is text (the SectionSpec id), not UUID. Sections are not first-class DB entities in this design; they live inside the JSONB context keyed by spec id. A UUID would force either a new `sections` table (rejected as Approach A) or redundant dual keys.
- Append-only, no `deleted_at`. Matches the existing audit log philosophy. Rollback never destroys history — it creates a new version whose content is copied forward.
- `content_hash` enables integrity checks between the JSONB read cache and the latest version row, and gives Phase 3 submission manifests an immutable reference.
- `state_at_capture` is always `'draft'` on insert — the column exists for readability and for future compatibility if we ever want to start a version directly in a different state.
- `metadata` is JSONB for the same reason `SectionResult.metadata` is today: model-provider-tokens shape may evolve.

### 3.2 Extensions to `SectionResult` (JSONB inside `workflow_sessions.context.projectSections`)

```typescript
interface SectionResult {
  id: string;
  title: string;
  content: string;            // current version content (duplicated from latest section_versions row — read cache)
  order: number;
  source: 'generated' | 'edited' | 'failed';
  metadata: { /* unchanged */ };

  // NEW — Phase 1
  state: 'draft' | 'reviewed' | 'approved';
  currentVersion: number;     // matches the row in section_versions; invariant: equals max(version) for this section
  versionCount: number;       // total versions — cheap badge display without DB hit
  contentHash: string;        // SHA-256 of current content; matches section_versions.content_hash for currentVersion
  lastStateChangeAt: string;  // ISO timestamp
  lastStateChangeBy: string | null;  // userId; null only for legacy sessions before Phase 1 ships
}
```

**Invariants:**
1. `SectionResult.currentVersion === max(version) FROM section_versions WHERE session_id=X AND section_id=Y`
2. `SectionResult.contentHash === section_versions.content_hash WHERE version = currentVersion`
3. `SectionResult.content === section_versions.content WHERE version = currentVersion`
4. `SectionResult.state === 'approved'` only if the current version's `source` is `'generated'` or `'edited'` (never `'failed'`)

Invariants 1–3 are maintained by always writing JSONB and the version row inside the same DB transaction.

## 4. State machine

### 4.1 States

| State | Meaning | Blocks export? |
|---|---|---|
| `draft` | Freshly generated, regenerated, or rolled back; content has changed since last review | Yes |
| `reviewed` | User has read this version end to end; not final | Yes |
| `approved` | User has signed off; ready for Phase 3 export | No (allows export) |

### 4.2 Allowed transitions

| From | To | Trigger | New version row? |
|---|---|---|---|
| `draft` | `reviewed` | user clicks "Mark reviewed" | no |
| `draft` | `approved` | user clicks "Approve" (shortcut skipping `reviewed`) | no |
| `reviewed` | `approved` | user clicks "Approve" | no |
| `reviewed` | `draft` | user clicks "Back to draft" | no |
| `approved` | `draft` | user clicks "Unapprove" | no |
| *any* | `draft` | AI regeneration / rollback | **yes** |

**Forbidden transitions:** `approved → reviewed` (no downgrade path to an intermediate state; walk back via `draft`). Same-state clicks are idempotent no-ops, not errors. `failed`-source sections cannot transition to `reviewed` or `approved`; only `draft`.

### 4.3 Rollback semantics

Rollback to target version K creates a new version N+1 whose content is copied from version K. State is always `draft` on the new version, regardless of what state version K had when it was the current version. State attaches to the exact current version only; re-approving after rollback is an intentional re-read, not a free ride.

### 4.4 Side effects per transition

All side effects occur inside a single DB transaction.

**Transitions that create a new version** (regenerate, rollback):
1. Insert into `section_versions` (version = max + 1, content, content_hash, reason, state_at_capture = 'draft').
2. Update `workflow_sessions.context.projectSections[i]` — content, contentHash, currentVersion++, versionCount++, state = 'draft', lastStateChangeAt, lastStateChangeBy.
3. `logAudit({ action: 'section.regenerated' | 'section.rollback', metadata: { ... } })`.

**State-only transitions:**
1. Update JSONB — state, lastStateChangeAt, lastStateChangeBy.
2. `logAudit({ action: 'section.state_change', metadata: { sectionId, fromState, toState, currentVersion, reason? } })`.

### 4.5 Derived "ready to export" signal

Computed on read, not stored: `sections.every(s => s.state === 'approved' && s.source !== 'failed')`. Surfaced in the UI progress header. Phase 3's export endpoint will gate on this predicate.

## 5. Engine and API changes

### 5.1 Helper module

New file: `app/src/lib/ai/orchestrator/section-versions.ts`. Single source of truth for version and state operations. Agents remain pure (no DB writes); the engine calls this helper post-agent.

```typescript
interface PersistOptions {
  sessionId: string;
  userId: string;
  previousSections: SectionResult[] | null;
  newSections: SectionResult[];
  reason: string;
}

// Computes content_hash per section, detects changes by hash comparison,
// inserts version rows only for changed sections, returns newSections enriched
// with state/currentVersion/versionCount/contentHash/lastStateChange*.
async function persistSectionChanges(opts: PersistOptions): Promise<SectionResult[]>;

async function getVersionHistory(
  sessionId: string,
  sectionId: string,
): Promise<SectionVersion[]>;

async function rollbackSection(opts: {
  sessionId: string;
  sectionId: string;
  targetVersion: number;
  userId: string;
  reason: string;
}): Promise<SectionResult>;

async function transitionSectionState(opts: {
  sessionId: string;
  sectionId: string;
  toState: 'draft' | 'reviewed' | 'approved';
  userId: string;
  reason?: string;
}): Promise<SectionResult>;
```

### 5.2 Change detection in `persistSectionChanges`

For each section in `newSections`, look up the corresponding previous section by `id`:

- **No previous** (initial generation) → insert v1, set `state='draft'`, `currentVersion=1`, `versionCount=1`, `contentHash=sha256(content)`.
- **Previous exists and `sha256(newContent) !== previous.contentHash`** → insert vN+1, reset `state='draft'`, `currentVersion++`, `versionCount++`, update `lastStateChange*`, update `contentHash`.
- **Previous exists and content hash unchanged** → preserve everything from previous (no version row written).

The helper is the only code path that writes to `section_versions`. Agents never touch it directly.

### 5.3 Legacy session handling

Sessions created before Phase 1 ships have `projectSections[]` without the new fields. Handling:

- **On read** (`loadSession` in engine), missing fields get defaults applied in memory: `state='draft'`, `currentVersion=1`, `versionCount=1`, `contentHash=sha256(content)`, `lastStateChangeAt=session.updatedAt`, `lastStateChangeBy=session.userId`. The DB is not touched.
- **On first write** (first regeneration, state transition, or rollback on a legacy section), `persistSectionChanges` detects no prior version row and inserts v1 as a baseline snapshot, then inserts v2 with the new content if any. Lazy backfill, no downtime.

### 5.4 Engine integration

Inside `processMessage` in `app/src/lib/ai/orchestrator/engine.ts`, around line 184, after the agent returns and before the `db.update(workflowSessions)` call:

```typescript
const result = await agent(ctx, input, stream, gateway);
let updatedContext = { ...ctx, ...result.data };

if (result.data.projectSections) {
  const enrichedSections = await persistSectionChanges({
    sessionId,
    userId: ctx.userId,
    previousSections: ctx.projectSections,
    newSections: result.data.projectSections,
    reason: isCompleted ? input : 'initial_generation',
  });
  updatedContext = { ...updatedContext, projectSections: enrichedSections };
}
// ... existing db.update
```

No changes to the build agent or edit agent themselves.

### 5.5 New REST endpoints

All under `/api/ai/orchestrator/sessions/:sessionId/sections/:sectionId/...` consistent with the existing `/api/ai/orchestrator/sessions/route.ts`. All require `requireAuth`, verify `session.userId === user.id`, honor CSRF via the existing middleware, and go through `withRateLimit`.

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `.../versions` | — | `{ versions: SectionVersion[] }` |
| `POST` | `.../rollback` | `{ targetVersion: number, reason?: string }` | `{ section: SectionResult }` |
| `POST` | `.../state` | `{ state: 'draft'\|'reviewed'\|'approved', reason?: string }` | `{ section: SectionResult }` |

**Regeneration does not get a new endpoint.** It continues to flow through `POST /api/ai/orchestrator/message` → edit agent → `persistSectionChanges`.

### 5.6 New SSE event

Adds one variant to `SSEEvent` in `app/src/lib/ai/orchestrator/types.ts`:

```typescript
| { type: 'section_updated'; sectionId: string; section: SectionResult }
```

Emitted from the rollback and state-transition endpoints via the existing pub/sub stream for the session. Client's `useOrchestrator` updates `canvasState.proposalSections` in place when this arrives, so the canvas stays live when the user acts via the history panel while the chat is streaming.

### 5.7 Error taxonomy

Errors flow through the existing `FondEUError` / `Errors.*` factory (`@/lib/errors`) with bilingual messages.

| Error | HTTP | Cause |
|---|---|---|
| `SectionNotFound` | 404 | No section in JSONB for that `sectionId` |
| `VersionNotFound` | 404 | Rollback target version doesn't exist |
| `InvalidStateTransition` | 400 | Transition not in the allowed table |
| `FailedSectionCannotBeApproved` | 400 | Current version has `source === 'failed'` and target state is `reviewed` or `approved` |
| `ConcurrentModification` | 409 | Optimistic-lock: `currentVersion` read at tx start doesn't match current |
| `VersionIntegrityMismatch` | 500 | JSONB `contentHash` ≠ latest version row; logged to Sentry |

## 6. UI changes

All changes inside `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` `ProposalTabContent` component (around line 408). No changes to the calls or plan tabs.

### 6.1 Progress header

Sticky at the top of the Proposal tab. Shows:
- Section count status line: `"8 of 11 sections approved · 2 reviewed · 1 draft"`
- Stacked progress bar (approved green, reviewed amber, draft indigo)
- Per-state count pills
- Caption: `"Export unlocks when all 11 sections are approved"` (Phase 3 teaser)

### 6.2 Per-section card

Card header gains:
- State badge: `DRAFT` (indigo) / `REVIEWED` (amber, with ✓) / `APPROVED` (green, with ✓✓) / `FAILED` (red, with ⚠)
- Version pill: `v3`
- Left border color matching state (visible only for `reviewed`, `approved`, `failed`)

Card body: unchanged (content with `max-h-48` inner scroll — layout fixes are out of scope for Phase 1).

Card footer gets state-aware button set:

| State | Buttons |
|---|---|
| `draft` | Mark reviewed · Approve · ↻ Improve · History |
| `reviewed` | Approve · ← Back to draft · ↻ Improve · History |
| `approved` | ← Unapprove · ↻ Improve · History · (caption: "Regenerating will reset to draft") |
| `failed` | Approve (disabled) · ↻ Regenerate · History |

`↻ Improve` continues to work as today: posts a chat message that goes through the edit agent.

### 6.3 Inline history expansion

Clicking `History` expands a panel in place below the card (not a drawer, not a modal). Panel shows:
- Header with version count
- One row per version, newest first, current version highlighted with a blue border
- Each row: version number + state-at-capture badge + timestamp + reason text
- Per-row actions (on non-current versions): `View` · `Compare with current` · `↶ Rollback`

`View` expands the row to show the full content of that version. `Compare with current` renders a two-column text diff using the `diff` npm package. `↶ Rollback` opens a confirm dialog with a reason field prefilled with "Rolled back to v{K}".

### 6.4 Confirm dialogs

Rollback and "Improve an already-approved section" show confirm dialogs. Both prefill the reason field and let the user edit. Approve and state transitions do not show confirms (they are reversible).

### 6.5 I18n

All new strings added to `notifications.*`-style namespaces in `app/src/messages/ro.json` and `app/src/messages/en.json`. Romanian first (it is the primary user audience), English parity required. No hardcoded strings in components.

### 6.6 Accessibility

- State badges use color AND a symbol (✓, ✓✓, ⚠) so color-blind users can distinguish.
- Buttons have `aria-label` when the visible label is terse.
- Confirm dialogs trap focus and close on Escape.
- Disabled buttons have `aria-disabled` and a tooltip explaining why.

## 7. Audit trail

All state changes and version creations flow through the existing `logAudit` from `@/lib/legal/audit`, inheriting the SHA-256 tamper-evident hash chain without any new audit code.

New audit action types:

| Action | Emitted when | Metadata payload |
|---|---|---|
| `section.generated` | Build agent produces v1 for a section | `sessionId, sectionId, version, contentHash, model, provider` |
| `section.regenerated` | Edit agent produces vN+1 | `sessionId, sectionId, fromVersion, toVersion, contentHash, reason, previousState` |
| `section.rollback` | Rollback endpoint creates vN+1 from a copy | `sessionId, sectionId, rolledBackFromVersion, rolledBackToVersion, newVersion, reason` |
| `section.state_change` | State endpoint changes state without creating a version | `sessionId, sectionId, currentVersion, fromState, toState, reason?` |

`userId`, `timestamp`, `previousHash`, `entryHash` are set by `logAudit` itself.

**Transaction boundary:** audit entries sit inside the same DB transaction as the JSONB and version row writes. A DB-level audit write failure rolls back the whole change. The DLQ fallback in the existing audit module handles truly pathological cases where the `audit_log` table is unavailable; `verifyAuditChainIntegrity` later detects any gaps.

## 8. Testing strategy

### 8.1 Unit tests (Vitest, `app/tests/unit/`)

| File | Covers |
|---|---|
| `section-versions.test.ts` (new) | `persistSectionChanges` change detection by hash; `transitionSectionState` allowed + forbidden transitions; `rollbackSection` content copy; `contentHash` computation; failed-section approve-block |
| `orchestrator-engine.test.ts` (extend) | `processMessage` integrates with `persistSectionChanges`; legacy session lazy-snapshot path writes v1 on first change; regeneration resets state to draft |

### 8.2 Integration tests (Vitest, `app/tests/integration/`)

| File | Covers |
|---|---|
| `section-state-api.test.ts` (new) | `POST .../state` happy paths per transition; invalid transitions return 400; auth + CSRF; failed sections blocked |
| `section-rollback-api.test.ts` (new) | `POST .../rollback` success; target not found; audit entry created; content hash integrity |
| `section-versions-api.test.ts` (new) | `GET .../versions` returns list; respects session ownership |

### 8.3 E2E (Playwright, `app/e2e/`)

One happy-path test:
1. Open an assistant session with existing sections.
2. Approve first section — verify badge change.
3. Open history — verify version list.
4. Regenerate a section — verify state resets and new version row appears.
5. Rollback to v1 — verify content matches and state is draft.
6. Verify progress header counts update throughout.

### 8.4 Regression gate

- All 16 existing `orchestrator-*.test.ts` tests must still pass.
- All 91 existing Playwright E2E tests must still pass.

## 9. Rollout plan

1. Gate behind feature flag `section_versioning` via `isFeatureEnabled(key, ctx)` (existing flag system). Default OFF in production, ON in dev.
2. Dogfood in dev with the existing single-user workflow until the Playwright happy-path test is green in CI and manual QA confirms no transaction edge cases.
3. Flip the flag on in production.
4. Monitor metrics: `section_state_transitions_total{from,to}`, `section_versions_created_total`, `section_rollbacks_total`. An abnormally high rollback rate would signal a UX problem (users regretting actions).

## 10. Relationship to later phases

Phase 1 is deliberately the narrowest possible slice of "improve the AI output screen" that still delivers standalone value. The full initiative has two more phases, each its own spec.

**Phase 2 — Trust workbench** (compliance overlay + call-match verification + citations). Will attach legal/compliance check results per-section per-version. Needs Phase 1's version rows as attachment points. Will add a `compliance_check` JSONB column to `section_versions` or a sibling table. Will surface Romanian law + EU regulation gaps: GDPR / Law 190 data processing flags, De minimis / GBER state aid declarations, ANI conflict-of-interest, beneficial ownership, publicity obligations under Regulation (EU) 2021/1060 Annex IX.

**Phase 3 — Submission** (MySMIS XML + PDF + proper DOCX). Will read only `approved` current versions and produce a submission bundle. Needs Phase 2's validated compliance metadata to populate MySMIS2021-required fields (SMIS code, CAEN, cofinancing rate, ERDF/ESF+ flags). Will emit a submission manifest that hashes each approved version using the `content_hash` introduced in Phase 1.

Phases 2 and 3 will each go through their own brainstorming and spec before implementation begins. This spec does not bind their design decisions beyond what Phase 1 directly enables.
