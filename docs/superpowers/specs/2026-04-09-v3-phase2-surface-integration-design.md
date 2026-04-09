# V3 Phase 2: Surface V3 Sessions in Dashboard & Project Pages — Design Spec

## Goal

Replace V2 orchestrator session references on dashboard and project detail with V3 agent session summaries. Resumable sessions link to `/proiecte/nou?session={id}`.

## Pages to Change

### 1. Dashboard (`/panou/page.tsx`)

- Replace V2 orchestrator session fetch with `csrfFetch('/api/ai/agent/sessions?status=active&limit=1')`
- Use the most recently updated active V3 session as the dashboard resume card (endpoint already sorts by `updatedAt DESC`)
- Map the returned V3 session summary into the existing card UI
- Show: phase badge, project title or fallback title, section count, relative updated time
- "Resume" navigates to `/proiecte/nou?session={id}`
- "Start new" continues to navigate to `/proiecte/nou`
- If no active session exists, show the existing empty state / hero flow without blocking the page

**Loading state:** Use current loading skeleton pattern.
**Fetch failure:** Fail silently — do not block the dashboard. Show the hero/empty state as fallback.

### 2. Project detail (`/proiecte/[id]/page.tsx`)

- Replace V2 orchestrator session fetch with `csrfFetch('/api/ai/agent/sessions?projectId={id}')`
- Show V3 sessions linked to the current project in the overview tab only
- Each session card shows: phase, status, section count, last updated time
- Show "Resume" only for resumable sessions (`active`, `paused`, `error`); terminal sessions (`completed`, `abandoned`) should not present a misleading resume CTA
- Do not change existing non-AI project tabs or document flows in this phase

**Empty state:** "No AI sessions yet" — must not break the project overview page.
**Fetch failure:** Do not break project overview rendering. Fail silently or show lightweight fallback.

### 3. No Changes

- `/proiecte/page.tsx` — no session data shown in list cards currently
- `/proiecte/nou` — already wired in Phase 1

## Replace V2 Card Model

Replace the V2 `AISession` interface (`{ id, currentStep, updatedAt }`) with a V3 session summary view model derived from `GET /api/ai/agent/sessions`. Do not hardcode the exact response shape — consume whatever the endpoint returns and map it into the page-local card view model.

The V2 fetch references to remove:
- `/panou/page.tsx`: `fetch('/api/ai/orchestrator/sessions?status=active&limit=1')`
- `/proiecte/[id]/page.tsx`: `fetch('/api/ai/orchestrator/sessions?limit=20')`

## Resume Link Rules

- If session status is resumable (`active`, `paused`, `error`): show "Resume" → `/proiecte/nou?session={id}`
- If session status is terminal (`completed`, `abandoned`): show "View" or no CTA — do not imply the session can be continued
- `/proiecte/nou?session={id}` already handles the resume flow (Phase 1)

## i18n

Add keys for:
- Phase labels: `session.phase.{discovery,planning,drafting,...}`
- Status labels: `session.status.{active,paused,error,completed,abandoned}`
- Resume/view CTAs: `session.resume`, `session.view`
- Empty states: `dashboard.noActiveSession`, `projects.noSessions`
- Loading/error fallbacks as needed

Use a shared `session` namespace rather than duplicating across `dashboard` and `projects`.

## Backend Assumption

No new endpoints required. `GET /api/ai/agent/sessions` already supports filtering by `status`, `limit`, and `projectId`, and returns results sorted by `updatedAt DESC`.

## Testing

### Integration tests
- Dashboard renders V3 session card when active session exists
- Dashboard shows empty state when no active sessions
- Project detail shows sessions filtered by projectId
- Project detail handles empty session list gracefully
- Resume CTA only appears for resumable statuses
- Fetch failures do not break page rendering

## Files

| Action | File |
|--------|------|
| Modify | `app/src/app/[locale]/(dashboard)/panou/page.tsx` |
| Modify | `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx` |
| Modify | `app/src/messages/ro.json` |
| Modify | `app/src/messages/en.json` |
| Create | `app/tests/integration/dashboard-v3-sessions.test.ts` |

## What This Spec Does NOT Add

- V3 session creation from dashboard (already exists via `/proiecte/nou`)
- V2 session migration or display
- Session deletion or archival UI
- Changes to the projects list page
- Changes to non-AI project tabs
