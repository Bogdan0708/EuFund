# App-Owned Workflow — PR 3: Deterministic `/actions/*` Endpoints + `changeCall()` Service

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose every workflow mutation as a session-scoped REST action endpoint. Add a dedicated `changeCall()` service that resets blueprint/outline/eligibility/sections in a single transaction. Wire UI buttons to call these endpoints behind a feature flag.

**Architecture:** Seven REST routes under `/api/v1/agent-sessions/[id]/actions/<name>` (run-eligibility, freeze-outline, change-call, accept-section, reject-section, rollback-section, export). Each route is thin: Zod validate → service call → `projectSessionState(...)` response. A shared envelope helper converts service errors to UI-friendly `{ error: { code, messageRo, messageEn } }` JSON. `changeCall()` is a new service function; `setSelectedCall` is untouched. UI buttons sit in `AgentWorkspace.tsx` and the `SelectedCallBanner.tsx`.

**Tech Stack:** Next.js 14 App Router, Zod, Drizzle, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-12-app-owned-workflow-design.md` §4

**Depends on:** PR 1 + PR 2 merged.

**Flag:** `deterministic_actions_enabled` (default `false` everywhere).

---

## File Inventory

**Create:**
- `app/drizzle/0037_deterministic_actions_flag.sql`
- `app/drizzle/meta/_journal.json` entry.
- `app/src/lib/ai/agent/services/change-call.ts` — `changeCall()` service.
- `app/src/lib/validation/agent-actions.ts` — Zod schemas for action bodies.
- `app/src/lib/api/agent-action-envelope.ts` — shared error→response helper.
- `app/src/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route.ts`
- `app/src/app/api/v1/agent-sessions/[id]/actions/freeze-outline/route.ts`
- `app/src/app/api/v1/agent-sessions/[id]/actions/change-call/route.ts`
- `app/src/app/api/v1/agent-sessions/[id]/actions/accept-section/route.ts`
- `app/src/app/api/v1/agent-sessions/[id]/actions/reject-section/route.ts`
- `app/src/app/api/v1/agent-sessions/[id]/actions/rollback-section/route.ts`
- `app/src/app/api/v1/agent-sessions/[id]/actions/export/route.ts`
- `app/src/lib/agent-actions/client.ts` — UI fetch helpers (`csrfFetch` wrappers).
- `app/tests/unit/change-call.test.ts`
- `app/tests/integration/actions/run-eligibility-route.test.ts`
- `app/tests/integration/actions/freeze-outline-route.test.ts`
- `app/tests/integration/actions/change-call-route.test.ts`
- `app/tests/integration/actions/accept-section-route.test.ts`
- `app/tests/integration/actions/reject-section-route.test.ts`
- `app/tests/integration/actions/rollback-section-route.test.ts`
- `app/tests/integration/actions/export-route.test.ts`

**Modify:**
- `app/src/lib/legal/audit.ts` — extend `AuditAction` union with `'session.call_changed'`.
- `app/src/hooks/useAgent.ts` — add `runAction(name, body)` method that merges the returned snapshot.
- `app/src/components/agent/AgentWorkspace.tsx` — add UI buttons (Freeze, Accept, Reject, Rollback, Export) routed through `runAction`. Visibility gated by `deterministic_actions_enabled` flag passed in as a prop.
- `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx` — pass `deterministic_actions_enabled` flag down.
- `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` — read the flag.
- `app/src/app/[locale]/(dashboard)/proiecte/nou/components/SelectedCallBanner.tsx` — Change button routes through `runAction('change-call', ...)` when flag on.
- `app/src/messages/ro.json` + `app/src/messages/en.json` — bilingual error codes for new action error shapes (`OUTLINE_NOT_READY`, `OUTLINE_ALREADY_FROZEN`, `CONCURRENCY_CONFLICT`, `VALIDATION_NO_OP`, `INVALID_CALL_ID`).

---

## Task 1: Seed `deterministic_actions_enabled` feature flag

**Files:**
- Create: `app/drizzle/0037_deterministic_actions_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Create the migration**

```sql
-- Seed the deterministic_actions_enabled feature flag (default disabled).
-- Gates the UI's use of /api/v1/agent-sessions/:id/actions/* endpoints.
-- When on, UI buttons drive workflow mutations via REST; when off, the
-- legacy in-chat tool path is used.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'deterministic_actions_enabled',
  false,
  'Gates the UI from routing workflow actions (freeze, accept, reject, rollback, change-call, export) through deterministic REST endpoints. When off, the legacy in-chat tool path is used.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Add journal entry**

```json
    {
      "idx": 37,
      "version": "7",
      "when": 1778803200001,
      "tag": "0037_deterministic_actions_flag",
      "breakpoints": true
    }
```

- [ ] **Step 3: Run migration**

```bash
cd app && npm run db:migrate
```

- [ ] **Step 4: Commit**

```bash
git add app/drizzle/0037_deterministic_actions_flag.sql app/drizzle/meta/_journal.json
git commit -m "feat(flags): seed deterministic_actions_enabled feature flag (off)"
```

---

## Task 2: Extend `AuditAction` union with `'session.call_changed'`

**Files:**
- Modify: `app/src/lib/legal/audit.ts`

- [ ] **Step 1: Add the union member**

In `app/src/lib/legal/audit.ts:15`, the `AuditAction` union. Add `'session.call_changed'` adjacent to the existing `'session.call_selected'`.

```ts
export type AuditAction =
  // ... existing entries
  | 'session.call_selected'
  | 'session.call_changed'
  // ... existing entries
```

`inferLegalBasis` already maps the `session.*` prefix to `'contract'` (per CLAUDE.md). No change there.

- [ ] **Step 2: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/legal/audit.ts
git commit -m "feat(audit): add session.call_changed action"
```

---

## Task 3: Create `changeCall()` service with unit test

**Files:**
- Create: `app/src/lib/ai/agent/services/change-call.ts`
- Test: `app/tests/unit/change-call.test.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// app/tests/unit/change-call.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbState: { session: Record<string, unknown> | null; sectionsDeleted: number } = {
  session: null,
  sectionsDeleted: 0,
}

vi.mock('@/lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (dbState.session ? [dbState.session] : []),
        }),
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: () => {
          dbState.session = { ...(dbState.session ?? {}), ...s }
          return Promise.resolve()
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        dbState.sectionsDeleted += 1
        return undefined
      },
    }),
  },
  withUserRLS: async (_uid: string, fn: (tx: unknown) => Promise<unknown>) => fn({}),
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

vi.mock('@/lib/ai/agent/services/blueprint', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/agent/services/blueprint')>(
    '@/lib/ai/agent/services/blueprint'
  )
  return {
    ...actual,
    lookupBlueprint: vi.fn().mockResolvedValue({ cached: false }),
  }
})

vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: vi.fn().mockResolvedValue({ matches: [{ callId: 'C-2', title: 'New Call', score: 0.9 }] }),
}))

describe('changeCall service', () => {
  beforeEach(() => {
    dbState.session = {
      id: 's1', userId: 'u1', selectedCallId: 'C-1',
      currentPhase: 'structuring', blueprint: { x: 1 }, outline: [{ id: 'a' }],
      eligibility: { score: 100 }, warnings: [],
      outlineFrozen: false, stateVersion: 3, status: 'active',
    }
    dbState.sectionsDeleted = 0
  })

  it('happy path: resets blueprint/outline/eligibility/warnings, deletes sections, bumps stateVersion once', async () => {
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    const out = await changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-2', expectedStateVersion: 3 },
    )
    expect(out.session.selectedCallId).toBe('C-2')
    expect(out.session.blueprint).toBeNull()
    expect(out.session.outline).toBeNull()
    expect(out.session.eligibility).toBeNull()
    expect(out.session.warnings).toEqual([])
    expect(out.session.currentPhase).toBe('research')
    expect(out.session.stateVersion).toBe(4)
    expect(out.sectionsDiscarded).toBeGreaterThanOrEqual(1)
  })

  it('rejects when newCallId equals current selectedCallId', async () => {
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    await expect(changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-1', expectedStateVersion: 3 },
    )).rejects.toThrow(/VALIDATION_NO_OP/)
  })

  it('rejects when outline is frozen', async () => {
    dbState.session = { ...(dbState.session ?? {}), outlineFrozen: true }
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    await expect(changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-2', expectedStateVersion: 3 },
    )).rejects.toThrow(/POLICY_OUTLINE_ALREADY_FROZEN/)
  })

  it('rejects when expectedStateVersion does not match (CAS conflict)', async () => {
    const { changeCall } = await import('@/lib/ai/agent/services/change-call')
    await expect(changeCall(
      { userId: 'u1', sessionId: 's1', requestId: 'r', now: new Date() },
      { sessionId: 's1', newCallId: 'C-2', expectedStateVersion: 999 },
    )).rejects.toThrow(/CONCURRENCY/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/unit/change-call.test.ts`
Expected: FAIL — module not yet created.

- [ ] **Step 3: Implement `change-call.ts`**

Create `app/src/lib/ai/agent/services/change-call.ts`:

```ts
// ── changeCall service ──────────────────────────────────────────────────
// Resets a session to a new call in a single transaction. Single CAS,
// single stateVersion bump, single audit entry. Distinct from
// setSelectedCall (which is used by preselect override paths and keeps
// its narrow scope).

import { and, eq, sql } from 'drizzle-orm'
import { db, withUserRLS } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { logAudit } from '@/lib/legal/audit'
import { logger } from '@/lib/logger'
import { ConcurrencyError, ValidationError, NotFoundError, AuthorizationError } from './errors'
import { lookupBlueprint, outlineFromBlueprint } from './blueprint'
import { searchCalls } from './evidence'
import type { AgentSession, CallBlueprint, ServiceContext, SectionSpec } from '../types'

const log = logger.child({ component: 'change-call-service' })

export interface ChangeCallInput {
  sessionId: string
  newCallId: string
  expectedStateVersion: number
}

export interface ChangeCallResult {
  session: AgentSession
  sectionsDiscarded: number
  blueprintSource: 'cached' | 'none'
}

async function callExists(ctx: ServiceContext, callId: string): Promise<boolean> {
  // Three-prong probe, same as preselect confirm.
  const { matches } = await searchCalls(ctx, callId, { maxResults: 5 })
  return matches.some(m => m.callId === callId)
}

export async function changeCall(
  ctx: ServiceContext,
  input: ChangeCallInput,
): Promise<ChangeCallResult> {
  return withUserRLS(ctx.userId, async () => {
    const [session] = await db
      .select()
      .from(agentSessions)
      .where(and(
        eq(agentSessions.id, input.sessionId),
        eq(agentSessions.userId, ctx.userId),
      ))
      .limit(1)

    if (!session) throw new NotFoundError('agent_session', input.sessionId)

    if (session.stateVersion !== input.expectedStateVersion) {
      throw new ConcurrencyError(
        'agent_session',
        input.sessionId,
        input.expectedStateVersion,
        session.stateVersion,
      )
    }

    if (session.outlineFrozen) {
      throw new ValidationError(
        'outlineFrozen',
        'Cannot change call while outline is frozen',
        'POLICY_OUTLINE_ALREADY_FROZEN',
      )
    }

    if (session.selectedCallId === input.newCallId) {
      throw new ValidationError(
        'newCallId',
        'New call is identical to current call',
        'VALIDATION_NO_OP',
      )
    }

    const exists = await callExists(ctx, input.newCallId)
    if (!exists) {
      throw new ValidationError('newCallId', `Unknown callId '${input.newCallId}'`, 'INVALID_CALL_ID')
    }

    // Look up blueprint (best-effort).
    let blueprint: CallBlueprint | null = null
    let blueprintSource: 'cached' | 'none' = 'none'
    try {
      const lookup = await lookupBlueprint(ctx, input.newCallId)
      if (lookup.cached) {
        blueprint = lookup.blueprint
        blueprintSource = 'cached'
      }
    } catch (err) {
      log.warn({ err, callId: input.newCallId }, 'blueprint_lookup_failed_during_change_call')
    }

    const newOutline: SectionSpec[] | null = blueprint ? outlineFromBlueprint(blueprint) : null
    const newPhase = blueprint ? 'structuring' : 'research'

    // Count sections that will be discarded for telemetry/audit.
    const existingSections = await db.select().from(agentSections).where(eq(agentSections.sessionId, input.sessionId))
    const sectionsDiscarded = existingSections.length

    await db.delete(agentSections).where(eq(agentSections.sessionId, input.sessionId))

    await db.update(agentSessions)
      .set({
        selectedCallId: input.newCallId,
        blueprint: blueprint as never,
        outline: newOutline as never,
        eligibility: null,
        warnings: [],
        currentPhase: newPhase,
        outlineFrozen: false,
        stateVersion: sql`${agentSessions.stateVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(agentSessions.id, input.sessionId),
        eq(agentSessions.stateVersion, input.expectedStateVersion),
      ))

    const [updated] = await db.select().from(agentSessions).where(eq(agentSessions.id, input.sessionId)).limit(1)

    await logAudit({
      userId: ctx.userId,
      action: 'session.call_changed',
      resourceType: 'agent_session',
      resourceId: input.sessionId,
      metadata: {
        previousCallId: session.selectedCallId,
        newCallId: input.newCallId,
        sectionsDiscarded,
        blueprintSource,
        requestId: ctx.requestId,
      },
    })

    return {
      session: updated as AgentSession,
      sectionsDiscarded,
      blueprintSource,
    }
  })
}
```

The exact import paths for `ConcurrencyError`/`ValidationError`/`NotFoundError` and the error constructor signatures need to match the existing service errors in `services/errors.ts`. If `ConcurrencyError`'s constructor takes a different shape (e.g., a single message string), adapt the throw site to match.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/unit/change-call.test.ts`
Expected: PASS, 4 tests green. If a test fails on a mock not returning the expected shape, adapt the mock harness or the service's DB calls to match.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/services/change-call.ts app/tests/unit/change-call.test.ts
git commit -m "feat(agent): changeCall service (reset session to a new call)"
```

---

## Task 4: Zod schemas for action bodies

**Files:**
- Create: `app/src/lib/validation/agent-actions.ts`

- [ ] **Step 1: Create the schemas**

```ts
// app/src/lib/validation/agent-actions.ts
import { z } from 'zod'

export const runEligibilityBody = z.object({
  projectSummary: z.string().min(1).max(20_000).optional(),
  expectedStateVersion: z.number().int().nonnegative(),
})

export const freezeOutlineBody = z.object({
  expectedStateVersion: z.number().int().nonnegative(),
})

export const changeCallBody = z.object({
  newCallId: z.string().min(1).max(200),
  expectedStateVersion: z.number().int().nonnegative(),
})

export const acceptSectionBody = z.object({
  sectionKey: z.string().min(1).max(200),
  expectedStateVersion: z.number().int().nonnegative(),
})

export const rejectSectionBody = z.object({
  sectionKey: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  expectedStateVersion: z.number().int().nonnegative(),
})

export const rollbackSectionBody = z.object({
  sectionKey: z.string().min(1).max(200),
  targetVersion: z.number().int().nonnegative(),
  expectedStateVersion: z.number().int().nonnegative(),
})

export const exportBody = z.object({}).strict()

export type RunEligibilityBody = z.infer<typeof runEligibilityBody>
export type FreezeOutlineBody = z.infer<typeof freezeOutlineBody>
export type ChangeCallBody = z.infer<typeof changeCallBody>
export type AcceptSectionBody = z.infer<typeof acceptSectionBody>
export type RejectSectionBody = z.infer<typeof rejectSectionBody>
export type RollbackSectionBody = z.infer<typeof rollbackSectionBody>
```

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/validation/agent-actions.ts
git commit -m "feat(validation): Zod schemas for agent action endpoints"
```

---

## Task 5: Shared envelope helper

**Files:**
- Create: `app/src/lib/api/agent-action-envelope.ts`

- [ ] **Step 1: Create the helper**

```ts
// app/src/lib/api/agent-action-envelope.ts
//
// Converts service errors to UI-friendly JSON responses:
//   { error: { code, messageRo, messageEn, missing? } }
// And maps internal POLICY_* codes to UI-facing codes when desired.

import { NextResponse } from 'next/server'
import {
  ValidationError,
  ConcurrencyError,
  NotFoundError,
  AuthorizationError,
} from '@/lib/ai/agent/services/errors'
import { getTranslations } from 'next-intl/server'

const POLICY_TO_UI_CODE: Record<string, string> = {
  POLICY_OUTLINE_NOT_READY: 'OUTLINE_NOT_READY',
  POLICY_OUTLINE_NOT_FROZEN: 'OUTLINE_NOT_FROZEN',
  POLICY_OUTLINE_ALREADY_FROZEN: 'OUTLINE_ALREADY_FROZEN',
  POLICY_SECTION_NOT_IN_OUTLINE: 'SECTION_NOT_IN_OUTLINE',
  POLICY_SESSION_NOT_ACTIVE: 'SESSION_NOT_ACTIVE',
  POLICY_NO_CALL_SELECTED: 'NO_CALL_SELECTED',
  POLICY_ELIGIBILITY_NOT_PASSED: 'ELIGIBILITY_NOT_PASSED',
  POLICY_SECTION_WRONG_STATE: 'SECTION_WRONG_STATE',
  POLICY_BLUEPRINT_PHASE_GATE: 'BLUEPRINT_PHASE_GATE',
}

function uiCodeFor(internal: string | undefined): string {
  if (!internal) return 'UNKNOWN'
  return POLICY_TO_UI_CODE[internal] ?? internal
}

export async function errorToResponse(err: unknown, locale: 'ro' | 'en'): Promise<NextResponse> {
  const t = await getTranslations({ locale, namespace: 'agent.errors' })

  if (err instanceof ValidationError) {
    const code = uiCodeFor(err.policyCode ?? err.code)
    return NextResponse.json(
      { error: {
        code,
        messageRo: await getMessage('ro', code, err.message),
        messageEn: await getMessage('en', code, err.message),
      } },
      { status: 409 },
    )
  }
  if (err instanceof ConcurrencyError) {
    return NextResponse.json(
      { error: {
        code: 'CONCURRENCY_CONFLICT',
        messageRo: await getMessage('ro', 'CONCURRENCY_CONFLICT', 'Cererea este învechită.'),
        messageEn: await getMessage('en', 'CONCURRENCY_CONFLICT', 'Request is stale.'),
        currentStateVersion: err.actualVersion,
      } },
      { status: 409 },
    )
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', messageRo: 'Resursă inexistentă.', messageEn: 'Resource not found.' } },
      { status: 404 },
    )
  }
  if (err instanceof AuthorizationError) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', messageRo: 'Acces interzis.', messageEn: 'Forbidden.' } },
      { status: 403 },
    )
  }
  return NextResponse.json(
    { error: { code: 'INTERNAL', messageRo: 'Eroare internă.', messageEn: 'Internal error.' } },
    { status: 500 },
  )
}

async function getMessage(locale: 'ro' | 'en', code: string, fallback: string): Promise<string> {
  try {
    const t = await getTranslations({ locale, namespace: 'agent.errors' })
    const m = t(code)
    return m && m !== code ? m : fallback
  } catch {
    return fallback
  }
}
```

If `ConcurrencyError`/`ValidationError`/etc don't have `policyCode`/`actualVersion` fields with the exact names above, adjust the access expressions to match the constructors in `services/errors.ts`.

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/api/agent-action-envelope.ts
git commit -m "feat(api): shared envelope for agent action error responses"
```

---

## Task 6: `/actions/run-eligibility` route

**Files:**
- Create: `app/src/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route.ts`
- Test: `app/tests/integration/actions/run-eligibility-route.test.ts`

- [ ] **Step 1: Implement the route**

```ts
// app/src/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import { runEligibilityBody } from '@/lib/validation/agent-actions'
import { runEligibility } from '@/lib/ai/agent/services/application'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import { db } from '@/lib/db'
import { agentSections, agentSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { errorToResponse } from '@/lib/api/agent-action-envelope'
import { randomUUID } from 'crypto'

async function handler(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await requireAuth()
  const locale = (req.headers.get('x-locale') as 'ro' | 'en') ?? 'ro'

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: { code: 'BAD_JSON', messageRo: 'JSON invalid.', messageEn: 'Invalid JSON.' } }, { status: 400 })
  }
  const parsed = runEligibilityBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: { code: 'BAD_REQUEST', messageRo: 'Cerere invalidă.', messageEn: 'Bad request.', details: parsed.error.flatten() } }, { status: 400 })
  }

  try {
    await runEligibility(
      { userId: user.id, sessionId: ctx.params.id, requestId: randomUUID(), now: new Date() },
      {
        sessionId: ctx.params.id,
        expectedStateVersion: parsed.data.expectedStateVersion,
        projectSummary: parsed.data.projectSummary,
      } as never,
    )
  } catch (err) {
    return errorToResponse(err, locale)
  }

  const [session] = await db.select().from(agentSessions).where(and(eq(agentSessions.id, ctx.params.id), eq(agentSessions.userId, user.id))).limit(1)
  const rows = session ? await db.select().from(agentSections).where(eq(agentSections.sessionId, ctx.params.id)) : []
  return NextResponse.json(projectSessionState(session as never, rows as never))
}

export const POST = withRateLimit(handler, { limit: 30, windowSec: 60, keySuffix: 'eligibility' })
```

If `runEligibility` does not exist as a top-level service export today, locate the equivalent function in `services/eligibility.ts` (or wherever the deterministic rule engine runs) and adapt the import. Confirm the input shape matches.

- [ ] **Step 2: Integration test**

`app/tests/integration/actions/run-eligibility-route.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/auth/helpers', () => ({ requireAuth: vi.fn().mockResolvedValue({ id: 'u1', tier: 'free' }) }))
vi.mock('@/lib/middleware/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

// Mock the service to assert call-through
const runEligibilitySpy = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/ai/agent/services/application', () => ({
  runEligibility: runEligibilitySpy,
}))

// Mock state-projection inputs (DB returns one session, no rows)
vi.mock('@/lib/db', () => {
  const limit = vi.fn().mockResolvedValue([{
    id: 's1', userId: 'u1', stateVersion: 1, outline: null, blueprint: null,
    status: 'active', selectedCallId: null, currentPhase: 'discovery',
    eligibility: null, warnings: [], outlineFrozen: false,
  }])
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where, limit }))
  const select = vi.fn(() => ({ from }))
  return { db: { select } }
})

describe('POST /actions/run-eligibility', () => {
  it('400 on invalid body', async () => {
    const { POST } = await import('@/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route')
    const res = await POST(
      new Request('http://localhost/api/v1/agent-sessions/s1/actions/run-eligibility', {
        method: 'POST', body: JSON.stringify({}),
      }) as never,
      { params: { id: 's1' } },
    )
    expect(res.status).toBe(400)
  })

  it('calls runEligibility with projectSummary fallback', async () => {
    const { POST } = await import('@/app/api/v1/agent-sessions/[id]/actions/run-eligibility/route')
    await POST(
      new Request('http://localhost/api/v1/agent-sessions/s1/actions/run-eligibility', {
        method: 'POST',
        body: JSON.stringify({ expectedStateVersion: 1, projectSummary: 'desc' }),
      }) as never,
      { params: { id: 's1' } },
    )
    expect(runEligibilitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', sessionId: 's1' }),
      expect.objectContaining({ sessionId: 's1', expectedStateVersion: 1, projectSummary: 'desc' }),
    )
  })
})
```

- [ ] **Step 3: Run the test**

```bash
cd app && npx vitest run tests/integration/actions/run-eligibility-route.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/src/app/api/v1/agent-sessions/\[id\]/actions/run-eligibility/route.ts app/tests/integration/actions/run-eligibility-route.test.ts
git commit -m "feat(api): POST /actions/run-eligibility"
```

---

## Task 7: `/actions/freeze-outline` route

**Files:**
- Create: `app/src/app/api/v1/agent-sessions/[id]/actions/freeze-outline/route.ts`
- Test: `app/tests/integration/actions/freeze-outline-route.test.ts`

- [ ] **Step 1: Implement the route**

Mirror the `run-eligibility` route's shape. Body schema: `freezeOutlineBody`. Service call: `freezeOutline` (already exported from `services/application.ts:640`). On success, return snapshot.

```ts
// app/src/app/api/v1/agent-sessions/[id]/actions/freeze-outline/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import { freezeOutlineBody } from '@/lib/validation/agent-actions'
import { freezeOutline } from '@/lib/ai/agent/services/application'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import { db } from '@/lib/db'
import { agentSections, agentSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { errorToResponse } from '@/lib/api/agent-action-envelope'
import { randomUUID } from 'crypto'

async function handler(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await requireAuth()
  const locale = (req.headers.get('x-locale') as 'ro' | 'en') ?? 'ro'
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: { code: 'BAD_JSON' } }, { status: 400 }) }
  const parsed = freezeOutlineBody.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: { code: 'BAD_REQUEST', details: parsed.error.flatten() } }, { status: 400 })

  try {
    await freezeOutline(
      { userId: user.id, sessionId: ctx.params.id, requestId: randomUUID(), now: new Date() },
      { sessionId: ctx.params.id, expectedStateVersion: parsed.data.expectedStateVersion } as never,
    )
  } catch (err) {
    return errorToResponse(err, locale)
  }
  const [session] = await db.select().from(agentSessions).where(and(eq(agentSessions.id, ctx.params.id), eq(agentSessions.userId, user.id))).limit(1)
  const rows = await db.select().from(agentSections).where(eq(agentSections.sessionId, ctx.params.id))
  return NextResponse.json(projectSessionState(session as never, rows as never))
}

export const POST = withRateLimit(handler, { limit: 30, windowSec: 60, keySuffix: 'freeze' })
```

- [ ] **Step 2: Integration test (mirror run-eligibility shape)**

```ts
// Same vi.mock setup as run-eligibility; replace service mock to freezeOutline.
// Assert 400 on missing expectedStateVersion; 200 on happy path with snapshot returned.
```

- [ ] **Step 3: Run + commit**

```bash
cd app && npx vitest run tests/integration/actions/freeze-outline-route.test.ts
git add app/src/app/api/v1/agent-sessions/\[id\]/actions/freeze-outline/route.ts app/tests/integration/actions/freeze-outline-route.test.ts
git commit -m "feat(api): POST /actions/freeze-outline"
```

---

## Task 8: `/actions/change-call` route

**Files:**
- Create: `app/src/app/api/v1/agent-sessions/[id]/actions/change-call/route.ts`
- Test: `app/tests/integration/actions/change-call-route.test.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import { changeCallBody } from '@/lib/validation/agent-actions'
import { changeCall } from '@/lib/ai/agent/services/change-call'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import { db } from '@/lib/db'
import { agentSections } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { errorToResponse } from '@/lib/api/agent-action-envelope'
import { randomUUID } from 'crypto'

async function handler(req: NextRequest, ctx: { params: { id: string } }) {
  const user = await requireAuth()
  const locale = (req.headers.get('x-locale') as 'ro' | 'en') ?? 'ro'
  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: { code: 'BAD_JSON' } }, { status: 400 }) }
  const parsed = changeCallBody.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: { code: 'BAD_REQUEST', details: parsed.error.flatten() } }, { status: 400 })

  let result
  try {
    result = await changeCall(
      { userId: user.id, sessionId: ctx.params.id, requestId: randomUUID(), now: new Date() },
      { sessionId: ctx.params.id, newCallId: parsed.data.newCallId, expectedStateVersion: parsed.data.expectedStateVersion },
    )
  } catch (err) {
    return errorToResponse(err, locale)
  }
  const rows = await db.select().from(agentSections).where(eq(agentSections.sessionId, ctx.params.id))
  return NextResponse.json(projectSessionState(result.session, rows as never))
}

export const POST = withRateLimit(handler, { limit: 10, windowSec: 60, keySuffix: 'change-call' })
```

- [ ] **Step 2: Integration test**

```ts
// Mock changeCall to return a session with newCallId set; assert response shape carries selectedCallId.
// Test 400 on bad body, 200 happy path.
```

- [ ] **Step 3: Run + commit**

```bash
cd app && npx vitest run tests/integration/actions/change-call-route.test.ts
git add app/src/app/api/v1/agent-sessions/\[id\]/actions/change-call/route.ts app/tests/integration/actions/change-call-route.test.ts
git commit -m "feat(api): POST /actions/change-call"
```

---

## Task 9: `/actions/accept-section`, `/reject-section`, `/rollback-section`

**Files:**
- Create: three route files at the standard path.
- Test: three integration test files.

These three routes share the same envelope shape; the only differences are body schema and service function. Implement in parallel.

- [ ] **Step 1: accept-section**

```ts
// route.ts excerpt
import { acceptSectionBody } from '@/lib/validation/agent-actions'
import { approveSection } from '@/lib/ai/agent/services/sections'
// handler: validate body, call approveSection({sessionId, sectionKey, expectedStateVersion}), return snapshot
```

- [ ] **Step 2: reject-section**

```ts
import { rejectSectionBody } from '@/lib/validation/agent-actions'
import { rejectSection } from '@/lib/ai/agent/services/sections'
// handler: validate body, call rejectSection({sessionId, sectionKey, reason, expectedStateVersion}), return snapshot
```

- [ ] **Step 3: rollback-section**

```ts
import { rollbackSectionBody } from '@/lib/validation/agent-actions'
import { rollbackSection } from '@/lib/ai/agent/services/sections'
// handler: validate body, call rollbackSection({sessionId, sectionKey, targetVersion, expectedStateVersion}), return snapshot
```

- [ ] **Step 4: Integration tests (one per route)**

Each test:
- Mocks `requireAuth`, `withRateLimit`, service function, and `db.select`.
- Asserts 400 on missing fields, 200 on happy path.
- For rollback specifically: assert 400 when `targetVersion` is missing from body.

- [ ] **Step 5: Run + commit**

```bash
cd app && npx vitest run tests/integration/actions/
git add app/src/app/api/v1/agent-sessions/\[id\]/actions/{accept-section,reject-section,rollback-section}/route.ts app/tests/integration/actions/{accept-section,reject-section,rollback-section}-route.test.ts
git commit -m "feat(api): POST /actions/{accept-section,reject-section,rollback-section}"
```

---

## Task 10: `/actions/export` route

**Files:**
- Create: `app/src/app/api/v1/agent-sessions/[id]/actions/export/route.ts`
- Test: `app/tests/integration/actions/export-route.test.ts`

- [ ] **Step 1: Implement**

```ts
// Imports: requireAuth, withRateLimit, exportBody, createExportSnapshot (from services/application)
// Handler: validate body (empty object), call createExportSnapshot, return { snapshotId }
```

- [ ] **Step 2: Test happy path + 400 on extraneous body**

`exportBody` uses `.strict()`, so any extra fields fail validation.

- [ ] **Step 3: Run + commit**

```bash
cd app && npx vitest run tests/integration/actions/export-route.test.ts
git add app/src/app/api/v1/agent-sessions/\[id\]/actions/export/route.ts app/tests/integration/actions/export-route.test.ts
git commit -m "feat(api): POST /actions/export"
```

---

## Task 11: Bilingual error messages for new UI codes

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`

- [ ] **Step 1: Add keys**

In each locale's `agent.errors` namespace:

| Key | ro | en |
|---|---|---|
| `OUTLINE_NOT_READY` | "Schița nu este pregătită." | "Outline is not ready." |
| `OUTLINE_NOT_FROZEN` | "Schița trebuie înghețată înainte." | "Outline must be frozen first." |
| `OUTLINE_ALREADY_FROZEN` | "Schița este deja înghețată." | "Outline is already frozen." |
| `SECTION_NOT_IN_OUTLINE` | "Secțiunea nu face parte din schiță." | "Section is not in the outline." |
| `SESSION_NOT_ACTIVE` | "Sesiunea nu este activă." | "Session is not active." |
| `NO_CALL_SELECTED` | "Niciun apel selectat." | "No call selected." |
| `ELIGIBILITY_NOT_PASSED` | "Eligibilitatea nu este îndeplinită." | "Eligibility is not passed." |
| `SECTION_WRONG_STATE` | "Starea secțiunii nu permite operația." | "Section state forbids this operation." |
| `BLUEPRINT_PHASE_GATE` | "Operația nu este permisă în faza curentă." | "Operation not allowed in current phase." |
| `CONCURRENCY_CONFLICT` | "Datele s-au schimbat între timp. Reîncarcă." | "Data has changed. Please reload." |
| `VALIDATION_NO_OP` | "Nicio schimbare." | "No-op." |
| `INVALID_CALL_ID` | "Apel necunoscut." | "Unknown call." |

- [ ] **Step 2: Commit**

```bash
git add app/src/messages/ro.json app/src/messages/en.json
git commit -m "i18n(agent): bilingual messages for action error codes"
```

---

## Task 12: `runAction(name, body)` on `useAgent`

**Files:**
- Modify: `app/src/hooks/useAgent.ts`
- Modify: `app/src/lib/agent-actions/client.ts` (new) — `csrfFetch` wrapper for the actions surface.

- [ ] **Step 1: Create the client helper**

```ts
// app/src/lib/agent-actions/client.ts
import { csrfFetch } from '@/lib/csrf/client'

export interface ActionErrorBody {
  error: {
    code: string
    messageRo: string
    messageEn: string
    currentStateVersion?: number
    details?: unknown
  }
}

export async function callAction<T>(
  sessionId: string,
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await csrfFetch(`/api/v1/agent-sessions/${sessionId}/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as Partial<ActionErrorBody>
    throw new ActionError(err?.error?.code ?? 'UNKNOWN', err?.error?.messageRo ?? '', err?.error?.messageEn ?? '', err?.error?.currentStateVersion)
  }
  return (await res.json()) as T
}

export class ActionError extends Error {
  constructor(
    public code: string,
    public messageRo: string,
    public messageEn: string,
    public currentStateVersion?: number,
  ) {
    super(`${code}: ${messageEn}`)
  }
}
```

- [ ] **Step 2: Add `runAction` to `useAgent`**

In `app/src/hooks/useAgent.ts`, find the returned object near the bottom. Add:

```ts
const runAction = useCallback(async (name: string, body: Record<string, unknown>) => {
  if (!sessionIdRef.current) throw new Error('No session to act on')
  const snapshot = await callAction(sessionIdRef.current, name, {
    ...body,
    expectedStateVersion: stateVersionRef.current,
  })
  applyServerSnapshot(snapshot as UIStateSnapshot)
  return snapshot as UIStateSnapshot
}, [applyServerSnapshot])

return {
  // ... existing fields
  runAction,
}
```

If `applyServerSnapshot` doesn't yet exist as a private helper, the existing snapshot-merging logic (currently inline in the SSE handler) should be extracted into one function that updates `messages`/`phase`/`stateVersion`/`outlineFrozen`/`sections`/`blueprint`/`eligibility`/`warnings` from a `UIStateSnapshot`. Extract it before adding `runAction`.

`stateVersionRef` is a mirror of `stateVersion` for synchronous access from inside callbacks. Add it if missing (same shape as the existing `sessionIdRef`).

- [ ] **Step 3: Type the hook return**

Update the `useAgent` return type to include `runAction: (name: string, body: Record<string, unknown>) => Promise<UIStateSnapshot>`.

- [ ] **Step 4: Run typecheck**

```bash
cd app && npm run typecheck
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useAgent.ts app/src/lib/agent-actions/client.ts
git commit -m "feat(agent): useAgent.runAction for deterministic /actions/* endpoints"
```

---

## Task 13: Wire UI buttons in `AgentWorkspace.tsx` and `SelectedCallBanner.tsx`

**Files:**
- Modify: `app/src/components/agent/AgentWorkspace.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/components/SelectedCallBanner.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx`

- [ ] **Step 1: Read `deterministic_actions_enabled` in page.tsx**

```ts
const deterministicActions = await isFeatureEnabled('deterministic_actions_enabled', {
  userId: user.id, bypassCache: true,
})
```

Pass it down through `NewProjectView` props.

- [ ] **Step 2: Add `runAction` and `actionsEnabled` props to `AgentWorkspace`**

```tsx
interface AgentWorkspaceProps {
  // ... existing
  runAction: (name: string, body: Record<string, unknown>) => Promise<unknown>
  actionsEnabled: boolean
}
```

- [ ] **Step 3: Render buttons when `actionsEnabled`**

Inside `AgentWorkspace`:

```tsx
{actionsEnabled && !outlineFrozen && (
  <button onClick={() => runAction('freeze-outline', {}).catch(showError)}>
    {t('actions.freezeOutline')}
  </button>
)}

{actionsEnabled && focusedSection?.status === 'draft' && (
  <>
    <button onClick={() => runAction('accept-section', { sectionKey: focusedSection.sectionKey })}>
      {t('actions.acceptSection')}
    </button>
    <button onClick={() => runAction('reject-section', { sectionKey: focusedSection.sectionKey, reason: prompt(t('actions.rejectReasonPrompt')) ?? '' })}>
      {t('actions.rejectSection')}
    </button>
  </>
)}

{actionsEnabled && focusedSection?.version > 1 && (
  <button onClick={() => runAction('rollback-section', { sectionKey: focusedSection.sectionKey, targetVersion: focusedSection.version - 1 })}>
    {t('actions.rollbackSection')}
  </button>
)}

{actionsEnabled && (
  <button onClick={() => runAction('export', {})}>
    {t('actions.export')}
  </button>
)}
```

Adapt to your actual workspace UX. `focusedSection` is the section currently displayed in the workspace (managed by `useState` locally within `AgentWorkspace`).

Add bilingual keys: `agent.actions.freezeOutline`, `acceptSection`, `rejectSection`, `rejectReasonPrompt`, `rollbackSection`, `export`.

- [ ] **Step 4: Wire change-call in `SelectedCallBanner.tsx`**

The current "Change" button calls `onChangeRequested` which currently triggers `handleChangeRequested` in `NewProjectView`. When `actionsEnabled` is on, `handleChangeRequested` should route through `agent.runAction('change-call', { newCallId })`. The `newCallId` is determined by the user picking from a list — same flow as today, but the picker's confirm action posts to `/actions/change-call` instead of `/api/v1/projects/preselect`.

For the MVP, leave `SelectedCallBanner` unchanged but make `handleChangeRequested` switch behavior:

```ts
if (actionsEnabled) {
  // Re-rank via existing preselect override path to get candidates, then
  // when user picks one, route through agent.runAction('change-call', ...)
}
```

This wires the simplest version: pick a candidate, call `change-call`.

- [ ] **Step 5: Run typecheck + smoke**

```bash
cd app && npm run typecheck
cd app && PORT=3002 npm run dev
```

Enable the flag in DB, open `/ro/proiecte/nou`, complete preselect, observe Freeze/Accept/etc buttons appear in the workspace.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/agent/AgentWorkspace.tsx app/src/app/[locale]/\(dashboard\)/proiecte/nou/components/SelectedCallBanner.tsx app/src/app/[locale]/\(dashboard\)/proiecte/nou/NewProjectView.tsx app/src/app/[locale]/\(dashboard\)/proiecte/nou/page.tsx
git commit -m "feat(agent): UI buttons for deterministic actions, flag-gated"
```

---

## Task 14: Add `change_call_total` metric

**Files:**
- Modify: `app/src/lib/monitoring/metrics.ts`
- Modify: `app/src/lib/ai/agent/services/change-call.ts`

- [ ] **Step 1: Define the counter**

```ts
import { Counter } from 'prom-client'

export const changeCallTotal = new Counter({
  name: 'change_call_total',
  help: 'Number of change-call operations',
  labelNames: ['from_blueprint', 'to_blueprint', 'sections_discarded_bucket'],
})
```

`sections_discarded_bucket` values: `'0'`, `'1-3'`, `'4-10'`, `'10+'`. Keep cardinality small.

- [ ] **Step 2: Increment from `changeCall`**

In `change-call.ts`, after the successful update and before returning:

```ts
function bucketize(n: number): string {
  if (n === 0) return '0'
  if (n <= 3) return '1-3'
  if (n <= 10) return '4-10'
  return '10+'
}

changeCallTotal.inc({
  from_blueprint: session.blueprint ? 'yes' : 'no',
  to_blueprint: blueprintSource === 'cached' ? 'yes' : 'no',
  sections_discarded_bucket: bucketize(sectionsDiscarded),
})
```

- [ ] **Step 3: Run unit tests**

```bash
cd app && npx vitest run tests/unit/change-call.test.ts
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/monitoring/metrics.ts app/src/lib/ai/agent/services/change-call.ts
git commit -m "feat(metrics): change_call_total counter"
```

---

## Task 15: Final regression + manual smoke

- [ ] **Step 1: Full test suite**

```bash
cd app && npm run typecheck && npm run test
```
Expected: all green.

- [ ] **Step 2: Manual smoke (flag on)**

```bash
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = true WHERE key = 'deterministic_actions_enabled'"
```

Complete a session via preselect, then:
- Click Freeze → workspace shows outline frozen, no chat turn.
- Click Accept on a section in `draft` → status → `accepted`, no chat turn.
- Click Reject with a reason → status → `rejected`, no chat turn.
- Click Change call, pick a different candidate → blueprint/outline reset; new call selected.
- Check audit: `SELECT action, metadata->>'newCallId' FROM audit_log WHERE action = 'session.call_changed' ORDER BY created_at DESC LIMIT 3;` — see the new action recorded.

- [ ] **Step 3: Verify flag-off behavior unchanged**

```bash
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = false WHERE key = 'deterministic_actions_enabled'"
```
Reload — buttons hidden; legacy in-chat tool flow still works.

- [ ] **Step 4: Commit any cleanup**

If lint or types required fixups, commit them.

---

## Self-Review Checklist

- [ ] Spec §4 coverage: every endpoint in the inventory table has a route file and a test (Tasks 6–10). `changeCall()` is its own service (Task 3). Bilingual envelope (Tasks 5 + 11). New audit action (Task 2). `useAgent.runAction` (Task 12). UI buttons (Task 13). Flag (Task 1).
- [ ] No placeholders: every test scaffold lists what to assert; every route file imports a real service function.
- [ ] Type consistency: `runAction(name, body)` signature identical across `useAgent`, `AgentWorkspace` props, and `callAction`. `ChangeCallResult.session` and `ChangeCallResult.sectionsDiscarded` consistent in service + tests.
- [ ] Commits per task = one logical change.

## Definition of Done

- `deterministic_actions_enabled = false` in production initially.
- With flag on (staff): UI buttons drive freeze/accept/reject/rollback/change-call/export via REST; chat tool path unused for these mutations.
- With flag off: existing UI/chat behavior unchanged.
- New audit action `session.call_changed` appears in `audit_log` after a change-call.
- All new route tests + existing service tests green.
- Bilingual error envelope reaches the UI on every 4xx/409.
