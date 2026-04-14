# Frontend Wiring + Text Readability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire all dashboard pages to real APIs — AI assistant with live canvas, smart landing, projects, funding calls (3-layer), settings, documents — and fix text readability.

**Architecture:** Extend `useOrchestrator()` hook with `canvasState` for the AI workspace canvas. Fix 3 backend issues (context exposure, session lock, replay dedup). Wire other pages with plain `useEffect` + `csrfFetch()`. Fix design tokens for WCAG AA.

**Tech Stack:** Next.js 14 App Router, TypeScript, existing `csrfFetch()` and `useOrchestrator()` hook, ioredis, Drizzle ORM, next-intl (ro/en)

**Spec:** `docs/superpowers/specs/2026-04-01-frontend-wiring-design.md`

---

## File Structure

### Modified Files
```
app/src/
├── lib/ai/orchestrator/
│   ├── engine.ts                    # Include context snapshot in step_complete events
│   └── types.ts                     # Add context field to step_complete SSE event
├── app/api/ai/orchestrator/
│   ├── messages/route.ts            # Include session.context in response
│   ├── message/route.ts             # Add Redis session lock
│   └── stream/route.ts              # Filter replay by lastEventId
├── hooks/useOrchestrator.ts         # Add canvasState tracking
├── app/[locale]/(dashboard)/
│   ├── asistent-ai/page.tsx         # Replace hardcoded data with hook
│   ├── panou/page.tsx               # Build smart landing page
│   ├── proiecte/page.tsx            # Wire to projects API
│   ├── proiecte/[id]/page.tsx       # Wire to project detail API
│   ├── finantari/page.tsx           # Wire to calls API + AI discovery
│   ├── setari/page.tsx              # Wire to preferences + billing APIs
│   └── documente/page.tsx           # Aggregate from projects API
└── styles/tokens.css                # Fix contrast ratios
```

---

## Dependency Graph

```
Task 1 (tokens.css) ─────────────────────── independent, do first
Task 2 (types.ts step_complete context) ──┐
Task 3 (engine.ts emit context) ──────────┤
Task 4 (messages/route.ts expose context)─┤── sequential prerequisites
Task 5 (stream/route.ts replay dedup) ────┤
Task 6 (message/route.ts session lock) ───┘
Task 7 (useOrchestrator canvasState) ───── depends on Tasks 2-4
Task 8 (asistent-ai page) ─────────────── depends on Task 7
Task 9 (panou smart landing) ──────────── depends on Task 7 (hero input)
Task 10 (proiecte list) ───────────────── independent after Task 1
Task 11 (proiecte detail) ─────────────── independent after Task 1
Task 12 (finantari) ───────────────────── independent after Task 1
Task 13 (setari) ──────────────────────── independent after Task 1
Task 14 (documente) ───────────────────── independent after Task 1

Tasks 10-14 are parallel after Task 1.
Tasks 2-8 are sequential.
Task 9 depends on Task 7 for the orchestrator session-start flow.
```

---

## Task 1: Fix Text Readability — Design Tokens

**Files:**
- Modify: `app/src/styles/tokens.css:16,38`

- [ ] **Step 1: Update --on-surface-variant in light theme**

In `app/src/styles/tokens.css`, change line 16:

```css
/* Before: */
  --on-surface-variant: 65 71 83;

/* After: */
  --on-surface-variant: 55 58 65;
```

- [ ] **Step 2: Update --outline in light theme**

In `app/src/styles/tokens.css`, change line 38:

```css
/* Before: */
  --outline: 113 119 133;

/* After: */
  --outline: 85 90 100;
```

- [ ] **Step 3: Verify build compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tailwindcss --content './src/**/*.tsx' --output /dev/null 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/styles/tokens.css && git commit -m "fix(design): darken on-surface-variant and outline tokens for WCAG AA"
```

---

## Task 2: Add Context Snapshot to step_complete SSE Event Type

**Files:**
- Modify: `app/src/lib/ai/orchestrator/types.ts:116`

- [ ] **Step 1: Update SSEEvent union to include context in step_complete**

In `app/src/lib/ai/orchestrator/types.ts`, change line 116:

```typescript
/* Before: */
  | { type: 'step_complete'; step: number; summary: string }

/* After: */
  | { type: 'step_complete'; step: number; summary: string; context?: Partial<WorkflowContext> }
```

- [ ] **Step 2: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/lib/ai/orchestrator/types.ts && git commit -m "feat(orchestrator): add context snapshot to step_complete event type"
```

---

## Task 3: Emit Context Snapshot in Engine step_complete Events

**Files:**
- Modify: `app/src/lib/ai/orchestrator/engine.ts:152-155,171-175`

- [ ] **Step 1: Add context to post-completion edit step_complete**

In `app/src/lib/ai/orchestrator/engine.ts`, replace lines 152-156:

```typescript
/* Before: */
      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: 'Edit applied',
      })

/* After: */
      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: 'Edit applied',
        context: {
          matchedCalls: updatedContext.matchedCalls,
          actionPlan: updatedContext.actionPlan,
          projectSections: updatedContext.projectSections,
        },
      })
```

- [ ] **Step 2: Add context to normal workflow step_complete**

In the same file, replace lines 171-175:

```typescript
/* Before: */
      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: `Step ${ctx.step} complete`,
      })

/* After: */
      stream.send({
        type: 'step_complete',
        step: ctx.step,
        summary: `Step ${ctx.step} complete`,
        context: {
          matchedCalls: updatedContext.matchedCalls,
          actionPlan: updatedContext.actionPlan,
          projectSections: updatedContext.projectSections,
        },
      })
```

- [ ] **Step 3: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/lib/ai/orchestrator/engine.ts && git commit -m "feat(orchestrator): include canvas-relevant context in step_complete events"
```

---

## Task 4: Expose Session Context in Messages API

**Files:**
- Modify: `app/src/app/api/ai/orchestrator/messages/route.ts:31-38`

- [ ] **Step 1: Include context in session select**

In `app/src/app/api/ai/orchestrator/messages/route.ts`, the current session query (line 31) uses `db.select().from(workflowSessions)` which returns all columns including `context`. The response at line 56 already returns `session`. Verify by reading the file.

The session object already includes `context` because `.select()` with no arguments selects all columns. No code change needed — just verify the response includes it.

Run: `cd /home/godja/Dev/EU-Funds/app && grep -n 'session' src/app/api/ai/orchestrator/messages/route.ts`

If the response is `{ messages: transformedMessages, session }` and the select has no field restriction, `session.context` is already available. Move to Task 5.

If `context` is excluded, add it to the select explicitly.

---

## Task 5: Filter Replay by lastEventId in Stream Route

**Files:**
- Modify: `app/src/app/api/ai/orchestrator/stream/route.ts:40-58`

- [ ] **Step 1: Add eventId filter to replay query**

In `app/src/app/api/ai/orchestrator/stream/route.ts`, replace the replay block (lines 40-59):

```typescript
/* Before: */
      if (lastEventId) {
        ;(async () => {
          try {
            const replayMessages = await db
              .select()
              .from(workflowMessages)
              .where(eq(workflowMessages.sessionId, sessionId))
              .orderBy(asc(workflowMessages.createdAt))

            for (const msg of replayMessages) {
              const replayEvent = {
                type: msg.role === 'user' ? 'replay_user' : 'replay_assistant',
                content: msg.content,
                step: msg.step,
                eventType: msg.eventType,
                metadata: msg.metadata,
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(replayEvent)}\n\n`))
            }
          } catch { /* replay is best-effort */ }
        })()
      }

/* After: */
      if (lastEventId) {
        ;(async () => {
          try {
            const parsedId = parseInt(lastEventId, 10)
            const replayMessages = await db
              .select()
              .from(workflowMessages)
              .where(and(
                eq(workflowMessages.sessionId, sessionId),
                gt(workflowMessages.eventId, isNaN(parsedId) ? 0 : parsedId)
              ))
              .orderBy(asc(workflowMessages.createdAt))

            for (const msg of replayMessages) {
              const replayEvent = {
                type: msg.role === 'user' ? 'replay_user' : 'replay_assistant',
                content: msg.content,
                step: msg.step,
                eventType: msg.eventType,
                metadata: msg.metadata,
              }
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(replayEvent)}\n\n`))
            }
          } catch { /* replay is best-effort */ }
        })()
      }
```

- [ ] **Step 2: Add gt import**

At the top of the file (line 5), add `gt` to the drizzle-orm import:

```typescript
/* Before: */
import { eq, and, asc } from 'drizzle-orm'

/* After: */
import { eq, and, asc, gt } from 'drizzle-orm'
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'stream/route' | head -5`
Expected: No errors for this file

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/app/api/ai/orchestrator/stream/route.ts && git commit -m "fix(orchestrator): filter SSE replay by lastEventId to prevent duplicates"
```

---

## Task 6: Add Redis Session Lock to Message Route

**Files:**
- Modify: `app/src/app/api/ai/orchestrator/message/route.ts:14-75`

- [ ] **Step 1: Add lock acquisition before processMessage calls**

In `app/src/app/api/ai/orchestrator/message/route.ts`, add Redis lock logic. Replace the entire POST handler:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { db } from '@/lib/db'
import { users, workflowSessions } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { processMessage, createSession } from '@/lib/ai/orchestrator/engine'
import { checkWorkflowLimit, incrementWorkflowCount } from '@/lib/billing/usage'
import { createGatewayClient } from '@/lib/ai/orchestrator/gateway'
import { createPubSubStream } from '@/lib/ai/orchestrator/pubsub'
import { logger } from '@/lib/logger'
import { getRedis } from '@/lib/redis/client'

const log = logger.child({ component: 'orchestrator-message' })

const LOCK_TTL_SECONDS = 300 // 5 minutes

async function acquireLock(sessionId: string): Promise<boolean> {
  try {
    const redis = getRedis()
    const result = await redis.set(`orchestrator:lock:${sessionId}`, '1', 'EX', LOCK_TTL_SECONDS, 'NX')
    return result === 'OK'
  } catch {
    // If Redis is down, allow the request (fail-open for lock)
    return true
  }
}

async function releaseLock(sessionId: string): Promise<void> {
  try {
    const redis = getRedis()
    await redis.del(`orchestrator:lock:${sessionId}`)
  } catch {
    // Best-effort release — TTL handles cleanup
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json()
    const { sessionId, message, locale } = body

    if (!message && !sessionId) {
      return NextResponse.json({ error: 'message or sessionId required' }, { status: 400 })
    }

    // Get user tier
    const [dbUser] = await db.select({ tier: users.tier }).from(users).where(eq(users.id, user.id)).limit(1)
    const tier = dbUser?.tier || 'free'

    if (!sessionId) {
      // Create new session — no lock needed (new session has no contention)
      const limitCheck = await checkWorkflowLimit(user.id, tier)
      if (!limitCheck.allowed) {
        return NextResponse.json({ error: limitCheck.message }, { status: 429 })
      }
      await incrementWorkflowCount(user.id)
      const session = await createSession(user.id, locale || 'ro', tier)

      const stream = createPubSubStream(session.id)
      const gateway = createGatewayClient('fondeu')
      log.info({ sessionId: session.id, userId: user.id }, 'New session created, processing message')
      processMessage(session.id, message, stream, gateway).then(() => {
        releaseLock(session.id)
      }).catch((err) => {
        releaseLock(session.id)
        log.error({ error: err instanceof Error ? err.message : String(err), sessionId: session.id }, 'processMessage failed')
      })

      return NextResponse.json({ sessionId: session.id }, { status: 202 })
    }

    // Existing session — acquire lock to prevent dual-tab corruption
    const locked = await acquireLock(sessionId)
    if (!locked) {
      return NextResponse.json({ error: 'Session is already processing a message. Please wait.' }, { status: 409 })
    }

    // Verify session belongs to user
    const [session] = await db
      .select()
      .from(workflowSessions)
      .where(and(
        eq(workflowSessions.id, sessionId),
        eq(workflowSessions.userId, user.id)
      ))
      .limit(1)

    if (!session) {
      await releaseLock(sessionId)
      return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    }

    const sseStream = createPubSubStream(sessionId)
    const gateway = createGatewayClient('fondeu')
    log.info({ sessionId, userId: user.id }, 'Resuming session, processing message')
    processMessage(sessionId, message, sseStream, gateway).then(() => {
      releaseLock(sessionId)
    }).catch((err) => {
      releaseLock(sessionId)
      log.error({ error: err instanceof Error ? err.message : String(err), sessionId }, 'processMessage failed')
    })

    return NextResponse.json({ ok: true }, { status: 202 })
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }, 'Orchestrator message handler failed')
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify Redis client import exists**

Run: `cd /home/godja/Dev/EU-Funds/app && grep -n 'getRedis\|createRedis' src/lib/redis/client.ts | head -5`

If `getRedis` is not exported, check what the export is named and update the import accordingly.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'message/route' | head -5`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/app/api/ai/orchestrator/message/route.ts && git commit -m "fix(orchestrator): add Redis session lock to prevent dual-tab corruption"
```

---

## Task 7: Extend useOrchestrator with canvasState

**Files:**
- Modify: `app/src/hooks/useOrchestrator.ts`

- [ ] **Step 1: Add CanvasState type and imports**

At the top of `app/src/hooks/useOrchestrator.ts`, after the existing imports (line 3), add:

```typescript
import type { MatchedCall, ActionPlan, ProjectSection, WorkflowContext } from '@/lib/ai/orchestrator/types';
```

After the `ChatMessage` interface (after line 21), add:

```typescript
export interface CanvasState {
  matchedCalls: MatchedCall[] | null;
  actionPlan: ActionPlan | null;
  proposalSections: ProjectSection[] | null;
  activeTab: 'calls' | 'plan' | 'proposal';
}

function deriveActiveTab(step: number): 'calls' | 'plan' | 'proposal' {
  if (step >= 7) return 'proposal';
  if (step >= 6) return 'plan';
  return 'calls';
}
```

- [ ] **Step 2: Add canvasState state to the hook**

Inside `useOrchestrator()`, after the existing state declarations (after line 49), add:

```typescript
  const [canvasState, setCanvasState] = useState<CanvasState>({
    matchedCalls: null,
    actionPlan: null,
    proposalSections: null,
    activeTab: 'calls',
  });
```

- [ ] **Step 3: Update handleSSEEvent to populate canvasState on step_complete**

In the `handleSSEEvent` callback, update the `step_complete` case (around line 200):

```typescript
/* Before: */
      case 'step_complete':
        flushChunkBuffer();
        setMessages((prev) => [
          ...prev,
          {
            id: `complete-${event.step}-${Date.now()}`,
            role: 'assistant',
            content: event.summary,
            eventType: 'step_complete',
            step: event.step,
          },
        ]);
        break;

/* After: */
      case 'step_complete':
        flushChunkBuffer();
        setMessages((prev) => [
          ...prev,
          {
            id: `complete-${event.step}-${Date.now()}`,
            role: 'assistant',
            content: event.summary,
            eventType: 'step_complete',
            step: event.step,
          },
        ]);
        // Update canvas state from context snapshot if present
        if ('context' in event && event.context) {
          const ctx = event.context as Partial<WorkflowContext>;
          setCanvasState((prev) => ({
            matchedCalls: ctx.matchedCalls ?? prev.matchedCalls,
            actionPlan: ctx.actionPlan ?? prev.actionPlan,
            proposalSections: ctx.projectSections ?? prev.proposalSections,
            activeTab: deriveActiveTab(event.step),
          }));
        } else {
          setCanvasState((prev) => ({
            ...prev,
            activeTab: deriveActiveTab(event.step),
          }));
        }
        break;
```

- [ ] **Step 4: Update SSEEvent type in the hook to match the server type**

In the hook's local `SSEEvent` type (around line 25), update the step_complete variant:

```typescript
/* Before: */
  | { type: 'step_complete'; step: number; summary: string }

/* After: */
  | { type: 'step_complete'; step: number; summary: string; context?: Partial<WorkflowContext> }
```

- [ ] **Step 5: Populate canvasState on loadHistory (reconnect)**

In the `loadHistory` callback (around line 255), after setting messages and currentStep, add canvas reconstruction:

```typescript
/* Before: */
      if (data.session?.currentStep) {
        setCurrentStep(data.session.currentStep);
      }

/* After: */
      if (data.session?.currentStep) {
        setCurrentStep(data.session.currentStep);
      }
      // Reconstruct canvas state from session context
      if (data.session?.context) {
        const ctx = data.session.context as Partial<WorkflowContext>;
        setCanvasState({
          matchedCalls: ctx.matchedCalls ?? null,
          actionPlan: ctx.actionPlan ?? null,
          proposalSections: ctx.projectSections ?? null,
          activeTab: deriveActiveTab(data.session.currentStep || 1),
        });
      }
```

- [ ] **Step 6: Reset canvasState in startNewSession**

In `startNewSession` (around line 340), add canvas reset:

```typescript
/* After: */
    flushChunkBuffer();
    setCanvasState({
      matchedCalls: null,
      actionPlan: null,
      proposalSections: null,
      activeTab: 'calls',
    });
```

- [ ] **Step 7: Add canvasState to the return object**

In the return statement (line 378), add `canvasState`:

```typescript
  return {
    messages,
    currentStep,
    status,
    sendMessage,
    activeSessionId,
    isStreaming,
    startNewSession,
    resumeSession,
    error,
    canvasState,
  };
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'useOrchestrator' | head -5`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/hooks/useOrchestrator.ts && git commit -m "feat(orchestrator): add canvasState to useOrchestrator hook for AI workspace canvas"
```

---

## Task 8: Wire AI Assistant Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` (full rewrite, 277 lines)

This is the largest task. The existing page has hardcoded chat messages, workflow steps, and canvas content. Replace everything with the `useOrchestrator()` hook.

- [ ] **Step 1: Rewrite the AI assistant page**

Replace the entire contents of `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` with the wired version. The page keeps the existing split-panel layout structure but replaces all hardcoded data with hook outputs.

Key components in the rewrite:
- `StepProgressBar` — 7 dots from `currentStep`, labels from `STEP_LABELS`
- `MessageList` — renders `messages[]` by `eventType` (user bubble, assistant bubble, step indicator, checkpoint card, streaming dots)
- `CheckpointCard` — renders `checkpoint.type` variants: `select` (clickable option cards), `confirm` (Continue/Modify buttons), `freetext` (input field)
- `ChatInput` — text input + send button → `sendMessage()`
- `CanvasPanel` — tabs (calls/plan/proposal) from `canvasState.activeTab`, renders structured data from `canvasState`
- Empty state when `messages.length === 0` — "Start by describing your project idea"
- Session resume via `?session=` URL query param → `resumeSession(id)` on mount

The page must:
- Import `useOrchestrator` from `@/hooks/useOrchestrator`
- Import `useTranslations` from `next-intl`
- Import `useSearchParams` from `next/navigation` for `?session=` param
- Import `STEP_LABELS` from `@/lib/ai/orchestrator/types`
- Use `'use client'` directive
- Handle all message eventTypes: `step_start`, `step_progress`, `ai_chunk`, `checkpoint`, `step_complete`, `error`
- Auto-scroll chat to bottom on new messages
- Hide canvas panel when `currentStep < 2`
- Show loading/error states from hook's `status` and `error`

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'asistent-ai' | head -5`
Expected: No errors

- [ ] **Step 3: Verify page renders in browser**

Run: `cd /home/godja/Dev/EU-Funds/app && npm run dev`
Navigate to `http://localhost:3002/ro/asistent-ai`
Expected: Empty chat with input field, no hardcoded messages, canvas hidden

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx && git commit -m "feat(ai-assistant): wire page to useOrchestrator hook with live canvas"
```

---

## Task 9: Build Smart Landing Page (Dashboard)

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/panou/page.tsx` (full rewrite, currently 8 lines)

- [ ] **Step 1: Rewrite the dashboard page**

Replace `app/src/app/[locale]/(dashboard)/panou/page.tsx` with the smart landing.

The page must:
- Use `'use client'` directive
- Import `useTranslations` from `next-intl`, `csrfFetch` from `@/lib/csrf/client`, `useRouter` from `next/navigation`, `useState`/`useEffect` from `react`
- On mount: fetch `GET /api/ai/orchestrator/sessions?status=active&limit=1` and `GET /api/v1/projects?perPage=3` in parallel via `Promise.all`
- Render conditionally based on whether user has projects/active sessions:
  - **No data:** Welcome headline, hero input (large glass-panel textarea), 3 quick-start cards (Browse Calls → `/finantari`, Start AI → `/asistent-ai`, Upload Docs → `/documente`)
  - **Has data:** Time-of-day greeting, continue banner (if active session exists), recent projects grid, smaller hero input at bottom
- Hero input submit: `POST /api/ai/orchestrator/message` with `{ message: inputText, locale }`, get `sessionId` from response, `router.push(\`/\${locale}/asistent-ai?session=\${sessionId}\`)`
- Continue banner: shows session step label from `STEP_LABELS[session.currentStep]`, "Resume" button → `/asistent-ai?session={id}`
- All text via `t()` from `useTranslations('dashboard')`
- Loading: skeleton cards
- Error: inline message with retry

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'panou' | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add app/src/app/[locale]/(dashboard)/panou/page.tsx && git commit -m "feat(dashboard): build smart landing page with hero input and continue banner"
```

---

## Task 10: Wire Projects List Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/page.tsx` (rewrite data layer, keep UI components)

- [ ] **Step 1: Replace hardcoded PROJECTS with API fetch**

In `app/src/app/[locale]/(dashboard)/proiecte/page.tsx`:
- Remove the `PROJECTS` hardcoded array (lines 21-62)
- Add state: `projects`, `loading`, `error`, `search`, `statusFilter`, `page`
- Add `useEffect` that fetches `csrfFetch(\`/api/v1/projects?page=\${page}&perPage=12&search=\${search}&status=\${statusFilter}\`)` and sets state
- Debounce search input (300ms) before triggering refetch
- Map API response fields to card rendering: `project.title`, `project.status` (map Romanian enum to display), `project.updatedAt`
- Change "Create Project" button `onClick` to `router.push(\`/\${locale}/asistent-ai\`)`
- Add empty state when `projects.length === 0 && !loading`
- Add ghost card (dashed, "+") as last item → `/asistent-ai`
- Add loading skeleton matching existing card layout
- Status filter maps: UI labels → API values (`draft`→`ciorna`, `in_progress`→`in_lucru`, `submitted`→`verificare`, `approved`→`aprobat`)

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'proiecte/page' | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/proiecte/page.tsx" && git commit -m "feat(projects): wire list page to GET /api/v1/projects"
```

---

## Task 11: Wire Project Detail Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`

- [ ] **Step 1: Replace hardcoded project with API fetch**

In `app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx`:
- Remove hardcoded `PROJECT` object
- Add `useEffect` that fetches `csrfFetch(\`/api/v1/projects/\${params.id}\`)` on mount
- Render project data from API response
- Map status enum (both V1 Romanian and V2 English) to display labels via i18n
- "Resume AI Session" button: fetch `GET /api/ai/orchestrator/sessions` filtered by this project, navigate to `/asistent-ai?session={id}`
- Keep existing tab structure (Overview, Documents, Tasks, Timeline)
- Documents tab: fetch `GET /api/v1/projects/{id}/files` for linked files
- Loading: skeleton matching existing layout
- Error: "Project not found" or error message with back link

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'proiecte/\\[id\\]' | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/proiecte/[id]/page.tsx" && git commit -m "feat(projects): wire detail page to GET /api/v1/projects/:id"
```

---

## Task 12: Wire Funding Calls Page (3-Layer)

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/finantari/page.tsx`

- [ ] **Step 1: Replace hardcoded FUNDING_CALLS with API fetch (Layer 1)**

In `app/src/app/[locale]/(dashboard)/finantari/page.tsx`:
- Remove the `FUNDING_CALLS` hardcoded array (lines 25-81)
- Add state: `calls`, `webCalls`, `loading`, `searching`, `error`, `statusFilter`, `search`, `page`
- Add `useEffect` that fetches `csrfFetch(\`/api/v1/calls?status=\${statusFilter}&search=\${search}&page=\${page}&perPage=20\`)` and sets `calls` state
- Map API response: `call.title`, `call.status`, `call.budgetMin`/`call.budgetMax`, `call.submissionEnd` (deadline), `call.programName`, `call.programCode`
- Status filter maps: `open`→`deschis`, `forthcoming`→`previzionat`, `closed`→`inchis`
- "Load more" button increments page and appends results
- "Start Project" on open calls → `router.push(\`/\${locale}/asistent-ai\`)`

- [ ] **Step 2: Add trust badges (Layer 2)**

For each call card, check `call.lastVerifiedAt`:
- If present and < 48h ago: green "Verified" badge with timestamp
- If present and > 7d ago: amber "Needs check" badge
- If absent: no badge (curated, unverified)

Use `Date.now() - new Date(call.lastVerifiedAt).getTime()` for comparison.

- [ ] **Step 3: Add AI discovery (Layer 3)**

Add "AI Smart Match" button in header. On click:
- Set `searching = true`
- Fetch `csrfFetch('/api/ai/search-calls', { method: 'POST', body: JSON.stringify({ query: search || 'open EU funding calls Romania' }) })`
- Set `webCalls` state from `response.calls`
- Render `webCalls` below DB calls with "Web result" badge and reduced opacity (`opacity-70`)
- Each web result shows: title, program, sourceUrl (as link), deadline, budgetRange, status, summary
- "Start project with this call" → `/asistent-ai`
- If search is empty and DB calls returned few results (< 3), auto-trigger AI search

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'finantari' | head -5`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/finantari/page.tsx" && git commit -m "feat(funding): wire calls page with 3-layer model (DB + trust badges + AI discovery)"
```

---

## Task 13: Wire Settings Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/setari/page.tsx`

- [ ] **Step 1: Replace hardcoded data with API fetches**

In `app/src/app/[locale]/(dashboard)/setari/page.tsx`:
- Remove hardcoded `AI_MODELS`, `USAGE_STATS`, and "Marcus Chen" data
- Add state: `preferences`, `org`, `pricing`, `saving`, `loading`
- On mount, fetch in parallel via `Promise.all`:
  - `csrfFetch('/api/v1/user/preferences')` → preferences (defaultModel, responseStyle, autoApprove)
  - `csrfFetch('/api/v1/organizations')` → org (first org from items array)
  - `csrfFetch('/api/billing/pricing')` → pricing tiers
- Profile card: render session user name and email (from useSession or pass via layout props), org name from API
- AI Preferences card: populate dropdowns and toggles from `preferences` state
- Subscription card: user tier from session, pricing from API, usage meters (use placeholder until tracking exists)
- GDPR card: toggles connected to consent state

- [ ] **Step 2: Add save handler for AI preferences**

On "Save" button click:
- Set `saving = true`
- `csrfFetch('/api/v1/user/preferences', { method: 'POST', body: JSON.stringify(preferences) })`
- On success: show success toast/indicator, set `saving = false`
- On error: show error message

- [ ] **Step 3: Add billing portal redirect**

"Manage Billing" button onClick:
- `csrfFetch('/api/billing/portal', { method: 'POST' })`
- Response contains `url` → `window.location.href = url`

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'setari' | head -5`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/setari/page.tsx" && git commit -m "feat(settings): wire page to preferences, billing, and organization APIs"
```

---

## Task 14: Wire Documents Page

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/documente/page.tsx`

- [ ] **Step 1: Replace hardcoded files with aggregated project data**

In `app/src/app/[locale]/(dashboard)/documente/page.tsx`:
- Remove hardcoded `PROJECT_FILES`, `COMPLIANCE_FILES`, `SMART_TEMPLATES` arrays
- Add state: `files`, `loading`, `error`, `filter`
- On mount: fetch `csrfFetch('/api/v1/projects?perPage=50')` to get all user projects
- For each project that has linked files, fetch `csrfFetch(\`/api/v1/projects/\${project.id}/files\`)` (or if the projects response includes file counts, skip empty ones)
- Aggregate all files into a flat list with `projectTitle` tag on each
- Group files: "Project Documents" (uploaded) vs "Generated" (AI outputs, `source === 'generated'`)
- Filter chips: All / Recent (last 7 days) / by project name
- File cards: type icon (PDF=red, DOCX=blue, XLSX=green, TXT=gray based on mimeType), filename, size, project tag, last modified
- Upload zone: keep the visual UI but disable the action (show "Coming soon" tooltip)
- Smart templates section: keep as-is (static, informational)
- Loading: skeleton cards
- Error: inline message

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit --pretty 2>&1 | grep 'documente' | head -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git add "app/src/app/[locale]/(dashboard)/documente/page.tsx" && git commit -m "feat(documents): wire page with aggregated project files"
```

---

## Self-Review Checklist

- [x] Spec section 1 (AI assistant backend fixes): Tasks 2-6
- [x] Spec section 1 (hook extension): Task 7
- [x] Spec section 1 (page wiring): Task 8
- [x] Spec section 2 (dashboard): Task 9
- [x] Spec section 3 (projects): Tasks 10-11
- [x] Spec section 4 (funding calls 3-layer): Task 12
- [x] Spec section 5 (settings): Task 13
- [x] Spec section 6 (documents): Task 14
- [x] Spec section 7 (text readability): Task 1
- [x] No TBDs or TODOs
- [x] Types consistent: `MatchedCall`, `ActionPlan`, `ProjectSection` from `types.ts` used throughout
- [x] `canvasState` field names match: `matchedCalls`, `actionPlan`, `proposalSections` across Tasks 7-8
- [x] `deriveActiveTab` logic consistent between Task 7 definition and usage
- [x] `csrfFetch` used for all POST/PUT/DELETE, plain `fetch` for GET (GET doesn't need CSRF)
