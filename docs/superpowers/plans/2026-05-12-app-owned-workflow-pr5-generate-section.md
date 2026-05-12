# App-Owned Workflow — PR 5: `/sections/generate` SSE + `ensureDraftingReady()` Saga

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Generate click → backend runs `ensureDraftingReady()` (eligibility → freeze → write) and streams the section draft. No model planning turns; no prior Freeze click required.

**Architecture:** New SSE endpoint at `POST /api/v1/agent-sessions/[id]/sections/generate`. Saga walks 8 steps; each precondition step that needs user input returns a deterministic 409 before any model call. Generation uses zero tools, one streamed model call with pre-fetched context (blueprint + prior accepted sections + top-K evidence). Model = Sonnet by default, Opus when `section.modelHint === 'heavy'`. SSE parser extracted from `useAgent.ts` into `lib/sse/parse.ts` so both endpoints share it.

**Tech Stack:** Next.js 14, Anthropic SDK (streaming), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-05-12-app-owned-workflow-design.md` §5

**Depends on:** PR 1, PR 2, PR 3, PR 4 merged.

**Flag:** `generate_section_endpoint_enabled` (default `false` everywhere).

---

## File Inventory

**Create:**
- `app/drizzle/0039_generate_section_endpoint_flag.sql`
- `app/drizzle/meta/_journal.json` entry.
- `app/src/lib/sse/parse.ts` — shared SSE parser (extract from `useAgent`).
- `app/src/lib/ai/agent/services/ensure-drafting-ready.ts` — the saga.
- `app/src/app/api/v1/agent-sessions/[id]/sections/generate/route.ts` — the SSE endpoint.
- `app/src/lib/ai/agent/services/section-generation.ts` — assemble prompt + run zero-tool model call.
- `app/src/lib/validation/generate-section.ts` — Zod schema for the body.
- `app/tests/unit/ensure-drafting-ready.test.ts`
- `app/tests/integration/sections/generate-happy-path.test.ts`
- `app/tests/integration/sections/generate-eligibility-required.test.ts`
- `app/tests/integration/sections/generate-eligibility-failed.test.ts`
- `app/e2e/generate-section.spec.ts`

**Modify:**
- `app/src/hooks/useAgent.ts` — replace inline SSE parser with `lib/sse/parse.ts`; add `generateSection({ sectionKey?, projectSummary? })`.
- `app/src/components/agent/AgentWorkspace.tsx` — render "Generate next section" button (gated by flag).
- `app/src/lib/monitoring/metrics.ts` — add `generate_section_total{outcome,reason?}` and `generate_section_latency_seconds`.
- `app/src/messages/ro.json` + `app/src/messages/en.json` — new error codes.
- `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` — read flag, pass down.

---

## Task 1: Seed `generate_section_endpoint_enabled` feature flag

**Files:**
- Create: `app/drizzle/0039_generate_section_endpoint_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: SQL**

```sql
-- Seed the generate_section_endpoint_enabled feature flag (default disabled).
-- Gates the UI's "Generate next section" button and the
-- /api/v1/agent-sessions/:id/sections/generate SSE endpoint.
-- When on, one click runs ensureDraftingReady() (eligibility → freeze →
-- write) and streams a single section draft. When off, drafting goes
-- through the legacy chat tool path.
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'generate_section_endpoint_enabled',
  false,
  'Gates the deterministic /sections/generate SSE endpoint and Generate button.',
  '{}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 2: Journal entry**

```json
    {
      "idx": 39,
      "version": "7",
      "when": 1778803200003,
      "tag": "0039_generate_section_endpoint_flag",
      "breakpoints": true
    }
```

- [ ] **Step 3: Migrate + commit**

```bash
cd app && npm run db:migrate
git add app/drizzle/0039_generate_section_endpoint_flag.sql app/drizzle/meta/_journal.json
git commit -m "feat(flags): seed generate_section_endpoint_enabled flag (off)"
```

---

## Task 2: Extract SSE parser into `lib/sse/parse.ts`

**Files:**
- Create: `app/src/lib/sse/parse.ts`
- Test: `app/tests/unit/sse-parse.test.ts`
- Modify: `app/src/hooks/useAgent.ts` — swap inline parser for the helper.

- [ ] **Step 1: Write the unit test**

```ts
// app/tests/unit/sse-parse.test.ts
import { describe, it, expect } from 'vitest'
import { parseSSEStream } from '@/lib/sse/parse'

async function streamFromString(s: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(s))
      c.close()
    },
  }).getReader()
}

describe('parseSSEStream', () => {
  it('parses a single event with data field', async () => {
    const reader = await streamFromString('event: text_delta\ndata: {"content":"hi"}\n\n')
    const events: { event: string; data: unknown }[] = []
    for await (const e of parseSSEStream(reader)) events.push(e)
    expect(events).toEqual([{ event: 'text_delta', data: { content: 'hi' } }])
  })

  it('parses multiple back-to-back events', async () => {
    const reader = await streamFromString(
      'event: a\ndata: {"x":1}\n\nevent: b\ndata: {"y":2}\n\n'
    )
    const events: { event: string; data: unknown }[] = []
    for await (const e of parseSSEStream(reader)) events.push(e)
    expect(events).toEqual([
      { event: 'a', data: { x: 1 } },
      { event: 'b', data: { y: 2 } },
    ])
  })

  it('survives split chunks', async () => {
    const reader = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('event: a\nda'))
        c.enqueue(new TextEncoder().encode('ta: {"v":1}\n\n'))
        c.close()
      },
    }).getReader()
    const events: { event: string; data: unknown }[] = []
    for await (const e of parseSSEStream(reader)) events.push(e)
    expect(events).toEqual([{ event: 'a', data: { v: 1 } }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/sse-parse.test.ts
```
Expected: FAIL — module not yet.

- [ ] **Step 3: Implement `lib/sse/parse.ts`**

```ts
// app/src/lib/sse/parse.ts
//
// Async generator parser for fetch-stream SSE responses. Splits on
// blank lines (\n\n) and parses event: + data: fields. JSON.parse failures
// on data fields surface as `{ event, data: undefined, raw }` so callers
// can decide how to react.

export interface SSEEvent {
  event: string
  data: unknown
  raw?: string
}

export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SSEEvent, void, unknown> {
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let sep: number
    while ((sep = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const ev = parseChunk(chunk)
      if (ev) yield ev
    }
  }
  buf += decoder.decode()
  if (buf.trim().length > 0) {
    const ev = parseChunk(buf)
    if (ev) yield ev
  }
}

function parseChunk(chunk: string): SSEEvent | null {
  let event = 'message'
  let raw = ''
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim()
    else if (line.startsWith('data: ')) raw += (raw ? '\n' : '') + line.slice(6)
  }
  if (!raw) return null
  try {
    return { event, data: JSON.parse(raw) }
  } catch {
    return { event, data: undefined, raw }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run tests/unit/sse-parse.test.ts
```
Expected: PASS, 3 tests green.

- [ ] **Step 5: Swap useAgent's inline parser**

In `app/src/hooks/useAgent.ts:248-273`, replace the inline reader/decoder/line-split logic with:

```ts
import { parseSSEStream } from '@/lib/sse/parse'

// ... inside the streaming handler ...
const reader = response.body?.getReader()
if (!reader) return
for await (const { event, data } of parseSSEStream(reader)) {
  // existing event handling: dispatch to handlers based on `data.type`
  // For the existing /api/ai/agent endpoint, the SSE protocol uses
  // `data: { type: 'text_delta' | ... }` without an `event:` line —
  // keep existing dispatch on data.type, ignore the `event` label.
  if (data && typeof data === 'object' && 'type' in data) {
    handleAgentEvent(data as AgentEvent)
  }
}
```

- [ ] **Step 6: Run regression tests for useAgent**

```bash
cd app && npx vitest run tests 2>&1 | grep useAgent | head -10
```
Expected: no regressions (any hook tests still pass).

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/sse/parse.ts app/tests/unit/sse-parse.test.ts app/src/hooks/useAgent.ts
git commit -m "refactor(sse): extract shared SSE parser; useAgent uses it"
```

---

## Task 3: `ensureDraftingReady()` saga — unit test + implementation

**Files:**
- Create: `app/src/lib/ai/agent/services/ensure-drafting-ready.ts`
- Test: `app/tests/unit/ensure-drafting-ready.test.ts`

- [ ] **Step 1: Write the failing unit test**

```ts
// app/tests/unit/ensure-drafting-ready.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AgentSession, AgentSection, SectionSpec } from '@/lib/ai/agent/types'

const calls = {
  runEligibility: vi.fn(),
  freezeOutline: vi.fn(),
}

vi.mock('@/lib/ai/agent/services/application', () => ({
  runEligibility: (...a: unknown[]) => calls.runEligibility(...a),
  freezeOutline: (...a: unknown[]) => calls.freezeOutline(...a),
}))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

function spec(id: string, order: number, modelHint: 'light' | 'heavy' = 'light'): SectionSpec {
  return {
    id, title: id, description: '', order, generationOrder: order,
    importance: 'standard', expectedLength: 'medium', dependsOn: [],
    modelHint, mandatory: true, confidence: 0.9,
  }
}

function session(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1', userId: 'u1', projectId: null, status: 'active', locale: 'ro',
    selectedCallId: 'C-1', currentPhase: 'structuring',
    blueprint: null, eligibility: null, outline: null,
    warnings: [], planningArtifact: null, outlineFrozen: false,
    messageSummary: null, stateVersion: 0,
    createdAt: new Date(0), updatedAt: new Date(0),
    ...over,
  }
}

describe('ensureDraftingReady', () => {
  beforeEach(() => {
    calls.runEligibility.mockReset()
    calls.freezeOutline.mockReset()
  })

  it('returns OUTLINE_NOT_READY when outline is null', async () => {
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(session(), { expectedStateVersion: 0 })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('OUTLINE_NOT_READY')
  })

  it('returns NO_SECTION_TO_GENERATE when all sections are non-pending', async () => {
    const s = session({ outline: [spec('a', 1)] })
    const rows: AgentSection[] = [{
      id: 'r1', sessionId: 's1', sectionKey: 'a', title: 'A', status: 'accepted',
      documentOrder: 1, content: 'x', acceptedContent: 'x', version: 1,
      rejectionReason: null, createdAt: new Date(0), updatedAt: new Date(0),
    } as AgentSection]
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, rows)
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NO_SECTION_TO_GENERATE')
  })

  it('returns ELIGIBILITY_INPUT_REQUIRED when eligibility is null and no projectSummary or preselect description', async () => {
    calls.runEligibility.mockResolvedValueOnce({
      ok: false, missing: ['projectSummary'],
    })
    const s = session({ outline: [spec('a', 1)] })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, [])
    expect(res.ok).toBe(false)
    expect(res.code).toBe('ELIGIBILITY_INPUT_REQUIRED')
    expect(res.missing).toEqual(['projectSummary'])
  })

  it('picks first pending section by generationOrder', async () => {
    const s = session({
      outline: [spec('a', 1), spec('b', 2)],
      eligibility: { results: [], score: 100, passCount: 0, failCount: 0, warningCount: 0 },
      outlineFrozen: true,
    })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, [])
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.sectionSpec.id).toBe('a')
  })

  it('freezes outline when not frozen', async () => {
    calls.freezeOutline.mockResolvedValueOnce(undefined)
    const s = session({
      outline: [spec('a', 1)],
      eligibility: { results: [], score: 100, passCount: 0, failCount: 0, warningCount: 0 },
      outlineFrozen: false,
    })
    const { ensureDraftingReady } = await import('@/lib/ai/agent/services/ensure-drafting-ready')
    const res = await ensureDraftingReady(s, { expectedStateVersion: 0 }, [])
    expect(calls.freezeOutline).toHaveBeenCalledTimes(1)
    expect(res.ok).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd app && npx vitest run tests/unit/ensure-drafting-ready.test.ts
```
Expected: FAIL — module not yet.

- [ ] **Step 3: Implement the saga**

```ts
// app/src/lib/ai/agent/services/ensure-drafting-ready.ts
//
// Walks the deterministic preconditions for generating a section:
//   outline present -> section selection -> eligibility -> freeze.
// Returns a tagged result; the caller (SSE endpoint) decides how to
// surface errors. Each precondition that needs user input returns a
// deterministic 409 before any model call.

import type { AgentSection, AgentSession, SectionSpec, ServiceContext } from '../types'
import { runEligibility, freezeOutline } from './application'

export type EnsureReadyResult =
  | { ok: true; sectionSpec: SectionSpec; sessionAfter: AgentSession; stateVersion: number }
  | { ok: false; code: 'OUTLINE_NOT_READY' }
  | { ok: false; code: 'NO_SECTION_TO_GENERATE' }
  | { ok: false; code: 'ELIGIBILITY_INPUT_REQUIRED'; missing: string[] }
  | { ok: false; code: 'ELIGIBILITY_FAILED'; details: unknown }

interface EnsureReadyArgs {
  expectedStateVersion: number
  sectionKey?: string
  projectSummary?: string
}

export async function ensureDraftingReady(
  session: AgentSession,
  args: EnsureReadyArgs,
  rows: AgentSection[],
  ctx?: ServiceContext,
): Promise<EnsureReadyResult> {
  // Step 1: outline present
  if (!session.outline || session.outline.length === 0) {
    return { ok: false, code: 'OUTLINE_NOT_READY' }
  }

  // Step 2: section selection
  const rowByKey = new Map(rows.map(r => [r.sectionKey, r]))
  let target: SectionSpec | undefined
  if (args.sectionKey) {
    target = session.outline.find(s => s.id === args.sectionKey)
    if (!target) return { ok: false, code: 'NO_SECTION_TO_GENERATE' }
    const row = rowByKey.get(target.id)
    if (row && row.status !== 'pending') {
      return { ok: false, code: 'NO_SECTION_TO_GENERATE' }
    }
  } else {
    const sorted = [...session.outline].sort((a, b) => a.generationOrder - b.generationOrder)
    target = sorted.find(s => {
      const r = rowByKey.get(s.id)
      return !r || r.status === 'pending'
    })
    if (!target) return { ok: false, code: 'NO_SECTION_TO_GENERATE' }
  }

  // Step 3: eligibility
  let sessionMut = session
  let currentVersion = args.expectedStateVersion
  if (!sessionMut.eligibility || sessionMut.eligibility.score < 0) {
    const preselectDescription = (sessionMut.planningArtifact as { preselect?: { description?: string } } | null)
      ?.preselect?.description
    const projectSummary = args.projectSummary ?? preselectDescription
    if (!projectSummary) {
      return { ok: false, code: 'ELIGIBILITY_INPUT_REQUIRED', missing: ['projectSummary'] }
    }
    if (!ctx) throw new Error('ServiceContext required to run eligibility')
    try {
      await runEligibility(ctx, {
        sessionId: sessionMut.id,
        expectedStateVersion: currentVersion,
        projectSummary,
      } as never)
      currentVersion += 1
    } catch (err) {
      // Service-level errors with missing-input details propagate up via err.policyCode/details
      const e = err as { policyCode?: string; missing?: string[]; details?: unknown }
      if (e?.policyCode === 'ELIGIBILITY_INPUT_REQUIRED') {
        return { ok: false, code: 'ELIGIBILITY_INPUT_REQUIRED', missing: e.missing ?? [] }
      }
      throw err
    }
    // Note: caller should refresh the session from DB before continuing; in practice
    // the SSE endpoint re-fetches session + sections after eligibility runs.
    sessionMut = { ...sessionMut, stateVersion: currentVersion }
  }

  // Score check
  if (sessionMut.eligibility && sessionMut.eligibility.failCount > 0) {
    return { ok: false, code: 'ELIGIBILITY_FAILED', details: sessionMut.eligibility }
  }

  // Step 4: freeze if needed
  if (!sessionMut.outlineFrozen) {
    if (!ctx) throw new Error('ServiceContext required to freeze outline')
    await freezeOutline(ctx, {
      sessionId: sessionMut.id,
      expectedStateVersion: currentVersion,
    } as never)
    currentVersion += 1
    sessionMut = { ...sessionMut, outlineFrozen: true, stateVersion: currentVersion }
  }

  return { ok: true, sectionSpec: target, sessionAfter: sessionMut, stateVersion: currentVersion }
}
```

Adapt return shapes (e.g., `EligibilityResult` field names) to the project's actual types.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd app && npx vitest run tests/unit/ensure-drafting-ready.test.ts
```
Expected: PASS — 5 tests green. If a test fails on mock signature, adapt.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/services/ensure-drafting-ready.ts app/tests/unit/ensure-drafting-ready.test.ts
git commit -m "feat(agent): ensureDraftingReady saga (eligibility + freeze preconditions)"
```

---

## Task 4: Section generation service (zero tools, streamed)

**Files:**
- Create: `app/src/lib/ai/agent/services/section-generation.ts`

- [ ] **Step 1: Implement**

```ts
// app/src/lib/ai/agent/services/section-generation.ts
//
// Single model call with pre-fetched context. No tools. Streams deltas
// back to the caller via an async generator. Caller is responsible for
// persistence (saveSectionDraft) after the stream completes.

import { aiGenerate } from '@/lib/ai/client'
import { retrieveEvidence } from './evidence'
import type { AgentSection, AgentSession, SectionSpec, ServiceContext } from '../types'

export interface GenerateSectionInput {
  session: AgentSession
  spec: SectionSpec
  priorSections: AgentSection[]
}

export interface GenerationDelta {
  type: 'delta' | 'final'
  content: string
}

const MIN_LEN = 80

export async function* streamSectionGeneration(
  ctx: ServiceContext,
  input: GenerateSectionInput,
): AsyncGenerator<GenerationDelta, void, unknown> {
  const evidence = await retrieveEvidence(ctx, {
    query: `${input.spec.title}. ${input.spec.description}`,
    maxChunks: 8,
  })

  const messages = buildPrompt(input, evidence)
  const model = input.spec.modelHint === 'heavy' ? 'claude-opus-4-6' : 'claude-sonnet-4-6'

  // aiGenerate with streaming. Adapt to project's actual streaming API.
  // The router exposes a streaming primitive; this is its expected use.
  const stream = await aiGenerate({
    model,
    messages,
    streaming: true,
    tools: [],
    maxTokens: 4096,
  } as never) as AsyncIterable<{ text: string }>

  let full = ''
  for await (const chunk of stream) {
    full += chunk.text
    yield { type: 'delta', content: chunk.text }
  }

  if (full.length < MIN_LEN) {
    throw new Error('GENERATION_INVALID: output below minimum length')
  }
  if (looksLikeRefusal(full)) {
    throw new Error('GENERATION_INVALID: output looks like a refusal')
  }

  yield { type: 'final', content: full }
}

function looksLikeRefusal(text: string): boolean {
  const t = text.toLowerCase()
  return /(?:i can(?:not| ?'t) help|refuse|nu pot să|nu pot să te ajut)/i.test(t)
    || t.startsWith("i'm sorry, but")
}

function buildPrompt(
  input: GenerateSectionInput,
  evidence: { chunks: { content: string; source: string }[] },
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const { session, spec, priorSections } = input
  const prior = priorSections
    .filter(s => s.status === 'accepted' && (s.acceptedContent ?? s.content))
    .sort((a, b) => a.documentOrder - b.documentOrder)
    .map(s => `### ${s.title}\n\n${s.acceptedContent ?? s.content}`)
    .join('\n\n')

  const evidenceBlock = evidence.chunks
    .map((c, i) => `[${i + 1}] (${c.source})\n${c.content}`)
    .join('\n\n')

  const locale = session.locale === 'en' ? 'English' : 'Romanian'

  return [{
    role: 'user',
    content: `You are drafting a section of an EU funding application in ${locale}.

## Section to draft
Title: ${spec.title}
Description: ${spec.description}
Importance: ${spec.importance}
Expected length: ${spec.expectedLength}

## Prior accepted sections
${prior || '(none)'}

## Supporting evidence (citations available; use bracket numbers if helpful)
${evidenceBlock || '(no specific evidence retrieved)'}

## Instructions
Write the section text only. No preamble, no meta-commentary. Match the call's tone and the prior accepted sections' style.`,
  }]
}
```

If `aiGenerate` doesn't support streaming in the same shape, use the Anthropic SDK directly via `lib/ai/providers/anthropic-native.ts` to stream `messages.create({ stream: true })`. The principle is unchanged.

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/ai/agent/services/section-generation.ts
git commit -m "feat(agent): streamSectionGeneration (zero tools, pre-fetched context)"
```

---

## Task 5: `/sections/generate` SSE route

**Files:**
- Create: `app/src/app/api/v1/agent-sessions/[id]/sections/generate/route.ts`
- Create: `app/src/lib/validation/generate-section.ts`

- [ ] **Step 1: Zod schema**

```ts
// app/src/lib/validation/generate-section.ts
import { z } from 'zod'

export const generateSectionBody = z.object({
  sectionKey: z.string().min(1).max(200).optional(),
  projectSummary: z.string().min(1).max(20_000).optional(),
  expectedStateVersion: z.number().int().nonnegative(),
})

export type GenerateSectionBody = z.infer<typeof generateSectionBody>
```

- [ ] **Step 2: Route**

```ts
// app/src/app/api/v1/agent-sessions/[id]/sections/generate/route.ts
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth/helpers'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import { generateSectionBody } from '@/lib/validation/generate-section'
import { ensureDraftingReady } from '@/lib/ai/agent/services/ensure-drafting-ready'
import { streamSectionGeneration } from '@/lib/ai/agent/services/section-generation'
import { saveSectionDraft } from '@/lib/ai/agent/services/sections'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import { db } from '@/lib/db'
import { agentSessions, agentSections } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { generateSectionTotal, generateSectionLatencySeconds } from '@/lib/monitoring/metrics'

async function loadSessionAndRows(sessionId: string, userId: string) {
  const [session] = await db.select().from(agentSessions)
    .where(and(eq(agentSessions.id, sessionId), eq(agentSessions.userId, userId)))
    .limit(1)
  const rows = session
    ? await db.select().from(agentSections).where(eq(agentSections.sessionId, sessionId))
    : []
  return { session, rows }
}

function sseLine(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function handler(req: NextRequest, ctxParams: { params: { id: string } }) {
  const start = Date.now()
  const user = await requireAuth()
  const sessionId = ctxParams.params.id

  let body: unknown
  try { body = await req.json() } catch {
    return jsonError('BAD_JSON', 400, 'JSON invalid.', 'Invalid JSON.')
  }
  const parsed = generateSectionBody.safeParse(body)
  if (!parsed.success) {
    return jsonError('BAD_REQUEST', 400, 'Cerere invalidă.', 'Bad request.', parsed.error.flatten())
  }

  const requestId = randomUUID()
  const svcCtx = { userId: user.id, sessionId, requestId, now: new Date() }

  // Pre-flight: load session + rows
  const initial = await loadSessionAndRows(sessionId, user.id)
  if (!initial.session) {
    return jsonError('NOT_FOUND', 404, 'Sesiune inexistentă.', 'Session not found.')
  }

  // Run preconditions
  const ready = await ensureDraftingReady(
    initial.session as never,
    {
      expectedStateVersion: parsed.data.expectedStateVersion,
      sectionKey: parsed.data.sectionKey,
      projectSummary: parsed.data.projectSummary,
    },
    initial.rows as never,
    svcCtx,
  )

  if (!ready.ok) {
    generateSectionTotal.inc({ outcome: 'precondition', reason: ready.code })
    return jsonError(ready.code, 409, '', '', 'missing' in ready ? { missing: ready.missing } : undefined)
  }

  // Reload session to pick up eligibility/freeze writes
  const post = await loadSessionAndRows(sessionId, user.id)
  if (!post.session) return jsonError('NOT_FOUND', 404, '', '')

  // Open SSE
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(sseLine('start', {
          sectionKey: ready.sectionSpec.id,
          title: ready.sectionSpec.title,
        }))

        let full = ''
        for await (const d of streamSectionGeneration(svcCtx, {
          session: post.session as never,
          spec: ready.sectionSpec,
          priorSections: post.rows as never,
        })) {
          if (d.type === 'delta') {
            full += d.content
            controller.enqueue(sseLine('delta', { content: d.content }))
          }
        }

        // Persist
        await saveSectionDraft(svcCtx, {
          sessionId,
          sectionKey: ready.sectionSpec.id,
          content: full,
          expectedStateVersion: ready.stateVersion,
        } as never)

        // Final snapshot
        const final = await loadSessionAndRows(sessionId, user.id)
        controller.enqueue(sseLine('done', projectSessionState(final.session as never, final.rows as never)))
        generateSectionTotal.inc({ outcome: 'success' })
      } catch (err) {
        const e = err as { message?: string }
        let code = 'PROVIDER_ERROR'
        if (e.message?.startsWith('GENERATION_INVALID')) code = 'GENERATION_INVALID'
        else if (e.message?.includes('CONCURRENCY')) code = 'CONCURRENCY_CONFLICT'
        controller.enqueue(sseLine('error', { code, message: e.message }))
        generateSectionTotal.inc({ outcome: 'failure', reason: code })
      } finally {
        generateSectionLatencySeconds.observe((Date.now() - start) / 1000)
        controller.close()
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

function jsonError(code: string, status: number, ro: string, en: string, extra?: unknown) {
  return new Response(JSON.stringify({ error: { code, messageRo: ro, messageEn: en, ...(extra as object ?? {}) } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const POST = withRateLimit(handler, { limit: 10, windowSec: 60, keySuffix: 'generate-section' })
```

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/validation/generate-section.ts app/src/app/api/v1/agent-sessions/\[id\]/sections/generate/route.ts
git commit -m "feat(api): POST /sections/generate SSE with ensureDraftingReady saga"
```

---

## Task 6: Metrics

**Files:**
- Modify: `app/src/lib/monitoring/metrics.ts`

- [ ] **Step 1: Add the counters / histogram**

```ts
import { Counter, Histogram } from 'prom-client'

export const generateSectionTotal = new Counter({
  name: 'generate_section_total',
  help: 'Outcomes of /sections/generate requests',
  labelNames: ['outcome', 'reason'],
})

export const generateSectionLatencySeconds = new Histogram({
  name: 'generate_section_latency_seconds',
  help: 'Wall-clock latency of /sections/generate end-to-end',
  buckets: [0.5, 1, 2, 5, 10, 20, 30, 60],
})
```

Adapt to existing metrics surface (the project likely already has Counter/Histogram wrappers).

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/monitoring/metrics.ts
git commit -m "feat(metrics): generate_section_total + generate_section_latency_seconds"
```

---

## Task 7: Integration tests for happy + error paths

**Files:**
- Create: `app/tests/integration/sections/generate-happy-path.test.ts`
- Create: `app/tests/integration/sections/generate-eligibility-required.test.ts`
- Create: `app/tests/integration/sections/generate-eligibility-failed.test.ts`

- [ ] **Step 1: Happy-path test scaffold**

```ts
// app/tests/integration/sections/generate-happy-path.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/auth/helpers', () => ({ requireAuth: vi.fn().mockResolvedValue({ id: 'u1', tier: 'free' }) }))
vi.mock('@/lib/middleware/rate-limit', () => ({ withRateLimit: (h: unknown) => h }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))

// Mock DB: return a session ready to draft (outline set, eligibility passed, outlineFrozen=true).
// ... mocks for ensureDraftingReady, streamSectionGeneration, saveSectionDraft, projectSessionState.

describe('POST /sections/generate happy path', () => {
  it('streams start → N deltas → done', async () => {
    const { POST } = await import('@/app/api/v1/agent-sessions/[id]/sections/generate/route')
    const res = await POST(
      new Request('http://localhost/api/v1/agent-sessions/s1/sections/generate', {
        method: 'POST',
        body: JSON.stringify({ sectionKey: 'a', expectedStateVersion: 0 }),
      }) as never,
      { params: { id: 's1' } },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')

    const text = await new Response(res.body).text()
    expect(text).toMatch(/event: start/)
    expect(text).toMatch(/event: delta/)
    expect(text).toMatch(/event: done/)
  })
})
```

- [ ] **Step 2: Eligibility-required test**

```ts
// Same scaffold; mock session with eligibility=null and no preselect description.
// Body omits projectSummary.
// Assert 409 with code ELIGIBILITY_INPUT_REQUIRED and { missing: ['projectSummary'] }.
```

- [ ] **Step 3: Eligibility-failed test**

```ts
// Mock session with eligibility = { ..., failCount: 1, score: 50 }.
// Assert 409 with code ELIGIBILITY_FAILED.
```

- [ ] **Step 4: Run + commit**

```bash
cd app && npx vitest run tests/integration/sections/
git add app/tests/integration/sections/
git commit -m "test(api): integration coverage for /sections/generate"
```

---

## Task 8: `useAgent.generateSection()` + UI button

**Files:**
- Modify: `app/src/hooks/useAgent.ts`
- Modify: `app/src/components/agent/AgentWorkspace.tsx`
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx`

- [ ] **Step 1: Add `generateSection` to `useAgent`**

```ts
const generateSection = useCallback(async (
  args: { sectionKey?: string; projectSummary?: string } = {},
): Promise<UIStateSnapshot> => {
  if (!sessionIdRef.current) throw new Error('No session')
  const res = await csrfFetch(`/api/v1/agent-sessions/${sessionIdRef.current}/sections/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...args,
      expectedStateVersion: stateVersionRef.current,
    }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ActionError(body.error?.code ?? 'UNKNOWN', body.error?.messageRo ?? '', body.error?.messageEn ?? '')
  }
  const reader = res.body!.getReader()
  let finalSnapshot: UIStateSnapshot | null = null
  for await (const { event, data } of parseSSEStream(reader)) {
    if (event === 'start') {
      // optional: surface the title
    } else if (event === 'delta') {
      // append delta.content to the focused section's content in local state
      appendDeltaToFocused((data as { content: string }).content)
    } else if (event === 'done') {
      finalSnapshot = data as UIStateSnapshot
      applyServerSnapshot(finalSnapshot)
    } else if (event === 'error') {
      throw new ActionError((data as { code: string }).code, '', '')
    }
  }
  if (!finalSnapshot) throw new Error('Stream ended without done event')
  return finalSnapshot
}, [applyServerSnapshot])

return {
  // ... existing
  generateSection,
}
```

`appendDeltaToFocused` is a small private helper that updates `sections[focused].content` incrementally so the UI shows streaming text.

- [ ] **Step 2: Read the flag in `page.tsx`**

```ts
const generateEnabled = await isFeatureEnabled('generate_section_endpoint_enabled', {
  userId: user.id, bypassCache: true,
})
```

Pass `generateEnabled` to `NewProjectView` → `AgentWorkspace`.

- [ ] **Step 3: Add the Generate button**

In `AgentWorkspace.tsx`:

```tsx
{generateEnabled && (
  <button
    disabled={isBusy}
    onClick={async () => {
      try {
        await onGenerateSection()
      } catch (err) {
        // surface bilingual error in UI
      }
    }}
  >
    {t('actions.generateNextSection')}
  </button>
)}
```

Add `agent.actions.generateNextSection` bilingual keys.

Wire `onGenerateSection` from `NewProjectView` to `agent.generateSection(...)`.

- [ ] **Step 4: Bilingual messages for SSE error codes**

Add to `agent.errors`:
| Key | ro | en |
|---|---|---|
| `NO_SECTION_TO_GENERATE` | "Toate secțiunile sunt deja generate." | "All sections are already drafted." |
| `ELIGIBILITY_INPUT_REQUIRED` | "Mai avem nevoie de câteva informații despre proiect." | "We need a bit more information about the project." |
| `ELIGIBILITY_FAILED` | "Cererea nu trece de verificarea de eligibilitate." | "The application does not pass eligibility." |
| `GENERATION_INVALID` | "Conținutul generat nu este valid. Reîncearcă." | "Generated content was invalid. Try again." |
| `GENERATION_TIMEOUT` | "Timpul de generare a expirat. Reîncearcă." | "Generation timed out. Try again." |
| `PROVIDER_ERROR` | "Eroare de furnizor AI. Reîncearcă." | "AI provider error. Try again." |

- [ ] **Step 5: Commit**

```bash
git add app/src/hooks/useAgent.ts app/src/components/agent/AgentWorkspace.tsx app/src/app/[locale]/\(dashboard\)/proiecte/nou/page.tsx app/src/messages/ro.json app/src/messages/en.json
git commit -m "feat(agent): useAgent.generateSection + Generate button (flag-gated)"
```

---

## Task 9: E2E — happy-path Generate flow

**Files:**
- Create: `app/e2e/generate-section.spec.ts`

- [ ] **Step 1: Write the Playwright spec**

```ts
// e2e/generate-section.spec.ts
import { test, expect } from '@playwright/test'
import { Client } from 'pg'

const DATABASE_URL = process.env.DATABASE_URL!

test.describe('generate-section happy path', () => {
  test.beforeAll(async () => {
    const c = new Client({ connectionString: DATABASE_URL })
    await c.connect()
    for (const f of ['preselect_no_auto_send', 'deterministic_actions_enabled', 'chat_tools_trimmed', 'generate_section_endpoint_enabled']) {
      await c.query(`UPDATE feature_flags SET enabled = true WHERE key = $1`, [f])
    }
    await c.end()
  })

  test.afterAll(async () => {
    const c = new Client({ connectionString: DATABASE_URL })
    await c.connect()
    for (const f of ['preselect_no_auto_send', 'deterministic_actions_enabled', 'chat_tools_trimmed', 'generate_section_endpoint_enabled']) {
      await c.query(`UPDATE feature_flags SET enabled = false WHERE key = $1`, [f])
    }
    await c.end()
  })

  test('preselect → Generate click → SSE deltas → section renders as draft', async ({ page }) => {
    await page.goto('/ro/proiecte/nou')
    await page.locator('textarea[name="message"]').first().fill(
      'Vrem să cumpărăm utilaje agricole pentru irigații în zona PNRR'
    )
    await page.locator('button[type="submit"]').first().click()
    await expect(page.getByTestId('selected-call-banner')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('agent-welcome')).toBeVisible()

    // Click Generate
    await page.getByRole('button', { name: /Generează|Generate/i }).click()

    // Wait for first delta (the focused section shows streaming content)
    await expect(page.getByTestId('section-content')).not.toBeEmpty({ timeout: 30_000 })

    // Wait for done — section status switches to 'draft'
    await expect(page.getByTestId('section-status').first()).toHaveText(/draft|ciornă/i, { timeout: 60_000 })
  })
})
```

(Add `data-testid` attributes to the section content/status elements if they don't exist yet.)

- [ ] **Step 2: Run**

```bash
cd app && PORT=3002 npm run dev &
sleep 5
DATABASE_URL=$DATABASE_URL npx playwright test e2e/generate-section.spec.ts
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/e2e/generate-section.spec.ts
git commit -m "test(e2e): generate-section happy path streams and persists"
```

---

## Task 10: Final regression sweep

- [ ] **Step 1: Full suite**

```bash
cd app && npm run typecheck && npm run test
```
Expected: all green.

- [ ] **Step 2: Flag-off smoke**

```bash
psql "$DATABASE_URL" -c "UPDATE feature_flags SET enabled = false WHERE key = 'generate_section_endpoint_enabled'"
```
Reload — Generate button absent. SSE endpoint reachable but UI never calls it. Legacy chat-driven generation still works (existing flows unaffected).

- [ ] **Step 3: Watch telemetry**

```bash
curl -s http://localhost:3002/api/metrics | grep -E '(generate_section|iteration_cap)'
```

After staff rollout, watch:
- `generate_section_total{outcome="success"}` vs `failure` ratio.
- `generate_section_total{reason="ELIGIBILITY_INPUT_REQUIRED"}` — if high, build the project-profile form (out of scope this PR).

- [ ] **Step 4: Commit any final fixups**

If lint/types/format needed adjustment during the sweep, commit them.

---

## Self-Review Checklist

- [ ] Spec §5 coverage: `ensureDraftingReady` saga (Task 3); section generation (Task 4); SSE route (Task 5); metrics (Task 6); useAgent + UI (Task 8); fetch-stream parser (Task 2). E2E (Task 9).
- [ ] No placeholders: every test scaffold has explicit assertions.
- [ ] Type consistency: `EnsureReadyResult` union shapes match across saga, route, and tests. `GenerationDelta` shape consistent across service + route. Metric names match across PR's tasks.
- [ ] One commit per task.

## Definition of Done

- `generate_section_endpoint_enabled = false` initially.
- Flag on for staff: clicking Generate runs eligibility (if not present) → freeze (if not frozen) → one streaming model call → persisted draft. Zero model planning turns.
- Flag off: button absent; legacy chat-driven generation unchanged.
- `generate_section_total` and `generate_section_latency_seconds` emit on every request.
- Saga returns deterministic 409s for every precondition that needs user input — no model call attempted in those branches.
- E2E spec passes locally; existing suites green.
- Bilingual error messages reach the UI for every saga error code.
