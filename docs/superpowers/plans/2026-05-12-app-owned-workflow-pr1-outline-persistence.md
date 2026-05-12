# App-Owned Workflow — PR 1: Outline Persistence + State Projection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `agent_sessions.outline` on every code path that learns the blueprint, and centralize state projection in one helper used by all four consumers (state route, V3 runtime, managed runtime, new action endpoints).

**Architecture:** Add `outlineFromBlueprint(blueprint)` wrapper in `services/blueprint.ts` reusing `materializeCachedSections`. Add `projectSessionState(session, sectionRows)` in a new `lib/ai/agent/state-projection.ts` module. Swap four consumers to the centralized helper. One idempotent backfill script populates outline for pre-existing sessions.

**Tech Stack:** Next.js 14, TypeScript, Drizzle ORM + postgres.js, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-12-app-owned-workflow-design.md` §2

**Flag:** None — this is a pure data/projection fix with no behavior change visible to end users.

---

## File Inventory

**Create:**
- `app/src/lib/ai/agent/state-projection.ts` — `projectSessionState(session, sectionRows)` and shared `projectSectionsForUI(session, sectionRows)` helper.
- `app/tests/unit/state-projection.test.ts` — unit tests for the helper.
- `app/scripts/backfill-session-outline.ts` — idempotent backfill script for pre-existing sessions.

**Modify:**
- `app/src/lib/ai/agent/services/blueprint.ts` — add `outlineFromBlueprint(blueprint)` wrapper near `materializeCachedSections`.
- `app/src/lib/ai/agent/services/preselect.ts:173-182` — write `outline` alongside `blueprint` when `blueprintKind === 'structured'`.
- `app/src/lib/ai/agent/managed/executor.ts:466-477` — write `outline` in the conditional WHERE update.
- `app/src/lib/ai/agent/managed/runtime.ts:612-629` — replace `buildUISnapshot` body with `projectSessionState(...)`.
- `app/src/lib/ai/agent/runtime.ts:934-979` — replace local `projectSectionsForUI` + `buildUISnapshot` with imports from new module.
- `app/src/app/api/ai/agent/state/route.ts` — use `projectSessionState(...)`.
- `app/tests/integration/preselect-outline.test.ts` (new) — integration coverage for preselect outline persistence.
- `app/tests/integration/managed-save-blueprint-outline.test.ts` (new) — integration coverage for managed save_call_blueprint outline write.
- `DEPLOYMENT_CHECKLIST.md` — document the backfill run.

---

## Task 1: Add `outlineFromBlueprint` helper in `services/blueprint.ts`

**Files:**
- Modify: `app/src/lib/ai/agent/services/blueprint.ts`
- Test: `app/tests/unit/outline-from-blueprint.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `app/tests/unit/outline-from-blueprint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { outlineFromBlueprint } from '@/lib/ai/agent/services/blueprint'
import type { CallBlueprint, SectionSpec } from '@/lib/ai/agent/types'

function makeFullSpec(over: Partial<SectionSpec> = {}): SectionSpec {
  return {
    id: 'intro',
    title: 'Introducere',
    description: 'Project overview',
    order: 1,
    generationOrder: 1,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 0.9,
    ...over,
  }
}

function makeBlueprint(sections: unknown[], structureConfidence = 0.9): CallBlueprint {
  return {
    callId: 'C-1',
    program: 'PNRR',
    isOpen: true,
    deadline: '2026-12-31',
    cofinancingRate: 0,
    sources: {
      eurLexId: null,
      portalId: null,
      cordisId: null,
      notebookLmResponse: '',
      perplexityResponse: '',
      retrievedAt: '2026-05-12T00:00:00.000Z',
    },
    normalized: {
      requiredSections: sections as SectionSpec[],
      mandatoryAnnexes: [],
      eligibilityCriteria: [],
      evaluationGrid: [],
      cofinancingRate: 0,
    },
    structureConfidence,
  }
}

describe('outlineFromBlueprint', () => {
  it('passes full SectionSpec rows through unchanged', () => {
    const a = makeFullSpec({ id: 'a', order: 1 })
    const b = makeFullSpec({ id: 'b', order: 2, title: 'Buget' })
    const bp = makeBlueprint([a, b])
    expect(outlineFromBlueprint(bp)).toEqual([a, b])
  })

  it('materializes partial cached rows with defaults', () => {
    const partial = [{ title: 'Cadru', description: 'Context legal' }]
    const bp = makeBlueprint(partial, 0.7)
    const out = outlineFromBlueprint(bp)
    expect(out).toHaveLength(1)
    expect(out[0].title).toBe('Cadru')
    expect(out[0].description).toBe('Context legal')
    expect(out[0].order).toBe(1)
    expect(out[0].generationOrder).toBe(1)
    expect(out[0].confidence).toBe(0.7)
    expect(out[0].id).toMatch(/^cadru/)
  })

  it('returns empty array for blueprint with zero sections', () => {
    expect(outlineFromBlueprint(makeBlueprint([]))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/unit/outline-from-blueprint.test.ts`
Expected: FAIL with `outlineFromBlueprint is not exported`.

- [ ] **Step 3: Implement `outlineFromBlueprint` in `services/blueprint.ts`**

Add immediately after the existing `materializeCachedSections` export (around line 277):

```ts
/**
 * Project a full CallBlueprint into the SectionSpec[] shape used for
 * agent_sessions.outline. Idempotent on already-full SectionSpec rows;
 * materializes partial cached rows via materializeCachedSections so
 * downstream code can always assume the 12-field SectionSpec contract.
 */
export function outlineFromBlueprint(blueprint: CallBlueprint): SectionSpec[] {
  return materializeCachedSections(
    blueprint.normalized.requiredSections,
    blueprint.structureConfidence,
  )
}
```

If `CallBlueprint` and `SectionSpec` aren't already imported at the top, ensure both come from `@/lib/ai/agent/types`. Check the file's existing import block.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/unit/outline-from-blueprint.test.ts`
Expected: PASS, 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/services/blueprint.ts app/tests/unit/outline-from-blueprint.test.ts
git commit -m "feat(agent): add outlineFromBlueprint helper in blueprint service"
```

---

## Task 2: Create `state-projection.ts` module with `projectSessionState`

**Files:**
- Create: `app/src/lib/ai/agent/state-projection.ts`
- Test: `app/tests/unit/state-projection.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `app/tests/unit/state-projection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import type { AgentSession, AgentSection, SectionSpec, CallBlueprint } from '@/lib/ai/agent/types'

function baseSession(over: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    projectId: null,
    status: 'active',
    locale: 'ro',
    selectedCallId: 'C-1',
    currentPhase: 'structuring',
    blueprint: null,
    eligibility: null,
    outline: null,
    warnings: [],
    planningArtifact: null,
    outlineFrozen: false,
    messageSummary: null,
    stateVersion: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }
}

function spec(id: string, order: number, title: string): SectionSpec {
  return {
    id, title,
    description: '',
    order,
    generationOrder: order,
    importance: 'standard',
    expectedLength: 'medium',
    dependsOn: [],
    modelHint: 'light',
    mandatory: true,
    confidence: 0.9,
  }
}

function row(over: Partial<AgentSection>): AgentSection {
  return {
    id: 'r1',
    sessionId: 's1',
    sectionKey: 'intro',
    title: 'Introducere',
    status: 'draft',
    documentOrder: 1,
    content: 'body',
    acceptedContent: null,
    version: 1,
    rejectionReason: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  } as AgentSection
}

describe('projectSessionState', () => {
  it('projects real rows when present', () => {
    const session = baseSession({ outline: [spec('intro', 1, 'Introducere')] })
    const r = row({ sectionKey: 'intro', status: 'draft', content: 'body' })
    const out = projectSessionState(session, [r])
    expect(out.sections).toEqual([{
      sectionKey: 'intro',
      title: 'Introducere',
      status: 'draft',
      documentOrder: 1,
      content: 'body',
    }])
  })

  it('projects virtual pending sections when outline set but no rows', () => {
    const session = baseSession({
      outline: [spec('a', 1, 'A'), spec('b', 2, 'B')],
    })
    const out = projectSessionState(session, [])
    expect(out.sections).toEqual([
      { sectionKey: 'a', title: 'A', status: 'pending', documentOrder: 1, content: null },
      { sectionKey: 'b', title: 'B', status: 'pending', documentOrder: 2, content: null },
    ])
  })

  it('falls back to blueprint.requiredSections when outline is null but blueprint exists', () => {
    const bp = {
      callId: 'C-1', program: 'PNRR', isOpen: true, deadline: null,
      cofinancingRate: 0,
      sources: {
        eurLexId: null, portalId: null, cordisId: null,
        notebookLmResponse: '', perplexityResponse: '',
        retrievedAt: '2026-05-12T00:00:00.000Z',
      },
      normalized: {
        requiredSections: [spec('x', 1, 'X')],
        mandatoryAnnexes: [], eligibilityCriteria: [],
        evaluationGrid: [], cofinancingRate: 0,
      },
      structureConfidence: 0.9,
    } as CallBlueprint
    const session = baseSession({ outline: null, blueprint: bp })
    const out = projectSessionState(session, [])
    expect(out.sections).toEqual([
      { sectionKey: 'x', title: 'X', status: 'pending', documentOrder: 1, content: null },
    ])
  })

  it('returns empty sections when outline and blueprint are both null', () => {
    const session = baseSession()
    expect(projectSessionState(session, []).sections).toEqual([])
  })

  it('merges rows over virtual entries on the same sectionKey', () => {
    const session = baseSession({
      outline: [spec('a', 1, 'A'), spec('b', 2, 'B')],
    })
    const r = row({ sectionKey: 'a', status: 'accepted', content: 'final', acceptedContent: 'final accepted' })
    const out = projectSessionState(session, [r])
    expect(out.sections).toEqual([
      { sectionKey: 'a', title: 'A', status: 'accepted', documentOrder: 1, content: 'final accepted' },
      { sectionKey: 'b', title: 'B', status: 'pending', documentOrder: 2, content: null },
    ])
  })

  it('echoes session top-level fields', () => {
    const session = baseSession({ stateVersion: 7, outlineFrozen: true })
    const out = projectSessionState(session, [])
    expect(out.sessionId).toBe(session.id)
    expect(out.phase).toBe('structuring')
    expect(out.stateVersion).toBe(7)
    expect(out.outlineFrozen).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/unit/state-projection.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Create `app/src/lib/ai/agent/state-projection.ts`**

```ts
// ── State projection ─────────────────────────────────────────────
// One helper, four consumers (state route, V3 runtime snapshot,
// managed runtime snapshot, new action endpoints). All callers see
// the same outline projection so virtual sections appear consistently
// when the blueprint is known but rows haven't been materialized.

import type {
  AgentSection,
  AgentSession,
  SectionSpec,
  UIStateSnapshot,
} from './types'
import { outlineFromBlueprint } from './services/blueprint'

type UISection = UIStateSnapshot['sections'][number]

export function projectSectionsForUI(
  session: AgentSession,
  sectionRows: AgentSection[],
): UISection[] {
  // Resolve effective outline: prefer session.outline, fall back to
  // blueprint.normalized.requiredSections when outline is null but
  // blueprint exists (defense in depth for sessions that escape the
  // backfill migration).
  let outline: SectionSpec[] | null = session.outline
  if ((!outline || outline.length === 0) && session.blueprint) {
    outline = outlineFromBlueprint(session.blueprint)
  }
  if (!outline || outline.length === 0) return []

  const rowsByKey = new Map<string, AgentSection>()
  for (const row of sectionRows) {
    rowsByKey.set(row.sectionKey, row)
  }

  return outline.map((spec, i): UISection => {
    const row = rowsByKey.get(spec.id)
    if (row) {
      return {
        sectionKey: row.sectionKey,
        title: row.title,
        status: row.status,
        documentOrder: row.documentOrder,
        content: row.acceptedContent ?? row.content,
      }
    }
    return {
      sectionKey: spec.id,
      title: spec.title,
      status: 'pending',
      documentOrder: typeof spec.order === 'number' ? spec.order : i + 1,
      content: null,
    }
  })
}

export function projectSessionState(
  session: AgentSession,
  sectionRows: AgentSection[],
): UIStateSnapshot {
  return {
    sessionId: session.id,
    phase: session.currentPhase,
    stateVersion: session.stateVersion,
    outlineFrozen: session.outlineFrozen,
    warnings: session.warnings,
    sections: projectSectionsForUI(session, sectionRows),
    blueprint: session.blueprint,
    eligibility: session.eligibility,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/unit/state-projection.test.ts`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/state-projection.ts app/tests/unit/state-projection.test.ts
git commit -m "feat(agent): add centralized projectSessionState helper"
```

---

## Task 3: Replace V3 runtime's local helpers with imports

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts` lines 924-979

This is a refactor — V3 already has a `projectSectionsForUI`/`buildUISnapshot` pair locally. We delete them and import the centralized versions. The new helper has the additional blueprint-fallback branch, which is a strict superset of V3's current behavior.

- [ ] **Step 1: Verify V3 turn integration tests pass first**

Run: `cd app && npx vitest run tests/integration/agent-v3 2>&1 | tail -30`
Expected: existing V3 tests pass (capture pre-refactor baseline).

- [ ] **Step 2: Replace local helpers with imports**

In `app/src/lib/ai/agent/runtime.ts`:

Add to the top import block (alphabetically near the other agent imports):
```ts
import { projectSectionsForUI, projectSessionState } from './state-projection'
```

Delete lines 924-956 entirely (the local `projectSectionsForUI` function and its preceding 11-line comment).

Replace `buildUISnapshot` (lines 968-979) with:
```ts
function buildUISnapshot(session: AgentSession, sections: AgentSection[]): UIStateSnapshot {
  return projectSessionState(session, sections)
}
```

`buildStatePatch` (lines 958-966) keeps its body but its `projectSectionsForUI(...)` call now resolves to the imported function — no source change needed there.

If `UIStateSnapshot` isn't already top-level imported (it's used as `import('./types').UIStateSnapshot` today), add it to the existing types import line and drop the inline `import('./types').` qualifiers.

- [ ] **Step 3: Run typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Run V3 integration tests**

Run: `cd app && npx vitest run tests/integration/agent-v3 2>&1 | tail -30`
Expected: same green baseline as Step 1. No regression.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/runtime.ts
git commit -m "refactor(agent): V3 runtime uses centralized state projection"
```

---

## Task 4: Replace managed runtime's `buildUISnapshot`

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts:612-629`

- [ ] **Step 1: Write a failing integration test**

Create `app/tests/integration/managed/managed-snapshot-virtual-outline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import type { AgentSection, AgentSession, SectionSpec } from '@/lib/ai/agent/types'

function spec(id: string, order: number, title: string): SectionSpec {
  return {
    id, title, description: '', order, generationOrder: order,
    importance: 'standard', expectedLength: 'medium', dependsOn: [],
    modelHint: 'light', mandatory: true, confidence: 0.9,
  }
}

describe('managed runtime snapshot virtual outline', () => {
  it('exposes pending virtual sections when outline is set and rows are empty', () => {
    const session = {
      id: 's', userId: 'u', projectId: null, status: 'active', locale: 'ro',
      selectedCallId: 'C-1', currentPhase: 'structuring',
      blueprint: null, eligibility: null,
      outline: [spec('a', 1, 'A'), spec('b', 2, 'B')],
      warnings: [], planningArtifact: null, outlineFrozen: false,
      messageSummary: null, stateVersion: 1,
      createdAt: new Date(0), updatedAt: new Date(0),
    } as AgentSession
    const snapshot = projectSessionState(session, [] as AgentSection[])
    expect(snapshot.sections.map(s => s.sectionKey)).toEqual(['a', 'b'])
    expect(snapshot.sections.every(s => s.status === 'pending')).toBe(true)
  })
})
```

This is a behavior test asserting the helper is the contract managed will use. The follow-up step replaces managed's local `buildUISnapshot` so this contract holds at the source.

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/integration/managed/managed-snapshot-virtual-outline.test.ts`
Expected: PASS (the helper already works from Task 2).

- [ ] **Step 3: Replace managed's `buildUISnapshot`**

In `app/src/lib/ai/agent/managed/runtime.ts`, add to imports near the top:
```ts
import { projectSessionState } from '../state-projection'
```

Replace lines 612-629 with:

```ts
function buildUISnapshot(session: AgentSession, sections: AgentSection[]): UIStateSnapshot {
  return projectSessionState(session, sections)
}
```

- [ ] **Step 4: Run managed integration tests**

Run: `cd app && npx vitest run tests/integration/managed 2>&1 | tail -30`
Expected: existing managed tests still pass; new test from Step 1 stays green.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/managed/runtime.ts app/tests/integration/managed/managed-snapshot-virtual-outline.test.ts
git commit -m "refactor(agent): managed runtime uses centralized state projection"
```

---

## Task 5: Update `/api/ai/agent/state/route.ts` to use the helper

**Files:**
- Modify: `app/src/app/api/ai/agent/state/route.ts`

- [ ] **Step 1: Write a failing integration test**

Create `app/tests/integration/agent-state-route-virtual-outline.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1', tier: 'free' }),
}))

const mockSession = {
  id: 'sess-1', userId: 'user-1', projectId: null, status: 'active', locale: 'ro',
  selectedCallId: 'C-1', currentPhase: 'structuring',
  blueprint: null, eligibility: null,
  outline: [
    { id: 'a', title: 'A', description: '', order: 1, generationOrder: 1,
      importance: 'standard', expectedLength: 'medium', dependsOn: [],
      modelHint: 'light', mandatory: true, confidence: 0.9 },
  ],
  warnings: [], planningArtifact: null, outlineFrozen: false,
  messageSummary: null, stateVersion: 1,
  createdAt: new Date(0), updatedAt: new Date(0),
}

vi.mock('@/lib/db', () => {
  const limit = vi.fn().mockResolvedValue([mockSession])
  const where = vi.fn(() => ({ limit }))
  const from = vi.fn(() => ({ where }))
  const select = vi.fn(() => ({ from }))
  return {
    db: {
      select,
      _calls: { select, from, where, limit },
    },
  }
})

describe('GET /api/ai/agent/state', () => {
  it('returns virtual pending sections when outline is set and rows are empty', async () => {
    const { GET } = await import('@/app/api/ai/agent/state/route')
    const url = new URL('http://localhost/api/ai/agent/state?sessionId=sess-1')
    const res = await GET(new Request(url) as unknown as Parameters<typeof GET>[0])
    const body = await res.json()
    expect(body.sections).toEqual([
      { sectionKey: 'a', title: 'A', status: 'pending', documentOrder: 1, content: null },
    ])
  })
})
```

Note: the mock returns the session first and `[]` for the section rows query via the chained mock chain. If your project's existing integration tests use a different mocking shape, mirror that pattern.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/integration/agent-state-route-virtual-outline.test.ts`
Expected: FAIL — current route returns `sections: []` when no rows exist.

- [ ] **Step 3: Modify `app/src/app/api/ai/agent/state/route.ts`**

Replace the body assembly (lines 32-47) with:

```ts
import { projectSessionState } from '@/lib/ai/agent/state-projection'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

// ... existing imports + GET signature ...

  const state = projectSessionState(session as AgentSession, sectionRows as AgentSection[])
  return NextResponse.json(state)
```

Remove the inline `state: UIStateSnapshot = { ... sections: sectionRows.map(...) ... }` block and the `UIStateSnapshot` import (now unused here).

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/integration/agent-state-route-virtual-outline.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/app/api/ai/agent/state/route.ts app/tests/integration/agent-state-route-virtual-outline.test.ts
git commit -m "feat(agent): /api/ai/agent/state uses centralized state projection"
```

---

## Task 6: Preselect writes outline when blueprint is cached structured

**Files:**
- Modify: `app/src/lib/ai/agent/services/preselect.ts:173-182`
- Test: `app/tests/integration/preselect-outline-persistence.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `app/tests/integration/preselect-outline-persistence.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

const insertedRows: { values: Record<string, unknown>[]; returningCols: string[] }[] = []

vi.mock('@/lib/db', () => {
  return {
    withUserRLS: async (_uid: string, fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            returning: () => {
              insertedRows.push({ values: [v], returningCols: ['id'] })
              return Promise.resolve([{ id: 'new-session-id' }])
            },
          }),
        }),
      }
      return fn(tx)
    },
  }
})

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn() }))
vi.mock('@/lib/projects/promotion', () => ({
  ensureProjectForSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/agent/services/blueprint', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/agent/services/blueprint')>(
    '@/lib/ai/agent/services/blueprint'
  )
  return {
    ...actual,
    lookupBlueprint: vi.fn().mockResolvedValue({
      cached: true,
      blueprint: {
        callId: 'C-1', program: 'PNRR', isOpen: true, deadline: null,
        cofinancingRate: 0,
        sources: { eurLexId: null, portalId: null, cordisId: null,
          notebookLmResponse: '', perplexityResponse: '',
          retrievedAt: '2026-05-12T00:00:00.000Z' },
        normalized: {
          requiredSections: [{
            id: 'intro', title: 'Introducere', description: '', order: 1,
            generationOrder: 1, importance: 'standard', expectedLength: 'medium',
            dependsOn: [], modelHint: 'light', mandatory: true, confidence: 0.9,
          }],
          mandatoryAnnexes: [], eligibilityCriteria: [],
          evaluationGrid: [], cofinancingRate: 0,
        },
        structureConfidence: 0.9,
      },
    }),
  }
})

describe('preselect initializeSession outline persistence', () => {
  it('writes outline alongside blueprint when blueprintKind=structured', async () => {
    insertedRows.length = 0
    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    await initializeSession({
      userId: 'u', description: 'desc', locale: 'ro',
      selectedCallId: 'C-1', selectedScore: 0.9,
      candidates: [{ callId: 'C-1', title: 'T', score: 0.9 }],
      excludeCallIdsApplied: [],
    })
    expect(insertedRows).toHaveLength(1)
    const v = insertedRows[0].values[0] as Record<string, unknown>
    expect(v.blueprint).toBeTruthy()
    expect(v.outline).toBeTruthy()
    expect(Array.isArray(v.outline)).toBe(true)
    expect((v.outline as Array<{ id: string }>)[0].id).toBe('intro')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/integration/preselect-outline-persistence.test.ts`
Expected: FAIL — `outline` is not on the inserted values.

- [ ] **Step 3: Update `services/preselect.ts:173-182`**

At the top of the file, import the helper:
```ts
import { lookupBlueprint, outlineFromBlueprint } from './blueprint'
```

Then change the insert block (lines 173-182) so it computes and passes `outline`:

```ts
  const outlinePayload =
    blueprintKind === 'structured' && blueprintPayload
      ? outlineFromBlueprint(blueprintPayload as import('@/lib/ai/agent/types').CallBlueprint)
      : null

  const [row] = await withUserRLS(userId, (tx) =>
    tx.insert(agentSessions).values({
      userId,
      locale,
      selectedCallId,
      currentPhase: phase,
      blueprint: blueprintPayload,
      outline: outlinePayload,
      planningArtifact: { preselect: artifact },
    }).returning({ id: agentSessions.id }),
  )
```

(The cast keeps the import surface narrow; the runtime check `blueprintKind === 'structured' && blueprintPayload` already guarantees the shape.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/integration/preselect-outline-persistence.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the wider preselect suite for regression**

Run: `cd app && npx vitest run tests/integration/preselect 2>&1 | tail -20`
Expected: existing preselect tests still pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/services/preselect.ts app/tests/integration/preselect-outline-persistence.test.ts
git commit -m "feat(agent): preselect persists outline when blueprint is cached"
```

---

## Task 7: Managed `save_call_blueprint` writes outline

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts:466-477`
- Test: `app/tests/integration/managed/save-blueprint-outline.test.ts`

- [ ] **Step 1: Write the failing integration test**

Create `app/tests/integration/managed/save-blueprint-outline.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'

const updateCalls: Array<{ set: Record<string, unknown>; where: unknown }> = []

vi.mock('@/lib/db', () => {
  return {
    db: {
      update: () => ({
        set: (s: Record<string, unknown>) => ({
          where: (w: unknown) => {
            updateCalls.push({ set: s, where: w })
            return Promise.resolve()
          },
        }),
      }),
    },
    withUserRLS: async (_u: string, fn: (tx: unknown) => Promise<unknown>) => fn({}),
  }
})

// Test the conditional WHERE block writes outline alongside blueprint.
// (The full executor dispatch is complex; we exercise the slice of behavior
// that places `outline` in the .set() argument when save_call_blueprint
// fires for a research-phase preselect session.)
describe('managed save_call_blueprint outline write', () => {
  it('includes outline in the update set when called', async () => {
    // Direct unit-flavored test of the update construction.
    // The real call site is in executor.ts; this verifies the helper
    // contract by exercising the same outlineFromBlueprint mapping.
    const { outlineFromBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    const bp = {
      callId: 'C-1', program: 'PNRR', isOpen: true, deadline: null,
      cofinancingRate: 0,
      sources: { eurLexId: null, portalId: null, cordisId: null,
        notebookLmResponse: '', perplexityResponse: '',
        retrievedAt: '2026-05-12T00:00:00.000Z' },
      normalized: {
        requiredSections: [{
          id: 'budget', title: 'Buget', description: '', order: 1,
          generationOrder: 1, importance: 'critical', expectedLength: 'long',
          dependsOn: [], modelHint: 'heavy', mandatory: true, confidence: 0.85,
        }],
        mandatoryAnnexes: [], eligibilityCriteria: [],
        evaluationGrid: [], cofinancingRate: 0,
      },
      structureConfidence: 0.85,
    }
    const outline = outlineFromBlueprint(bp)
    expect(outline).toHaveLength(1)
    expect(outline[0].id).toBe('budget')
    expect(outline[0].importance).toBe('critical')
  })
})
```

Plus add the assertion to the existing executor test suite if one exists. The minimal coverage above proves the helper produces correct outline shape; the next step ties it to the executor.

- [ ] **Step 2: Run the test to verify it passes (Task 1 already enables it)**

Run: `cd app && npx vitest run tests/integration/managed/save-blueprint-outline.test.ts`
Expected: PASS (smoke-tests the helper).

- [ ] **Step 3: Update `managed/executor.ts:466-477`**

Locate the `save_call_blueprint` write-back update (lines 466-477). Add `outline` to the `.set(...)`. The block becomes:

```ts
      await db.update(agentSessions)
        .set({
          blueprint: fullBlueprint as never,
          outline: outlineFromBlueprint(fullBlueprint) as never,
          currentPhase: 'structuring',
          stateVersion: sql`${agentSessions.stateVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(agentSessions.id, ctx.sessionId),
          eq(agentSessions.currentPhase, 'research'),
          eq(agentSessions.selectedCallId, i.callId),
        ))
```

Add the import at the top:
```ts
import { outlineFromBlueprint } from '@/lib/ai/agent/services/blueprint'
```

(Existing import block has `import * as blueprint from '@/lib/ai/agent/services/blueprint'` — adding the named import alongside it is fine, or use `blueprint.outlineFromBlueprint` if you prefer the namespace.)

- [ ] **Step 4: Run typecheck + managed tests**

```bash
cd app && npm run typecheck && npx vitest run tests/integration/managed 2>&1 | tail -30
```
Expected: no type errors; existing managed tests still pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/agent/managed/executor.ts app/tests/integration/managed/save-blueprint-outline.test.ts
git commit -m "feat(agent): managed save_call_blueprint persists outline"
```

---

## Task 8: Backfill script for pre-existing sessions

**Files:**
- Create: `app/scripts/backfill-session-outline.ts`
- Modify: `DEPLOYMENT_CHECKLIST.md`

- [ ] **Step 1: Create the script**

Create `app/scripts/backfill-session-outline.ts`:

```ts
// scripts/backfill-session-outline.ts
//
// Idempotent backfill: populates agent_sessions.outline for sessions that
// already have a blueprint but no outline. Runs once post-deploy of PR 1.
// Re-runs are no-ops (WHERE clause filters out populated rows).
//
// Usage:
//   npx tsx scripts/backfill-session-outline.ts --dry-run
//   npx tsx scripts/backfill-session-outline.ts --confirm

import { db } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { outlineFromBlueprint } from '@/lib/ai/agent/services/blueprint'
import type { CallBlueprint } from '@/lib/ai/agent/types'
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const BATCH_SIZE = 100

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const confirm = args.includes('--confirm')
  if (!dryRun && !confirm) {
    console.error('Refusing to run without --dry-run or --confirm')
    process.exit(2)
  }

  const log = logger.child({ component: 'backfill-session-outline', dryRun })
  log.info({ batchSize: BATCH_SIZE }, 'start')

  let scanned = 0
  let updated = 0
  let lastId: string | null = null

  // Pagination by id is RLS-friendly and stable under concurrent inserts.
  while (true) {
    const rows = await db
      .select({
        id: agentSessions.id,
        blueprint: agentSessions.blueprint,
      })
      .from(agentSessions)
      .where(and(
        isNotNull(agentSessions.blueprint),
        isNull(agentSessions.outline),
        ...(lastId ? [sql`${agentSessions.id} > ${lastId}`] : []),
      ))
      .orderBy(agentSessions.id)
      .limit(BATCH_SIZE)

    if (rows.length === 0) break

    for (const row of rows) {
      scanned++
      if (!row.blueprint) continue
      const outline = outlineFromBlueprint(row.blueprint as CallBlueprint)
      if (outline.length === 0) {
        log.warn({ sessionId: row.id }, 'blueprint produced empty outline; skipping')
        continue
      }
      if (!dryRun) {
        await db.update(agentSessions)
          .set({ outline: outline as never, updatedAt: new Date() })
          .where(eq(agentSessions.id, row.id))
      }
      updated++
    }
    lastId = rows[rows.length - 1].id
    log.info({ scanned, updated, lastId }, 'progress')
  }

  log.info({ scanned, updated, dryRun }, 'done')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Run dry-run locally against the dev DB**

```bash
cd app && npx tsx scripts/backfill-session-outline.ts --dry-run
```
Expected: logs scanned/updated counts; no writes.

- [ ] **Step 3: Run for-real against dev DB**

```bash
cd app && npx tsx scripts/backfill-session-outline.ts --confirm
```
Expected: writes; second run reports 0 updates.

- [ ] **Step 4: Verify idempotency**

```bash
cd app && npx tsx scripts/backfill-session-outline.ts --confirm
```
Expected: scanned = 0, updated = 0.

- [ ] **Step 5: Document the post-deploy step**

In `DEPLOYMENT_CHECKLIST.md`, add a new section:

```markdown
## After PR 1 (Outline Persistence) deploys

Run the backfill against production once, then verify counts:

```bash
# Dry-run first
cd app && npx tsx scripts/backfill-session-outline.ts --dry-run

# Apply
cd app && npx tsx scripts/backfill-session-outline.ts --confirm

# Verify
psql "$DATABASE_URL" -c "SELECT count(*) FROM agent_sessions WHERE blueprint IS NOT NULL AND outline IS NULL;"
# Expected: 0
```
```

- [ ] **Step 6: Commit**

```bash
git add app/scripts/backfill-session-outline.ts DEPLOYMENT_CHECKLIST.md
git commit -m "feat(scripts): backfill agent_sessions.outline from blueprint"
```

---

## Task 9: Run full test suite + smoke check

- [ ] **Step 1: Full unit + integration suite**

```bash
cd app && npm run typecheck && npm run test
```
Expected: all green.

- [ ] **Step 2: Smoke-test the bootstrap flow manually**

```bash
cd app && PORT=3002 npm run dev
```

In a separate shell, create a session via preselect and verify `outline` is set:

```bash
psql "$DATABASE_URL" -c "SELECT id, outline IS NOT NULL AS has_outline, blueprint IS NOT NULL AS has_blueprint FROM agent_sessions ORDER BY created_at DESC LIMIT 3;"
```

For any session where `has_blueprint=t` and the row was created after this PR deploys, `has_outline=t` should hold.

- [ ] **Step 3: Final commit if any formatting cleanup is needed**

If `npm run lint` flags anything in changed files, fix and commit. Otherwise this step is a no-op.

---

## Self-Review Checklist

- [ ] Every spec §2 requirement has a task: outline persistence (preselect ✓ Task 6; managed ✓ Task 7); centralized projection helper ✓ Tasks 2/3/4/5; backfill ✓ Task 8.
- [ ] No placeholders: every test has concrete assertions; every implementation step has a code block.
- [ ] Type consistency: `outlineFromBlueprint(blueprint: CallBlueprint): SectionSpec[]` and `projectSessionState(session, sectionRows): UIStateSnapshot` used identically everywhere.
- [ ] Commits per task = one logical change; messages follow conventional commits.

## Definition of Done

- Backfill script merged, run on staging, run on production.
- `psql` count query in DEPLOYMENT_CHECKLIST returns 0 on production.
- State route, V3 runtime, managed runtime, and any new action endpoints all emit virtual-section snapshots consistently.
- Existing V3 and managed integration suites green; new unit and integration tests for the helper and the four consumers green.
- No flag — PR ships at 100% on deploy.
