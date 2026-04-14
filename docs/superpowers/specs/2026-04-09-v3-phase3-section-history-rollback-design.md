# V3 Phase 3: Section Version History & Rollback API — Design Spec

## Goal

Add API endpoints to browse section version history and rollback to previous versions for V3 agent sessions. Backend-only — no UI in this phase.

## Current State

V3 has the data layer but no API surface:
- `agent_sections` — status state machine with states: `pending`, `generating`, `draft`, `accepted`, `stale`, `invalidated`, `needs_review`, `failed`
- `agent_section_versions` — version rows: `versionNumber`, `kind` (draft/accepted/regenerated/system_rewrite), `content`, `modelUsed`, `sourcesUsed`, `createdAt`
- The V3 runtime creates version rows when sections are generated/regenerated, but no endpoint exposes them to the client

V2 has equivalent endpoints under `/api/ai/orchestrator/sessions/{id}/sections/{sectionId}/` for versions, state transitions, and rollback. This spec adds V3 equivalents under the agent sessions path.

## New Endpoints

All endpoints use the same auth pattern as Phase 1: `requireAuth()` + verify `agentSessions.userId === user.id`. Return 404 for non-existent or unauthorized sessions (not 403).

### 1. GET /api/ai/agent/sessions/{sessionId}/sections

List all sections for a session.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "sectionKey": "executive-summary",
      "title": "Rezumat Executiv",
      "status": "draft",
      "documentOrder": 0,
      "versionCount": 3,
      "updatedAt": "ISO8601"
    }
  ]
}
```

- Ordered by `documentOrder ASC`
- `versionCount` via subquery on `agent_section_versions`
- No pagination — a session has at most ~15 sections

**File:** `app/src/app/api/ai/agent/sessions/[sessionId]/sections/route.ts`

### 2. GET /api/ai/agent/sessions/{sessionId}/sections/{sectionId}/versions

Version history for a single section. Returns full content for every version.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "versionNumber": 3,
      "kind": "regenerated",
      "content": "full section text...",
      "modelUsed": "claude-sonnet-4-5-20250514",
      "sourcesUsed": [],
      "createdAt": "ISO8601"
    }
  ]
}
```

- Ordered by `versionNumber DESC` (newest first)
- Returns full content — sections are at most a few KB of text, metadata-only adds unnecessary round trips
- `sectionId` is the UUID of the `agent_sections` row (not the `sectionKey` slug)

**File:** `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route.ts`

### 3. POST /api/ai/agent/sessions/{sessionId}/sections/{sectionId}/rollback

Rollback a section to a previous version.

**Request body:**
```json
{
  "targetVersion": 2
}
```

**Behavior:**
1. Validate `targetVersion` exists for this section
2. Restore the selected version's content into `agent_sections.content`
3. Reset `agent_sections.status` to `draft`
4. Must update `agent_sections.updatedAt` to now
5. Append a new `agent_section_versions` row capturing the rollback result as the latest version:
   - `versionNumber`: current max + 1
   - `kind`: `system_rewrite`
   - `content`: copied from `targetVersion` row
6. Must update `agent_sessions.updatedAt` to now (rollback is a session-visible change — keeps session lists correctly sorted by recent activity)
7. Return the new version row

**Guards:**
- Session must not be `completed` or `abandoned` — return 409 ("Session is not active")
- Section must exist and belong to the session
- `targetVersion` must exist — return 400 if not

**No optimistic locking** — V3 sessions are single-user owned. The ownership check is the guard. No concurrent editor scenario exists.

**File:** `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts`

### 4. PATCH /api/ai/agent/sessions/{sessionId}/sections/{sectionId}/state

Transition a section's status.

**Request body:**
```json
{
  "status": "accepted"
}
```

**Allowed transitions (user-initiated):**
```
draft → accepted        (skip review)
draft → needs_review
needs_review → accepted
needs_review → draft    (reject back)
accepted → draft        (reopen)
```

States `pending`, `generating`, `stale`, `invalidated`, `failed` are system-managed and not user-transitionable. Attempting to transition to or from these states returns 400.

**Guards:**
- Session must not be `completed` or `abandoned` — return 409
- Current status must allow the requested transition — return 400 with current and requested status in error message

**Response:** Updated section object.

**File:** `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route.ts`

## Shared Patterns

### Session ownership verification

All four endpoints share the same pattern (extract to a helper or inline):
```typescript
const session = await db.query.agentSessions.findFirst({
  where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
})
if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
```

### UUID validation

Validate `sessionId` and `sectionId` format before querying (same regex as Phase 1 messages endpoint).

### Error handling

Use the same FondEUError catch pattern as Phase 1 endpoints. Return 400 for validation errors, 404 for not found, 409 for state conflicts, 500 for internal errors.

## Testing

### Integration tests for section listing
- Returns sections ordered by documentOrder
- Returns 404 for unauthorized session
- Includes versionCount per section

### Integration tests for version history
- Returns all versions with full content, newest first
- Returns 404 for non-existent section
- Returns 404 for unauthorized session

### Integration tests for rollback
- Creates new version with rolled-back content
- Resets section status to draft
- Returns 400 for non-existent targetVersion
- Returns 409 for completed session
- Returns 404 for unauthorized session

### Integration tests for state transition
- Allows valid transitions (draft→accepted, draft→needs_review, etc.)
- Rejects invalid transitions (pending→accepted, failed→draft)
- Returns 409 for completed session
- Returns 400 with descriptive error for invalid transition

## Files

| Action | File |
|--------|------|
| Create | `app/src/app/api/ai/agent/sessions/[sessionId]/sections/route.ts` |
| Create | `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route.ts` |
| Create | `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts` |
| Create | `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route.ts` |
| Create | `app/tests/integration/agent-section-list.test.ts` |
| Create | `app/tests/integration/agent-section-versions.test.ts` |
| Create | `app/tests/integration/agent-section-rollback.test.ts` |
| Create | `app/tests/integration/agent-section-state.test.ts` |

## What This Spec Does NOT Add

- Section editor UI or version timeline component (separate frontend work)
- Section content editing endpoint (sections are generated by the agent runtime)
- Export endpoints (separate concern)
- Audit logging for state transitions (can be added later if compliance requires it)
- Optimistic locking / concurrent edit protection (single-user sessions)
