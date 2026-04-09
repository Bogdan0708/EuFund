# V3 Agent Session Inventory & Resume — Design Spec

## Goal

Add a session listing endpoint and resume entry point to the V3 agent system so that dashboard and project detail pages can discover and resume V3 sessions. This is the foundation for phases 2 (surface integration) and 3 (section history/rollback).

## Current State

- V3 agent creates/resumes sessions via `POST /api/ai/agent` (accepts optional `sessionId`)
- `GET /api/ai/agent/state?sessionId=` returns full state snapshot for reconnect
- `useAgent` hook supports resume via `sessionId` param and has a `reconnect()` method
- `agentSessions` table has `idx_agent_sessions_user_status` index on (userId, status, updatedAt)
- No listing endpoint exists — dashboard and project detail pages only query V2 sessions

## What This Spec Adds

### 1. GET /api/ai/agent/sessions

List the current user's V3 agent sessions with summary data.

**Query params:**
- `status` — comma-separated filter (e.g. `active,paused`). Defaults to all non-abandoned.
- `projectId` — filter by linked project UUID. Optional.
- `limit` — max results, default 20, max 100.
- `offset` — pagination offset, default 0.

**Response:**
```json
{
  "success": true,
  "data": {
    "sessions": [
      {
        "id": "uuid",
        "projectId": "uuid | null",
        "status": "active",
        "currentPhase": "drafting",
        "locale": "ro",
        "selectedCallId": "string | null",
        "messageSummary": "string | null",
        "stateVersion": 5,
        "sectionCount": 7,
        "createdAt": "2026-04-09T10:00:00Z",
        "updatedAt": "2026-04-09T11:30:00Z"
      }
    ],
    "total": 12
  }
}
```

`sectionCount` is a count of `agentSections` rows for the session (gives a progress signal without loading full sections).

**Auth:** `requireAuth()`, filter by `userId = session.user.id`. No org-level check needed.

**Error handling:** Standard `FondEUError` pattern. Invalid UUID in `projectId` returns 400.

**File:** `app/src/app/api/ai/agent/sessions/route.ts`

### 2. useAgent hook: initialSessionId support

The hook already accepts `sessionId` in the request body and has `reconnect()`. Add an `initialSessionId` parameter to the hook constructor so pages can pass a session ID from URL params:

```typescript
function useAgent(locale: 'ro' | 'en', initialSessionId?: string)
```

When `initialSessionId` is provided, the hook calls `reconnect(initialSessionId)` on mount instead of starting fresh.

**File:** `app/src/hooks/useAgent.ts`

### 3. Resume navigation contract

When a user clicks a V3 session card (in dashboard or project detail — phase 2), the navigation target is:

```
/{locale}/proiecte/nou?session={sessionId}
```

The `/proiecte/nou` page reads `searchParams.session` and passes it to `useAgent` as `initialSessionId`. This matches the existing pattern where `/asistent-ai` reads `?session=` for V2 resume.

No new pages or components are created in this phase.

## What This Spec Does NOT Add

- Dashboard/project page wiring (phase 2)
- Session deletion or archival endpoints
- Section version history API (phase 3)
- V2 session migration or data backfill

## Testing

- Integration test for `GET /api/ai/agent/sessions`: mock auth + DB, verify filtering by status/projectId, pagination, sectionCount aggregation, auth enforcement (403 for other users' sessions)
- Unit test for useAgent initialSessionId: verify reconnect is called on mount when provided

## Files

| Action | File |
|--------|------|
| Create | `app/src/app/api/ai/agent/sessions/route.ts` |
| Create | `app/tests/integration/agent-sessions-list.test.ts` |
| Modify | `app/src/hooks/useAgent.ts` (add initialSessionId param) |
| Modify | `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` (read ?session= from URL) |
