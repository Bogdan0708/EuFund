# V3 Agent Session Inventory & Resume — Design Spec

## Goal

Add session listing and first-class resume to the V3 agent system so dashboard and project detail pages can discover and resume V3 sessions. Foundation for phases 2 (surface integration) and 3 (section history/rollback).

## Current State

- `POST /api/ai/agent` creates or continues a session (accepts optional `sessionId` in body)
- `GET /api/ai/agent/state?sessionId=` returns a `UIStateSnapshot` (workspace state, no messages)
- `useAgent(locale)` hook manages session lifecycle client-side. `sessionId` is internal state set after the first POST response. `reconnect()` only works when `sessionId` is already populated (guards with `if (!sessionId) return`).
- `agentMessages` table stores full conversation history server-side. `loadContext()` in `history.ts` loads messages for LLM context, but no endpoint exposes message history to the client.
- Dashboard and project pages only query V2 orchestrator sessions.

## What This Spec Adds

### 1. GET /api/ai/agent/sessions — Session listing

List the current user's V3 agent sessions with summary data.

**Query params:**
- `status` — comma-separated filter (e.g. `active,paused`). Defaults to `active,paused,error` (resumable states only — completed sessions excluded from resume surfaces).
- `projectId` — filter by linked project UUID. Optional. Returns 400 if not a valid UUID.
- `limit` — max results, default 20, max 100.

**No offset pagination.** Return the latest N sessions ordered by `updatedAt DESC`. The existing `idx_agent_sessions_user_status` index covers this query. No `total` count query — the caller doesn't need it for a resume surface.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "projectId": "uuid | null",
      "projectTitle": "string | null",
      "status": "active",
      "currentPhase": "drafting",
      "locale": "ro",
      "selectedCallId": "string | null",
      "messageSummary": "string | null",
      "sectionCount": 7,
      "stateVersion": 5,
      "createdAt": "ISO8601",
      "updatedAt": "ISO8601"
    }
  ]
}
```

`projectTitle` is a left join on `projects.title` when `projectId` is present. Avoids extra client-side fetches in phase 2.

`sectionCount` is a subquery count of `agentSections` rows per session.

**Auth:** `requireAuth()`, filter by `eq(agentSessions.userId, user.id)`. No 403 case for "other user's session" — the query simply returns only the caller's rows.

**Error pattern:** Use plain `NextResponse.json()` to match existing V3 route conventions (`agent/route.ts` and `agent/state/route.ts` both use plain responses, not `FondEUError`).

**File:** `app/src/app/api/ai/agent/sessions/route.ts`

### 2. GET /api/ai/agent/sessions/[sessionId]/messages — Message history for resume

Return the user-visible conversation messages for a session. This powers the conversation pane on resume.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "role": "user | assistant | system | tool",
      "content": "string",
      "toolName": "string | null",
      "toolCallId": "string | null",
      "createdAt": "ISO8601"
    }
  ]
}
```

Returns all non-compacted messages ordered by `sequenceNumber ASC`. The `role` field matches storage exactly (including `tool` for tool results). The client decides what to render — the API does not filter or normalize roles. Compacted messages are excluded (they've been summarized into `messageSummary`).

**Auth:** `requireAuth()`, verify session belongs to user.

**File:** `app/src/app/api/ai/agent/sessions/[sessionId]/messages/route.ts`

### 3. useAgent hook: resumeSession support

The current hook cannot be initialized with an existing session. `reconnect()` guards on `sessionId` state which is null on first mount. A `?session=` URL param has no effect.

**Change:** Add `initialSessionId` parameter and a `resumeSession` effect:

```typescript
export function useAgent(locale: 'ro' | 'en', initialSessionId?: string)
```

Resume triggers **whenever `initialSessionId` changes to a new non-empty value** (not just on mount). This handles both first load and in-page navigation between session cards without a full remount.

The effect:
1. Guard: if `initialSessionId` equals current `sessionId`, skip (prevent double-fetch)
2. Clear prior local state (messages, sections, phase, etc.)
3. Set `sessionId` state to `initialSessionId`
4. Fetch `GET /api/ai/agent/state?sessionId={id}` to hydrate workspace state (phase, sections, blueprint, eligibility, warnings)
5. Fetch `GET /api/ai/agent/sessions/{id}/messages` to hydrate conversation history
6. Map stored messages to `AgentMessage[]` display format in the hook (filter/transform `tool` role messages into compact activity indicators)
7. Set `status` to `'idle'` when both complete

This gives the user a full resume experience: conversation history in the left pane, workspace state in the right pane, ready to continue.

**File:** `app/src/hooks/useAgent.ts`

### 4. /proiecte/nou page: read ?session= from URL

Read `searchParams.session` and pass to `useAgent`:

```typescript
const sessionId = searchParams?.session as string | undefined
const agent = useAgent(locale, sessionId)
```

**File:** `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx`

## What This Spec Does NOT Add

- Dashboard/project page wiring to show V3 sessions (phase 2)
- Section version history or rollback API (phase 3)
- Session deletion, archival, or V2 migration
- Feature flag checks on the listing endpoint (all authenticated users can list their own V3 sessions, even if they can't create new ones)

## Testing

### Integration tests for session listing
- Returns sessions filtered by status
- Returns sessions filtered by projectId
- Returns empty array for user with no sessions
- Includes projectTitle and sectionCount
- Returns 401 for unauthenticated request
- Excludes sessions belonging to other users (verify empty result, not 403)

### Integration tests for message history
- Returns messages for session owner
- Returns 404 for non-existent or other user's session
- Excludes compacted messages
- Orders by sequenceNumber ascending

### useAgent hook
- Verify resumeSession hydrates messages and workspace state on mount

## Files

| Action | File |
|--------|------|
| Create | `app/src/app/api/ai/agent/sessions/route.ts` |
| Create | `app/src/app/api/ai/agent/sessions/[sessionId]/messages/route.ts` |
| Create | `app/tests/integration/agent-sessions-list.test.ts` |
| Create | `app/tests/integration/agent-session-messages.test.ts` |
| Modify | `app/src/hooks/useAgent.ts` |
| Modify | `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` |
