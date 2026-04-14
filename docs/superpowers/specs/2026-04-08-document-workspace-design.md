# Document Workspace: Markdown-First Editor

**Date**: 2026-04-08
**Status**: Draft
**Goal**: Replace DOCX-centric file dump with a markdown-native document workspace.

---

## Problem

The AI generates markdown content, converts it to DOCX, stores in GCS. The `/documente` page lists these DOCX files and only offers download. Users cannot view, edit, or refine proposal sections in the browser.

## Solution

Make markdown the canonical viewing/editing format. Keep DOCX as on-demand export only.

- Stop auto-generating per-section DOCX files
- Add a document workspace where users read and edit sections as markdown
- DOCX export available on demand (full proposal or per-section)
- Respect the existing session-backed versioning system for all edits

---

## Architecture

### Source of Truth Chain (existing, unchanged)

1. **`workflowSessions.context.projectSections`** — live sections (SectionResult[])
2. **`section_versions`** table — immutable version history per section per session
3. **`projectDocuments.sections`** — mutable materialized snapshot (updated after edits)

### Key Architectural Decision: Session-Backed Edits

All section edits flow through the existing session versioning system. The workspace resolves project → latest qualifying session, then operates on it.

**Session precedence** (for `resolveProjectWorkspace()`):
1. `active` or `paused` session where `projectId = id` and `userId = user.id` → use (user may be mid-edit)
2. `completed` session, latest by `updatedAt` → use (finished proposal)
3. `abandoned` → skip always
4. No qualifying session → fall back to `projectDocuments.sections` (read-only snapshot mode)

Note: `workflowStatusEnum` has four values: `active`, `paused`, `completed`, `abandoned`. There is no `error` status.

### Consistency Model: Transactional for Core, Eventual for Derivatives

Workspace content edits do NOT use `persistSectionChanges()`. That function is designed for the orchestrator's batch-generation flow — it takes `previousSections` as a parameter and derives versions without locking. Two concurrent calls can race into the same `(sessionId, sectionId, version)` insert, yielding a unique-constraint violation instead of a clean 409.

Instead, `editProjectSection()` follows the pattern of `transitionSectionState()` (section-versions.ts:249): a single `db.transaction()` that locks the session row with `SELECT ... FOR UPDATE`, re-reads sections from the locked row, checks `expectedCurrentVersion`, inserts the version row, and updates session context — all atomically. This guarantees:

- **Clean 409**: A concurrent PATCH on the same section blocks on the row lock, then sees the updated `currentVersion` and returns 409 `ConcurrentModification`.
- **No orphan version rows**: Version insert and session update commit or rollback together.
- **No reconciliation needed**: The "version committed but session stale" failure mode cannot happen.

**Write flow** (`editProjectSection()`):

1. **In one transaction** (with `FOR UPDATE` lock on `workflowSessions`):
   - Re-read `session.context.projectSections` from locked row
   - Find target section, check `expectedCurrentVersion` → 409 if stale
   - Compute `contentHash` via `hashContent()`
   - Insert `section_versions` row (version = `currentVersion + 1`)
   - Update section in JSONB: `content`, `title`, `contentHash`, `source: 'edited'`, `state: 'draft'`, `currentVersion + 1`, `versionCount + 1`, `lastStateChangeAt: now`, `lastStateChangeBy: userId`
   - Write updated `projectSections` back to session context
   - Collect audit entry
2. **Post-commit** (same pattern as `transitionSectionState`):
   - Emit audit via `logAudit()`
   - Sync `projectDocuments.sections` via `syncProjectDocumentSnapshot()` — catch + log on failure
   - Await `persistAndPublishSectionUpdatedEvent()` — catch + log on failure

**Failure handling for post-commit steps**:

- **Snapshot sync fails**: Edit is saved (session + version row are committed). Export endpoint uses `resolveProjectWorkspace()` to read from session if available, falls back to snapshot only when no session exists. So export always reflects the latest committed state.
- **Event publish fails**: `persistAndPublishReplayableEvent()` persists to `workflowMessages` in its own transaction first, then publishes to Redis/SSE. If the DB transaction succeeds but Redis publish fails, the event is still persisted and replayable. If the DB transaction itself fails, the event is lost — but the edit is committed and the next section load shows current state. Failure is caught and logged, does not fail the edit.

**Read-time reconciliation** (defense-in-depth):

`resolveProjectWorkspace()` includes a lightweight drift check as a safety net for edge cases (e.g., manual DB intervention, bug in a future code path). For each section in session context, compare `currentVersion` against the max version in `section_versions` for that `(sessionId, sectionId)`. If drift is found, patch the session context from the version row — rebuilding all fields: `content`, `contentHash`, `title`, `currentVersion`, `versionCount`, `state` (reset to `'draft'`), `source` (`'edited'`), `lastStateChangeAt`, `lastStateChangeBy`. Update the session row in DB so the fix is permanent. This should never trigger in normal operation.

### projectDocuments Semantics

`projectDocuments` is a **mutable materialized snapshot**. The latest row (by `version desc`) is the current state. User edits update this row in place. The `version` column tracks document generation version (from orchestrator), not edit versions (those live in `section_versions`).

### Read-Only Mode

When no qualifying session exists, the API returns `{ source: 'snapshot', readOnly: true }`. The UI disables editing and shows an info banner. PATCH/state-change requests return 400 in this mode.

### Snapshot Normalization

Legacy or incomplete `projectDocuments.sections` entries are normalized on read:
- Missing `state` → `'draft'`
- Missing `currentVersion` → `1`
- Missing `versionCount` → `1`
- Empty `contentHash` → computed from content via `hashContent()`
- Missing `lastStateChangeAt` → document `createdAt`

---

## Data Flow

### User Edits a Section

```
User types in editor
  → debounced auto-save (3s)
  → PATCH /api/v1/projects/[id]/sections/[sectionId]
    → resolveProjectWorkspace() → finds session
    → editProjectSection():
        TRANSACTION (FOR UPDATE on workflowSessions):
          re-read sections from locked row
          check expectedCurrentVersion → 409 if stale
          INSERT section_versions row
          UPDATE session.context.projectSections
        POST-COMMIT:
          logAudit()
          syncProjectDocumentSnapshot() (catch+log)
          persistAndPublishSectionUpdatedEvent() (catch+log)
    → 200 { section: SectionResult }
  → editor shows "Saved" indicator
```

### User Changes Section State

```
POST /api/v1/projects/[id]/sections/[sectionId]/state
  → resolveProjectWorkspace()
  → transitionSectionState() → updates session, audits
  → sync projectDocuments.sections (best-effort)
  → 200 { section: SectionResult }
```

### Optimistic Locking

All writes require `expectedCurrentVersion`. On conflict: 409 with `ConcurrentModification` code. UI shows conflict message and offers reload.

---

## API Endpoints

### GET /api/v1/projects/[id]/sections

Returns all sections for a project.

```typescript
Response: {
  sections: SectionResult[]
  sessionId: string | null
  source: 'session' | 'snapshot'
  readOnly: boolean
  version: number
}
```

### PATCH /api/v1/projects/[id]/sections/[sectionId]

Edit section content/title.

```typescript
Body: {
  content: string        // min 1, max 100K
  title?: string         // min 1, max 500
  expectedCurrentVersion: number
}
Response: { section: SectionResult }
Errors: 400 (read-only), 404, 409 (conflict)
```

### POST /api/v1/projects/[id]/sections/[sectionId]/state

Transition section state.

```typescript
Body: {
  state: 'draft' | 'reviewed' | 'approved'
  expectedCurrentVersion: number
  reason?: string
}
Response: { section: SectionResult }
```

### GET /api/v1/projects/[id]/sections/[sectionId]/export?format=docx

Export single section as DOCX. Uses `resolveProjectWorkspace()` — reads from session if available, falls back to snapshot. Works in both modes.

### GET /api/v1/workspace

Aggregate endpoint for `/documente` page. Returns all projects with section summaries.

```typescript
Response: {
  projects: Array<{
    id: string
    title: string
    sectionCount: number
    stateBreakdown: { draft: number, reviewed: number, approved: number }
    lastEditedAt: string
    mode: 'session' | 'snapshot'
    hasUploadedFiles: boolean
  }>
}
```

Implementation uses a subquery or window function (`ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY ...)`) to select the best session per project according to the session precedence rules — not a simple flat join. Also includes a `LEFT JOIN LATERAL` or equivalent for `projectFiles` count. Capped at 50 projects.

---

## Shared Infrastructure

### `resolveProjectWorkspace(projectId, userId)`

**File**: `app/src/lib/ai/orchestrator/workspace.ts`

```typescript
interface ProjectWorkspace {
  project: Project
  session: WorkflowSession | null
  snapshotDoc: ProjectDocument | null
  mode: 'session' | 'snapshot'
  sections: SectionResult[]  // normalized, reconciled
}
```

Auth: verifies `projects.userId === userId`.

**Drift reconciliation** (defense-in-depth, when `mode='session'`): After loading session context, queries `section_versions` for the max version per sectionId in this session. If any section's `currentVersion` in session context is behind the version table, patches the session context from the version row — rebuilding ALL fields: `content`, `contentHash`, `title`, `currentVersion`, `versionCount` (set to max version number), `state: 'draft'`, `source: 'edited'`, `lastStateChangeAt`, `lastStateChangeBy`. Updates the session row in DB so the fix is permanent. Should never trigger in normal operation.

The reconciliation query is lightweight: one query with `GROUP BY section_id` and `MAX(version)`, only checking sections where the session's `currentVersion` < max version. No reconciliation needed if all match.

### `editProjectSection(workspace, sectionId, content, title?, expectedCurrentVersion, userId)`

Same file. Follows the `transitionSectionState()` pattern (NOT `persistSectionChanges()`):

**In one `db.transaction()` with `FOR UPDATE` lock on `workflowSessions`:**
1. Re-read `session.context.projectSections` from locked row
2. Find section by `sectionId`, check `expectedCurrentVersion` → throw `ConcurrentModification` if stale
3. Compute `contentHash` via `hashContent()`
4. Insert `section_versions` row (version = `currentVersion + 1`)
5. Build updated section: `content`, `title`, `contentHash`, `source: 'edited'`, `state: 'draft'`, `currentVersion + 1`, `versionCount + 1`, `lastStateChangeAt: now`, `lastStateChangeBy: userId`
6. Replace section in array, write updated `projectSections` back to session context
7. Collect audit entry for post-commit emission

**Post-commit** (same pattern as `transitionSectionState`):
8. `logAudit()` with action `'section.edited'`
9. `syncProjectDocumentSnapshot()` — catch + log on failure
10. `persistAndPublishSectionUpdatedEvent()` — catch + log on failure

### `syncProjectDocumentSnapshot(projectId, sections)`

Same file. Updates latest `projectDocuments` row's `sections` JSONB in place. Creates row with `version: 1` if none exists. Best-effort — caller catches and logs failures.

### `normalizeSections(sections, fallbackCreatedAt)`

Same file. Fills in defaults for legacy/incomplete section data.

---

## UI Components

### Editor Library: MDXEditor

- WYSIWYG markdown editor that accepts/emits markdown strings
- Best UX for non-technical users (municipality staff, grant applicants)
- Dynamic import with `ssr: false` (uses browser APIs)
- Plugins: headings, lists, bold/italic, thematic break, link

### Preview: react-markdown + remark-gfm + rehype-sanitize

- Full GFM support (tables, task lists, strikethrough)
- Sanitized output (safe for AI-generated content)
- Existing `MarkdownPreview` in AI chat stays unchanged

### Section State Badge

Maps `draft|reviewed|approved` → styled badges.

---

## Pages

### Section Editor (`/proiecte/[id]/sectiuni/[sectionId]`)

- Breadcrumb → editable title → status bar → MDXEditor → action bar
- Read-only mode: editor disabled, save hidden, info banner shown
- Auto-save: 3s debounce with Saving/Saved indicator
- Conflict handling: 409 → message + reload option
- `beforeunload` guard for unsaved changes

### Sections Tab on Project Detail

- New tab between overview and documents (activated via `?tab=sections` query param)
- Ordered section cards: number, title, state badge, ~200 char preview, edit link, version
- Edit links disabled in snapshot/read-only mode
- "Export Full DOCX" button at top
- Empty state with link to AI assistant

### Documents Page (`/documente`) → Workspace

Uses `GET /api/v1/workspace` (single request, no N+1).

**Generated Documents** section:
- Project cards: title, section count, state summary, last edited
- "Open Workspace" → `/proiecte/[id]?tab=sections`
- "Export DOCX" quick action
- Filter by section state

**Uploaded Files** section:
- Separate area for reference materials
- Existing file card UI

---

## Orchestrator Change

Remove per-section DOCX generation loop in `engine.ts` lines 391-405. Keep submission forms generation (lines 410-443) — those are template-based annexes.

---

## Dependencies

```
@mdxeditor/editor   — WYSIWYG markdown editor (markdown in/out)
react-markdown      — Markdown → React renderer
remark-gfm          — GFM support
rehype-sanitize     — HTML sanitization
```

---

## New Files

| File | Purpose |
|------|---------|
| `app/src/lib/ai/orchestrator/workspace.ts` | resolveProjectWorkspace, editProjectSection, syncSnapshot, normalize |
| `app/src/app/api/v1/projects/[id]/sections/route.ts` | GET sections |
| `app/src/app/api/v1/projects/[id]/sections/[sectionId]/route.ts` | GET/PATCH section |
| `app/src/app/api/v1/projects/[id]/sections/[sectionId]/state/route.ts` | State transition |
| `app/src/app/api/v1/projects/[id]/sections/[sectionId]/export/route.ts` | Section DOCX export |
| `app/src/app/api/v1/workspace/route.ts` | Aggregate workspace data |
| `app/src/components/ui/markdown-render.tsx` | react-markdown wrapper |
| `app/src/components/editor/section-editor.tsx` | MDXEditor wrapper |
| `app/src/components/ui/section-state-badge.tsx` | State badge |
| `app/src/app/[locale]/(dashboard)/proiecte/[id]/sectiuni/[sectionId]/page.tsx` | Editor page |
| `app/src/app/[locale]/(dashboard)/proiecte/[id]/components/SectionsTabContent.tsx` | Sections tab |

## Modified Files

| File | Change |
|------|--------|
| `app/src/lib/ai/orchestrator/engine.ts` | Remove per-section DOCX (lines 391-405) |
| `app/src/lib/validators/index.ts` | Add editSectionContentSchema |
| `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx` | Add Sections tab + ?tab= param |
| `app/src/app/[locale]/(dashboard)/documente/page.tsx` | Rewrite as workspace |
| `app/src/app/api/v1/projects/[id]/export/route.ts` | Use resolveProjectWorkspace() — read from session if available, fall back to snapshot |
| `app/src/messages/ro.json` + `en.json` | Workspace + editor i18n keys |

## Reused (Not Modified)

| File | What |
|------|------|
| `app/src/lib/ai/orchestrator/section-versions.ts` | `hashContent()`, `transitionSectionState()`, `SectionVersionError`, `verifySectionIntegrity()`. Note: `persistSectionChanges()` is NOT used by workspace edits — it lacks row locking and is designed for the orchestrator's batch flow. |
| `app/src/lib/ai/orchestrator/pubsub.ts` | `persistAndPublishSectionUpdatedEvent()` |
| `app/src/lib/export/section-docx.ts` | `generateSectionDocx()` |
| `app/src/lib/export/docx.ts` | `generateDocx()` |

---

## Test Matrix

| Scenario | Expected | Verifies |
|----------|----------|----------|
| Concurrent PATCH on same section | Second request blocks on `FOR UPDATE`, then returns 409 `ConcurrentModification` | Row-level locking, clean conflict |
| PATCH with stale `expectedCurrentVersion` | 409 immediately | Optimistic lock check |
| PATCH in snapshot mode (no session) | 400 "Cannot edit without an active session" | Read-only enforcement |
| Snapshot sync fails after successful edit | PATCH returns 200, `projectDocuments` stale, export reads from session | Export freshness guarantee |
| Event publish DB failure after edit | PATCH returns 200, event not in `workflowMessages`, section load shows current state | Post-commit isolation |
| State transition syncs snapshot | POST state → `projectDocuments.sections` reflects new state | Snapshot consistency |
| Read after manual DB edit to `section_versions` | `resolveProjectWorkspace()` detects drift, reconciles all fields, updates session row | Defense-in-depth reconciliation |
| Legacy project with no session | GET returns `source: 'snapshot', readOnly: true`, sections normalized | Snapshot normalization + read-only |
| Export with session available | DOCX generated from session sections, not snapshot | Export freshness |
| Export with snapshot only | DOCX generated from `projectDocuments.sections` | Fallback export |

---

## Future (not in scope)

- Separate sections table (retire JSONB)
- Section-level AI refinement
- Diff view / version history UI
- Locked template headings
- Multi-user collaboration
