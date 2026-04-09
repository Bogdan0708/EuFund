# V3 Phase 3: Section Version History & Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add API endpoints to browse section version history, transition section state, and rollback to previous versions for V3 agent sessions.

**Architecture:** Four new API routes under `/api/ai/agent/sessions/[sessionId]/sections/`. All follow the same auth pattern as Phase 1 (requireAuth + session ownership check). State machine transitions enforce allowed paths. Rollback appends a new version (never mutates history) and bumps both section and session updatedAt.

**Tech Stack:** Next.js 14 App Router, Drizzle ORM, Vitest

**Spec:** `docs/superpowers/specs/2026-04-09-v3-phase3-section-history-rollback-design.md`

---

### Task 1: GET /api/ai/agent/sessions/[sessionId]/sections — Section listing

**Files:**
- Create: `app/src/app/api/ai/agent/sessions/[sessionId]/sections/route.ts`
- Create: `app/tests/integration/agent-section-list.test.ts`

- [ ] **Step 1: Write the test**

Create `app/tests/integration/agent-section-list.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'

describe('GET /api/ai/agent/sessions/[sessionId]/sections', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('returns sections ordered by documentOrder', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { id: 's1', sectionKey: 'executive-summary', title: 'Rezumat', status: 'draft', documentOrder: 0, versionCount: 2, updatedAt: new Date() },
                { id: 's2', sectionKey: 'methodology', title: 'Metodologie', status: 'accepted', documentOrder: 1, versionCount: 3, updatedAt: new Date() },
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
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections`)
    const res = await GET(req, { params: { sessionId: SESSION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(2)
    expect(json.data[0].sectionKey).toBe('executive-summary')
    expect(json.data[0]).toHaveProperty('versionCount')
  })

  it('returns 404 for unauthorized session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections`)
    const res = await GET(req, { params: { sessionId: SESSION_ID } })

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/agent-section-list.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the endpoint**

Create `app/src/app/api/ai/agent/sessions/[sessionId]/sections/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and, asc, sql } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: { sessionId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId } = params

    if (!UUID_RE.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId format' }, { status: 400 })
    }

    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const rows = await db
      .select({
        id: agentSections.id,
        sectionKey: agentSections.sectionKey,
        title: agentSections.title,
        status: agentSections.status,
        documentOrder: agentSections.documentOrder,
        versionCount: sql<number>`(SELECT count(*) FROM agent_section_versions WHERE section_id = ${agentSections.id})`.as('version_count'),
        updatedAt: agentSections.updatedAt,
      })
      .from(agentSections)
      .where(eq(agentSections.sessionId, sessionId))
      .orderBy(asc(agentSections.documentOrder))

    return NextResponse.json({ success: true, data: rows })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Error' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/agent-section-list.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/ai/agent/sessions/\[sessionId\]/sections/route.ts app/tests/integration/agent-section-list.test.ts
git commit -m "feat(agent): add GET /api/ai/agent/sessions/[sessionId]/sections listing endpoint"
```

---

### Task 2: GET /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions — Version history

**Files:**
- Create: `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route.ts`
- Create: `app/tests/integration/agent-section-versions.test.ts`

- [ ] **Step 1: Write the test**

Create `app/tests/integration/agent-section-versions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('GET /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('returns all versions with full content, newest first', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockResolvedValue([
                { id: 'v3', versionNumber: 3, kind: 'regenerated', content: 'Version 3 text', modelUsed: 'claude-sonnet', sourcesUsed: [], createdAt: new Date() },
                { id: 'v2', versionNumber: 2, kind: 'draft', content: 'Version 2 text', modelUsed: 'claude-sonnet', sourcesUsed: [], createdAt: new Date() },
                { id: 'v1', versionNumber: 1, kind: 'draft', content: 'Version 1 text', modelUsed: 'claude-sonnet', sourcesUsed: [], createdAt: new Date() },
              ]),
            }),
          }),
        }),
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID }),
          },
        },
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/versions`)
    const res = await GET(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(3)
    expect(json.data[0].versionNumber).toBe(3)
    expect(json.data[0].content).toBe('Version 3 text')
    expect(json.data[2].versionNumber).toBe(1)
  })

  it('returns 404 for non-existent section', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue(null),
          },
        },
      },
    }))

    const { GET } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/versions`)
    const res = await GET(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/agent-section-versions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the endpoint**

Create `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections, agentSectionVersions } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Params = { params: { sessionId: string; sectionId: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId, sectionId } = params

    if (!UUID_RE.test(sessionId) || !UUID_RE.test(sectionId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
    }

    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const section = await db.query.agentSections.findFirst({
      where: and(eq(agentSections.id, sectionId), eq(agentSections.sessionId, sessionId)),
    })
    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    const rows = await db
      .select({
        id: agentSectionVersions.id,
        versionNumber: agentSectionVersions.versionNumber,
        kind: agentSectionVersions.kind,
        content: agentSectionVersions.content,
        modelUsed: agentSectionVersions.modelUsed,
        sourcesUsed: agentSectionVersions.sourcesUsed,
        createdAt: agentSectionVersions.createdAt,
      })
      .from(agentSectionVersions)
      .where(eq(agentSectionVersions.sectionId, sectionId))
      .orderBy(desc(agentSectionVersions.versionNumber))

    return NextResponse.json({ success: true, data: rows })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Error' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/agent-section-versions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/ai/agent/sessions/\[sessionId\]/sections/\[sectionId\]/versions/route.ts app/tests/integration/agent-section-versions.test.ts
git commit -m "feat(agent): add GET /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/versions endpoint"
```

---

### Task 3: POST /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback — Rollback

**Files:**
- Create: `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts`
- Create: `app/tests/integration/agent-section-rollback.test.ts`

- [ ] **Step 1: Write the test**

Create `app/tests/integration/agent-section-rollback.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('POST /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('creates new version with rolled-back content and resets status', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))

    const insertedVersion = { id: 'v-new', versionNumber: 4, kind: 'system_rewrite', content: 'Old content from v2', modelUsed: null, sourcesUsed: null, createdAt: new Date() }

    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'active' }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID, status: 'accepted' }),
          },
        },
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ versionNumber: 3 }]),
              }),
            }),
          }),
        }),
        transaction: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
          const tx = {
            select: vi.fn().mockReturnValue({
              from: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ id: 'v2', versionNumber: 2, content: 'Old content from v2', modelUsed: null, sourcesUsed: null }]),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              values: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([insertedVersion]),
              }),
            }),
            update: vi.fn().mockReturnValue({
              set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
              }),
            }),
          }
          return fn(tx)
        }),
      },
    }))

    const { POST } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 2 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.kind).toBe('system_rewrite')
    expect(json.data.content).toBe('Old content from v2')
  })

  it('returns 409 for completed session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'completed' }),
          },
        },
      },
    }))

    const { POST } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ targetVersion: 1 }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await POST(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/agent-section-rollback.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the endpoint**

Create `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections, agentSectionVersions } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TERMINAL_STATUSES = ['completed', 'abandoned']

type Params = { params: { sessionId: string; sectionId: string } }

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId, sectionId } = params

    if (!UUID_RE.test(sessionId) || !UUID_RE.test(sectionId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
    }

    const body = await req.json()
    const targetVersion = body?.targetVersion
    if (typeof targetVersion !== 'number' || targetVersion < 1) {
      return NextResponse.json({ error: 'targetVersion must be a positive integer' }, { status: 400 })
    }

    // Verify session ownership and status
    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (TERMINAL_STATUSES.includes(session.status)) {
      return NextResponse.json({ error: 'Session is not active' }, { status: 409 })
    }

    // Verify section belongs to session
    const section = await db.query.agentSections.findFirst({
      where: and(eq(agentSections.id, sectionId), eq(agentSections.sessionId, sessionId)),
    })
    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    // Get current max version
    const [maxRow] = await db
      .select({ versionNumber: agentSectionVersions.versionNumber })
      .from(agentSectionVersions)
      .where(eq(agentSectionVersions.sectionId, sectionId))
      .orderBy(desc(agentSectionVersions.versionNumber))
      .limit(1)

    const currentMax = maxRow?.versionNumber ?? 0

    // Execute rollback in a transaction
    const newVersion = await db.transaction(async (tx) => {
      // Find target version content
      const [target] = await tx
        .select()
        .from(agentSectionVersions)
        .where(and(
          eq(agentSectionVersions.sectionId, sectionId),
          eq(agentSectionVersions.versionNumber, targetVersion),
        ))

      if (!target) {
        throw Object.assign(new Error('Target version not found'), { statusCode: 400 })
      }

      // Append new version with rolled-back content
      const [inserted] = await tx
        .insert(agentSectionVersions)
        .values({
          sectionId,
          versionNumber: currentMax + 1,
          kind: 'system_rewrite',
          content: target.content,
          modelUsed: target.modelUsed,
          sourcesUsed: target.sourcesUsed,
        })
        .returning()

      // Update section: restore content, reset status, bump updatedAt
      const now = new Date()
      await tx
        .update(agentSections)
        .set({ content: target.content, status: 'draft', updatedAt: now })
        .where(eq(agentSections.id, sectionId))

      // Bump session updatedAt
      await tx
        .update(agentSessions)
        .set({ updatedAt: now })
        .where(eq(agentSessions.id, sessionId))

      return inserted
    })

    return NextResponse.json({ success: true, data: newVersion })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; message?: string; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: e.message || 'Error' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/agent-section-rollback.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/ai/agent/sessions/\[sessionId\]/sections/\[sectionId\]/rollback/route.ts app/tests/integration/agent-section-rollback.test.ts
git commit -m "feat(agent): add POST /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/rollback endpoint"
```

---

### Task 4: PATCH /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state — State transition

**Files:**
- Create: `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route.ts`
- Create: `app/tests/integration/agent-section-state.test.ts`

- [ ] **Step 1: Write the test**

Create `app/tests/integration/agent-section-state.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const SESSION_ID = '22222222-2222-4222-8222-222222222222'
const SECTION_ID = '33333333-3333-4333-8333-333333333333'

describe('PATCH /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('@/lib/logger', () => ({
      logger: { child: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
    }))
  })

  it('allows valid transition draft → accepted', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'active' }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID, status: 'draft' }),
          },
        },
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([
                { id: SECTION_ID, sectionKey: 'summary', title: 'Summary', status: 'accepted', documentOrder: 0, updatedAt: new Date() },
              ]),
            }),
          }),
        }),
      },
    }))

    const { PATCH } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.status).toBe('accepted')
  })

  it('rejects invalid transition pending → accepted', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'active' }),
          },
          agentSections: {
            findFirst: vi.fn().mockResolvedValue({ id: SECTION_ID, sessionId: SESSION_ID, status: 'pending' }),
          },
        },
      },
    }))

    const { PATCH } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(400)
  })

  it('returns 409 for completed session', async () => {
    vi.doMock('@/lib/auth/helpers', () => ({
      requireAuth: vi.fn().mockResolvedValue({ id: USER_ID, email: 'u@test.com' }),
    }))
    vi.doMock('@/lib/db', () => ({
      db: {
        query: {
          agentSessions: {
            findFirst: vi.fn().mockResolvedValue({ id: SESSION_ID, userId: USER_ID, status: 'completed' }),
          },
        },
      },
    }))

    const { PATCH } = await import('@/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route')
    const req = new NextRequest(`http://localhost/api/ai/agent/sessions/${SESSION_ID}/sections/${SECTION_ID}/state`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'accepted' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await PATCH(req, { params: { sessionId: SESSION_ID, sectionId: SECTION_ID } })

    expect(res.status).toBe(409)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run tests/integration/agent-section-state.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the endpoint**

Create `app/src/app/api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TERMINAL_STATUSES = ['completed', 'abandoned']

// User-allowed state transitions
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ['accepted', 'needs_review'],
  needs_review: ['accepted', 'draft'],
  accepted: ['draft'],
}

type Params = { params: { sessionId: string; sectionId: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth()
    const { sessionId, sectionId } = params

    if (!UUID_RE.test(sessionId) || !UUID_RE.test(sectionId)) {
      return NextResponse.json({ error: 'Invalid ID format' }, { status: 400 })
    }

    const body = await req.json()
    const targetStatus = body?.status
    if (typeof targetStatus !== 'string') {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    // Verify session ownership and status
    const session = await db.query.agentSessions.findFirst({
      where: and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, user.id)),
    })
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }
    if (TERMINAL_STATUSES.includes(session.status)) {
      return NextResponse.json({ error: 'Session is not active' }, { status: 409 })
    }

    // Verify section belongs to session
    const section = await db.query.agentSections.findFirst({
      where: and(eq(agentSections.id, sectionId), eq(agentSections.sessionId, sessionId)),
    })
    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 })
    }

    // Validate transition
    const allowed = ALLOWED_TRANSITIONS[section.status]
    if (!allowed || !allowed.includes(targetStatus)) {
      return NextResponse.json(
        { error: `Cannot transition from '${section.status}' to '${targetStatus}'` },
        { status: 400 },
      )
    }

    // Apply transition
    const [updated] = await db
      .update(agentSections)
      .set({ status: targetStatus as typeof section.status, updatedAt: new Date() })
      .where(eq(agentSections.id, sectionId))
      .returning()

    return NextResponse.json({ success: true, data: updated })
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const e = error as { statusCode: number; toResponse?: (l: string) => unknown }
      return NextResponse.json(
        e.toResponse ? e.toResponse('ro') : { error: 'Error' },
        { status: e.statusCode },
      )
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run tests/integration/agent-section-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/ai/agent/sessions/\[sessionId\]/sections/\[sectionId\]/state/route.ts app/tests/integration/agent-section-state.test.ts
git commit -m "feat(agent): add PATCH /api/ai/agent/sessions/[sessionId]/sections/[sectionId]/state endpoint"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: Clean

- [ ] **Step 2: Run full test suite**

Run: `cd app && npx vitest run tests/`
Expected: All tests pass (740+), 0 failures

- [ ] **Step 3: Run lint**

Run: `cd app && npm run lint`
Expected: No new lint errors
