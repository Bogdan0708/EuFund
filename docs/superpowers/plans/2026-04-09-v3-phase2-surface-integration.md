# V3 Phase 2: Surface V3 Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace V2 orchestrator session references on dashboard and project detail with V3 agent session summaries.

**Architecture:** Two page modifications (dashboard, project detail) that swap V2 orchestrator fetch calls for V3 agent session endpoints. No new backend work — consumes the `GET /api/ai/agent/sessions` endpoint built in Phase 1. Adds shared i18n keys for session phase/status labels.

**Tech Stack:** Next.js 14 App Router, next-intl, csrfFetch, motion/react

**Spec:** `docs/superpowers/specs/2026-04-09-v3-phase2-surface-integration-design.md`

---

### Task 1: Add i18n keys for session phase, status, and UI strings

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`

- [ ] **Step 1: Add session namespace keys to ro.json**

Add a new `"session"` top-level namespace after the `"projects"` namespace (around line 823):

```json
"session": {
  "phase": {
    "discovery": "Descoperire",
    "research": "Cercetare",
    "structuring": "Structurare",
    "drafting": "Redactare",
    "review": "Revizuire"
  },
  "status": {
    "active": "Activă",
    "paused": "Întreruptă",
    "error": "Eroare",
    "completed": "Finalizată",
    "abandoned": "Abandonată"
  },
  "resume": "Reia sesiunea",
  "view": "Vezi detalii",
  "noActiveSession": "Nicio sesiune activă",
  "noSessions": "Nicio sesiune AI încă",
  "sections": "{count} secțiuni",
  "untitledProject": "Proiect fără titlu"
}
```

- [ ] **Step 2: Add session namespace keys to en.json**

Add the same `"session"` namespace to `en.json`:

```json
"session": {
  "phase": {
    "discovery": "Discovery",
    "research": "Research",
    "structuring": "Structuring",
    "drafting": "Drafting",
    "review": "Review"
  },
  "status": {
    "active": "Active",
    "paused": "Paused",
    "error": "Error",
    "completed": "Completed",
    "abandoned": "Abandoned"
  },
  "resume": "Resume session",
  "view": "View details",
  "noActiveSession": "No active session",
  "noSessions": "No AI sessions yet",
  "sections": "{count} sections",
  "untitledProject": "Untitled project"
}
```

- [ ] **Step 3: Commit**

```bash
git add app/src/messages/ro.json app/src/messages/en.json
git commit -m "feat(i18n): add session phase, status, and UI string keys for V3 surface integration"
```

---

### Task 2: Replace V2 session fetch on dashboard with V3

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/panou/page.tsx`
- Create: `app/tests/integration/dashboard-v3-sessions.test.ts`

- [ ] **Step 1: Write the test**

Create `app/tests/integration/dashboard-v3-sessions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'

describe('Dashboard V3 session integration', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('GET /api/ai/agent/sessions returns data consumable by dashboard', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))

    const mockSessions = [
      {
        id: 'sess-1',
        projectId: 'proj-1',
        projectTitle: 'Test Project',
        status: 'active',
        currentPhase: 'drafting',
        locale: 'ro',
        selectedCallId: null,
        messageSummary: 'Working on proposal',
        stateVersion: 3,
        sectionCount: 5,
        createdAt: new Date('2026-04-09T10:00:00Z'),
        updatedAt: new Date('2026-04-09T11:00:00Z'),
      },
    ]

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(mockSessions),
                }),
              }),
            }),
          }),
        }),
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/route')
    const req = new NextRequest('http://localhost/api/ai/agent/sessions?status=active&limit=1')
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)

    // Verify the shape has what dashboard needs
    const session = json.data[0]
    expect(session).toHaveProperty('id')
    expect(session).toHaveProperty('currentPhase')
    expect(session).toHaveProperty('projectTitle')
    expect(session).toHaveProperty('sectionCount')
    expect(session).toHaveProperty('updatedAt')
    expect(session).toHaveProperty('status')
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/dashboard-v3-sessions.test.ts`
Expected: PASS (endpoint already exists from Phase 1)

- [ ] **Step 3: Update the dashboard page**

In `app/src/app/[locale]/(dashboard)/panou/page.tsx`, make these changes:

Replace the `AISession` interface (lines 13-17):

```typescript
interface V3Session {
  id: string;
  projectTitle: string | null;
  currentPhase: string;
  status: string;
  messageSummary: string | null;
  sectionCount: number;
  updatedAt: string;
}
```

Replace `useState<AISession | null>(null)` (line 42):

```typescript
const [activeSession, setActiveSession] = useState<V3Session | null>(null);
```

Replace the V2 session fetch in `fetchData()` (lines 58-66):

```typescript
        const [sessRes, projRes] = await Promise.all([
          csrfFetch('/api/ai/agent/sessions?status=active&limit=1'),
          fetch('/api/v1/projects?perPage=3'),
        ]);

        if (sessRes.ok) {
          const sessData = await sessRes.json();
          const sessions: V3Session[] = sessData.data ?? [];
          setActiveSession(sessions[0] ?? null);
        }
```

Replace the hero submit handler (lines 84-99) to navigate to `/proiecte/nou` instead of V2 orchestrator:

```typescript
  async function handleHeroSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim() || submitting) return;
    setSubmitting(true);
    router.push(`/${locale}/proiecte/nou`);
  }
```

Replace the active session card rendering (lines 270-302). Replace the V2 progress bar (currentStep/7) with phase badge and section count:

```typescript
              {activeSession && (
                <div
                  className="bg-white rounded-[1.5rem] p-6 shadow-sm flex items-center gap-6 group cursor-pointer border border-transparent hover:border-outline-variant/20 transition-all"
                  onClick={() => router.push(`/${locale}/proiecte/nou?session=${activeSession.id}`)}
                >
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-primary/10 flex items-center justify-center text-primary">
                    <Icon name="smart_toy" filled size="lg" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-lg">
                      {activeSession.projectTitle ?? tSession('untitledProject')}
                    </h4>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        {tSession(`phase.${activeSession.currentPhase}`)}
                      </span>
                      <span className="text-xs text-on-surface-variant">
                        {tSession('sections', { count: activeSession.sectionCount })}
                      </span>
                      <span className="text-xs text-on-surface-variant flex items-center gap-1">
                        <Icon name="schedule" size="sm" />
                        {relativeTime(activeSession.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <Icon
                    name="chevron_right"
                    className="text-on-surface-variant group-hover:translate-x-1 transition-transform"
                    size="md"
                  />
                </div>
              )}
```

Add the session translations hook near the other `useTranslations` call:

```typescript
  const tSession = useTranslations('session');
```

- [ ] **Step 4: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 5: Commit**

```bash
git add app/src/app/[locale]/(dashboard)/panou/page.tsx app/tests/integration/dashboard-v3-sessions.test.ts
git commit -m "feat(dashboard): replace V2 orchestrator session card with V3 agent session"
```

---

### Task 3: Replace V2 session fetch on project detail with V3

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`

- [ ] **Step 1: Update V3 session interface and fetch**

In `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`:

Replace the `WorkflowSession` interface (around line 44) with:

```typescript
interface V3Session {
  id: string;
  projectTitle: string | null;
  currentPhase: string;
  status: string;
  sectionCount: number;
  updatedAt: string;
}

const RESUMABLE_STATUSES = ['active', 'paused', 'error'];
```

Replace the V2 sessions fetch (around line 492):

```typescript
      csrfFetch(`/api/ai/agent/sessions?projectId=${id}`).then(r => r.ok ? r.json() : { data: [] }).catch(() => ({ data: [] })),
```

Replace the session state variable and assignment. Find where `setAiSessionId` is called (around line 496):

```typescript
      const v3Sessions: V3Session[] = sessionsData.data ?? [];
      setProjectSessions(v3Sessions);
      setAiSessionId(v3Sessions.find(s => RESUMABLE_STATUSES.includes(s.status))?.id ?? null);
```

Add the `projectSessions` state near the other state declarations:

```typescript
const [projectSessions, setProjectSessions] = useState<V3Session[]>([]);
```

- [ ] **Step 2: Update session display in overview tab**

Find the overview tab section that shows the AI session link (varies by current code) and replace it with a session cards list. If there's an existing AI session display, replace it. If not, add after the project summary section:

```typescript
            {/* V3 AI Sessions */}
            {projectSessions.length > 0 && (
              <div className="mt-8">
                <h3 className="text-sm font-semibold text-on-surface-variant mb-3">
                  {tSession('noSessions').replace('yet', '')} {/* Use heading label */}
                </h3>
                <div className="space-y-2">
                  {projectSessions.map(s => (
                    <div
                      key={s.id}
                      className="flex items-center gap-4 p-4 rounded-xl bg-surface-container-low hover:bg-surface-container transition-colors cursor-pointer"
                      onClick={() => RESUMABLE_STATUSES.includes(s.status)
                        ? router.push(`/${locale}/proiecte/nou?session=${s.id}`)
                        : undefined
                      }
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                            {tSession(`phase.${s.currentPhase}`)}
                          </span>
                          <span className="text-[10px] font-medium text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full">
                            {tSession(`status.${s.status}`)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-on-surface-variant">
                          <span>{tSession('sections', { count: s.sectionCount })}</span>
                          <span>{relativeTime(s.updatedAt)}</span>
                        </div>
                      </div>
                      {RESUMABLE_STATUSES.includes(s.status) && (
                        <span className="text-xs font-semibold text-primary">{tSession('resume')}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
```

Add the session translations hook near other `useTranslations`:

```typescript
  const tSession = useTranslations('session');
```

Add `relativeTime` import if not already present.

- [ ] **Step 3: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git add app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx
git commit -m "feat(project-detail): replace V2 orchestrator sessions with V3 agent sessions"
```

---

### Task 4: Full verification

- [ ] **Step 1: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 2: Run full test suite**

Run: `cd app && npx vitest run tests/`
Expected: All tests pass (734+), 0 failures

- [ ] **Step 3: Run lint**

Run: `cd app && npm run lint`
Expected: No new lint errors
