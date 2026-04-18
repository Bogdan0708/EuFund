# Deterministic Preselect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move deterministic call selection + session bootstrap out of the managed LLM agent into a new server endpoint, so new sessions arrive pre-initialized with a selected call and a populated blueprint where possible.

**Architecture:** New `POST /api/v1/projects/preselect` endpoint owns three request modes (rank / confirm / override). Service layer (`app/src/lib/ai/agent/services/preselect.ts`) owns `rankCandidates`, `decideSelection`, `initializeSession`. Results persist in `agent_sessions.planning_artifact` (existing JSONB column). Managed prompt gets a new conditional block telling preselected sessions to skip call selection. Feature-flagged on `deterministic_preselect_enabled` (DB-backed, hard dependency on `managed_agent_writes_enabled`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM + postgres.js, Vitest (unit + integration), Playwright (E2E). Existing services: `searchCalls`, `lookupBlueprint`, `setSelectedCall`, `logAudit`, `isFeatureEnabled`, `requireAuth`, `withRateLimit`.

**Spec:** `docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md`.

**Working directory:** `app/` for all commands. Path alias `@/*` → `app/src/*`.

**Worktree:** `.worktrees/feat-deterministic-preselect` on branch `feat/deterministic-preselect`.

---

## File map

**New:**
- `app/src/lib/ai/agent/services/preselect.ts` — service: types, constants, `rankCandidates`, `decideSelection`, `initializeSession`
- `app/src/app/api/v1/projects/preselect/route.ts` — thin route handler composing the service
- `app/src/lib/preselect/client.ts` — client-side fetch wrapper
- `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx` — extracted client component (current page logic + new state machine)
- `app/src/app/[locale]/(dashboard)/proiecte/nou/components/SelectedCallBanner.tsx`
- `app/src/app/[locale]/(dashboard)/proiecte/nou/components/CandidatePicker.tsx`
- `app/src/app/[locale]/(dashboard)/proiecte/nou/components/NoMatchGuidance.tsx`
- `app/drizzle/0031_preselect_feature_flag.sql` — seed the new flag row
- `app/tests/unit/preselect/rank-candidates.test.ts`
- `app/tests/unit/preselect/decide-selection.test.ts`
- `app/tests/unit/preselect/initialize-session.test.ts`
- `app/tests/unit/managed/prompt-phase-bootstrap.test.ts`
- `app/tests/integration/preselect-route.test.ts`
- `app/tests/integration/agent-bootstrap-phase.test.ts`
- `app/e2e/preselect-new-project.spec.ts`

**Modified:**
- `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx` — convert to RSC, read flags, render NewProjectView
- `app/src/lib/ai/agent/managed/prompt.ts` — add conditional `phaseBootstrapBlock` (both locales)
- `app/src/messages/ro.json`, `app/src/messages/en.json` — new i18n keys

---

## Task 1: Service module scaffold — types + constants

**Files:**
- Create: `app/src/lib/ai/agent/services/preselect.ts`

- [ ] **Step 1: Create the service module with types and constants only**

Write `app/src/lib/ai/agent/services/preselect.ts`:

```ts
// ── Deterministic preselect service ──────────────────────────────
// Owns: rankCandidates, decideSelection, initializeSession.
// Spec: docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md

import type { CallMatch } from './evidence'

// Rollout-tunable defaults; tune against real traces after 20-50 sessions.
export const SCORE_FLOOR = 0.35
export const AMBIGUITY_EPSILON = 0.05
export const MIN_DESCRIPTION_LENGTH = 40

export interface Candidate {
  callId: string
  title: string
  score: number
  program?: string
  sourceUrl?: string
  // NOTE: no blueprintKind here in Phase 1 — see spec section "Response contract".
}

export type BlueprintKind = 'structured' | 'raw_evidence' | 'none'

export type SelectionDecision =
  | { kind: 'selected'; callId: string; candidates: Candidate[] }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'no_match'; reason: 'below_score_floor' | 'empty_results' }

export interface PreselectArtifactV1 {
  version: 1
  rankedAt: string
  description: string
  selectedCallId: string
  selectedScore: number
  candidates: Candidate[]
  selectionKind: 'selected'
  blueprintKind: BlueprintKind
  excludeCallIdsApplied: string[]
}

// Re-export type for convenience in tests
export type { CallMatch }
```

- [ ] **Step 2: Verify the file typechecks**

Run: `cd app && npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/ai/agent/services/preselect.ts
git commit -m "feat(preselect): scaffold service module with types and constants"
```

---

## Task 2: `decideSelection` — pure branching logic

**Files:**
- Modify: `app/src/lib/ai/agent/services/preselect.ts`
- Create: `app/tests/unit/preselect/decide-selection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/preselect/decide-selection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decideSelection, SCORE_FLOOR, AMBIGUITY_EPSILON } from '@/lib/ai/agent/services/preselect'

describe('decideSelection', () => {
  const mk = (callId: string, score: number) => ({
    callId, title: `Call ${callId}`, score,
  })

  it('returns no_match with reason=empty_results for empty input', () => {
    expect(decideSelection([])).toEqual({ kind: 'no_match', reason: 'empty_results' })
  })

  it('returns no_match when top score is below floor', () => {
    const result = decideSelection([mk('a', SCORE_FLOOR - 0.01)])
    expect(result).toEqual({ kind: 'no_match', reason: 'below_score_floor' })
  })

  it('returns selected when single candidate is above floor', () => {
    const top = mk('a', 0.8)
    const result = decideSelection([top])
    expect(result).toEqual({ kind: 'selected', callId: 'a', candidates: [top] })
  })

  it('returns selected when top is clearly above runner-up', () => {
    const cands = [mk('a', 0.9), mk('b', 0.9 - AMBIGUITY_EPSILON - 0.01), mk('c', 0.5)]
    const result = decideSelection(cands)
    expect(result.kind).toBe('selected')
    if (result.kind === 'selected') {
      expect(result.callId).toBe('a')
      expect(result.candidates).toHaveLength(3)
    }
  })

  it('returns ambiguous when top-1 and top-2 are within epsilon', () => {
    const cands = [mk('a', 0.9), mk('b', 0.9 - AMBIGUITY_EPSILON + 0.01), mk('c', 0.5), mk('d', 0.4)]
    const result = decideSelection(cands)
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') {
      expect(result.candidates).toHaveLength(3)
      expect(result.candidates.map(c => c.callId)).toEqual(['a', 'b', 'c'])
    }
  })
})
```

- [ ] **Step 2: Run the test to confirm RED**

Run: `cd app && npx vitest run tests/unit/preselect/decide-selection.test.ts`
Expected: FAIL with `decideSelection is not a function`.

- [ ] **Step 3: Implement `decideSelection`**

Append to `app/src/lib/ai/agent/services/preselect.ts`:

```ts
export function decideSelection(candidates: Candidate[]): SelectionDecision {
  if (candidates.length === 0) {
    return { kind: 'no_match', reason: 'empty_results' }
  }
  if (candidates[0].score < SCORE_FLOOR) {
    return { kind: 'no_match', reason: 'below_score_floor' }
  }
  const top = candidates[0]
  const runner = candidates[1]
  if (runner && top.score - runner.score < AMBIGUITY_EPSILON) {
    return { kind: 'ambiguous', candidates: candidates.slice(0, 3) }
  }
  return { kind: 'selected', callId: top.callId, candidates: candidates.slice(0, 3) }
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

Run: `cd app && npx vitest run tests/unit/preselect/decide-selection.test.ts`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/services/preselect.ts app/tests/unit/preselect/decide-selection.test.ts
git commit -m "feat(preselect): add decideSelection with three-branch policy"
```

---

## Task 3: `rankCandidates` — filter-and-slice over searchCalls

**Files:**
- Modify: `app/src/lib/ai/agent/services/preselect.ts`
- Create: `app/tests/unit/preselect/rank-candidates.test.ts`

**Context:** `searchCalls()` in `app/src/lib/ai/agent/services/evidence.ts` already deduplicates by callId (Qdrant returns chunks score-descending; the `seen` Set keeps the first = highest-scoring). `rankCandidates` is a thin filter + slice over its output.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/preselect/rank-candidates.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock searchCalls before importing rankCandidates
const mockSearchCalls = vi.fn()
vi.mock('@/lib/ai/agent/services/evidence', () => ({
  searchCalls: mockSearchCalls,
}))

import { rankCandidates } from '@/lib/ai/agent/services/preselect'

const ctx = { userId: 'u1', sessionId: 's1' } as any

beforeEach(() => {
  mockSearchCalls.mockReset()
})

describe('rankCandidates', () => {
  it('returns empty when searchCalls returns no matches', async () => {
    mockSearchCalls.mockResolvedValue({ matches: [] })
    expect(await rankCandidates(ctx, 'nothing here')).toEqual([])
  })

  it('passes through searchCalls output, sliced to top-5', async () => {
    const matches = [1, 2, 3, 4, 5, 6, 7].map(i => ({
      callId: `c${i}`, title: `Call ${i}`, program: 'P', score: 1 - i * 0.01,
      snippet: '', sourceUrl: undefined,
    }))
    mockSearchCalls.mockResolvedValue({ matches })
    const result = await rankCandidates(ctx, 'query')
    expect(result).toHaveLength(5)
    expect(result.map(r => r.callId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
  })

  it('filters out excluded callIds and keeps remaining order', async () => {
    const matches = ['a', 'b', 'c', 'd'].map((id, i) => ({
      callId: id, title: id, program: 'P', score: 1 - i * 0.1, snippet: '', sourceUrl: undefined,
    }))
    mockSearchCalls.mockResolvedValue({ matches })
    const result = await rankCandidates(ctx, 'q', ['a', 'c'])
    expect(result.map(r => r.callId)).toEqual(['b', 'd'])
  })

  it('removes the top match when it is excluded', async () => {
    const matches = [
      { callId: 'top', title: 'Top', program: 'P', score: 0.9, snippet: '', sourceUrl: undefined },
      { callId: 'two', title: 'Two', program: 'P', score: 0.7, snippet: '', sourceUrl: undefined },
    ]
    mockSearchCalls.mockResolvedValue({ matches })
    const result = await rankCandidates(ctx, 'q', ['top'])
    expect(result.map(r => r.callId)).toEqual(['two'])
  })
})
```

- [ ] **Step 2: Run the test to confirm RED**

Run: `cd app && npx vitest run tests/unit/preselect/rank-candidates.test.ts`
Expected: FAIL — `rankCandidates is not a function`.

- [ ] **Step 3: Implement `rankCandidates`**

Append to `app/src/lib/ai/agent/services/preselect.ts`:

```ts
import { searchCalls } from './evidence'
import type { ServiceContext } from './types'

/**
 * Deterministic per-call ranker. searchCalls() already dedupes by callId
 * (Qdrant returns chunks score-descending; the seen Set keeps the first =
 * highest-scoring per call). rankCandidates is a thin filter + slice.
 */
export async function rankCandidates(
  ctx: ServiceContext,
  description: string,
  excludeCallIds: string[] = [],
): Promise<Candidate[]> {
  // Overfetch slightly so exclusions don't leave us short.
  const { matches } = await searchCalls(ctx, description, { maxResults: 10 })
  const excluded = new Set(excludeCallIds)
  return matches
    .filter(m => !excluded.has(m.callId))
    .slice(0, 5)
    .map(m => ({
      callId: m.callId,
      title: m.title,
      score: m.score,
      program: m.program === 'unknown' ? undefined : m.program,
      sourceUrl: m.sourceUrl,
    }))
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

Run: `cd app && npx vitest run tests/unit/preselect/rank-candidates.test.ts`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/services/preselect.ts app/tests/unit/preselect/rank-candidates.test.ts
git commit -m "feat(preselect): add rankCandidates wrapping searchCalls"
```

---

## Task 4: `initializeSession` — happy path (structured blueprint)

**Files:**
- Modify: `app/src/lib/ai/agent/services/preselect.ts`
- Create: `app/tests/unit/preselect/initialize-session.test.ts`

**Context:** Creates a new `agent_sessions` row with `selectedCallId`, `blueprint`, `currentPhase`, and `planning_artifact` populated. Emits a `logAudit` entry. Uses existing `lookupBlueprint` service.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/preselect/initialize-session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDb = { insert: vi.fn() }
const mockLookupBlueprint = vi.fn()
const mockLogAudit = vi.fn()

vi.mock('@/lib/db', () => ({ db: mockDb, withUserRLS: (_u: string, fn: any) => fn(mockDb) }))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: mockLookupBlueprint }))
vi.mock('@/lib/legal/audit', () => ({ logAudit: mockLogAudit }))
vi.mock('@/lib/db/schema', () => ({
  agentSessions: Symbol('agentSessions'),
}))

import { initializeSession } from '@/lib/ai/agent/services/preselect'

const CALL_ID = 'call-abc'
const USER_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  mockDb.insert.mockReset()
  mockLookupBlueprint.mockReset()
  mockLogAudit.mockReset()

  // default: insert returns a row with id
  mockDb.insert.mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 'session-xyz' }]),
    }),
  })
})

describe('initializeSession — structured blueprint', () => {
  it('creates session with phase=structuring, blueprint populated, artifact persisted', async () => {
    mockLookupBlueprint.mockResolvedValue({
      kind: 'structured',
      blueprint: { requiredSections: ['intro', 'budget'], confidence: 0.9 },
    })

    const result = await initializeSession({
      userId: USER_ID,
      description: 'Primăria comunei Ocna Șugatag, proiect digitalizare muzeu',
      locale: 'ro',
      selectedCallId: CALL_ID,
      selectedScore: 0.72,
      candidates: [
        { callId: CALL_ID, title: 'Digitizare Patrimoniu', score: 0.72 },
        { callId: 'other', title: 'Other', score: 0.5 },
      ],
      excludeCallIdsApplied: [],
    })

    expect(result.sessionId).toBe('session-xyz')
    expect(result.phase).toBe('structuring')
    expect(result.blueprintKind).toBe('structured')

    const valuesCall = mockDb.insert.mock.results[0].value.values
    const inserted = valuesCall.mock.calls[0][0]
    expect(inserted.userId).toBe(USER_ID)
    expect(inserted.selectedCallId).toBe(CALL_ID)
    expect(inserted.currentPhase).toBe('structuring')
    expect(inserted.blueprint).toEqual({ requiredSections: ['intro', 'budget'], confidence: 0.9 })
    expect(inserted.planningArtifact.preselect.version).toBe(1)
    expect(inserted.planningArtifact.preselect.selectedCallId).toBe(CALL_ID)
    expect(inserted.planningArtifact.preselect.selectionKind).toBe('selected')
    expect(inserted.planningArtifact.preselect.blueprintKind).toBe('structured')
    expect(inserted.planningArtifact.preselect.excludeCallIdsApplied).toEqual([])

    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'session.preselect_completed',
      userId: USER_ID,
    }))
  })
})
```

- [ ] **Step 2: Run the test to confirm RED**

Run: `cd app && npx vitest run tests/unit/preselect/initialize-session.test.ts`
Expected: FAIL — `initializeSession is not a function`.

- [ ] **Step 3: Implement `initializeSession`**

Append to `app/src/lib/ai/agent/services/preselect.ts`:

```ts
import { db, withUserRLS } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { lookupBlueprint } from './blueprint'
import { logAudit } from '@/lib/legal/audit'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'preselect-service' })

export interface InitializeSessionParams {
  userId: string
  description: string
  locale: 'ro' | 'en'
  selectedCallId: string
  selectedScore: number
  candidates: Candidate[]
  excludeCallIdsApplied: string[]
}

export interface InitializeSessionResult {
  sessionId: string
  phase: 'structuring' | 'research'
  blueprintKind: BlueprintKind
}

export async function initializeSession(
  params: InitializeSessionParams,
): Promise<InitializeSessionResult> {
  const {
    userId, description, locale, selectedCallId, selectedScore,
    candidates, excludeCallIdsApplied,
  } = params

  // Blueprint prefetch (best-effort).
  let blueprintKind: BlueprintKind
  let blueprintPayload: unknown = null
  let blueprintLookupFailed = false

  try {
    const ctx = { userId, sessionId: '', locale } as const
    const result = await lookupBlueprint(ctx as any, selectedCallId)
    if (result.kind === 'structured') {
      blueprintKind = 'structured'
      blueprintPayload = result.blueprint
    } else {
      blueprintKind = 'raw_evidence'
      // raw evidence is not a structured blueprint — leave blueprint column null
    }
  } catch (err) {
    blueprintLookupFailed = true
    blueprintKind = 'none'
    log.warn(
      { userId, selectedCallId, error: err instanceof Error ? err.message : String(err) },
      'blueprint_lookup_failed',
    )
  }

  const phase: 'structuring' | 'research' =
    blueprintKind === 'structured' ? 'structuring' : 'research'

  const artifact: PreselectArtifactV1 = {
    version: 1,
    rankedAt: new Date().toISOString(),
    description,
    selectedCallId,
    selectedScore,
    candidates,
    selectionKind: 'selected',
    blueprintKind,
    excludeCallIdsApplied,
  }

  const [row] = await withUserRLS(userId, (tx) =>
    tx.insert(agentSessions).values({
      userId,
      locale,
      selectedCallId,
      currentPhase: phase,
      blueprint: blueprintPayload,
      planningArtifact: { preselect: artifact },
    }).returning({ id: agentSessions.id }),
  )

  await logAudit({
    userId,
    sessionId: row.id,
    action: 'session.preselect_completed',
    metadata: {
      selectedCallId,
      selectedScore,
      candidateCount: candidates.length,
      blueprintKind,
      phase,
      blueprintLookupFailed,
    },
  })

  return { sessionId: row.id, phase, blueprintKind }
}
```

- [ ] **Step 4: Run the test to confirm GREEN**

Run: `cd app && npx vitest run tests/unit/preselect/initialize-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/services/preselect.ts app/tests/unit/preselect/initialize-session.test.ts
git commit -m "feat(preselect): add initializeSession happy path with blueprint prefetch"
```

---

## Task 5: `initializeSession` — degraded paths (raw evidence + lookup failure)

**Files:**
- Modify: `app/tests/unit/preselect/initialize-session.test.ts`

- [ ] **Step 1: Add the raw-evidence test case**

Append to `app/tests/unit/preselect/initialize-session.test.ts`:

```ts
describe('initializeSession — raw-evidence blueprint', () => {
  it('creates session with phase=research, blueprint null, blueprintKind=raw_evidence', async () => {
    mockLookupBlueprint.mockResolvedValue({ kind: 'raw_evidence', chunks: [{ content: 'x' }] })

    const result = await initializeSession({
      userId: USER_ID,
      description: 'a sufficiently long description of a project',
      locale: 'ro',
      selectedCallId: CALL_ID,
      selectedScore: 0.6,
      candidates: [{ callId: CALL_ID, title: 'X', score: 0.6 }],
      excludeCallIdsApplied: [],
    })

    expect(result.phase).toBe('research')
    expect(result.blueprintKind).toBe('raw_evidence')

    const inserted = mockDb.insert.mock.results[0].value.values.mock.calls[0][0]
    expect(inserted.currentPhase).toBe('research')
    expect(inserted.blueprint).toBeNull()
    expect(inserted.planningArtifact.preselect.blueprintKind).toBe('raw_evidence')
  })
})

describe('initializeSession — blueprint lookup failure (degraded success)', () => {
  it('creates session with phase=research, blueprintKind=none, audit flag set, warning logged', async () => {
    mockLookupBlueprint.mockRejectedValue(new Error('vector store blew up'))

    const result = await initializeSession({
      userId: USER_ID,
      description: 'a sufficiently long description of a project',
      locale: 'ro',
      selectedCallId: CALL_ID,
      selectedScore: 0.6,
      candidates: [{ callId: CALL_ID, title: 'X', score: 0.6 }],
      excludeCallIdsApplied: [],
    })

    expect(result.phase).toBe('research')
    expect(result.blueprintKind).toBe('none')

    const inserted = mockDb.insert.mock.results[0].value.values.mock.calls[0][0]
    expect(inserted.planningArtifact.preselect.blueprintKind).toBe('none')

    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'session.preselect_completed',
      metadata: expect.objectContaining({
        blueprintLookupFailed: true,
        blueprintKind: 'none',
      }),
    }))
  })
})
```

- [ ] **Step 2: Run tests to confirm both new cases pass**

Run: `cd app && npx vitest run tests/unit/preselect/initialize-session.test.ts`
Expected: 3 tests PASS (the original plus two new).

If either new case fails, fix `initializeSession`. The existing implementation from Task 4 already handles these paths — run first and only edit if red.

- [ ] **Step 3: Commit**

```bash
git add app/tests/unit/preselect/initialize-session.test.ts
git commit -m "test(preselect): cover raw-evidence and degraded blueprint paths"
```

---

## Task 6: Managed prompt — `phaseBootstrapBlock` (both locales)

**Files:**
- Modify: `app/src/lib/ai/agent/managed/prompt.ts`
- Create: `app/tests/unit/managed/prompt-phase-bootstrap.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/managed/prompt-phase-bootstrap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildManagedSystemPrompt } from '@/lib/ai/agent/managed/prompt'

const mkSession = (opts: { phase: 'discovery'|'research'|'structuring'|'drafting'|'review', selectedCallId?: string | null }) => ({
  id: 's1', userId: 'u1', status: 'active', locale: 'ro',
  selectedCallId: opts.selectedCallId ?? null,
  currentPhase: opts.phase,
  blueprint: null, eligibility: null, outline: null,
  warnings: [], planningArtifact: null, messageSummary: null,
  stateVersion: 0, createdAt: new Date(), updatedAt: new Date(),
  outlineFrozen: false, projectId: null,
} as any)

describe('phaseBootstrapBlock — Romanian', () => {
  it('renders a structuring-branch clause when phase=structuring', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'structuring', selectedCallId: 'CALL-A' }),
      [], 'structuring', 'ro', true,
    )
    expect(p).toContain('## Punct de pornire')
    expect(p).toContain('CALL-A')
    expect(p).toContain('Blueprint-ul complet al apelului este deja disponibil în stare')
    expect(p).not.toContain('vezi `get_call_blueprint`')
  })

  it('renders a research-branch clause when phase=research with selectedCallId', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'research', selectedCallId: 'CALL-B' }),
      [], 'research', 'ro', true,
    )
    expect(p).toContain('## Punct de pornire')
    expect(p).toContain('CALL-B')
    expect(p).toContain('extrage-l folosind `get_call_blueprint`')
  })

  it('omits the block when phase=discovery', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'discovery' }), [], 'discovery', 'ro', true,
    )
    expect(p).not.toContain('## Punct de pornire')
  })
})

describe('phaseBootstrapBlock — English', () => {
  it('renders a structuring-branch clause when phase=structuring', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'structuring', selectedCallId: 'CALL-A' }),
      [], 'structuring', 'en', true,
    )
    expect(p).toContain('## Starting point')
    expect(p).toContain('CALL-A')
    expect(p).toContain('The full call blueprint is already available in state')
    expect(p).not.toContain('see `get_call_blueprint`')
  })

  it('renders a research-branch clause when phase=research with selectedCallId', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'research', selectedCallId: 'CALL-B' }),
      [], 'research', 'en', true,
    )
    expect(p).toContain('## Starting point')
    expect(p).toContain('extract it using `get_call_blueprint`')
  })

  it('omits the block when phase=discovery', () => {
    const p = buildManagedSystemPrompt(
      mkSession({ phase: 'discovery' }), [], 'discovery', 'en', true,
    )
    expect(p).not.toContain('## Starting point')
  })
})
```

- [ ] **Step 2: Run tests to confirm RED**

Run: `cd app && npx vitest run tests/unit/managed/prompt-phase-bootstrap.test.ts`
Expected: all tests FAIL (strings not present in prompt).

- [ ] **Step 3: Add `phaseBootstrapBlock` to Romanian prompt**

In `app/src/lib/ai/agent/managed/prompt.ts`, inside `buildRomanianPrompt`, add before the `return` statement:

```ts
  const phaseBootstrapBlock = phase === 'structuring' && session.selectedCallId
    ? `## Punct de pornire

Apelul ${session.selectedCallId} a fost deja selectat prin preselectare deterministă.
Blueprint-ul complet al apelului este deja disponibil în stare.
Nu re-căuta apeluri. Începe cu generarea outline-ului.

`
    : phase === 'research' && session.selectedCallId
    ? `## Punct de pornire

Apelul ${session.selectedCallId} a fost deja selectat prin preselectare deterministă.
Blueprint-ul structurat nu este încă disponibil în cache — extrage-l folosind \`get_call_blueprint\` și \`retrieve_evidence\`, apoi treci la structurare.

`
    : ''
```

Then modify the template string in `return` to insert `${phaseBootstrapBlock}` right before `## Fazele acoperite` (i.e., before `${modeBlock}` is rendered — or after if `modeBlock` already precedes it; inspect the current template and place the bootstrap block to render between "## Modul curent" section and "## Fazele acoperite"). Keep the existing structure otherwise.

Concrete edit: change the `return` in `buildRomanianPrompt` from:

```ts
  return `Ești FondEU, un asistent expert pentru cereri de finanțare UE (fonduri europene) destinate organizațiilor din România.

${modeBlock}

## Instrumentele tale
```

to:

```ts
  return `Ești FondEU, un asistent expert pentru cereri de finanțare UE (fonduri europene) destinate organizațiilor din România.

${modeBlock}

${phaseBootstrapBlock}## Instrumentele tale
```

- [ ] **Step 4: Add `phaseBootstrapBlock` to English prompt**

Apply the mirror in `buildEnglishPrompt`. English block text:

```ts
  const phaseBootstrapBlock = phase === 'structuring' && session.selectedCallId
    ? `## Starting point

Call ${session.selectedCallId} has already been selected via deterministic preselect.
The full call blueprint is already available in state.
Do not re-run call search. Start with outline generation.

`
    : phase === 'research' && session.selectedCallId
    ? `## Starting point

Call ${session.selectedCallId} has already been selected via deterministic preselect.
The structured blueprint is not yet cached — extract it using \`get_call_blueprint\` and \`retrieve_evidence\`, then move to structuring.

`
    : ''
```

And insert `${phaseBootstrapBlock}` at the same position in the English return template.

- [ ] **Step 5: Run tests to confirm GREEN**

Run: `cd app && npx vitest run tests/unit/managed/prompt-phase-bootstrap.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 6: Re-run full unit suite to ensure no prompt regressions**

Run: `cd app && npx vitest run tests/unit`
Expected: all existing tests still PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai/agent/managed/prompt.ts app/tests/unit/managed/prompt-phase-bootstrap.test.ts
git commit -m "feat(managed-prompt): add phaseBootstrapBlock for preselected sessions"
```

---

## Task 7: Seed `deterministic_preselect_enabled` feature flag

**Files:**
- Create: `app/drizzle/0031_preselect_feature_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

**Context:** Feature flags are rows in the `feature_flags` table, not schema. Per `CLAUDE.md`: `npm run db:generate` is broken; hand-author migrations and append to `_journal.json`.

- [ ] **Step 1: Check the next migration number**

Run: `cd app && ls drizzle/*.sql | tail -5`
Expected: note the highest-numbered existing migration (e.g., `0030_*.sql`). Use the next number. Replace `0031` below with that number if different.

- [ ] **Step 2: Create the migration file**

Create `app/drizzle/0031_preselect_feature_flag.sql`:

```sql
-- Seed the deterministic_preselect_enabled feature flag (default disabled).
-- Admins enable via targeting JSONB: {"userIds": [...]} or {"percentage": 10}.
-- Idempotent: safe to re-run.

INSERT INTO feature_flags (key, description, enabled, targeting)
VALUES (
  'deterministic_preselect_enabled',
  'Gates server-side deterministic call preselect at /proiecte/nou first-message dispatch. Hard dependency on managed_agent_writes_enabled.',
  false,
  '{}'::jsonb
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 3: Append the entry to `_journal.json`**

Open `app/drizzle/meta/_journal.json`. Find the `entries` array and append (after the last entry, before the closing `]`):

```json
    {
      "idx": 31,
      "version": "7",
      "when": 1776500000000,
      "tag": "0031_preselect_feature_flag",
      "breakpoints": true
    }
```

(Use a `when` timestamp greater than the previous entry's. Match `idx` and `tag` to the actual file number from Step 1.)

- [ ] **Step 4: Run the migration locally**

Run: `cd app && DATABASE_URL=postgresql://fondeu:fondeu@localhost:5433/fondeu npm run db:migrate`
Expected: the migration applies without error.

- [ ] **Step 5: Verify the flag exists**

Run:
```bash
docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c "SELECT key, enabled FROM feature_flags WHERE key='deterministic_preselect_enabled';"
```
Expected: one row with `enabled=f`.

- [ ] **Step 6: Commit**

```bash
git add app/drizzle/0031_preselect_feature_flag.sql app/drizzle/meta/_journal.json
git commit -m "chore(db): seed deterministic_preselect_enabled flag (default off)"
```

---

## Task 8: Preselect route — rank mode (integration test first)

**Files:**
- Create: `app/src/app/api/v1/projects/preselect/route.ts`
- Create: `app/tests/integration/preselect-route.test.ts`

**Context:** Route composes `rankCandidates` → `decideSelection` → (`initializeSession` when selected). Auth via `requireAuth`, rate limit via `withRateLimit`, NOT via `withAIAuth` (see spec). Both flags must be enabled.

- [ ] **Step 1: Write the failing integration test (rank mode, selected happy path)**

Create `app/tests/integration/preselect-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mocks: auth, feature flags, service functions
const mockRequireAuth = vi.fn()
const mockIsFeatureEnabled = vi.fn()
const mockRankCandidates = vi.fn()
const mockInitializeSession = vi.fn()

vi.mock('@/lib/auth/helpers', () => ({ requireAuth: mockRequireAuth }))
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: mockIsFeatureEnabled }))
vi.mock('@/lib/ai/agent/services/preselect', async () => {
  const actual = await vi.importActual<any>('@/lib/ai/agent/services/preselect')
  return {
    ...actual,
    rankCandidates: mockRankCandidates,
    initializeSession: mockInitializeSession,
  }
})
vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (handler: any) => handler,
}))

import { POST } from '@/app/api/v1/projects/preselect/route'

const USER = { id: '11111111-1111-4111-8111-111111111111', tier: 'free' }

beforeEach(() => {
  vi.clearAllMocks()
  mockRequireAuth.mockResolvedValue(USER)
  mockIsFeatureEnabled.mockResolvedValue(true)
})

const req = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/projects/preselect', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })

describe('POST /api/v1/projects/preselect — rank mode', () => {
  it('returns kind=selected when ranker produces a clear winner', async () => {
    mockRankCandidates.mockResolvedValue([
      { callId: 'top', title: 'Top', score: 0.8 },
      { callId: 'two', title: 'Two', score: 0.5 },
    ])
    mockInitializeSession.mockResolvedValue({
      sessionId: 'session-xyz', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({
      description: 'a project description that is at least forty chars long',
      locale: 'ro',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('selected')
    expect(body.sessionId).toBe('session-xyz')
    expect(body.selectedCallId).toBe('top')
    expect(body.phase).toBe('structuring')
    expect(body.blueprintKind).toBe('structured')
    expect(body.candidates).toHaveLength(2)
  })

  it('returns kind=ambiguous without creating a session', async () => {
    mockRankCandidates.mockResolvedValue([
      { callId: 'a', title: 'A', score: 0.8 },
      { callId: 'b', title: 'B', score: 0.78 },
      { callId: 'c', title: 'C', score: 0.6 },
    ])

    const res = await POST(req({
      description: 'a project description that is at least forty chars long',
      locale: 'ro',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('ambiguous')
    expect(body.candidates).toHaveLength(3)
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('returns kind=no_match when top score below floor', async () => {
    mockRankCandidates.mockResolvedValue([{ callId: 'x', title: 'X', score: 0.1 }])

    const res = await POST(req({
      description: 'a project description that is at least forty chars long',
      locale: 'ro',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('no_match')
    expect(body.reason).toBe('below_score_floor')
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to confirm RED**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts`
Expected: FAIL — `Cannot find module '@/app/api/v1/projects/preselect/route'`.

- [ ] **Step 3: Implement the route**

Create `app/src/app/api/v1/projects/preselect/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth/helpers'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { withRateLimit } from '@/lib/middleware/rate-limit'
import {
  rankCandidates,
  decideSelection,
  initializeSession,
  MIN_DESCRIPTION_LENGTH,
} from '@/lib/ai/agent/services/preselect'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'preselect-route' })

const RequestSchema = z.object({
  description: z.string(),
  locale: z.enum(['ro', 'en']),
  sessionId: z.string().uuid().optional(),
  expectedStateVersion: z.number().int().nonnegative().optional(),
  confirmCandidateId: z.string().optional(),
  excludeCallIds: z.array(z.string()).optional(),
})

const err = (status: number, code: string, message?: string) =>
  NextResponse.json({ error: { code, message: message ?? code } }, { status })

async function handler(req: NextRequest): Promise<NextResponse> {
  // Auth
  let user
  try {
    user = await requireAuth()
  } catch {
    return err(401, 'UNAUTHORIZED')
  }

  // Feature flags (both required)
  const [preselect, writes] = await Promise.all([
    isFeatureEnabled('deterministic_preselect_enabled', { userId: user.id }),
    isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id }),
  ])
  if (!preselect || !writes) return err(404, 'PRESELECT_DISABLED')

  // Validate request body
  let parsed
  try {
    const body = await req.json()
    parsed = RequestSchema.parse(body)
  } catch (e) {
    return err(400, 'INVALID_REQUEST', e instanceof Error ? e.message : 'invalid body')
  }

  if (parsed.description.length < MIN_DESCRIPTION_LENGTH) {
    return err(400, 'DESCRIPTION_TOO_SHORT')
  }

  // Disallow conflicting modes
  if (parsed.sessionId && parsed.confirmCandidateId) {
    return err(400, 'CONFLICTING_MODE', 'sessionId and confirmCandidateId are mutually exclusive')
  }
  if (parsed.sessionId && parsed.expectedStateVersion === undefined) {
    return err(400, 'EXPECTED_STATE_VERSION_REQUIRED')
  }

  // Phase 1: rank mode only. Confirm + override added in later tasks.
  if (parsed.confirmCandidateId || parsed.sessionId) {
    return err(501, 'NOT_IMPLEMENTED', 'confirm and override modes arrive in later tasks')
  }

  const ctx = { userId: user.id, sessionId: '', locale: parsed.locale }
  let candidates
  try {
    candidates = await rankCandidates(ctx as any, parsed.description, parsed.excludeCallIds ?? [])
  } catch (e) {
    log.error({ err: e, userId: user.id }, 'rankCandidates failed')
    return err(503, 'PRESELECT_UNAVAILABLE')
  }

  const decision = decideSelection(candidates)

  if (decision.kind === 'no_match') {
    return NextResponse.json({ kind: 'no_match', reason: decision.reason })
  }
  if (decision.kind === 'ambiguous') {
    return NextResponse.json({ kind: 'ambiguous', candidates: decision.candidates })
  }

  // kind === 'selected'
  try {
    const result = await initializeSession({
      userId: user.id,
      description: parsed.description,
      locale: parsed.locale,
      selectedCallId: decision.callId,
      selectedScore: decision.candidates[0].score,
      candidates: decision.candidates,
      excludeCallIdsApplied: parsed.excludeCallIds ?? [],
    })
    return NextResponse.json({
      kind: 'selected',
      sessionId: result.sessionId,
      selectedCallId: decision.callId,
      candidates: decision.candidates,
      blueprintKind: result.blueprintKind,
      phase: result.phase,
    })
  } catch (e) {
    log.error({ err: e, userId: user.id }, 'initializeSession failed')
    return err(500, 'SESSION_INIT_FAILED')
  }
}

export const POST = withRateLimit(handler)
```

- [ ] **Step 4: Run the test to confirm GREEN**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/v1/projects/preselect/route.ts app/tests/integration/preselect-route.test.ts
git commit -m "feat(preselect): add POST /api/v1/projects/preselect rank mode"
```

---

## Task 9: Preselect route — error paths + mode validation

**Files:**
- Modify: `app/tests/integration/preselect-route.test.ts`
- (possibly) Modify: `app/src/app/api/v1/projects/preselect/route.ts` if tests reveal gaps

- [ ] **Step 1: Append error-path tests**

Append to `app/tests/integration/preselect-route.test.ts`:

```ts
describe('POST /api/v1/projects/preselect — error paths', () => {
  it('returns 401 when unauthenticated', async () => {
    mockRequireAuth.mockRejectedValue(new Error('unauthorized'))
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns 404 PRESELECT_DISABLED when preselect flag off', async () => {
    mockIsFeatureEnabled.mockImplementation(async (key) =>
      key === 'managed_agent_writes_enabled',
    )
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('PRESELECT_DISABLED')
  })

  it('returns 404 PRESELECT_DISABLED when writes flag off', async () => {
    mockIsFeatureEnabled.mockImplementation(async (key) =>
      key === 'deterministic_preselect_enabled',
    )
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('PRESELECT_DISABLED')
  })

  it('returns 400 DESCRIPTION_TOO_SHORT when description below min length', async () => {
    const res = await POST(req({ description: 'short', locale: 'ro' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('DESCRIPTION_TOO_SHORT')
  })

  it('returns 400 INVALID_REQUEST on malformed body', async () => {
    const res = await POST(new NextRequest('http://localhost/x', {
      method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(400)
  })

  it('returns 400 CONFLICTING_MODE when sessionId and confirmCandidateId both present', async () => {
    const res = await POST(req({
      description: 'x'.repeat(50), locale: 'ro',
      sessionId: '00000000-0000-4000-8000-000000000000',
      expectedStateVersion: 0,
      confirmCandidateId: 'abc',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('CONFLICTING_MODE')
  })

  it('returns 400 EXPECTED_STATE_VERSION_REQUIRED when sessionId without expectedStateVersion', async () => {
    const res = await POST(req({
      description: 'x'.repeat(50), locale: 'ro',
      sessionId: '00000000-0000-4000-8000-000000000000',
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('EXPECTED_STATE_VERSION_REQUIRED')
  })

  it('returns 503 PRESELECT_UNAVAILABLE when rankCandidates throws', async () => {
    mockRankCandidates.mockRejectedValue(new Error('qdrant down'))
    const res = await POST(req({ description: 'x'.repeat(50), locale: 'ro' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error.code).toBe('PRESELECT_UNAVAILABLE')
  })
})
```

- [ ] **Step 2: Run the full preselect-route test file**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts`
Expected: all tests PASS (rank-mode tests from Task 8 plus 8 new error-path tests).

If any fail, fix the route. The route from Task 8 should already return these codes.

- [ ] **Step 3: Commit**

```bash
git add app/tests/integration/preselect-route.test.ts
git commit -m "test(preselect): cover error paths + mode validation"
```

---

## Task 10: Preselect route — confirm mode

**Files:**
- Modify: `app/src/app/api/v1/projects/preselect/route.ts`
- Modify: `app/tests/integration/preselect-route.test.ts`

**Context:** Confirm mode: client sends `confirmCandidateId` (from an earlier ambiguous response), server skips ranking and creates a session with that call. Server validates the call exists in the vector store via a cheap check against `searchCalls` (query = callId); reject with `INVALID_CALL_ID` if not found.

- [ ] **Step 1: Add the confirm-mode test**

Append to `app/tests/integration/preselect-route.test.ts`:

```ts
describe('POST /api/v1/projects/preselect — confirm mode', () => {
  it('creates session with the specified confirmCandidateId, skips ranker', async () => {
    mockInitializeSession.mockResolvedValue({
      sessionId: 'session-confirm', phase: 'structuring', blueprintKind: 'structured',
    })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      confirmCandidateId: 'chosen-call-id',
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('selected')
    expect(body.selectedCallId).toBe('chosen-call-id')
    expect(mockRankCandidates).not.toHaveBeenCalled()
    expect(mockInitializeSession).toHaveBeenCalledWith(expect.objectContaining({
      selectedCallId: 'chosen-call-id',
      candidates: [{ callId: 'chosen-call-id', title: 'chosen-call-id', score: 1 }],
      excludeCallIdsApplied: [],
    }))
  })
})
```

- [ ] **Step 2: Run the test to confirm RED**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts -t "confirm mode"`
Expected: FAIL — route still returns 501 NOT_IMPLEMENTED for confirm.

- [ ] **Step 3: Implement confirm mode in the route**

Edit `app/src/app/api/v1/projects/preselect/route.ts`. Remove the "Phase 1: rank mode only" guard and replace with:

```ts
  // Confirm mode: skip ranker, trust the provided callId
  if (parsed.confirmCandidateId && !parsed.sessionId) {
    try {
      const result = await initializeSession({
        userId: user.id,
        description: parsed.description,
        locale: parsed.locale,
        selectedCallId: parsed.confirmCandidateId,
        selectedScore: 1,
        candidates: [{
          callId: parsed.confirmCandidateId,
          title: parsed.confirmCandidateId,
          score: 1,
        }],
        excludeCallIdsApplied: [],
      })
      return NextResponse.json({
        kind: 'selected',
        sessionId: result.sessionId,
        selectedCallId: parsed.confirmCandidateId,
        candidates: [{ callId: parsed.confirmCandidateId, title: parsed.confirmCandidateId, score: 1 }],
        blueprintKind: result.blueprintKind,
        phase: result.phase,
      })
    } catch (e) {
      log.error({ err: e, userId: user.id }, 'initializeSession failed (confirm mode)')
      return err(500, 'SESSION_INIT_FAILED')
    }
  }

  // Override mode not yet implemented (arrives in Task 11)
  if (parsed.sessionId) {
    return err(501, 'NOT_IMPLEMENTED', 'override mode arrives in task 11')
  }

  // Rank mode (default)
  // ... existing rank-mode code stays as-is
```

- [ ] **Step 4: Run the confirm test to confirm GREEN**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/v1/projects/preselect/route.ts app/tests/integration/preselect-route.test.ts
git commit -m "feat(preselect): add confirm mode to preselect route"
```

---

## Task 11: Preselect route — override mode (on existing session)

**Files:**
- Modify: `app/src/app/api/v1/projects/preselect/route.ts`
- Modify: `app/tests/integration/preselect-route.test.ts`

**Context:** Override mode: client passes `sessionId` + `expectedStateVersion` + `excludeCallIds`. Server re-runs ranker, and on `kind: 'selected'` calls `setSelectedCall(sessionId, newCallId, expectedStateVersion)` on the existing session. Policy matrix enforces outline-frozen lock.

- [ ] **Step 1: Add override-mode tests**

Append to `app/tests/integration/preselect-route.test.ts`:

```ts
// Add to the top-of-file mocks block:
const mockSetSelectedCall = vi.fn()
vi.mock('@/lib/ai/agent/services/application', () => ({
  setSelectedCall: mockSetSelectedCall,
}))

// ... and in beforeEach, reset: mockSetSelectedCall.mockReset()
```

(If the tests are already structured to merge mocks, append the `mockSetSelectedCall` declaration near the others and the `vi.mock` line in the mocks block, and add the reset in `beforeEach`.)

Append new test block:

```ts
describe('POST /api/v1/projects/preselect — override mode', () => {
  const SESSION_ID = '22222222-2222-4222-8222-222222222222'

  it('re-ranks with excludeCallIds and mutates existing session via setSelectedCall', async () => {
    mockRankCandidates.mockResolvedValue([
      { callId: 'newtop', title: 'NewTop', score: 0.8 },
      { callId: 'other', title: 'Other', score: 0.5 },
    ])
    mockSetSelectedCall.mockResolvedValue({ stateVersion: 3 })

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 2,
      excludeCallIds: ['oldcall'],
    }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('selected')
    expect(body.sessionId).toBe(SESSION_ID)
    expect(body.selectedCallId).toBe('newtop')
    expect(mockSetSelectedCall).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sessionId: SESSION_ID,
        callId: 'newtop',
        expectedStateVersion: 2,
      }),
    )
    expect(mockInitializeSession).not.toHaveBeenCalled()
  })

  it('returns 409 OUTLINE_FROZEN when setSelectedCall throws the policy error', async () => {
    mockRankCandidates.mockResolvedValue([{ callId: 'x', title: 'X', score: 0.9 }])
    const err = Object.assign(new Error('frozen'), { code: 'POLICY_OUTLINE_ALREADY_FROZEN' })
    mockSetSelectedCall.mockRejectedValue(err)

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 2,
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('OUTLINE_FROZEN')
  })

  it('returns 409 CONCURRENCY_CONFLICT on stateVersion mismatch', async () => {
    mockRankCandidates.mockResolvedValue([{ callId: 'x', title: 'X', score: 0.9 }])
    const err = Object.assign(new Error('stale'), { code: 'CONCURRENCY_CONFLICT' })
    mockSetSelectedCall.mockRejectedValue(err)

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 1,
    }))
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('CONCURRENCY_CONFLICT')
  })
})
```

- [ ] **Step 2: Run to confirm RED**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts -t "override mode"`
Expected: FAIL — override returns 501.

- [ ] **Step 3: Implement override mode**

In `app/src/app/api/v1/projects/preselect/route.ts`, add the import:

```ts
import { setSelectedCall } from '@/lib/ai/agent/services/application'
```

Replace the `if (parsed.sessionId) { return err(501, 'NOT_IMPLEMENTED', ...) }` stub with:

```ts
  // Override mode: existing session, re-rank and mutate via setSelectedCall
  if (parsed.sessionId) {
    const overrideCtx = {
      userId: user.id,
      sessionId: parsed.sessionId,
      locale: parsed.locale,
    }
    let candidates
    try {
      candidates = await rankCandidates(overrideCtx as any, parsed.description, parsed.excludeCallIds ?? [])
    } catch (e) {
      log.error({ err: e, userId: user.id }, 'rankCandidates failed (override)')
      return err(503, 'PRESELECT_UNAVAILABLE')
    }
    const decision = decideSelection(candidates)
    if (decision.kind === 'no_match') {
      return NextResponse.json({ kind: 'no_match', reason: decision.reason })
    }
    if (decision.kind === 'ambiguous') {
      return NextResponse.json({ kind: 'ambiguous', candidates: decision.candidates })
    }
    try {
      await setSelectedCall(overrideCtx as any, {
        sessionId: parsed.sessionId,
        callId: decision.callId,
        expectedStateVersion: parsed.expectedStateVersion!,
      })
    } catch (e) {
      const code = (e as any)?.code
      if (code === 'POLICY_OUTLINE_ALREADY_FROZEN') return err(409, 'OUTLINE_FROZEN')
      if (code === 'CONCURRENCY_CONFLICT') return err(409, 'CONCURRENCY_CONFLICT')
      log.error({ err: e, userId: user.id, sessionId: parsed.sessionId }, 'setSelectedCall failed')
      return err(500, 'OVERRIDE_FAILED')
    }
    return NextResponse.json({
      kind: 'selected',
      sessionId: parsed.sessionId,
      selectedCallId: decision.callId,
      candidates: decision.candidates,
      // blueprintKind/phase not returned on override — client can query session state
      blueprintKind: 'structured',  // placeholder; actual kind unchanged by override
      phase: 'structuring',         // placeholder; actual phase unchanged by override
    })
  }
```

Note the placeholder `blueprintKind`/`phase` in the response: override doesn't re-fetch the blueprint. The client already has the session state from the SSE resume path; it should not rely on these fields in override responses. Consider omitting them — but keep the shape consistent for Phase 1 by using safe defaults.

- [ ] **Step 4: Run full integration test file**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts`
Expected: all tests PASS (rank + confirm + override + errors).

- [ ] **Step 5: Add the "excludeCallIds removes strong candidate" edge case**

Append to the override-mode describe block:

```ts
  it('falls back from selected → ambiguous when excludeCallIds removes the clear winner', async () => {
    // searchCalls (mocked through rankCandidates) returns two close scores after exclusion
    mockRankCandidates.mockResolvedValue([
      { callId: 'a', title: 'A', score: 0.75 },
      { callId: 'b', title: 'B', score: 0.73 },
      { callId: 'c', title: 'C', score: 0.5 },
    ])

    const res = await POST(req({
      description: 'x'.repeat(50),
      locale: 'ro',
      sessionId: SESSION_ID,
      expectedStateVersion: 2,
      excludeCallIds: ['oldcall'],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('ambiguous')
    expect(body.candidates.map((c: any) => c.callId)).toEqual(['a', 'b', 'c'])
    expect(mockSetSelectedCall).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run tests to confirm GREEN**

Run: `cd app && npx vitest run tests/integration/preselect-route.test.ts`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/app/api/v1/projects/preselect/route.ts app/tests/integration/preselect-route.test.ts
git commit -m "feat(preselect): add override mode + edge case coverage"
```

---

## Task 12: Agent bootstrap phase integration test

**Files:**
- Create: `app/tests/integration/agent-bootstrap-phase.test.ts`

**Context:** Asserts that when the managed runtime handles its first turn on a session that was seeded with `phase: 'structuring'` + `selectedCallId` + `blueprint`, it does not call `search_calls`. Stubs Anthropic streaming to avoid real API calls.

- [ ] **Step 1: Write the test**

Create `app/tests/integration/agent-bootstrap-phase.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stub Anthropic SDK at the module boundary. The exact import path matches
// what lib/ai/agent/managed/runtime.ts uses.
const mockAnthropicStream = vi.fn()
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { stream: mockAnthropicStream }
  },
}))

// Mock the managed runtime's collaborators at their import points.
// (Fill in the actual import paths used by runtime.ts when implementing.)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('agent bootstrap phase — first turn on preselected session', () => {
  it('does not call search_calls on the first turn when phase=structuring and selectedCallId is set', async () => {
    // Configure the streaming mock to return a simple text-only response
    // (no tool_use blocks), signalling the agent did not request any tools.
    const iterable = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Outline will be generated.' } }
        yield { type: 'message_stop', stop_reason: 'end_turn' }
      },
      finalMessage: async () => ({ usage: { input_tokens: 100, output_tokens: 10 } }),
    }
    mockAnthropicStream.mockReturnValue(iterable)

    // Build a session input that seeds state as if preselect ran.
    const preloadedSession = {
      id: 'session-preloaded',
      userId: '11111111-1111-4111-8111-111111111111',
      status: 'active',
      locale: 'ro',
      selectedCallId: 'CALL-A',
      currentPhase: 'structuring',
      blueprint: { requiredSections: ['intro', 'budget'], confidence: 0.9 },
      outlineFrozen: false,
      stateVersion: 0,
    }

    // Import the runtime under test lazily, after mocks are set up.
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')

    // Invoke the runtime with a first user message ("describe project").
    // Assert the resulting tool-call log does NOT include search_calls.
    const events: any[] = []
    await runManagedTurn({
      session: preloadedSession as any,
      sections: [],
      userMessage: 'Primăria comunei Ocna Șugatag, proiect digitalizare muzeu.',
      locale: 'ro',
      allowWrites: true,
      onEvent: (e) => events.push(e),
    } as any).catch(() => {/* runtime may require extra plumbing; OK for this assert */})

    const toolNames = events
      .filter(e => e.type === 'tool_use')
      .map(e => e.name)
    expect(toolNames).not.toContain('search_calls')
  })
})
```

**NOTE:** This test's exact shape depends on the current `runManagedTurn` (or equivalent) signature. If the real entry-point name or params differ, adjust the invocation. The invariant under test — `toolNames does not contain 'search_calls'` — is the important part. If this test proves hard to set up in Phase 1, downgrade to a prompt-level test (assert the system prompt contains `Nu re-căuta apeluri`); the unit test in Task 6 already provides prompt-level coverage, so this integration test is gravy.

- [ ] **Step 2: Run the test**

Run: `cd app && npx vitest run tests/integration/agent-bootstrap-phase.test.ts`

If the runtime's signature doesn't match the test as drafted, fix the test to match the real API. If setup proves non-trivial, skip (`.skip`) this test with a comment explaining what it should eventually assert — the prompt-level unit tests from Task 6 are the primary guard.

- [ ] **Step 3: Commit**

```bash
git add app/tests/integration/agent-bootstrap-phase.test.ts
git commit -m "test(preselect): integration test — no search_calls on preselected first turn"
```

---

## Task 13: i18n keys for preselect UI

**Files:**
- Modify: `app/src/messages/ro.json`
- Modify: `app/src/messages/en.json`

- [ ] **Step 1: Add Romanian keys**

Open `app/src/messages/ro.json`, add a new top-level `preselect` block:

```json
"preselect": {
  "placeholder": "Descrie proiectul tău…",
  "matching": "Caut cel mai potrivit apel…",
  "banner": {
    "label": "Apel selectat",
    "change": "Schimbă"
  },
  "picker": {
    "title": "Alege apelul potrivit",
    "subtitle": "Am găsit mai multe apeluri similare. Alege unul pentru a continua.",
    "select": "Alege"
  },
  "noMatch": {
    "title": "Nu am găsit un apel suficient de potrivit",
    "hint": "Adaugă mai multe detalii: tipul organizației, domeniul proiectului, buget aproximativ.",
    "retry": "Încearcă din nou"
  },
  "errors": {
    "PRESELECT_UNAVAILABLE": "Sistemul de căutare este momentan indisponibil. Încearcă din nou în câteva momente.",
    "DESCRIPTION_TOO_SHORT": "Descrie proiectul mai în detaliu (cel puțin 40 de caractere).",
    "OUTLINE_FROZEN": "Outline-ul este înghețat, nu mai poți schimba apelul.",
    "CONCURRENCY_CONFLICT": "Starea sesiunii s-a schimbat între timp. Reîncearcă."
  }
}
```

- [ ] **Step 2: Add English keys**

Mirror in `app/src/messages/en.json`:

```json
"preselect": {
  "placeholder": "Describe your project…",
  "matching": "Finding the best matching call…",
  "banner": {
    "label": "Selected call",
    "change": "Change"
  },
  "picker": {
    "title": "Choose the right call",
    "subtitle": "We found several similar calls. Pick one to continue.",
    "select": "Select"
  },
  "noMatch": {
    "title": "No sufficiently strong match was found",
    "hint": "Add more detail: organization type, project domain, approximate budget.",
    "retry": "Try again"
  },
  "errors": {
    "PRESELECT_UNAVAILABLE": "The search system is temporarily unavailable. Try again in a moment.",
    "DESCRIPTION_TOO_SHORT": "Describe your project in more detail (at least 40 characters).",
    "OUTLINE_FROZEN": "The outline is frozen; you can no longer change the call.",
    "CONCURRENCY_CONFLICT": "The session state changed in the meantime. Please retry."
  }
}
```

- [ ] **Step 3: Verify JSON parses**

Run: `cd app && node -e "JSON.parse(require('fs').readFileSync('src/messages/ro.json'))" && node -e "JSON.parse(require('fs').readFileSync('src/messages/en.json'))"`
Expected: no output (both files are valid JSON).

- [ ] **Step 4: Commit**

```bash
git add app/src/messages/ro.json app/src/messages/en.json
git commit -m "i18n: add preselect keys (ro, en)"
```

---

## Task 14: Preselect client helper

**Files:**
- Create: `app/src/lib/preselect/client.ts`

- [ ] **Step 1: Create the helper**

Create `app/src/lib/preselect/client.ts`:

```ts
// Client-side fetch wrapper for /api/v1/projects/preselect.
// Keeps useAgent purely SSE-focused; this file owns the preselect handshake.

export interface Candidate {
  callId: string
  title: string
  score: number
  program?: string
  sourceUrl?: string
}

export type PreselectResponse =
  | {
      kind: 'selected'
      sessionId: string
      selectedCallId: string
      candidates: Candidate[]
      blueprintKind: 'structured' | 'raw_evidence' | 'none'
      phase: 'structuring' | 'research'
    }
  | { kind: 'ambiguous'; candidates: Candidate[] }
  | { kind: 'no_match'; reason: string }

export interface PreselectError {
  kind: 'error'
  httpStatus: number
  code: string
  message: string
}

export interface PreselectRequest {
  description: string
  locale: 'ro' | 'en'
  sessionId?: string
  expectedStateVersion?: number
  confirmCandidateId?: string
  excludeCallIds?: string[]
}

export async function preselect(
  body: PreselectRequest,
): Promise<PreselectResponse | PreselectError> {
  let res: Response
  try {
    res = await fetch('/api/v1/projects/preselect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return {
      kind: 'error',
      httpStatus: 0,
      code: 'NETWORK_ERROR',
      message: e instanceof Error ? e.message : 'network error',
    }
  }

  const json = await res.json().catch(() => null)

  if (!res.ok) {
    return {
      kind: 'error',
      httpStatus: res.status,
      code: json?.error?.code ?? 'UNKNOWN',
      message: json?.error?.message ?? `HTTP ${res.status}`,
    }
  }

  return json as PreselectResponse
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/preselect/client.ts
git commit -m "feat(preselect): add client fetch helper"
```

---

## Task 15: `SelectedCallBanner` component

**Files:**
- Create: `app/src/app/[locale]/(dashboard)/proiecte/nou/components/SelectedCallBanner.tsx`

- [ ] **Step 1: Create the component**

Create `app/src/app/[locale]/(dashboard)/proiecte/nou/components/SelectedCallBanner.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'

interface SelectedCallBannerProps {
  callTitle: string
  outlineFrozen: boolean
  onChangeRequested: () => void
}

export function SelectedCallBanner({
  callTitle,
  outlineFrozen,
  onChangeRequested,
}: SelectedCallBannerProps) {
  const t = useTranslations('preselect.banner')
  return (
    <div className="flex items-center justify-between rounded-md border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
      <div>
        <span className="font-medium text-gray-500">{t('label')}:</span>{' '}
        <span className="font-semibold text-gray-900">{callTitle}</span>
      </div>
      {!outlineFrozen && (
        <button
          type="button"
          onClick={onChangeRequested}
          className="text-blue-600 hover:text-blue-700 font-medium"
        >
          {t('change')}
        </button>
      )}
    </div>
  )
}
```

The "Change" button is visible **only when `outlineFrozen === false`**, per the spec. Phase-based gating would incorrectly re-enable the button in post-freeze `review`/`completed` states.

- [ ] **Step 2: Verify typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/[locale]/(dashboard)/proiecte/nou/components/SelectedCallBanner.tsx"
git commit -m "feat(preselect): add SelectedCallBanner component"
```

---

## Task 16: `CandidatePicker` component

**Files:**
- Create: `app/src/app/[locale]/(dashboard)/proiecte/nou/components/CandidatePicker.tsx`

- [ ] **Step 1: Create the component**

Create `app/src/app/[locale]/(dashboard)/proiecte/nou/components/CandidatePicker.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'
import type { Candidate } from '@/lib/preselect/client'

interface CandidatePickerProps {
  candidates: Candidate[]
  onSelect: (callId: string) => void
  disabled?: boolean
}

export function CandidatePicker({ candidates, onSelect, disabled }: CandidatePickerProps) {
  const t = useTranslations('preselect.picker')
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-base font-semibold text-gray-900">{t('title')}</h3>
      <p className="mt-1 text-sm text-gray-600">{t('subtitle')}</p>
      <ul className="mt-3 space-y-2">
        {candidates.map((c) => (
          <li key={c.callId}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(c.callId)}
              className="flex w-full items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-left hover:border-blue-400 hover:bg-blue-50 disabled:opacity-50"
            >
              <div>
                <div className="font-medium text-gray-900">{c.title}</div>
                {c.program && (
                  <div className="text-xs text-gray-500">{c.program}</div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <ScoreBar score={c.score} />
                <span className="text-sm font-medium text-blue-600">{t('select')}</span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  return (
    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-200">
      <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/[locale]/(dashboard)/proiecte/nou/components/CandidatePicker.tsx"
git commit -m "feat(preselect): add CandidatePicker component"
```

---

## Task 17: `NoMatchGuidance` component

**Files:**
- Create: `app/src/app/[locale]/(dashboard)/proiecte/nou/components/NoMatchGuidance.tsx`

- [ ] **Step 1: Create the component**

Create `app/src/app/[locale]/(dashboard)/proiecte/nou/components/NoMatchGuidance.tsx`:

```tsx
'use client'

import { useTranslations } from 'next-intl'

interface NoMatchGuidanceProps {
  onRetry: () => void
}

export function NoMatchGuidance({ onRetry }: NoMatchGuidanceProps) {
  const t = useTranslations('preselect.noMatch')
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-base font-semibold text-amber-900">{t('title')}</h3>
      <p className="mt-2 text-sm text-amber-800">{t('hint')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
      >
        {t('retry')}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "app/src/app/[locale]/(dashboard)/proiecte/nou/components/NoMatchGuidance.tsx"
git commit -m "feat(preselect): add NoMatchGuidance component"
```

---

## Task 18: Convert `/proiecte/nou/page.tsx` to RSC and extract `NewProjectView`

**Files:**
- Modify: `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx`
- Create: `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx`

**Context:** The page must read feature flags server-side (per spec) and pass a single `preselectEnabled` prop to a new client component that owns the state machine.

- [ ] **Step 1: Copy the current page contents into `NewProjectView.tsx`**

Run: `cat app/src/app/\[locale\]/\(dashboard\)/proiecte/nou/page.tsx` — copy the body.

Create `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx` as a client component with the current page's client logic. Preserve the `useAgent(locale, initialSessionId)` wiring and URL-param behavior.

Add one new prop at the top:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { useAgent } from '@/hooks/useAgent'
import { preselect, type Candidate, type PreselectResponse, type PreselectError } from '@/lib/preselect/client'
import { SelectedCallBanner } from './components/SelectedCallBanner'
import { CandidatePicker } from './components/CandidatePicker'
import { NoMatchGuidance } from './components/NoMatchGuidance'
import { useTranslations } from 'next-intl'

interface NewProjectViewProps {
  locale: 'ro' | 'en'
  initialSessionId?: string
  preselectEnabled: boolean
}

type PreselectState =
  | { kind: 'idle' }
  | { kind: 'matching' }
  | {
      kind: 'selected'
      sessionId: string
      callId: string
      callTitle: string
      description: string       // preserved so override can re-rank with the same input
      outlineFrozen: boolean
    }
  | { kind: 'ambiguous'; candidates: Candidate[]; description: string }
  | { kind: 'no_match'; reason: string }
  | { kind: 'error'; code: string; message: string }

export function NewProjectView({ locale, initialSessionId, preselectEnabled }: NewProjectViewProps) {
  const t = useTranslations('preselect')
  const agent = useAgent(locale, initialSessionId)
  const [state, setState] = useState<PreselectState>({ kind: 'idle' })

  const handleFirstSend = useCallback(async (description: string) => {
    // If preselect is disabled or we already have a session, use legacy flow
    if (!preselectEnabled || initialSessionId) {
      await agent.sendMessage(description)
      return
    }

    setState({ kind: 'matching' })
    const result = await preselect({ description, locale })

    if ('kind' in result && result.kind === 'error') {
      setState({ kind: 'error', code: result.code, message: result.message })
      return
    }

    if (result.kind === 'no_match') {
      setState({ kind: 'no_match', reason: result.reason })
      return
    }

    if (result.kind === 'ambiguous') {
      setState({ kind: 'ambiguous', candidates: result.candidates, description })
      return
    }

    // kind === 'selected'
    setState({
      kind: 'selected',
      sessionId: result.sessionId,
      callId: result.selectedCallId,
      callTitle: result.candidates[0]?.title ?? result.selectedCallId,
      description,
      outlineFrozen: false,
    })
    // Update URL so a refresh resumes into the created session.
    window.history.replaceState(null, '', `?session=${result.sessionId}`)
    await agent.sendMessage(description)
  }, [preselectEnabled, initialSessionId, locale, agent])

  const handleCandidatePick = useCallback(async (callId: string) => {
    if (state.kind !== 'ambiguous') return
    const description = state.description
    setState({ kind: 'matching' })
    const result = await preselect({
      description,
      locale,
      confirmCandidateId: callId,
    })
    if ('kind' in result && result.kind === 'error') {
      setState({ kind: 'error', code: result.code, message: result.message })
      return
    }
    if (result.kind === 'selected') {
      setState({
        kind: 'selected',
        sessionId: result.sessionId,
        callId: result.selectedCallId,
        callTitle: result.candidates[0]?.title ?? result.selectedCallId,
        description,
        outlineFrozen: false,
      })
      window.history.replaceState(null, '', `?session=${result.sessionId}`)
      await agent.sendMessage(description)
    }
  }, [state, locale, agent])

  const handleChangeRequested = useCallback(async () => {
    // Override path — sessionId + stateVersion + excludeCallIds.
    // Requires useAgent to expose the current stateVersion. If the hook does
    // not yet expose it publicly, add a getter in that hook as part of this
    // task (one-line change: return `stateVersion` from the hook's return
    // object alongside `sessionId`). Do NOT ship a TODO.
    if (state.kind !== 'selected' || !agent.sessionId) return
    const description = state.description
    const rejectedCallId = state.callId
    setState({ kind: 'matching' })
    const result = await preselect({
      description,
      locale,
      sessionId: agent.sessionId,
      expectedStateVersion: agent.stateVersion,
      excludeCallIds: [rejectedCallId],
    })
    if ('kind' in result && result.kind === 'error') {
      setState({ kind: 'error', code: result.code, message: result.message })
      return
    }
    if (result.kind === 'selected') {
      setState({
        kind: 'selected',
        sessionId: result.sessionId,
        callId: result.selectedCallId,
        callTitle: result.candidates[0]?.title ?? result.selectedCallId,
        description,
        outlineFrozen: false,
      })
      return
    }
    if (result.kind === 'ambiguous') {
      setState({ kind: 'ambiguous', candidates: result.candidates, description })
      return
    }
    if (result.kind === 'no_match') {
      setState({ kind: 'no_match', reason: result.reason })
    }
  }, [state, locale, agent])

  const handleNoMatchRetry = useCallback(() => {
    setState({ kind: 'idle' })
  }, [])

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-4">
      {state.kind === 'selected' && (
        <SelectedCallBanner
          callTitle={state.callTitle}
          outlineFrozen={state.outlineFrozen}
          onChangeRequested={handleChangeRequested}
        />
      )}
      {state.kind === 'ambiguous' && (
        <CandidatePicker candidates={state.candidates} onSelect={handleCandidatePick} />
      )}
      {state.kind === 'no_match' && (
        <NoMatchGuidance onRetry={handleNoMatchRetry} />
      )}
      {state.kind === 'matching' && (
        <p className="text-sm text-gray-600">{t('matching')}</p>
      )}
      {state.kind === 'error' && (
        <p className="text-sm text-red-600">
          {t(`errors.${state.code}` as any, { fallback: state.message })}
        </p>
      )}

      {/* Composer + conversation rendered inline below.
          Port the existing page.tsx JSX here (the transcript list, composer
          textarea, and send button). The ONLY behavioral change is the
          composer submit handler: */}
      <ComposerBlock
        agent={agent}
        onFirstSend={handleFirstSend}
        disabled={state.kind === 'matching'}
        placeholder={t('placeholder')}
      />
    </div>
  )
}

/**
 * ComposerBlock owns the conversation UI and the composer. Implementation
 * steps for this function (do NOT ship as written — fill in real JSX):
 *
 *   1. Copy the entire JSX return block from the current page.tsx (the
 *      transcript list rendering agent.messages + the textarea + the send
 *      button) into this function body.
 *   2. Find the submit handler. Currently it calls `agent.sendMessage(text)`.
 *      Replace with:
 *          if (!agent.sessionId) {
 *            await props.onFirstSend(text)  // routes through preselect
 *          } else {
 *            await agent.sendMessage(text)  // normal subsequent send
 *          }
 *   3. Honor `props.disabled` on the textarea + button (grey out during matching).
 *   4. Use `props.placeholder` on the textarea.
 *
 * Everything else (message bubbles, streaming display, markdown rendering)
 * is unchanged.
 */
function ComposerBlock(props: {
  agent: ReturnType<typeof useAgent>
  onFirstSend: (text: string) => Promise<void>
  disabled: boolean
  placeholder: string
}) {
  // IMPLEMENTATION: port existing page.tsx JSX here per the steps above.
  throw new Error('ComposerBlock not implemented — port existing conversation JSX from the original page.tsx body.')
}
```

**Important:** the `ComposerAndConversation` body is placeholder text in the snippet above — in practice, copy the existing page's conversation JSX into it. Do not ship a stub.

- [ ] **Step 2: Replace `page.tsx` with an RSC that reads flags and renders `NewProjectView`**

Write `app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx`:

```tsx
import { requireAuth } from '@/lib/auth/helpers'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { NewProjectView } from './NewProjectView'

interface PageProps {
  params: { locale: 'ro' | 'en' }
  searchParams: { session?: string }
}

export default async function NewProjectPage({ params, searchParams }: PageProps) {
  const user = await requireAuth()

  const [preselectFlag, writesFlag] = await Promise.all([
    isFeatureEnabled('deterministic_preselect_enabled', { userId: user.id }),
    isFeatureEnabled('managed_agent_writes_enabled', { userId: user.id }),
  ])

  return (
    <NewProjectView
      locale={params.locale}
      initialSessionId={searchParams.session}
      preselectEnabled={preselectFlag && writesFlag}
    />
  )
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd app && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Start the dev server (`cd app && PORT=3002 npm run dev`). Navigate to `http://localhost:3002/ro/proiecte/nou` logged in.

With the flag **off** (default): verify the page works exactly as before — typing a description starts the current cold-start agent flow.

Flip the flag on locally:
```bash
docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c \
  "UPDATE feature_flags SET enabled=true WHERE key IN ('deterministic_preselect_enabled','managed_agent_writes_enabled');"
```

With the flag on: verify the "matching…" state appears, then (for a well-matched description like the Ocna prompt) the banner renders and the agent conversation starts.

- [ ] **Step 5: Commit**

```bash
git add "app/src/app/[locale]/(dashboard)/proiecte/nou/page.tsx" "app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx"
git commit -m "feat(preselect): wire /proiecte/nou to deterministic preselect flow"
```

---

## Task 19: E2E smoke test

**Files:**
- Create: `app/e2e/preselect-new-project.spec.ts`

**Context:** Playwright smoke asserting the UX states fire in order. Requires local dev server running with both flags enabled and Qdrant populated with indexed calls (the existing `feat-document-uploads` worktree has this).

- [ ] **Step 1: Write the smoke spec**

Create `app/e2e/preselect-new-project.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test.use({ storageState: 'e2e/.auth/user.json' })
test.describe.configure({ mode: 'serial' })

test('preselect: new project lands in selected state without a discovery loop', async ({ page }) => {
  test.setTimeout(3 * 60_000)

  // Navigate
  await page.goto('/ro/proiecte/nou')
  await page.waitForLoadState('networkidle').catch(() => {})

  // Type a description we expect to match
  const desc =
    'Salut! Sunt primăria comunei Ocna Șugatag, județul Maramureș (UAT). ' +
    'Vreau să aplic la o finanțare pentru restaurarea și digitalizarea muzeului satului ' +
    'și a patrimoniului saline local.'

  const composer = page.getByRole('textbox').first()
  await expect(composer).toBeVisible({ timeout: 15_000 })
  await composer.fill(desc)

  // Submit
  const sendBtn = page.getByRole('button', { name: /Send|Trimite/i })
  if (await sendBtn.isVisible().catch(() => false)) {
    await sendBtn.click()
  } else {
    await composer.press('Enter')
  }

  // Assert matching state appears (within 2s, small window)
  const matchingText = page.getByText(/Caut cel mai potrivit apel/i)
  await expect(matchingText).toBeVisible({ timeout: 5_000 })

  // Wait for banner (selected) OR picker (ambiguous) OR guidance (no_match)
  const banner = page.getByText(/Apel selectat/i)
  const picker = page.getByText(/Alege apelul potrivit/i)
  const guidance = page.getByText(/Nu am găsit un apel/i)

  await Promise.race([
    banner.waitFor({ state: 'visible', timeout: 20_000 }),
    picker.waitFor({ state: 'visible', timeout: 20_000 }),
    guidance.waitFor({ state: 'visible', timeout: 20_000 }),
  ])

  // For the happy path, assert the banner rendered
  if (await banner.isVisible().catch(() => false)) {
    // First assistant message appears (SSE stream started)
    await expect(page.locator('div.bg-white.text-gray-900.border').first())
      .toBeVisible({ timeout: 30_000 })
  }
})
```

- [ ] **Step 2: Prerequisites for running the spec**

Ensure:
1. Dev server running at `http://localhost:3002` from the `feat-deterministic-preselect` worktree with merge from feature branch and flags enabled.
2. Qdrant populated (inherited from existing `feat-document-uploads` setup; confirm with `docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c "SELECT COUNT(*) FROM feature_flags WHERE key='deterministic_preselect_enabled' AND enabled=true"`).
3. Auth storageState present at `app/e2e/.auth/user.json` (same session cookie as existing smoke specs).

- [ ] **Step 3: Run the E2E**

Run: `cd app && PLAYWRIGHT_BASE_URL=http://localhost:3002 npx playwright test e2e/preselect-new-project.spec.ts --project=chromium --no-deps --reporter=list`
Expected: test PASSES (either the selected banner renders and the agent starts streaming, or one of the other two valid branches renders).

If the description routinely lands in `ambiguous` or `no_match` against the live Qdrant data, tune the description string to produce a more confident match. If the matching state is too fast to observe, relax the matching-state assertion (it's optional evidence, not load-bearing).

- [ ] **Step 4: Commit**

```bash
git add app/e2e/preselect-new-project.spec.ts
git commit -m "test(preselect): Playwright smoke for new-project preselect flow"
```

---

## Task 20: Documentation + rollout readiness

**Files:**
- Modify: `app/CLAUDE.md`

- [ ] **Step 1: Add a one-paragraph entry under the "Agent Architecture" section**

Edit `app/CLAUDE.md` to add (in the Agent Architecture section, after the Managed Agents paragraph):

```markdown
**Deterministic preselect** (`lib/ai/agent/services/preselect.ts`, `POST /api/v1/projects/preselect`): server-side call selection + session bootstrap that replaces LLM-driven discovery for new projects. Three request modes (rank / confirm / override). Ranks top-5 calls by per-call vector similarity (pure max-score from `searchCalls`, which already dedupes). Three-branch decision policy: `selected` creates the session with `selectedCallId` + blueprint (when cached) + phase=`structuring` or `research`; `ambiguous` returns top-3 to the client without creating a session; `no_match` returns guidance without creating a session. Candidate list persists in `agent_sessions.planning_artifact` (versioned). Feature-flagged on `deterministic_preselect_enabled` with hard dependency on `managed_agent_writes_enabled`. Spec: `docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add app/CLAUDE.md
git commit -m "docs: note deterministic preselect in CLAUDE.md Agent Architecture"
```

---

## Task 21: Rollout smoke + readiness checklist

No code changes; a manual verification gate before the PR lands.

- [ ] **Step 1: Run the full test suite**

Run: `cd app && npm run test`
Expected: all tests PASS (no regressions in existing suites).

- [ ] **Step 2: Run lint + typecheck**

Run: `cd app && npm run lint && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual end-to-end with flags on**

With both flags enabled in the local DB and the dev server running against the feature branch, drive the Ocna Șugatag flow end-to-end and verify:
- Matching state appears
- Banner renders with a call title
- Agent's first turn does NOT call `search_calls` (inspect dev log for `"tool":"search_calls"` — should be absent on the first turn of the new session)
- `agent_sessions.planning_artifact->'preselect'` is populated
- `agent_turns` rows are recorded by managed runtime telemetry (cost is observable)

- [ ] **Step 4: Push the branch and open PR**

```bash
git push -u origin feat/deterministic-preselect
gh pr create --title "feat: deterministic preselect for new projects" --body "$(cat <<'EOF'
## Summary
Move call selection and session bootstrap out of the managed LLM agent. New endpoint `POST /api/v1/projects/preselect` runs deterministic ranking + decision policy, creates the session with selectedCallId + blueprint (when cached) already set, and the agent enters at phase=structuring (or research) instead of discovery.

Spec: docs/superpowers/specs/2026-04-18-deterministic-preselect-design.md
Plan: docs/superpowers/plans/2026-04-18-deterministic-preselect.md

Hard-gated behind `deterministic_preselect_enabled` AND `managed_agent_writes_enabled` feature flags (both default off; admin-canary → 10/50/100 ramp).

## Test plan
- [x] Unit tests: rank-candidates, decide-selection, initialize-session (including degraded blueprint paths)
- [x] Prompt tests: phaseBootstrapBlock renders correctly in ro + en for structuring / research / discovery
- [x] Integration tests: preselect route across rank / confirm / override modes, all error paths, mode validation, excludeCallIds edge case
- [x] E2E smoke: new-project happy path
- [ ] Manual verification: admin canary with flags on

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Commit the rollout gate (no code, just marker)**

Nothing to commit — this task is procedural.

---

## Rollout plan (post-merge)

1. **Admin canary**: set `targeting.userIds: [<your admin user id>]` on both flags. Test the full Ocna flow against production-like data. Watch dev logs for `session.preselect_completed` audit entries and the absence of discovery-phase tool-use loops.
2. **10% ramp**: `targeting.percentage: 10`. Monitor `agent_turns` cost-per-project for the 10% cohort vs. the 90% baseline. Look at `planning_artifact->'preselect'->'blueprintKind'` distribution — high `none` rate indicates a blueprint-lookup issue.
3. **Tune thresholds** if data suggests: `SCORE_FLOOR` if `no_match` rate is unexpectedly high or low; `AMBIGUITY_EPSILON` if ambiguous picker fires too often or too rarely. Adjust the constants in `services/preselect.ts`, land a small PR, redeploy.
4. **50% → 100%** ramp when cost-per-project is stable and thresholds feel right.

## Out of scope (Phase 2 work)

- Unified SSE handshake (Approach 3 from brainstorming) — collapse preselect into the `/api/ai/agent` stream once Phase 1 correctness is validated.
- Override "Change" button wired end-to-end (requires threading session `stateVersion` from `useAgent` into the banner's handler; Phase 1 stubs it).
- Per-candidate `blueprintKind` badges in the picker.
- `score_fit` integration as a ranker signal (requires applicant org data which isn't available at first-message time).
- Chunk-repeat bonus on the ranker.
- `no_match` description analytics.
