# V3 Session Inventory & Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session listing endpoint, message history endpoint, and first-class resume to the V3 agent system.

**Architecture:** Two new API routes (`sessions/route.ts`, `sessions/[sessionId]/messages/route.ts`) following existing V3 patterns (plain `NextResponse.json`, `requireAuth()`, `db` queries filtered by userId). The `useAgent` hook gains an `initialSessionId` parameter with an effect that hydrates both workspace state and conversation history on change.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, Vitest, React hooks

**Spec:** `docs/superpowers/specs/2026-04-09-v3-session-inventory-design.md`

---

### Task 1: GET /api/ai/agent/sessions — Session listing endpoint

**Files:**
- Create: `app/src/app/api/ai/agent/sessions/route.ts`
- Create: `app/tests/integration/agent-sessions-list.test.ts`

- [ ] **Step 1: Write the test**

Create `app/tests/integration/agent-sessions-list.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('GET /api/ai/agent/sessions', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));
  });

  it('returns sessions for the authenticated user', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }));

    const mockSessions = [
      {
        id: 'sess-1',
        userId: USER_ID,
        projectId: 'proj-1',
        status: 'active',
        currentPhase: 'drafting',
        locale: 'ro',
        selectedCallId: null,
        messageSummary: 'Working on proposal',
        stateVersion: 3,
        createdAt: new Date('2026-04-09T10:00:00Z'),
        updatedAt: new Date('2026-04-09T11:00:00Z'),
      },
    ];

    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue(
                    mockSessions.map(s => ({ ...s, projectTitle: 'Test Project', sectionCount: 5 }))
                  ),
                }),
              }),
            }),
          }),
        }),
      },
    }));

    const { GET } = await import('@/app/api/ai/agent/sessions/route');
    const req = new NextRequest('http://localhost/api/ai/agent/sessions');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe('sess-1');
    expect(json.data[0].currentPhase).toBe('drafting');
  });

  it('returns 401 when not authenticated', async () => {
    const { Errors } = await import('@/lib/errors');
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockRejectedValue(Errors.unauthorized()),
    }));
    vi.doMock('@/lib/db', () => ({ db: {} }));

    const { GET } = await import('@/app/api/ai/agent/sessions/route');
    const req = new NextRequest('http://localhost/api/ai/agent/sessions');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/agent-sessions-list.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the endpoint**

Create `app/src/app/api/ai/agent/sessions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections, projects } from '@/lib/db/schema'
import { eq, and, inArray, desc, sql } from 'drizzle-orm'

const RESUMABLE_STATUSES = ['active', 'paused', 'error'] as const
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()

    const url = req.nextUrl
    const statusParam = url.searchParams.get('status')
    const projectId = url.searchParams.get('projectId')
    const limitParam = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || '', 10) || DEFAULT_LIMIT))

    // Parse status filter
    const statuses = statusParam
      ? statusParam.split(',').filter(Boolean)
      : [...RESUMABLE_STATUSES]

    // Validate projectId is UUID-like if provided
    if (projectId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
      return NextResponse.json({ error: 'Invalid projectId format' }, { status: 400 })
    }

    // Build where conditions
    const conditions = [
      eq(agentSessions.userId, user.id),
      inArray(agentSessions.status, statuses),
    ]
    if (projectId) {
      conditions.push(eq(agentSessions.projectId, projectId))
    }

    const rows = await db
      .select({
        id: agentSessions.id,
        projectId: agentSessions.projectId,
        projectTitle: projects.title,
        status: agentSessions.status,
        currentPhase: agentSessions.currentPhase,
        locale: agentSessions.locale,
        selectedCallId: agentSessions.selectedCallId,
        messageSummary: agentSessions.messageSummary,
        stateVersion: agentSessions.stateVersion,
        createdAt: agentSessions.createdAt,
        updatedAt: agentSessions.updatedAt,
        sectionCount: sql<number>`(SELECT count(*) FROM agent_sections WHERE session_id = ${agentSessions.id})`.as('section_count'),
      })
      .from(agentSessions)
      .leftJoin(projects, eq(agentSessions.projectId, projects.id))
      .where(and(...conditions))
      .orderBy(desc(agentSessions.updatedAt))
      .limit(limitParam)

    return NextResponse.json({ success: true, data: rows })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Forbidden' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/agent-sessions-list.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent): add GET /api/ai/agent/sessions listing endpoint"
```

---

### Task 2: GET /api/ai/agent/sessions/[sessionId]/messages — Message history endpoint

**Files:**
- Create: `app/src/app/api/ai/agent/sessions/[sessionId]/messages/route.ts`
- Create: `app/tests/integration/agent-session-messages.test.ts`

- [ ] **Step 1: Write the test**

Create `app/tests/integration/agent-session-messages.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

describe('GET /api/ai/agent/sessions/[sessionId]/messages', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }));
  });

  it('returns messages for session owner', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { id: 'm1', role: 'user', content: 'Hello', toolName: null, toolCallId: null, createdAt: new Date() },
                { id: 'm2', role: 'assistant', content: 'Hi there', toolName: null, toolCallId: null, createdAt: new Date() },
                { id: 'm3', role: 'tool', content: '{"result": true}', toolName: 'search-calls', toolCallId: 'tc1', createdAt: new Date() },
              ]),
            }),
          }),
        }),
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
          },
        },
      },
    }));

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/messages/route');
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/messages`);
    const res = await GET(req, { params: { sessionId: SESSION_ID } });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(3);
    expect(json.data[2].role).toBe('tool');
    expect(json.data[2].toolName).toBe('search-calls');
  });

  it('returns 404 for non-existent or other user session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }));
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }));

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/messages/route');
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/messages`);
    const res = await GET(req, { params: { sessionId: SESSION_ID } });

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/agent-session-messages.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the endpoint**

Create `app/src/app/api/ai/agent/sessions/[sessionId]/messages/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentMessages } from '@/lib/db/schema'
import { eq, and, isNull, asc } from 'drizzle-orm'

type Params = { params: { sessionId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId } = params

    // Verify session exists and belongs to user
    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    // Load non-compacted messages in order
    const rows = await db
      .select({
        id: agentMessages.id,
        role: agentMessages.role,
        content: agentMessages.content,
        toolName: agentMessages.toolName,
        toolCallId: agentMessages.toolCallId,
        createdAt: agentMessages.createdAt,
      })
      .from(agentMessages)
      .where(and(
        eq(agentMessages.sessionId, sessionId),
        isNull(agentMessages.compactedAt),
      ))
      .orderBy(asc(agentMessages.sequenceNumber))

    return NextResponse.json({
      success: true,
      data: rows.map(r => ({
        ...r,
        content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content),
      })),
    })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Unauthorized' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/agent-session-messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(agent): add GET /api/ai/agent/sessions/[sessionId]/messages endpoint"
```

---

### Task 3: useAgent hook — add initialSessionId with resume effect

**Files:**
- Modify: `app/src/hooks/useAgent.ts`

- [ ] **Step 1: Add initialSessionId parameter to the hook signature**

Change line 31 from:
```typescript
export function useAgent(locale: 'ro' | 'en') {
```
To:
```typescript
export function useAgent(locale: 'ro' | 'en', initialSessionId?: string) {
```

- [ ] **Step 2: Add the resume effect after the reconnect callback (after line 254)**

Add this `useEffect` block:

```typescript
  // ── Resume from initialSessionId ──────────────────────────
  import { useEffect } from 'react'

  useEffect(() => {
    if (!initialSessionId || initialSessionId === sessionId) return

    let cancelled = false

    async function resumeSession() {
      setStatus('connecting')
      setError(null)
      // Clear prior state
      setMessages([])
      setSections([])
      setWarnings([])
      setBlueprint(null)
      setEligibility(null)
      setPhase('discovery')
      setSessionId(initialSessionId!)

      try {
        // Fetch workspace state + messages in parallel
        const [stateRes, msgsRes] = await Promise.all([
          csrfFetch(`/api/ai/agent/state?sessionId=${initialSessionId}`),
          csrfFetch(`/api/ai/agent/sessions/${initialSessionId}/messages`),
        ])

        if (cancelled) return

        if (stateRes.ok) {
          const state: UIStateSnapshot = await stateRes.json()
          applyFinalState(state)
        }

        if (msgsRes.ok) {
          const { data } = await msgsRes.json()
          const restored: AgentMessage[] = (data as Array<{
            id: string; role: string; content: string;
            toolName?: string; createdAt: string;
          }>).map((m) => ({
            id: m.id,
            role: m.role === 'tool' ? 'system' as const : m.role as 'user' | 'assistant' | 'system',
            content: m.content,
            toolName: m.toolName || undefined,
            isToolActivity: m.role === 'tool',
            timestamp: new Date(m.createdAt).getTime(),
          }))
          if (!cancelled) setMessages(restored)
        }

        if (!cancelled) setStatus('idle')
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Failed to resume session')
        }
      }
    }

    resumeSession()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId])
```

Note: Move the `useEffect` import to the top of the file (line 2) alongside the existing React imports:
```typescript
import { useState, useCallback, useRef, useEffect } from 'react'
```

- [ ] **Step 3: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent): add initialSessionId resume support to useAgent hook"
```

---

### Task 4: /proiecte/nou page — read ?session= from URL

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx`

- [ ] **Step 1: Update the page to read searchParams and pass to useAgent**

Replace the current page component:

```typescript
'use client'

import { useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import { useAgent } from '@/hooks/useAgent'
import { AgentConversation } from '@/components/agent/AgentConversation'
import { AgentWorkspace } from '@/components/agent/AgentWorkspace'

export default function NewProjectPage({
  params: { locale },
}: {
  params: { locale: string }
}) {
  const t = useTranslations('projects')
  const searchParams = useSearchParams()
  const initialSessionId = searchParams?.get('session') || undefined
  const agent = useAgent(locale as 'ro' | 'en', initialSessionId)

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">
          {t(initialSessionId ? 'resumeProject' : 'newProject')}
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {t('agentDescription')}
        </p>
      </div>

      {/* Main content — conversation left, workspace right */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: Conversation */}
        <div className="w-1/2 border-r border-gray-200 flex flex-col">
          <AgentConversation
            messages={agent.messages}
            status={agent.status}
            error={agent.error}
            onSendMessage={agent.sendMessage}
          />
        </div>

        {/* Right panel: Workspace */}
        <div className="w-1/2 bg-gray-50">
          <AgentWorkspace
            phase={agent.phase}
            sections={agent.sections}
            blueprint={agent.blueprint}
            eligibility={agent.eligibility}
            warnings={agent.warnings}
            onAction={agent.sendAction}
          />
        </div>
      </div>
    </div>
  )
}
```

Note: Add `resumeProject` key to both `app/src/messages/ro.json` and `en.json` under the `projects` namespace if it doesn't exist. Value: `"Continuă proiectul"` (ro) / `"Resume Project"` (en).

- [ ] **Step 2: Add i18n key if missing**

Check `app/src/messages/ro.json` for `projects.resumeProject`. If missing, add it. Same for `en.json`.

- [ ] **Step 3: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(agent): wire /proiecte/nou to resume sessions via ?session= URL param"
```

---

### Task 5: Full test suite verification

- [ ] **Step 1: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 2: Run full test suite**

Run: `cd app && npx vitest run`
Expected: All tests pass (730+), 0 failures

- [ ] **Step 3: Run lint**

Run: `cd app && npm run lint`
Expected: No new lint errors
