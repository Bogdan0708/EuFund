# AI Flow Stability — PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three user-visible defects in the managed agent runtime — stale post-write `done.finalState`, racing workspace action buttons during streaming turns, and leaked English tool-error strings — without touching the executor contract, the SSE event shape, or the DB schema.

**Architecture:** Four discrete changes scoped to the managed runtime + agent UI:
- (B) `runManagedTurn` reloads `agent_sessions` + `agent_sections` after successful writes and folds the fresh rows into `done.finalState`; `useAgent` adds a terminal-error latch so non-retryable errors aren't masked by the post-stream `setStatus('idle')`.
- (C) `AgentWorkspace` accepts `isBusy` and forwards `disabled` to the four mutating buttons; both callers compute `isBusy` from `agent.status`.
- (F1) Iteration-cap synthetic text is appended to `agent_messages` (best-effort, non-fatal) so the next turn's history reflects the bail-out.
- (F2) Tool-error UI strings are localized client-side via a pure-function formatter that maps stable executor prefixes to `agent.toolErrors.*` translations.

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest (node environment), Drizzle ORM + postgres.js, next-intl, Anthropic SDK (`@anthropic-ai/sdk`).

**Spec:** `docs/superpowers/specs/2026-04-29-ai-flow-stability-pr1-design.md`

**Test environment note:** `app/vitest.config.ts` uses `environment: 'node'` and the repo has neither `jsdom` nor `@testing-library/react` installed. Adding either is out of scope for PR1 (stability mandate). Component-level rendering tests for Change C are deferred — the disabled-button wiring is verified via TypeScript prop interface enforcement plus a manual smoke step in Task 11. All other changes are testable as pure functions or server-side runtime tests.

---

## File Structure

| Path | Role | Status |
|---|---|---|
| `app/src/lib/ai/agent/managed/runtime.ts` | Tool loop; gains `writesSucceeded` flag + post-write reload + cap-text persistence | Modify |
| `app/src/lib/ai/agent/managed/reload.ts` | New helper: `reloadSessionAndSections(sessionId, userId)` (DB query + local row mappers) | Create |
| `app/src/hooks/useAgent.ts` | Streaming SSE consumer; gains `terminalErrorRef`; calls formatter for `tool_result` | Modify |
| `app/src/lib/ai/agent/format-tool-error.ts` | New pure-function formatter that maps executor prefixes to translation keys | Create |
| `app/src/components/agent/AgentWorkspace.tsx` | Adds `isBusy` prop; forwards `disabled` down | Modify |
| `app/src/components/agent/OutlineView.tsx` | Adds optional `disabled` prop on the Approve button | Modify |
| `app/src/components/agent/SectionCard.tsx` | Adds optional `disabled` prop on Accept + Reject buttons | Modify |
| `app/src/components/agent/ValidationSummary.tsx` | Adds optional `disabled` prop, OR'd with the existing eligibility/section condition | Modify |
| `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx` | Computes `isBusy` from `agent.status`; passes to `AgentWorkspace` | Modify |
| `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` | Same as above | Modify |
| `app/src/messages/en.json` | Add `agent.toolErrors.*` namespace (10 keys) | Modify |
| `app/src/messages/ro.json` | Same | Modify |
| `app/tests/unit/format-tool-error.test.ts` | Pure-function tests covering all 10 executor prefixes × 2 locales + Romanian leak guard | Create |
| `app/tests/integration/managed/runtime-post-write-reload.test.ts` | Asserts `done.finalState.stateVersion` matches the post-write DB row | Create |
| `app/tests/integration/managed/runtime-reload-failure.test.ts` | Asserts terminal `error` event, no `done`, `markTurnCompleted` ran first | Create |
| `app/tests/integration/managed/runtime-iteration-cap.test.ts` | Extend existing test to assert `appendManagedMessage` called with cap text | Modify |

---

## Task 1: Add reload helper module

**Files:**
- Create: `app/src/lib/ai/agent/managed/reload.ts`

This module wraps the two Drizzle queries that load `agent_sessions` + `agent_sections` for a session (currently inlined in `app/src/app/api/ai/agent/route.ts:46-64` and using the private `mapSessionRow` / `mapSectionRow` from `route.ts:571,593`). The spec rules out extracting a shared service; instead we **duplicate the two row mappers locally** and document the intent. They can be unified in a follow-up cleanup PR.

The helper is a pure async function. No side effects beyond DB reads.

> **Deliberate adaptation from spec.** The spec (`docs/superpowers/specs/2026-04-29-ai-flow-stability-pr1-design.md:77`) says the reload helper "lives in `managed/runtime.ts` next to `buildUISnapshot`." This plan extracts it to its own file instead. Rationale: `runtime.ts` is already a 460-line file owning the streaming tool loop, usage accounting, parallel-write cap, and message persistence. Adding a new helper plus duplicated row mappers (~80 lines) directly into it reduces readability for marginal locality benefit. A separate file makes the helper trivially mockable in tests (`vi.mock('@/lib/ai/agent/managed/reload', ...)`) without having to mock the whole runtime. Both choices satisfy the spec's actual constraint — that the row mapping be duplicated rather than extracted into a cross-runtime shared service. The unification follow-up still applies regardless of which file holds the duplicate.

- [ ] **Step 1: Create the file with imports + signature**

```ts
// app/src/lib/ai/agent/managed/reload.ts
//
// Post-write reload helper for the managed runtime.
//
// Loads agent_sessions + agent_sections by id, scoped to userId, and maps
// rows into the in-memory AgentSession / AgentSection shapes the runtime
// already uses. Returns null when the session row is missing or owned by
// another user — the caller treats that as a reload failure.
//
// Row-mapping functions are intentionally duplicated from
// app/src/app/api/ai/agent/route.ts (mapSessionRow at line 571, mapSectionRow
// at line 593). The spec for PR1 rules out extracting a shared mapper module
// to keep blast radius small. A post-pilot cleanup PR can unify them.

import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AgentSession, AgentSection } from '../types'

export interface ReloadResult {
  session: AgentSession
  sections: AgentSection[]
}

export async function reloadSessionAndSections(
  sessionId: string,
  userId: string,
): Promise<ReloadResult | null> {
  const [row] = await db
    .select()
    .from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
    .limit(1)

  if (!row) return null

  const sectionRows = await db
    .select()
    .from(agentSections)
    .where(eq(agentSections.sessionId, sessionId))

  return {
    session: mapSessionRow(row),
    sections: sectionRows.map(mapSectionRow),
  }
}

function mapSessionRow(row: Record<string, unknown>): AgentSession {
  return {
    id: row.id as string,
    userId: row.userId as string,
    projectId: (row.projectId as string) ?? null,
    status: row.status as AgentSession['status'],
    locale: row.locale as 'ro' | 'en',
    selectedCallId: row.selectedCallId as string | null,
    currentPhase: row.currentPhase as AgentSession['currentPhase'],
    blueprint: row.blueprint as AgentSession['blueprint'],
    eligibility: row.eligibility as AgentSession['eligibility'],
    outline: row.outline as AgentSession['outline'],
    warnings: (row.warnings as AgentSession['warnings']) || [],
    planningArtifact: row.planningArtifact as AgentSession['planningArtifact'],
    outlineFrozen: (row.outlineFrozen as boolean) || false,
    messageSummary: row.messageSummary as string | null,
    stateVersion: row.stateVersion as number,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  }
}

function mapSectionRow(row: Record<string, unknown>): AgentSection {
  return {
    id: row.id as string,
    sessionId: row.sessionId as string,
    sectionKey: row.sectionKey as string,
    title: row.title as string,
    documentOrder: row.documentOrder as number,
    generationOrder: row.generationOrder as number,
    status: row.status as AgentSection['status'],
    content: row.content as string | null,
    acceptedContent: row.acceptedContent as string | null,
    modelUsed: row.modelUsed as string | null,
    retryCount: row.retryCount as number,
    sourcesUsed: row.sourcesUsed as string[] | null,
    promptVersion: row.promptVersion as string | null,
    latencyMs: row.latencyMs as number | null,
    tokenUsage: row.tokenUsage as AgentSection['tokenUsage'],
    errorClass: row.errorClass as string | null,
    rejectionReason: row.rejectionReason as string | null,
    updatedAt: row.updatedAt as Date,
  }
}
```

- [ ] **Step 2: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS — no new errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/ai/agent/managed/reload.ts
git commit -m "feat(managed): add reload helper for post-write state refresh"
```

---

## Task 2: Wire writesSucceeded tracking into runtime tool loop

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`

Add a `writesSucceeded: boolean` flag, flip it true the first time a tool with name in `WRITE_TOOL_NAMES` returns `result.isError === false`. This change is mechanical; no behavior changes yet — the flag is read in Task 3.

- [ ] **Step 1: Declare the flag near the other turn-level locals**

Find the block at `runtime.ts:128-133` (`let toolCount = 0` … `let firstOutputPersisted = false`) and add the new flag at the bottom:

```ts
  let toolCount = 0
  let iterationCount = 0
  // Message persistence is deferred until the first durable assistant or
  // tool_use block arrives. This flag flips true inside the stream loop
  // the first time we flush the user message + first output together.
  let firstOutputPersisted = false
  // Tracks whether any WRITE_TOOL_NAMES tool dispatched in this turn returned
  // a non-error result. Read after the loop to decide whether to reload
  // session/sections from DB before building the final UI snapshot.
  let writesSucceeded = false
```

- [ ] **Step 2: Flip the flag in the executor result loop**

Find the block at `runtime.ts:329-359` (`for (const { block, result } of executionResults)`). Right after the `toolCount += 1` line, add the write-detection guard. The check uses the imported `WRITE_TOOL_NAMES` set (already imported at line 24):

```ts
    for (const { block, result } of executionResults) {
      toolCount += 1

      if (!result.isError && WRITE_TOOL_NAMES.has(result.toolName)) {
        writesSucceeded = true
      }

      emit({
        type: 'tool_result',
        // … unchanged
```

- [ ] **Step 3: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run existing managed tests to confirm no regression**

Run from `app/`: `npx vitest run tests/integration/managed/`
Expected: all pass — the flag is set but not yet read.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/managed/runtime.ts
git commit -m "refactor(managed): track writesSucceeded across tool loop"
```

---

## Task 3: Reload session+sections after writes; build done.finalState from fresh rows

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`
- Test: `app/tests/integration/managed/runtime-post-write-reload.test.ts`

The current `runtime.ts:417-418` builds `finalState` from the pre-turn `session` / `sections` locals and emits `done`. After this task: when `writesSucceeded === true`, re-query the DB and build `finalState` from the fresh rows. The reload happens **after** `markTurnCompleted` and `compactIfNeeded` so a turn with durable output is always recorded as completed regardless of whether the reload succeeds.

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration/managed/runtime-post-write-reload.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeFakeStream(events: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const e of events) yield e
    },
  }
}

// Single sub-stream: emits set_selected_call(tool_use) + end_turn after the
// tool result is handled (we use end_turn here to exit the loop after one
// write, matching the spec's "managed write turn followed by an immediate
// UI action" scenario).
const stream1Events = [
  { type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_set', name: 'set_selected_call', input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"sessionId":"11111111-1111-4111-8111-111111111111","callId":"CALL-1","expectedStateVersion":0}' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
  { type: 'message_stop' },
]

// Second stream: assistant text + end_turn. Loop exits after this.
const stream2Events = [
  { type: 'message_start', message: { id: 'm2', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 150, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Done.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
]

// Hoisted so the factory below + later `vi.mocked(getAnthropicClient)`
// references resolve to the same vi.fn(). A plain inline arrow function
// would not expose `.mockReturnValueOnce()` to the second test.
const { getAnthropicClient } = vi.hoisted(() => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      stream: vi.fn()
        .mockImplementationOnce(() => makeFakeStream(stream1Events))
        .mockImplementationOnce(() => makeFakeStream(stream2Events)),
    },
  })),
}))

vi.mock('@/lib/ai/anthropic-client', () => ({ getAnthropicClient }))

vi.mock('@/lib/db', () => {
  const makeChain = () => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(() => Promise.resolve([])),
      then: (resolve: (val: unknown[]) => void) => resolve([]),
    }
    return chain
  }
  const mockDb: any = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn().mockResolvedValue([{ id: 'mock-turn-id' }]),
        then: (resolve: (val: unknown) => void) => resolve(undefined),
      })),
    })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) })),
    delete: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  }
  mockDb.transaction = vi.fn(async (cb: any) => cb(mockDb))
  return { db: mockDb }
})

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number', turnId: 'turn_id' },
  agentTurns: { id: 'id', sessionId: 'session_id', requestId: 'request_id' },
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
  asc: vi.fn(),
  desc: vi.fn(),
}))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/ai/agent/services/evidence', () => ({ searchCalls: vi.fn(), retrieveEvidence: vi.fn() }))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn() }))
vi.mock('@/lib/ai/agent/services/application', () => ({
  getApplicationState: vi.fn(),
  getValidationReport: vi.fn(),
  validateApplication: vi.fn(),
  checkMissingAnnexes: vi.fn(),
  setApplicationStatus: vi.fn(),
  setSelectedCall: vi.fn(),
  freezeOutline: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/sections', () => ({
  listSections: vi.fn(),
  getSection: vi.fn(),
  validateSection: vi.fn(),
  saveSectionDraft: vi.fn(),
  approveSection: vi.fn(),
  rollbackSection: vi.fn(),
  markSectionStale: vi.fn(),
  rejectSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/projects', () => ({ getProjectSummary: vi.fn(), listUploadedDocuments: vi.fn() }))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({ runEligibility: vi.fn(), scoreFit: vi.fn() }))

// Spy the reload helper so we can verify it ran AND inject a fresh row.
vi.mock('@/lib/ai/agent/managed/reload', () => ({
  reloadSessionAndSections: vi.fn(),
}))

import type { AgentEvent, AgentSession } from '@/lib/ai/agent/types'

const mockSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  status: 'active',
  locale: 'ro',
  selectedCallId: null,
  currentPhase: 'research',
  blueprint: null,
  eligibility: null,
  outline: null,
  warnings: [],
  planningArtifact: null,
  outlineFrozen: false,
  messageSummary: null,
  stateVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('runManagedTurn — post-write reload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('reloads from DB after a successful write and emits done with fresh stateVersion', async () => {
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setSelectedCall).mockResolvedValueOnce({ newStateVersion: 1 } as never)

    const { reloadSessionAndSections } = await import('@/lib/ai/agent/managed/reload')
    vi.mocked(reloadSessionAndSections).mockResolvedValueOnce({
      session: { ...mockSession, stateVersion: 1, selectedCallId: 'CALL-1' },
      sections: [],
    })

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-1', locale: 'ro', message: 'Selectează apelul.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-1',
        now: new Date(),
        allowWrites: true,
      },
    })

    expect(reloadSessionAndSections).toHaveBeenCalledWith(mockSession.id, mockSession.userId)

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
    if (done?.type !== 'done') throw new Error('expected done event')
    expect(done.finalState.stateVersion).toBe(1)
  })

  it('does NOT call reload when no write succeeded', async () => {
    // Override Anthropic to emit text only — no tool_use, no writes.
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    vi.mocked(getAnthropicClient).mockReturnValueOnce({
      messages: {
        stream: vi.fn().mockImplementationOnce(() => makeFakeStream(stream2Events)),
      },
    } as never)

    const { reloadSessionAndSections } = await import('@/lib/ai/agent/managed/reload')

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-2', locale: 'ro', message: 'Salut.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-2',
        now: new Date(),
        allowWrites: true,
      },
    })

    expect(reloadSessionAndSections).not.toHaveBeenCalled()

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
    if (done?.type !== 'done') throw new Error('expected done event')
    expect(done.finalState.stateVersion).toBe(0) // pre-turn stateVersion
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `app/`: `npx vitest run tests/integration/managed/runtime-post-write-reload.test.ts`
Expected: FAIL — the assertion `reloadSessionAndSections` was called fails because runtime.ts doesn't yet import or call it.

- [ ] **Step 3: Add the reload call to runtime.ts**

Edit `app/src/lib/ai/agent/managed/runtime.ts`. Add the import near the other managed-module imports (around line 80, after the `compactIfNeeded` import):

```ts
import { reloadSessionAndSections } from './reload'
```

Then replace the block at `runtime.ts:417-418` (`const finalState = buildUISnapshot(session, sections)` + `emit({ type: 'done', finalState })`) with:

```ts
  // Post-write reload (PR1 Change B). Runs AFTER markTurnCompleted +
  // compactIfNeeded so that a turn with durable output is always recorded
  // as completed even if the reload itself fails.
  let snapshotSession = session
  let snapshotSections = sections
  if (writesSucceeded) {
    try {
      const reloaded = await reloadSessionAndSections(session.id, session.userId)
      if (!reloaded) throw new Error('session row missing after write')
      snapshotSession = reloaded.session
      snapshotSections = reloaded.sections
    } catch (err) {
      log.error(
        {
          sessionId: session.id,
          requestId: request.requestId,
          error: err instanceof Error ? err.message : String(err),
        },
        'managed post-write reload failed',
      )
      const message = session.locale === 'ro'
        ? 'Sesiunea s-a actualizat parțial. Reîncarcă pagina pentru a continua.'
        : 'Session partially updated. Reload to continue.'
      emit({ type: 'error', message, retryable: false })
      // Skip the done event. agent_turns.completedAt is already set by
      // markTurnCompleted above. The client's terminalErrorRef latch (Task 5)
      // prevents the post-stream setStatus('idle') from masking this.
      log.info({
        event: 'managed_turn_complete',
        sessionId: session.id,
        turnId,
        requestId: request.requestId,
        iterations: iterationCount,
        toolCount,
        durationMs: Date.now() - start,
        outcome: 'completed_reload_failed',
        degradedReason: null,
        model: modelUsed,
        usage: aggregateUsage,
        costUsdMicros,
      }, 'managed_turn_complete')
      return {
        toolCount,
        iterationCount,
        model: tctx.messageModel,
        latencyMs: Date.now() - start,
        firstOutputPersisted,
      }
    }
  }

  const finalState = buildUISnapshot(snapshotSession, snapshotSections)
  emit({ type: 'done', finalState })
```

The original `log.info({ event: 'managed_turn_complete', … }, 'managed_turn_complete')` block at `runtime.ts:423-436` and the final `return` statement stay unchanged for the success path — they run after `emit({ type: 'done', finalState })`.

- [ ] **Step 4: Run the post-write reload test**

Run from `app/`: `npx vitest run tests/integration/managed/runtime-post-write-reload.test.ts`
Expected: PASS — both cases (write happens → reload called; no write → no reload).

- [ ] **Step 5: Run all managed integration tests**

Run from `app/`: `npx vitest run tests/integration/managed/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/managed/runtime.ts \
        app/tests/integration/managed/runtime-post-write-reload.test.ts
git commit -m "feat(managed): reload session/sections after writes for accurate done.finalState"
```

---

## Task 4: Reload-failure path — terminal error, no done, completion preserved

**Files:**
- Test: `app/tests/integration/managed/runtime-reload-failure.test.ts`

The implementation already lives in Task 3's edit (the `try/catch` around `reloadSessionAndSections`). This task adds the regression test that pins the contract: on reload failure, exactly one `error` with `retryable: false` is emitted, no `done` is emitted, and `markTurnCompleted` was called before the failure.

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration/managed/runtime-reload-failure.test.ts`. The mock setup is identical to `runtime-post-write-reload.test.ts` (copy it wholesale, including the streams and all `vi.mock(...)` calls). The unique parts are:

```ts
// Spy on markTurnCompleted so we can assert it ran before the reload threw.
vi.mock('@/lib/ai/agent/managed/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent/managed/history')>()
  return {
    ...actual,
    markTurnCompleted: vi.fn().mockResolvedValue(undefined),
    appendManagedMessage: vi.fn().mockResolvedValue(0),
    persistFirstDurableOutput: vi.fn().mockResolvedValue(undefined),
    loadManagedHistory: vi.fn().mockResolvedValue({ messages: [], systemSummary: null }),
  }
})

vi.mock('@/lib/ai/agent/managed/reload', () => ({
  reloadSessionAndSections: vi.fn(),
}))

// … (mocks for db, schema, drizzle-orm, logger, services — identical to Task 3)

describe('runManagedTurn — reload failure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits exactly one terminal error, no done, after markTurnCompleted', async () => {
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setSelectedCall).mockResolvedValueOnce({ newStateVersion: 1 } as never)

    const { reloadSessionAndSections } = await import('@/lib/ai/agent/managed/reload')
    vi.mocked(reloadSessionAndSections).mockRejectedValueOnce(new Error('db down'))

    const { markTurnCompleted } = await import('@/lib/ai/agent/managed/history')

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-fail', locale: 'ro', message: 'Selectează apelul.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-fail',
        now: new Date(),
        allowWrites: true,
      },
    })

    // markTurnCompleted MUST have run BEFORE the reload threw — proves the
    // turn is recorded as completed even though the post-write reload failed.
    // Assert ordering via invocationCallOrder, not just call count: a future
    // refactor that runs the reload first and falls through to markTurnCompleted
    // on success would still see "called once" but would no longer satisfy the
    // ordering invariant the catch path depends on.
    expect(markTurnCompleted).toHaveBeenCalledTimes(1)
    expect(reloadSessionAndSections).toHaveBeenCalledTimes(1)
    const markOrder = vi.mocked(markTurnCompleted).mock.invocationCallOrder[0]
    const reloadOrder = vi.mocked(reloadSessionAndSections).mock.invocationCallOrder[0]
    expect(markOrder).toBeLessThan(reloadOrder)

    const errorEvents = events.filter(e => e.type === 'error')
    expect(errorEvents).toHaveLength(1)
    if (errorEvents[0].type !== 'error') throw new Error('expected error event')
    expect(errorEvents[0].retryable).toBe(false)
    expect(errorEvents[0].message).toMatch(/Sesiunea|Session/)
    expect(errorEvents[0].message.length).toBeGreaterThan(0)

    const doneEvents = events.filter(e => e.type === 'done')
    expect(doneEvents).toHaveLength(0)
  })

  it('does NOT emit terminal error when reload succeeds', async () => {
    const { setSelectedCall } = await import('@/lib/ai/agent/services/application')
    vi.mocked(setSelectedCall).mockResolvedValueOnce({ newStateVersion: 1 } as never)

    const { reloadSessionAndSections } = await import('@/lib/ai/agent/managed/reload')
    vi.mocked(reloadSessionAndSections).mockResolvedValueOnce({
      session: { ...mockSession, stateVersion: 1 },
      sections: [],
    })

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-ok', locale: 'ro', message: 'Selectează apelul.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-ok',
        now: new Date(),
        allowWrites: true,
      },
    })

    expect(events.filter(e => e.type === 'error')).toHaveLength(0)
    expect(events.filter(e => e.type === 'done')).toHaveLength(1)
  })
})
```

The mock setup (anthropic, db, schema, drizzle-orm, logger, all services, mockSession) is the same as Task 3's test — copy it verbatim into the same file. Do NOT use `import { ... } from '../runtime-post-write-reload.test.ts'`.

- [ ] **Step 2: Run the test**

Run from `app/`: `npx vitest run tests/integration/managed/runtime-reload-failure.test.ts`
Expected: PASS — Task 3's runtime edit already implements the catch path; this test verifies it.

- [ ] **Step 3: Run all managed tests**

Run from `app/`: `npx vitest run tests/integration/managed/`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add app/tests/integration/managed/runtime-reload-failure.test.ts
git commit -m "test(managed): pin reload-failure contract — terminal error after markTurnCompleted"
```

---

## Task 5: Add terminalErrorRef latch in useAgent

**Files:**
- Modify: `app/src/hooks/useAgent.ts`

The current `useAgent.ts:260` unconditionally calls `setStatus('idle')` after the reader loop drains. When the runtime emits `error retryable=false` mid-stream, the hook sets `status='error'` (line 151), but `setStatus('idle')` overwrites it. Fix with a ref-backed latch.

This change is global — applies to ALL non-retryable error events, not just reload failures. Closes a latent bug.

- [ ] **Step 1: Add the latch ref**

Edit `app/src/hooks/useAgent.ts`. Find the block at lines 45-52 (`abortRef`, `stateVersionRef`, `sessionIdRef`). Insert the new ref:

```ts
  const abortRef = useRef<AbortController | null>(null)
  // True when the most recent stream emitted a non-retryable error event.
  // The reader loop's natural-end setStatus('idle') is gated on this so
  // a terminal failure (e.g. post-write reload failure) isn't masked as
  // 'idle' once the stream closes. Reset to false at the start of each
  // sendRequest so retries clear the latch.
  const terminalErrorRef = useRef(false)
  const stateVersionRef = useRef(0)
  stateVersionRef.current = stateVersion
```

- [ ] **Step 2: Set the latch in the error handler**

Find the `case 'error':` block at lines 149-152:

```ts
      case 'error':
        setError(event.message)
        if (!event.retryable) setStatus('error')
        break
```

Replace with:

```ts
      case 'error':
        setError(event.message)
        if (!event.retryable) {
          terminalErrorRef.current = true
          setStatus('error')
        }
        break
```

- [ ] **Step 3: Reset the latch at the start of sendRequest**

Find the body of `sendRequest` at line 163. After the `setStatus('connecting')` line (line 172) and before `setError(null)` (line 173), insert the reset:

```ts
    setStatus('connecting')
    terminalErrorRef.current = false
    setError(null)
```

- [ ] **Step 4: Gate the post-loop setStatus('idle')**

Find line 260 inside `sendRequest`:

```ts
      setStatus('idle')
    } catch (err) {
```

Replace with:

```ts
      if (!terminalErrorRef.current) setStatus('idle')
    } catch (err) {
```

- [ ] **Step 5: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run lint**

Run from `app/`: `npm run lint`
Expected: PASS — no new warnings on the modified file. The existing `eslint-disable-next-line react-hooks/exhaustive-deps` at line 268 stays as-is.

- [ ] **Step 7: Commit**

```bash
git add app/src/hooks/useAgent.ts
git commit -m "fix(useAgent): latch terminal errors so post-stream idle doesn't mask them"
```

**Note:** Hook behavior is verified end-to-end via the manual smoke step in Task 11 (running the local managed flow with a forced reload failure). No unit test for the latch — RTL is not in the dev-deps and adding it expands PR1 scope.

---

## Task 6: Add disabled prop to OutlineView, SectionCard, ValidationSummary

**Files:**
- Modify: `app/src/components/agent/OutlineView.tsx`
- Modify: `app/src/components/agent/SectionCard.tsx`
- Modify: `app/src/components/agent/ValidationSummary.tsx`

Each child component gets an optional `disabled?: boolean` prop (default `false`) and forwards it to its mutating button(s).

- [ ] **Step 1: Update OutlineView**

Edit `app/src/components/agent/OutlineView.tsx`. Replace the entire file with:

```tsx
import type { AgentSectionState } from '@/hooks/useAgent'

interface Props {
  sections: AgentSectionState[]
  onApprove: () => void
  disabled?: boolean
}

export function OutlineView({ sections, onApprove, disabled = false }: Props) {
  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">Application Outline</h3>
        <button
          onClick={onApprove}
          disabled={disabled}
          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Approve & Start Drafting
        </button>
      </div>
      <ol className="space-y-1.5">
        {sections
          .sort((a, b) => a.documentOrder - b.documentOrder)
          .map((s, i) => (
            <li key={s.sectionKey} className="flex items-center gap-2 text-sm">
              <span className="text-xs text-gray-400 w-5 text-right">{i + 1}.</span>
              <span className="text-gray-900">{s.title}</span>
            </li>
          ))}
      </ol>
    </div>
  )
}
```

- [ ] **Step 2: Update SectionCard**

Edit `app/src/components/agent/SectionCard.tsx`. Add `disabled` to the `Props` interface and forward to both buttons:

Find:
```tsx
interface Props {
  section: AgentSectionState
  onAccept: () => void
  onReject: () => void
}
```

Replace with:
```tsx
interface Props {
  section: AgentSectionState
  onAccept: () => void
  onReject: () => void
  disabled?: boolean
}
```

Find:
```tsx
export function SectionCard({ section, onAccept, onReject }: Props) {
```

Replace with:
```tsx
export function SectionCard({ section, onAccept, onReject, disabled = false }: Props) {
```

Find the two buttons inside `section.status === 'draft'`:
```tsx
          <button onClick={onAccept} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
            Accept
          </button>
          <button onClick={onReject} className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
            Revise
          </button>
```

Replace with:
```tsx
          <button onClick={onAccept} disabled={disabled} className="text-xs px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            Accept
          </button>
          <button onClick={onReject} disabled={disabled} className="text-xs px-3 py-1.5 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
            Revise
          </button>
```

- [ ] **Step 3: Update ValidationSummary**

Edit `app/src/components/agent/ValidationSummary.tsx`. The button already has a `disabled` attribute computed from `!allAccepted || hasBlockers`. We OR the new prop in.

Find:
```tsx
interface Props {
  sections: AgentSectionState[]
  eligibility: unknown
  onComplete: () => void
}
```

Replace with:
```tsx
interface Props {
  sections: AgentSectionState[]
  eligibility: unknown
  onComplete: () => void
  disabled?: boolean
}
```

Find:
```tsx
export function ValidationSummary({ sections, eligibility, onComplete }: Props) {
```

Replace with:
```tsx
export function ValidationSummary({ sections, eligibility, onComplete, disabled = false }: Props) {
```

Find:
```tsx
      <button
        onClick={onComplete}
        disabled={!allAccepted || hasBlockers}
        className="mt-4 w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
```

Replace with:
```tsx
      <button
        onClick={onComplete}
        disabled={!allAccepted || hasBlockers || disabled}
        className="mt-4 w-full py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
```

- [ ] **Step 4: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS — `disabled` is optional, no caller breaks.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/agent/OutlineView.tsx \
        app/src/components/agent/SectionCard.tsx \
        app/src/components/agent/ValidationSummary.tsx
git commit -m "feat(agent-ui): forward disabled prop to mutating workspace buttons"
```

---

## Task 7: Add isBusy to AgentWorkspace and forward to children

**Files:**
- Modify: `app/src/components/agent/AgentWorkspace.tsx`

`AgentWorkspace` adds `isBusy: boolean` to its `Props` and threads it as `disabled` into `OutlineView`, `SectionCard`, and `ValidationSummary`.

- [ ] **Step 1: Add isBusy to Props and forward**

Edit `app/src/components/agent/AgentWorkspace.tsx`. Find:

```tsx
interface Props {
  phase: Phase
  sections: AgentSectionState[]
  blueprint: unknown
  eligibility: unknown
  warnings: Warning[]
  onAction: (action: StructuredAction) => void
}
```

Replace with:

```tsx
interface Props {
  phase: Phase
  sections: AgentSectionState[]
  blueprint: unknown
  eligibility: unknown
  warnings: Warning[]
  onAction: (action: StructuredAction) => void
  // True while the agent is connecting or streaming. Disables the four
  // mutating workspace buttons (approve outline, accept/reject section,
  // mark complete) so a click cannot race the in-flight turn and 409.
  isBusy: boolean
}
```

Find:
```tsx
export function AgentWorkspace({ phase, sections, blueprint, eligibility, warnings, onAction }: Props) {
```

Replace with:
```tsx
export function AgentWorkspace({ phase, sections, blueprint, eligibility, warnings, onAction, isBusy }: Props) {
```

Find the three call sites that need forwarding.

OutlineView (line 72):
```tsx
        {sections.length > 0 && phase === 'structuring' && (
          <OutlineView sections={sections} onApprove={() => onAction({ type: 'approve_outline' })} />
        )}
```

Replace with:
```tsx
        {sections.length > 0 && phase === 'structuring' && (
          <OutlineView sections={sections} onApprove={() => onAction({ type: 'approve_outline' })} disabled={isBusy} />
        )}
```

SectionCard (lines 79-86):
```tsx
            {sections
              .sort((a, b) => a.documentOrder - b.documentOrder)
              .map(section => (
                <SectionCard
                  key={section.sectionKey}
                  section={section}
                  onAccept={() => onAction({ type: 'accept_section', sectionKey: section.sectionKey })}
                  onReject={() => onAction({ type: 'reject_section', sectionKey: section.sectionKey, reason: 'Needs revision' })}
                />
              ))}
```

Replace with:
```tsx
            {sections
              .sort((a, b) => a.documentOrder - b.documentOrder)
              .map(section => (
                <SectionCard
                  key={section.sectionKey}
                  section={section}
                  onAccept={() => onAction({ type: 'accept_section', sectionKey: section.sectionKey })}
                  onReject={() => onAction({ type: 'reject_section', sectionKey: section.sectionKey, reason: 'Needs revision' })}
                  disabled={isBusy}
                />
              ))}
```

ValidationSummary (lines 90-96):
```tsx
        {phase === 'review' && (
          <ValidationSummary
            sections={sections}
            eligibility={eligibility}
            onComplete={() => onAction({ type: 'mark_complete' })}
          />
        )}
```

Replace with:
```tsx
        {phase === 'review' && (
          <ValidationSummary
            sections={sections}
            eligibility={eligibility}
            onComplete={() => onAction({ type: 'mark_complete' })}
            disabled={isBusy}
          />
        )}
```

- [ ] **Step 2: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: FAIL — both callers (`NewProjectView.tsx`, `asistent-ai/page.tsx`) don't yet pass `isBusy`. This is expected; Task 8 fixes the callers.

- [ ] **Step 3: DON'T commit yet**

Wait until Task 8 wires the callers — they're a logical pair.

---

## Task 8: Pass isBusy from both AgentWorkspace callers

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx`

- [ ] **Step 1: Update NewProjectView.tsx**

Edit `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx`. Find the `AgentWorkspace` invocation around line 280:

```tsx
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
```

Replace with:

```tsx
        <div className="w-1/2 bg-gray-50">
          <AgentWorkspace
            phase={agent.phase}
            sections={agent.sections}
            blueprint={agent.blueprint}
            eligibility={agent.eligibility}
            warnings={agent.warnings}
            onAction={agent.sendAction}
            isBusy={agent.status === 'streaming' || agent.status === 'connecting'}
          />
        </div>
```

- [ ] **Step 2: Update asistent-ai/page.tsx**

Edit `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx`. Find the `AgentWorkspace` invocation at line 42:

```tsx
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
```

Replace with:

```tsx
        <div className="w-1/2 bg-gray-50">
          <AgentWorkspace
            phase={agent.phase}
            sections={agent.sections}
            blueprint={agent.blueprint}
            eligibility={agent.eligibility}
            warnings={agent.warnings}
            onAction={agent.sendAction}
            isBusy={agent.status === 'streaming' || agent.status === 'connecting'}
          />
        </div>
```

- [ ] **Step 3: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run lint**

Run from `app/`: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/components/agent/AgentWorkspace.tsx \
        app/src/app/[locale]/\(dashboard\)/proiecte/nou/NewProjectView.tsx \
        app/src/app/[locale]/\(dashboard\)/asistent-ai/page.tsx
git commit -m "feat(agent-ui): disable workspace actions during streaming turns"
```

---

## Task 9: Persist iteration-cap text to agent_messages (best-effort)

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`
- Modify: `app/tests/integration/managed/runtime-iteration-cap.test.ts`

When the loop hits `ITERATION_CAP` (8), the runtime emits a synthetic `text_delta` to the SSE stream but never writes it to `agent_messages`. The next turn's history is missing the bail-out signal. Add a best-effort `appendManagedMessage` call guarded on `firstOutputPersisted`. A failure logs a warn but does not abort — the user has already seen the cap text via SSE, and `markTurnCompleted` MUST still run.

- [ ] **Step 1: Extend the existing iteration-cap test to assert persistence**

Edit `app/tests/integration/managed/runtime-iteration-cap.test.ts`. The current test (lines 126-171) verifies the `text_delta` is emitted. Extend it.

Find the `vi.mock('@/lib/ai/agent/services/...')` block ending around line 102. After all the service mocks, before `import type { AgentEvent, AgentSession }`, add:

```ts
vi.mock('@/lib/ai/agent/managed/history', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent/managed/history')>()
  return {
    ...actual,
    appendManagedMessage: vi.fn().mockResolvedValue(0),
    persistFirstDurableOutput: vi.fn().mockResolvedValue(undefined),
    markTurnCompleted: vi.fn().mockResolvedValue(undefined),
    loadManagedHistory: vi.fn().mockResolvedValue({ messages: [], systemSummary: null }),
  }
})
```

Then, inside the existing `it('stops at ITERATION_CAP (8) ...')` block, AFTER the existing `expect(preDone.type).toBe('text_delta')` assertions, add:

```ts
    // PR1 Change F1: cap text MUST also be appended to agent_messages so the
    // next turn's loadManagedHistory replays the bail-out signal.
    const { appendManagedMessage } = await import('@/lib/ai/agent/managed/history')
    const calls = vi.mocked(appendManagedMessage).mock.calls
    const capCall = calls.find(([, msg]) => {
      if (typeof msg.content === 'string') {
        return msg.content.includes('Limita de iterații') || msg.content.includes('iteration limit')
      }
      return false
    })
    expect(capCall).toBeDefined()
    expect(capCall![0]).toBe(mockSession.id)
    expect(capCall![1].role).toBe('assistant')
    expect(capCall![1].messageType).toBe('text')
    expect(capCall![1].turnId).toBe('99999999-9999-4999-8999-999999999999')
```

Add a second test in the same `describe` block:

```ts
  it('does NOT crash if the cap-text persistence fails — markTurnCompleted still runs', async () => {
    const { appendManagedMessage, markTurnCompleted } = await import('@/lib/ai/agent/managed/history')

    // Reject ONLY when the runtime tries to persist the cap-text. The
    // tool-loop calls appendManagedMessage once per tool_result before the
    // cap is reached (8 iterations × 1 tool_result/iteration = 8 calls
    // before cap-text persistence). A blanket mockRejectedValueOnce would
    // fire on the first tool_result and short-circuit the test before
    // exercising the cap-text catch path.
    vi.mocked(appendManagedMessage).mockImplementation(async (_sessionId, msg) => {
      const isCapText =
        typeof msg.content === 'string' &&
        (msg.content.includes('Limita de iterații') || msg.content.includes('iteration limit'))
      if (isCapText) throw new Error('db blip')
      return 0
    })

    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: mockSession,
      sections: [],
      request: { requestId: 'req-cap-fail', locale: 'ro', message: 'Loop forever.' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: {
        userId: mockSession.userId,
        sessionId: mockSession.id,
        requestId: 'req-cap-fail',
        now: new Date(),
      },
    })

    // markTurnCompleted MUST still run.
    expect(markTurnCompleted).toHaveBeenCalled()

    // The done event still fires.
    expect(events.find(e => e.type === 'done')).toBeDefined()
  })
```

- [ ] **Step 2: Run the test to verify it fails on the first new assertion**

Run from `app/`: `npx vitest run tests/integration/managed/runtime-iteration-cap.test.ts`
Expected: FAIL on the new "PR1 Change F1" assertion — runtime.ts doesn't yet append the cap text.

- [ ] **Step 3: Persist cap text in runtime.ts**

Edit `app/src/lib/ai/agent/managed/runtime.ts`. Find the iteration-cap block at lines 369-382:

```ts
  // Iteration cap hit
  if (iterationCount >= ITERATION_CAP) {
    log.warn({
      sessionId: session.id,
      requestId: request.requestId,
      iterationCount,
    }, 'managed turn hit iteration cap')
    emit({
      type: 'text_delta',
      content: session.locale === 'ro'
        ? '\n\n(Limita de iterații atinsă. Vă rog, clarificați întrebarea.)'
        : '\n\n(Reached tool iteration limit. Please clarify your request.)',
    })
  }
```

Replace with:

```ts
  // Iteration cap hit
  if (iterationCount >= ITERATION_CAP) {
    log.warn({
      sessionId: session.id,
      requestId: request.requestId,
      iterationCount,
    }, 'managed turn hit iteration cap')
    const capMessage = session.locale === 'ro'
      ? '\n\n(Limita de iterații atinsă. Vă rog, clarificați întrebarea.)'
      : '\n\n(Reached tool iteration limit. Please clarify your request.)'
    emit({ type: 'text_delta', content: capMessage })
    // Persist the cap text so the next turn's loadManagedHistory replays
    // the bail-out signal. Best-effort: a failure here MUST NOT abort the
    // runtime — markTurnCompleted still has to run, and the user has
    // already seen the text via SSE. The next turn's history will simply
    // omit the cap text; the prior assistant + tool messages already
    // describe the conversation state. ensurePairingInvariant covers
    // orphan tool_use/tool_result blocks but not missing assistant text.
    if (firstOutputPersisted) {
      try {
        await appendManagedMessage(
          session.id,
          { role: 'assistant', messageType: 'text', content: capMessage, turnId },
          { runtimeMode: 'managed', provider: 'anthropic', model: tctx.messageModel },
        )
      } catch (err) {
        log.warn(
          {
            sessionId: session.id,
            turnId,
            requestId: request.requestId,
            error: err instanceof Error ? err.message : String(err),
          },
          'iteration-cap text persistence failed (non-fatal)',
        )
      }
    }
  }
```

The guard on `firstOutputPersisted` ensures we don't try to append a cap message when the turn produced zero durable output (in which case the route's catch branch deletes the empty turn anyway).

- [ ] **Step 4: Run the iteration-cap test**

Run from `app/`: `npx vitest run tests/integration/managed/runtime-iteration-cap.test.ts`
Expected: PASS — both the persistence assertion and the failure-tolerance test.

- [ ] **Step 5: Run all managed integration tests**

Run from `app/`: `npx vitest run tests/integration/managed/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/managed/runtime.ts \
        app/tests/integration/managed/runtime-iteration-cap.test.ts
git commit -m "feat(managed): persist iteration-cap text to agent_messages (best-effort)"
```

---

## Task 10: Add agent.toolErrors translations + format-tool-error helper + wire into useAgent

**Files:**
- Modify: `app/src/messages/en.json`
- Modify: `app/src/messages/ro.json`
- Create: `app/src/lib/ai/agent/format-tool-error.ts`
- Create: `app/tests/unit/format-tool-error.test.ts`
- Modify: `app/src/hooks/useAgent.ts`

The formatter is a pure function — easy to test and free of React dependencies. The hook calls it for `tool_result` events. Translations are read via `next-intl`'s `useTranslations` in the hook.

- [ ] **Step 1: Add translations to en.json**

Edit `app/src/messages/en.json`. Find the closing bracket of the top-level object at line 1372. Insert a new `agent` namespace immediately before the final `}`. The trailing comma after `docType` (line 1370) needs to follow the existing pattern.

Find the `docType` block (lines 1360-1370):
```json
  "docType": {
    "ghid_solicitant": "Applicant guide",
    "bilant": "Balance sheet",
    "certificat": "Certificate",
    "aviz": "Opinion/authorization",
    "studiu_fezabilitate": "Feasibility study",
    "plan_afaceri": "Business plan",
    "deviz": "Cost estimate",
    "acord_parteneriat": "Partnership agreement",
    "declaratie": "Declaration",
    "altul": "Other"
  }
}
```

Replace with:
```json
  "docType": {
    "ghid_solicitant": "Applicant guide",
    "bilant": "Balance sheet",
    "certificat": "Certificate",
    "aviz": "Opinion/authorization",
    "studiu_fezabilitate": "Feasibility study",
    "plan_afaceri": "Business plan",
    "deviz": "Cost estimate",
    "acord_parteneriat": "Partnership agreement",
    "declaratie": "Declaration",
    "altul": "Other"
  },
  "agent": {
    "toolErrors": {
      "PARALLEL_WRITE_BLOCKED": "Only one write at a time was allowed; the second write was rejected.",
      "TOOL_TIMEOUT": "{tool} took too long and was cancelled.",
      "AUTHORIZATION": "You are not authorized to perform {tool}.",
      "NOT_FOUND": "{tool}: the requested resource was not found.",
      "POLICY_PREFIX": "{tool} blocked by policy ({code}).",
      "VALIDATION_PREFIX": "{tool}: invalid input.",
      "CONCURRENCY": "{tool} conflicted with a concurrent change. Please retry.",
      "EXTERNAL_DEPENDENCY": "{tool} unavailable: external service error.",
      "INTERNAL": "{tool} encountered an internal error.",
      "GENERIC": "{tool} failed."
    }
  }
}
```

- [ ] **Step 2: Add the same namespace to ro.json**

Edit `app/src/messages/ro.json`. The structure mirrors en.json. Find the same `docType` closing block (line 1370 region) and apply the same insertion with Romanian strings:

Replace the `docType` closing `}` (no trailing comma) with the same closing followed by the new namespace:

```json
  },
  "agent": {
    "toolErrors": {
      "PARALLEL_WRITE_BLOCKED": "Doar o operațiune de scriere era permisă; a doua a fost respinsă.",
      "TOOL_TIMEOUT": "{tool} a durat prea mult și a fost anulată.",
      "AUTHORIZATION": "Nu ai permisiunea să rulezi {tool}.",
      "NOT_FOUND": "{tool}: resursa cerută nu a fost găsită.",
      "POLICY_PREFIX": "{tool} blocată de o regulă ({code}).",
      "VALIDATION_PREFIX": "{tool}: date invalide.",
      "CONCURRENCY": "{tool} a intrat în conflict cu o modificare concurentă. Reîncearcă.",
      "EXTERNAL_DEPENDENCY": "{tool} indisponibilă: eroare la un serviciu extern.",
      "INTERNAL": "{tool} a întâmpinat o eroare internă.",
      "GENERIC": "{tool} a eșuat."
    }
  }
}
```

(Read the file first to determine the exact byte where `docType`'s closing `}` is and append the comma + new namespace.)

- [ ] **Step 3: Verify both JSON files parse**

Run from `app/`: `node -e "JSON.parse(require('fs').readFileSync('src/messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/messages/ro.json','utf8')); console.log('ok')"`
Expected: `ok`. Any syntax error here means the comma placement is wrong.

- [ ] **Step 4: Write the failing formatter test**

Create `app/tests/unit/format-tool-error.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { formatToolError } from '@/lib/ai/agent/format-tool-error'
import enMessages from '@/messages/en.json'
import roMessages from '@/messages/ro.json'

// Load the ACTUAL translation maps from messages/{en,ro}.json so a typo or
// missing key in the JSON would break this test. Duplicating local copies
// would let drift go undetected.
const EN = (enMessages as { agent: { toolErrors: Record<string, string> } }).agent.toolErrors
const RO = (roMessages as { agent: { toolErrors: Record<string, string> } }).agent.toolErrors

// Build a translator stub that mimics next-intl's t(key, params) shape.
function makeT(messages: Record<string, string>) {
  return (key: string, params?: Record<string, string>) => {
    const tpl = messages[key]
    if (tpl == null) throw new Error(`missing key: ${key}`)
    if (!params) return tpl
    return tpl.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`)
  }
}

describe('formatToolError', () => {
  describe.each([
    ['en', makeT(EN), EN],
    ['ro', makeT(RO), RO],
  ])('locale=%s', (_locale, t, M) => {
    it('PARALLEL_WRITE_BLOCKED prefix', () => {
      const out = formatToolError(
        'save_section_draft',
        'PARALLEL_WRITE_BLOCKED: Only one write tool call is allowed per assistant message. ...',
        t,
      )
      expect(out).toBe(M.PARALLEL_WRITE_BLOCKED)
    })

    it('Tool timed out exact match', () => {
      const out = formatToolError('search_calls', 'Tool timed out after 15s', t)
      expect(out).toBe(M.TOOL_TIMEOUT.replace('{tool}', 'search_calls'))
    })

    it('NOT_FOUND prefix', () => {
      const out = formatToolError('get_section', 'NOT_FOUND: section foo', t)
      expect(out).toBe(M.NOT_FOUND.replace('{tool}', 'get_section'))
    })

    it('AUTHORIZATION prefix', () => {
      const out = formatToolError('save_section_draft', 'AUTHORIZATION: Access denied to requested session', t)
      expect(out).toBe(M.AUTHORIZATION.replace('{tool}', 'save_section_draft'))
    })

    it('POLICY_ prefix interpolates code only', () => {
      const out = formatToolError(
        'freeze_outline',
        'POLICY_OUTLINE_NOT_FROZEN: outline must be frozen',
        t,
      )
      expect(out).toBe(
        M.POLICY_PREFIX.replace('{tool}', 'freeze_outline').replace('{code}', 'POLICY_OUTLINE_NOT_FROZEN'),
      )
    })

    it('VALIDATION: prefix', () => {
      const out = formatToolError('save_section_draft', 'VALIDATION:sectionKey: invalid', t)
      expect(out).toBe(M.VALIDATION_PREFIX.replace('{tool}', 'save_section_draft'))
    })

    it('CONCURRENCY prefix', () => {
      const out = formatToolError('approve_section', 'CONCURRENCY: state version mismatch', t)
      expect(out).toBe(M.CONCURRENCY.replace('{tool}', 'approve_section'))
    })

    it('EXTERNAL_DEPENDENCY prefix', () => {
      const out = formatToolError('search_calls', 'EXTERNAL_DEPENDENCY: VectorStore unavailable', t)
      expect(out).toBe(M.EXTERNAL_DEPENDENCY.replace('{tool}', 'search_calls'))
    })

    it('Internal tool error exact match', () => {
      const out = formatToolError('any_tool', 'Internal tool error', t)
      expect(out).toBe(M.INTERNAL.replace('{tool}', 'any_tool'))
    })

    it('unknown summary falls back to GENERIC', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const prevEnv = process.env.NODE_ENV
      // Cast away readonly TS type for env in the test; runtime allows assignment.
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'development'
      try {
        const out = formatToolError('any_tool', 'completely unknown error string', t)
        expect(out).toBe(M.GENERIC.replace('{tool}', 'any_tool'))
        expect(warn).toHaveBeenCalledWith('[tool error]', 'any_tool', 'completely unknown error string')
      } finally {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = prevEnv
        warn.mockRestore()
      }
    })

    it('GENERIC fallback does not console.warn in production', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const prevEnv = process.env.NODE_ENV
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'production'
      try {
        formatToolError('any_tool', 'unknown', t)
        expect(warn).not.toHaveBeenCalled()
      } finally {
        ;(process.env as Record<string, string | undefined>).NODE_ENV = prevEnv
        warn.mockRestore()
      }
    })
  })

  it('Romanian POLICY_ output never contains raw English service prose', () => {
    // Regression guard: the formatter must extract only the stable code,
    // never pass the full `summary` (which contains English error prose
    // like "outline must be frozen") into the localized template.
    const out = formatToolError(
      'freeze_outline',
      'POLICY_OUTLINE_NOT_FROZEN: outline must be frozen',
      makeT(RO),
    )
    expect(out).not.toMatch(/outline must be frozen/)
    expect(out).toContain('POLICY_OUTLINE_NOT_FROZEN')
  })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run from `app/`: `npx vitest run tests/unit/format-tool-error.test.ts`
Expected: FAIL — module `@/lib/ai/agent/format-tool-error` does not exist.

- [ ] **Step 6: Create the formatter module**

Create `app/src/lib/ai/agent/format-tool-error.ts`:

```ts
// Pure function: maps stable tool-error prefixes emitted by
// app/src/lib/ai/agent/managed/executor.ts into translation keys
// under the agent.toolErrors namespace. Order of checks matters —
// most specific prefixes first.
//
// Source of truth for the input strings: executor.ts:166-203 +
// runtime.ts:29 (PARALLEL_WRITE_BLOCKED). Adding a new error code in
// the executor REQUIRES adding a matching branch here AND a matching
// translation key in messages/{ro,en}.json — otherwise users see the
// GENERIC fallback and we log a dev-only console.warn.

export type TranslateFn = (key: string, params?: Record<string, string>) => string

export function formatToolError(
  tool: string,
  summary: string,
  t: TranslateFn,
): string {
  if (summary.startsWith('PARALLEL_WRITE_BLOCKED')) return t('PARALLEL_WRITE_BLOCKED', { tool })
  if (summary === 'Tool timed out after 15s') return t('TOOL_TIMEOUT', { tool })
  if (summary.startsWith('NOT_FOUND')) return t('NOT_FOUND', { tool })
  if (summary.startsWith('AUTHORIZATION')) return t('AUTHORIZATION', { tool })
  if (summary.startsWith('POLICY_')) {
    // Extract ONLY the stable code (text up to the first ':') — never
    // pass the full summary as detail. Otherwise a Romanian render of
    // "POLICY_OUTLINE_NOT_FROZEN: outline must be frozen" leaks the
    // English service prose into a localized template.
    const code = summary.split(':')[0]
    return t('POLICY_PREFIX', { tool, code })
  }
  if (summary.startsWith('VALIDATION:')) return t('VALIDATION_PREFIX', { tool })
  if (summary.startsWith('CONCURRENCY')) return t('CONCURRENCY', { tool })
  if (summary.startsWith('EXTERNAL_DEPENDENCY')) return t('EXTERNAL_DEPENDENCY', { tool })
  if (summary === 'Internal tool error') return t('INTERNAL', { tool })

  if (process.env.NODE_ENV !== 'production') {
    console.warn('[tool error]', tool, summary)
  }
  return t('GENERIC', { tool })
}
```

- [ ] **Step 7: Run the formatter test**

Run from `app/`: `npx vitest run tests/unit/format-tool-error.test.ts`
Expected: PASS — all branches covered for both locales + the Romanian prose-leak guard.

- [ ] **Step 8: Wire the formatter into useAgent**

Edit `app/src/hooks/useAgent.ts`. The hook needs a translator function. Easiest path: take the `useTranslations('agent.toolErrors')` translator inside the hook (next-intl already powers all bilingual UI in this project — confirmed by the existing `aiAssistant`, `managedAgent`, `preselect` namespaces). The hook is `'use client'` so this is safe.

Find the imports at the top:

```ts
'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { csrfFetch } from '@/lib/csrf/client'
```

Replace with:

```ts
'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { csrfFetch } from '@/lib/csrf/client'
import { formatToolError } from '@/lib/ai/agent/format-tool-error'
```

Find the start of the hook body (line 32):

```ts
export function useAgent(locale: 'ro' | 'en', initialSessionId?: string) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
```

Insert the translator hook call right after `useAgent` opens:

```ts
export function useAgent(locale: 'ro' | 'en', initialSessionId?: string) {
  const tToolError = useTranslations('agent.toolErrors')
  const [messages, setMessages] = useState<AgentMessage[]>([])
```

Find the `case 'tool_result':` block at lines 98-109:

```ts
      case 'tool_result':
        setMessages(prev => {
          const toolMsg = [...prev].reverse().find(m => m.toolName === event.tool && m.isToolActivity)
          if (toolMsg) {
            return prev.map(m => m.id === toolMsg.id
              ? { ...m, content: `${event.tool}: ${event.success ? 'completed' : event.summary}` }
              : m
            )
          }
          return prev
        })
        break
```

Replace with:

```ts
      case 'tool_result':
        setMessages(prev => {
          const toolMsg = [...prev].reverse().find(m => m.toolName === event.tool && m.isToolActivity)
          if (toolMsg) {
            const newContent = event.success
              ? `${event.tool}: completed`
              : formatToolError(event.tool, event.summary, tToolError)
            return prev.map(m => m.id === toolMsg.id
              ? { ...m, content: newContent }
              : m
            )
          }
          return prev
        })
        break
```

The success branch keeps the existing `${event.tool}: completed` shape. Only the failure branch is localized. (Why not localize `completed` too? Out of scope — the spec only demands fixing the leaked English on errors. The `: completed` string is a stable success indicator, low priority.)

The `useCallback` deps array for `handleEvent` (line 159) needs `tToolError` added. Find:

```ts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFinalState])
```

Replace with:

```ts
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFinalState, tToolError])
```

- [ ] **Step 9: Run typecheck and lint**

Run from `app/`: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 10: Run all unit tests**

Run from `app/`: `npx vitest run tests/unit/format-tool-error.test.ts tests/integration/managed/`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add app/src/messages/en.json app/src/messages/ro.json \
        app/src/lib/ai/agent/format-tool-error.ts \
        app/src/hooks/useAgent.ts \
        app/tests/unit/format-tool-error.test.ts
git commit -m "feat(agent-ui): localize tool error messages via stable executor prefixes"
```

---

## Task 11: End-to-end manual smoke + acceptance verification

**Files:**
- None modified

The remaining acceptance criteria can only be confirmed against a running app. Run them in order. If any step fails, stop and triage.

**Setup:**

`docker-compose.yml` lives at the repo root, not under `app/`. Run Compose from the repo root.

```bash
# From the repo root (/home/godja/Dev/EU-Funds):
docker compose up -d postgres redis
docker compose exec redis redis-cli FLUSHDB

# Then start the dev server from app/:
cd app && PORT=3002 npm run dev
```

Browser: log in via `/ro/autentificare` (use `ADMIN_PASSWORD` from `app/.env.local`).

Dismiss the cookie banner if present:
```js
localStorage.setItem('eufund:cookie-consent-dismissed:v1', '1')
```

To enable the managed runtime locally, set `MANAGED_RUNTIME_ENABLED=true` in `app/.env.local` and restart `npm run dev`. Confirm `managed_agent_enabled` and `managed_agent_writes_enabled` flags are on for your user (DB query via `npm run db:studio` or directly in `feature_flags`).

- [ ] **Step 1: Acceptance criterion 1 — write + immediate action does not 409**

Navigate to `/ro/proiecte/nou`. Type a project description that resolves cleanly via deterministic preselect. Click through to the managed flow. Once a write tool fires (e.g., `set_selected_call` from a confirmed call), wait for the `done` event, then immediately click **Approve outline** in the workspace.

Expected: the action POSTs successfully (HTTP 200, no 409 in DevTools Network tab). The new turn streams normally. PR1 Change B verified.

- [ ] **Step 2: Acceptance criterion 2 — disabled buttons during streaming**

Send a long-form prompt that triggers a multi-iteration tool loop. While the stream is active (status indicator shows "Generating..."), attempt to click any of the four mutating buttons (Approve outline, Accept, Reject, Mark complete) that are visible.

Expected: buttons are visibly dimmed (opacity-50) and clicks are no-ops. PR1 Change C verified.

- [ ] **Step 3: Acceptance criterion 3 — iteration cap text persisted**

The integration test (`tests/integration/managed/runtime-iteration-cap.test.ts`, extended in Task 9) is the deterministic gate for this acceptance criterion. The smoke step below is a confidence check that the persisted row appears in `agent_messages` end-to-end; it is NOT the acceptance gate.

Drive the cap by temporarily lowering `ITERATION_CAP` for the smoke run:

1. In `app/src/lib/ai/agent/managed/runtime.ts`, find the `const ITERATION_CAP = 8` line and temporarily change it to `2`. Save and let the dev server hot-reload.
2. In the chat, send a message that triggers at least one tool call (e.g., "Search for calls about renewable energy"). The 2-iteration cap fires after the second tool round-trip.
3. Note the session id from the URL or DevTools Network response.
4. Refresh the page and verify the Romanian cap text "(Limita de iterații atinsă...)" appears in the conversation history.
5. **Revert `ITERATION_CAP` back to `8` before committing.**

Verify directly via psql / db:studio:
```sql
SELECT content FROM agent_messages
WHERE session_id = '<your-session-id>'
ORDER BY sequence_number DESC LIMIT 5;
```
Expected: a row with the cap text exists.

- [ ] **Step 4: Acceptance criterion 4 — localized tool errors**

The unit test (`tests/unit/format-tool-error.test.ts`, Task 10) is the deterministic gate covering all 10 error prefixes × 2 locales. The smoke step below confirms wiring through `useAgent` in a real browser, not classifier coverage.

To deterministically force a `CONCURRENCY` error in the UI:

1. Open the project in two browser tabs (Tab A and Tab B), both pointing at the same in-flight session in drafting phase with at least one section in `needs_review`.
2. In Tab A: click **Accept** on a section. Wait for the SSE stream to complete; the section status moves to `accepted` and `stateVersion` bumps.
3. In Tab B (which still holds the pre-A `stateVersion` in memory because it never refreshed): click **Reject** on the same section. The runtime CAS fails — the executor returns a `CONCURRENCY: state version mismatch` tool result.
4. Inspect the tool_result rendering in Tab B's chat.

Expected: Tab B shows a Romanian message like "reject_section a intrat în conflict cu o modificare concurentă. Reîncearcă." — never the raw English `CONCURRENCY: ...`. PR1 Change F2 verified.

Switch the locale by reloading Tab B at the `/en/...` URL and re-running the procedure. Expected: English equivalent ("reject_section conflicted with a concurrent change. Please retry.").

- [ ] **Step 5: Final test sweep**

Run from `app/`:
```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: all green.

- [ ] **Step 6: Commit acceptance log if anything new uncovered**

If any smoke step revealed a regression that required a fix, commit it as a follow-up. Otherwise PR1 is complete.

---

## Self-Review

**Spec coverage:**
- Change B (reload + terminal error latch): Tasks 1, 2, 3, 4 (server) + Task 5 (client). ✓
- Change C (disabled buttons): Tasks 6, 7, 8. ✓
- Change F1 (cap text persistence): Task 9. ✓
- Change F2 (localized tool errors): Task 10. ✓
- Acceptance criteria 1–5: Task 11. ✓
- Spec test plan ("React Testing Library: render `AgentWorkspace` ..."): NOT covered as RTL — `app/vitest.config.ts` is `node` env, no `@testing-library/react` or `jsdom` in package.json. Rationale documented at the top of the plan. Acceptance criterion 2 is verified manually in Task 11 Step 2 instead. The disabled-prop wiring is enforced by TypeScript at the call sites.
- Spec test plan ("unit test on `useAgent`: feed an SSE stream ..."): also depends on RTL/jsdom. Verified manually in Task 11 + indirectly via the runtime-side `runtime-reload-failure` test (Task 4) which proves the runtime emits the event the hook needs.

**Placeholder scan:** No "TBD", "TODO", "fill in details", or vague descriptors. Every step has the actual code or command. Steps that reference other files (e.g., the JSON edits) name the exact lines and provide before/after snippets.

**Type consistency:**
- `writesSucceeded` declared in Task 2, consumed in Task 3. ✓
- `terminalErrorRef` declared in Task 5, consumed in Task 5 (single task). ✓
- `disabled?: boolean` consistently optional with `= false` default across OutlineView, SectionCard, ValidationSummary. ✓
- `isBusy: boolean` (REQUIRED, not optional) on `AgentWorkspace`. Both callers in Task 8 pass it. Compile-time enforced: making it optional would silently let either caller forget. ✓
- `formatToolError(tool, summary, t)` — matches the `TranslateFn` shape and is consumed in `useAgent` at Task 10 Step 8. ✓
- `reloadSessionAndSections(sessionId, userId)` — created in Task 1, called in Task 3, mocked in Tasks 3+4 tests. ✓

**Spec gaps fixed inline:** None — spec was thorough. Two deliberate adaptations from the spec are called out explicitly:

1. **RTL component tests deferred to manual smoke** (top of plan). `app/vitest.config.ts` is `node` env with no `jsdom` or `@testing-library/react`; adding either expands PR1 scope.
2. **Reload helper extracted to its own file** (Task 1 callout) instead of inlined in `runtime.ts` next to `buildUISnapshot`. Rationale: keeps `runtime.ts` focused; makes the helper trivially mockable via `vi.mock('@/lib/ai/agent/managed/reload', ...)` in tests. The spec's actual constraint — duplicate row mappers rather than extracting a cross-runtime shared service — is preserved.

**Audit fixes applied (post-initial-draft):**
- Task 9 cap-text persistence test: `appendManagedMessage` rejection now content-guarded (only the cap-text string rejects), so the rejection doesn't fire on tool_result appends earlier in the loop.
- Task 3 Anthropic mock: `getAnthropicClient` defined via `vi.hoisted(() => ({ ... vi.fn(...) }))` so the second test's `vi.mocked(getAnthropicClient).mockReturnValueOnce(...)` operates on a real `vi.fn()` rather than a plain arrow.
- Task 4 ordering proof: switched from "called once" to `mock.invocationCallOrder` comparison between `markTurnCompleted` and `reloadSessionAndSections` to actually pin the before/after invariant.
- Task 10 formatter test: now imports the live `messages/{en,ro}.json` `agent.toolErrors` maps instead of duplicating local copies, so a typo in the JSON breaks the test.
- Task 11 manual smoke: Compose runs from repo root (where `docker-compose.yml` lives); `docker compose exec redis redis-cli FLUSHDB` replaces the hardcoded `eu-funds-redis-1` container name. Iteration-cap and localized-error steps now use deterministic procedures (temporary `ITERATION_CAP=2`; two-tab CAS-conflict procedure).
- Formatter module location: moved from `app/src/lib/agent/format-tool-error.ts` to `app/src/lib/ai/agent/format-tool-error.ts` to match where the rest of agent code lives.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-ai-flow-stability-pr1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
