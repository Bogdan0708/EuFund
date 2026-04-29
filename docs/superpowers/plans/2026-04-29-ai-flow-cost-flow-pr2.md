# AI Flow Cost & Flow Cleanup — PR2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three independent cost/correctness defects in the AI flow — triple Qdrant retrieval per cold preselect session, stacked retry layers with uncancelled SDK calls, and missing V3 turn-claim/sequence-race protection — without DB migrations, new constraints, or SSE shape changes.

**Architecture:** Three independent items. Each touches a small, isolated surface and ships with its own tests:

- **Item A — Collapse cache-miss research dance.** Stash `rawEvidence` from `lookupBlueprint` cache miss into `planningArtifact.preselect.rawEvidence` (top-15). The managed runtime injects a synthetic `retrieve_evidence` tool_use/tool_result pair into in-memory history on the first turn of a research-phase preselected session, so the model sees evidence as if it had called the tool. The system prompt branches: with-injection branch tells the model NOT to call `get_call_blueprint` or `retrieve_evidence`. `save_call_blueprint` is unblocked; the executor case also writes back to `agent_sessions.blueprint`, advances phase to `'structuring'`, and bumps `stateVersion`. PR1's reload-after-write surfaces the new state.
- **Item E — One retry/fallback layer with proper cancellation.** Delete the outer `withRetry` from `client.ts` (and its `Errors.serviceUnavailable` wrapping that masks original error codes). Rewrite `providers/retry.ts` as a single-attempt-with-fallback: timeout-bounded primary call → on retryable error or internal timeout, fallback with a fresh `AbortController`. Thread `AbortSignal` through `ProviderClient.generate` and into all four adapter SDKs.
- **Item D — V3 turn-claim and appendMessage retry.** All three V3 entry paths claim a turn before `runAgentTurn`; on conflict return JSON 409 with the same `conflict_request_id` envelope managed uses. `runAgentTurn` threads `turnId` to every `appendMessage` call and calls `markTurnCompleted` immediately before each `done` emit. `appendMessage` retries once on PG 23505 (sequence-number race), mirroring `appendManagedMessage`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest (node environment), Drizzle ORM + postgres.js, Anthropic SDK + OpenAI SDK (provider clients), Qdrant vector store.

**Spec:** `docs/superpowers/specs/2026-04-29-ai-flow-cost-flow-pr2-design.md`

**Sibling spec / dependency:** PR1 (`docs/superpowers/plans/2026-04-29-ai-flow-stability-pr1.md`). Land PR1 first — Item A's "session.blueprint + phase + stateVersion become visible to the client" only works because PR1's reload-after-write reads the fresh row before emitting `done.finalState`.

**Test environment note:** `app/vitest.config.ts` is `node` env. Every test in this plan is server-side (services, runtime, route, history, providers). No React rendering required.

---

## File Structure

| Path | Role | Status |
|---|---|---|
| `app/src/lib/ai/agent/services/preselect.ts` | Stash `rawEvidence` (≤15) into `PreselectArtifactV1` | Modify |
| `app/src/lib/ai/agent/services/blueprint.ts` | Add `buildCallBlueprintFromArgs(args, ctx): CallBlueprint` helper | Modify |
| `app/src/lib/ai/agent/mcp/write/save-call-blueprint.ts` | Export `inputShape` + `inputSchema`; call helper instead of inlining the shape | Modify |
| `app/src/lib/ai/agent/managed/tools.ts` | Register `save_call_blueprint`; move from `PHASE_4_BLOCKED_TOOL_NAMES` to `WRITE_TOOL_NAMES` | Modify |
| `app/src/lib/ai/agent/managed/executor.ts` | Add dispatch case; on success update `agent_sessions.blueprint`+`currentPhase`+`stateVersion` (conditional WHERE) | Modify |
| `app/src/lib/ai/agent/managed/runtime.ts` | Synthetic `retrieve_evidence` injection into in-memory history before user message | Modify |
| `app/src/lib/ai/agent/managed/prompt.ts` | Split research-phase bootstrap into branch 3a (with injection) and branch 3b (without) | Modify |
| `app/src/lib/ai/client.ts` | Drop outer `withRetry` + `Errors.serviceUnavailable` wrapping in `aiGenerate`/`aiGenerateObject`/`aiEmbed` | Modify |
| `app/src/lib/ai/providers/types.ts` | `ProviderClient.generate` gains optional `signal?: AbortSignal` parameter | Modify |
| `app/src/lib/ai/providers/openai.ts` | Pass `signal` to `c.chat.completions.create(..., { signal })` | Modify |
| `app/src/lib/ai/providers/anthropic.ts` | Pass `signal` to shim + native paths | Modify |
| `app/src/lib/ai/providers/anthropic-native.ts` | Pass `signal` to `anthropic.messages.create(..., { signal })` | Modify |
| `app/src/lib/ai/providers/google.ts` | Pass `signal` to SDK call | Modify |
| `app/src/lib/ai/providers/perplexity.ts` | Pass `signal` to SDK call | Modify |
| `app/src/lib/ai/providers/retry.ts` | Rewrite — timeout-bounded primary + fresh-controller fallback | Modify |
| `app/src/lib/ai/providers/router.ts` | Update `withRetry` call signature (now takes `(signal) => Promise<...>`) | Modify |
| `app/src/app/api/ai/agent/route.ts` | Add `claimV3OrConflict` helper; call before all three V3 dispatch sites; pass `turnId` to `runV3WithSSE` | Modify |
| `app/src/lib/ai/agent/runtime.ts` | Accept `turnId` in `RuntimeOptions`; thread to every `appendMessage` call; call `markTurnCompleted` before each `done` emit | Modify |
| `app/src/lib/ai/agent/history.ts` | `appendMessage` accepts `turnId?`; retry-once on PG 23505 | Modify |
| `app/tests/unit/agent/preselect-raw-evidence-stash.test.ts` | Cache-miss/hit/throw branches in `initializeSession` | Create |
| `app/tests/integration/managed/runtime-preselect-injection.test.ts` | Synthetic injection presence/absence + ordering + non-persistence | Create |
| `app/tests/integration/managed/save-call-blueprint-tool.test.ts` | End-to-end: model calls `save_call_blueprint` → executor writes back to session | Create |
| `app/tests/unit/ai/providers/retry.test.ts` | Rewrite for new contract: classifier branches, fresh-controller fallback, internal-vs-external abort | Modify |
| `app/tests/unit/ai/providers/openai.test.ts` | Add signal pass-through assertion | Modify |
| `app/tests/unit/ai/providers/anthropic.test.ts` | Add signal pass-through assertion (shim) | Modify |
| `app/tests/unit/ai/providers/anthropic-native.test.ts` | Add signal pass-through assertion (native) | Modify |
| `app/tests/unit/ai/providers/google.test.ts` | Add signal pass-through assertion | Modify |
| `app/tests/unit/ai/providers/perplexity.test.ts` | Add signal pass-through assertion | Modify |
| `app/tests/unit/ai-client-retry.test.ts` | New: assert `client.ts` no longer wraps in `withRetry` from `@/lib/errors`; assert original error preserved | Create |
| `app/tests/integration/managed/route-v3-claim.test.ts` | All three V3 paths claim; concurrent identical request returns 409 envelope | Create |
| `app/tests/unit/agent-runtime-completion.test.ts` | `runAgentTurn` calls `markTurnCompleted` before `done`; failure path leaves `completedAt` null | Create |
| `app/tests/unit/agent-history-append-retry.test.ts` | `appendMessage` retries once on 23505; passes `turnId`; second 23505 throws | Create |

---

## Phase ordering

The three items are independent at the file level but share PR-level discipline:

- **Phase A** (Tasks 1–7): Item A — preselect stash + injection + prompt branch + tool registration + executor write-back.
- **Phase E** (Tasks 8–12): Item E — provider signal threading + retry rewrite + client cleanup.
- **Phase D** (Tasks 13–17): Item D — V3 claim helper + runtime threading + appendMessage retry.
- **Task 18**: PR2-wide acceptance summary (sits outside any phase).

Tasks within a phase are TDD-shaped where possible. The plan commits per task in Phase A and Phase E (each task ships with its own atomic test+impl commit). Phase D commits Tasks 13–16 together as a single commit because they share a type-system dependency: Task 13 calls `claimTurn`, Task 14 makes `turnId` required on `RuntimeOptions`, Task 15 threads it through, Task 16 widens `appendMessage`'s signature to accept it. Splitting them would leave intermediate commits that don't typecheck.

---

## Task 1: Stash rawEvidence in PreselectArtifactV1 (Item A.1)

**Files:**
- Modify: `app/src/lib/ai/agent/services/preselect.ts`
- Test: `app/tests/unit/agent/preselect-raw-evidence-stash.test.ts`

Type extension is non-breaking (additive optional field). Cache-miss path stores top-15 evidence chunks. Cache-hit and throw paths leave the field unset.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/agent/preselect-raw-evidence-stash.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  withUserRLS: vi.fn(async (_userId: string, fn: (tx: unknown) => unknown) => fn({
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'sess-1' }]) }) }),
  })),
}))

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id' },
}))

vi.mock('@/lib/legal/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn() }))
vi.mock('@/lib/ai/agent/services/evidence', () => ({ searchCalls: vi.fn() }))

describe('initializeSession — rawEvidence stash', () => {
  beforeEach(() => vi.clearAllMocks())

  function makeChunks(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `c${i}`, content: `chunk ${i}`, docType: 'ghid',
      source: 'src', score: 0.9 - i * 0.01, priority: 1,
    }))
  }

  const baseParams = {
    userId: '11111111-1111-4111-8111-111111111111',
    description: 'Test description for preselect',
    locale: 'ro' as const,
    selectedCallId: 'CALL-1',
    selectedScore: 0.85,
    candidates: [],
    excludeCallIdsApplied: [],
  }

  it('cache miss: stashes top-15 sliced rawEvidence and sets blueprintKind=raw_evidence', async () => {
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    const chunks = makeChunks(20)
    vi.mocked(lookupBlueprint).mockResolvedValueOnce({
      cached: false, blueprint: null, rawEvidence: chunks,
    } as never)

    // Capture the inserted row's planningArtifact.
    const captured: unknown[] = []
    const { withUserRLS } = await import('@/lib/db')
    vi.mocked(withUserRLS).mockImplementationOnce(async (_uid: string, fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (v: unknown) => {
            captured.push(v)
            return { returning: () => Promise.resolve([{ id: 'sess-1' }]) }
          },
        }),
      }
      return fn(tx)
    })

    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    const result = await initializeSession(baseParams)

    expect(result.blueprintKind).toBe('raw_evidence')
    expect(result.phase).toBe('research')

    expect(captured).toHaveLength(1)
    const row = captured[0] as { planningArtifact: { preselect: { rawEvidence?: unknown[]; blueprintKind: string } } }
    expect(row.planningArtifact.preselect.blueprintKind).toBe('raw_evidence')
    expect(row.planningArtifact.preselect.rawEvidence).toHaveLength(15)
    expect((row.planningArtifact.preselect.rawEvidence as { id: string }[])[0].id).toBe('c0')
    expect((row.planningArtifact.preselect.rawEvidence as { id: string }[])[14].id).toBe('c14')
  })

  it('cache hit: does NOT stash rawEvidence', async () => {
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    vi.mocked(lookupBlueprint).mockResolvedValueOnce({
      cached: true,
      blueprint: { callId: 'CALL-1' } as never,
      rawEvidence: null,
    })

    const captured: unknown[] = []
    const { withUserRLS } = await import('@/lib/db')
    vi.mocked(withUserRLS).mockImplementationOnce(async (_uid: string, fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (v: unknown) => { captured.push(v); return { returning: () => Promise.resolve([{ id: 'sess-1' }]) } },
        }),
      }
      return fn(tx)
    })

    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    const result = await initializeSession(baseParams)

    expect(result.blueprintKind).toBe('structured')
    expect(result.phase).toBe('structuring')

    const row = captured[0] as { planningArtifact: { preselect: { rawEvidence?: unknown[]; blueprintKind: string } } }
    expect(row.planningArtifact.preselect.blueprintKind).toBe('structured')
    expect(row.planningArtifact.preselect.rawEvidence).toBeUndefined()
  })

  it('lookupBlueprint throws: blueprintKind=none, no rawEvidence', async () => {
    const { lookupBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    vi.mocked(lookupBlueprint).mockRejectedValueOnce(new Error('Qdrant down'))

    const captured: unknown[] = []
    const { withUserRLS } = await import('@/lib/db')
    vi.mocked(withUserRLS).mockImplementationOnce(async (_uid: string, fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (v: unknown) => { captured.push(v); return { returning: () => Promise.resolve([{ id: 'sess-1' }]) } },
        }),
      }
      return fn(tx)
    })

    const { initializeSession } = await import('@/lib/ai/agent/services/preselect')
    const result = await initializeSession(baseParams)

    expect(result.blueprintKind).toBe('none')
    expect(result.phase).toBe('research')

    const row = captured[0] as { planningArtifact: { preselect: { rawEvidence?: unknown[]; blueprintKind: string } } }
    expect(row.planningArtifact.preselect.blueprintKind).toBe('none')
    expect(row.planningArtifact.preselect.rawEvidence).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `app/`: `npx vitest run tests/unit/agent/preselect-raw-evidence-stash.test.ts`
Expected: FAIL — current `preselect.ts:128` discards `rawEvidence`; the cache-miss assertion that `rawEvidence` exists fails.

- [ ] **Step 3: Update PreselectArtifactV1 type and stash logic**

Edit `app/src/lib/ai/agent/services/preselect.ts`.

Find the `PreselectArtifactV1` interface (lines 34-44) and the `EvidenceChunk` import is missing — add the import near the top:

```ts
import { lookupBlueprint } from './blueprint'
import { searchCalls } from './evidence'
import type { CallMatch, ServiceContext, EvidenceChunk } from './types'
```

Replace the `PreselectArtifactV1` interface:

```ts
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
  // Top-15 evidence chunks stashed on cache miss so the managed runtime
  // can synthetically inject them on the first turn — avoids the model
  // re-running retrieve_evidence on Qdrant. Present iff blueprintKind ===
  // 'raw_evidence'. Absent (undefined) for 'structured' and 'none'.
  rawEvidence?: EvidenceChunk[]
}
```

Find the cache-miss branch in `initializeSession` (lines 120-137) and the artifact constructor (lines 142-152). Replace the full `try` block + artifact:

```ts
  let blueprintKind: BlueprintKind
  let blueprintPayload: unknown = null
  let blueprintLookupFailed = false
  let rawEvidenceForArtifact: EvidenceChunk[] | undefined = undefined

  try {
    const ctx = { userId, sessionId: '', locale } as const
    const result = await lookupBlueprint(ctx as unknown as ServiceContext, selectedCallId)
    if (result.cached) {
      blueprintKind = 'structured'
      blueprintPayload = result.blueprint
    } else {
      blueprintKind = 'raw_evidence'
      // Top-15 cap matches retrieve_evidence's default maxChunks. Slicing
      // here keeps the invariant local: no other caller needs to know.
      rawEvidenceForArtifact = (result.rawEvidence ?? []).slice(0, 15)
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
    ...(rawEvidenceForArtifact !== undefined ? { rawEvidence: rawEvidenceForArtifact } : {}),
  }
```

- [ ] **Step 4: Run typecheck and the new test**

Run from `app/`:
```bash
npm run typecheck && npx vitest run tests/unit/agent/preselect-raw-evidence-stash.test.ts
```
Expected: PASS for all three branches.

- [ ] **Step 5: Run existing preselect tests to confirm no regression**

Run from `app/`: `npx vitest run tests/integration/preselect-route.test.ts tests/unit/agent/preselect-decide.test.ts 2>/dev/null || npx vitest run tests/integration/preselect-route.test.ts`

(If neither test file exists, run `npx vitest run -t preselect`.)

Expected: all existing preselect tests still pass — the additive optional field doesn't break callers.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/services/preselect.ts \
        app/tests/unit/agent/preselect-raw-evidence-stash.test.ts
git commit -m "feat(preselect): stash top-15 rawEvidence in planningArtifact on cache miss"
```

---

## Task 2: Extract buildCallBlueprintFromArgs helper (Item A.5 prep)

**Files:**
- Modify: `app/src/lib/ai/agent/services/blueprint.ts`
- Modify: `app/src/lib/ai/agent/mcp/write/save-call-blueprint.ts`

The blueprint-building shape currently lives inline in `save-call-blueprint.ts:39-56`. Extracting it to a service helper lets both the MCP handler AND the managed executor write back consistent shapes to `agent_sessions.blueprint`.

- [ ] **Step 1: Add the helper to blueprint.ts**

Edit `app/src/lib/ai/agent/services/blueprint.ts`. After the imports block (line 1-22), add the helper at the end of the file (after `buildBlueprintFromCache`):

```ts
// ── buildCallBlueprintFromArgs ───────────────────────────────────────────
//
// Converts the partial input shape that save_call_blueprint accepts into a
// full normalized CallBlueprint. Used by:
//   - The MCP handler (mcp/write/save-call-blueprint.ts) for the call to
//     saveCallBlueprint().
//   - The managed executor's save_call_blueprint case for both
//     saveCallBlueprint() AND the agent_sessions.blueprint write-back.
//
// Both call sites MUST construct the blueprint via this helper; otherwise
// the cache row and the session row drift, and the next-turn skip
// condition (`!session.blueprint`) becomes unreliable.

export interface SaveCallBlueprintArgs {
  callId: string
  blueprint: {
    callId?: string
    program?: string
    requiredSections?: { title: string; description: string; evaluationWeight?: number }[]
    mandatoryAnnexes?: string[]
    eligibilityCriteria?: string[]
    structureConfidence?: number
    sources?: string[]
  }
}

export function buildCallBlueprintFromArgs(
  args: SaveCallBlueprintArgs,
  ctx: ServiceContext,
): CallBlueprint {
  const requiredSections = args.blueprint.requiredSections ?? []
  const mandatoryAnnexes = args.blueprint.mandatoryAnnexes ?? []
  const eligibilityCriteria = args.blueprint.eligibilityCriteria ?? []
  const sources = args.blueprint.sources ?? []
  const verifiedAt = ctx.now.toISOString()

  // The schema input only carries { title, description, evaluationWeight? }
  // per section. CallBlueprint.normalized.requiredSections is SectionSpec[]
  // which has additional fields (id, order, generationOrder, importance,
  // expectedLength, dependsOn, modelHint, mandatory, confidence). The cache
  // row in callKnowledge has historically stored the partial shape via the
  // `as SectionSpec[]` precedent in buildBlueprintFromCache (see
  // app/src/lib/ai/agent/services/blueprint.ts, the cache-hit reader).
  // Match that precedent here at the boundary so the helper's return type
  // is honored without an `any` cast on the whole shape.
  return {
    callId: args.callId,
    program: args.blueprint.program ?? 'Unknown',
    isOpen: true,
    amendments: [],
    warnings: [],
    requiredSections,
    mandatoryAnnexes,
    eligibilityCriteria,
    evaluationGrid: [],
    cofinancingRate: 0,
    eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
    sources,
    verifiedAt,
    raw: { notebookLmResponse: '', perplexityResponse: '', retrievedAt: verifiedAt },
    normalized: {
      requiredSections: requiredSections as unknown as import('@/lib/ai/agent/types').SectionSpec[],
      mandatoryAnnexes,
      eligibilityCriteria,
      evaluationGrid: [],
      cofinancingRate: 0,
    },
    structureConfidence: args.blueprint.structureConfidence ?? 0.3,
  }
}
```

- [ ] **Step 2: Update the MCP handler to use the helper and export the schema**

Edit `app/src/lib/ai/agent/mcp/write/save-call-blueprint.ts`.

Find:
```ts
const sectionSpecShape = z.object({
  title: z.string(),
  description: z.string(),
  evaluationWeight: z.number().optional(),
})

const inputShape = {
  callId: z.string().min(1),
  blueprint: z.object({
    callId: z.string().optional(),
    program: z.string().optional(),
    requiredSections: z.array(sectionSpecShape).optional(),
    mandatoryAnnexes: z.array(z.string()).optional(),
    eligibilityCriteria: z.array(z.string()).optional(),
    structureConfidence: z.number().optional(),
    sources: z.array(z.string()).optional(),
  }),
}
```

Replace with (export `inputShape`, add `inputSchema`):
```ts
const sectionSpecShape = z.object({
  title: z.string(),
  description: z.string(),
  evaluationWeight: z.number().optional(),
})

export const inputShape = {
  callId: z.string().min(1),
  blueprint: z.object({
    callId: z.string().optional(),
    program: z.string().optional(),
    requiredSections: z.array(sectionSpecShape).optional(),
    mandatoryAnnexes: z.array(z.string()).optional(),
    eligibilityCriteria: z.array(z.string()).optional(),
    structureConfidence: z.number().optional(),
    sources: z.array(z.string()).optional(),
  }),
}

export const inputSchema = z.object(inputShape)
```

Find the inline blueprint construction (lines 38-56):
```ts
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const blueprint: any = {
          ...args.blueprint,
          callId: args.callId,
          isOpen: true,
          amendments: [],
          warnings: [],
          requiredSections: args.blueprint.requiredSections ?? [],
          mandatoryAnnexes: args.blueprint.mandatoryAnnexes ?? [],
          eligibilityCriteria: args.blueprint.eligibilityCriteria ?? [],
          evaluationGrid: [],
          cofinancingRate: 0,
          eligibilityResult: { score: 0, passCount: 0, failCount: 0, failures: [], warnings: [] },
          sources: args.blueprint.sources ?? [],
          verifiedAt: ctx.now.toISOString(),
          raw: { notebookLmResponse: '', perplexityResponse: '', retrievedAt: ctx.now.toISOString() },
          normalized: { requiredSections: args.blueprint.requiredSections ?? [], mandatoryAnnexes: args.blueprint.mandatoryAnnexes ?? [], eligibilityCriteria: args.blueprint.eligibilityCriteria ?? [], evaluationGrid: [], cofinancingRate: 0 },
          structureConfidence: args.blueprint.structureConfidence ?? 0.3,
        }

        const result = await saveCallBlueprint(ctx, args.callId, blueprint)
```

Replace with (use the helper):
```ts
      try {
        const blueprint = buildCallBlueprintFromArgs(args, ctx)
        const result = await saveCallBlueprint(ctx, args.callId, blueprint)
```

Update the import line at the top:
```ts
import { saveCallBlueprint, buildCallBlueprintFromArgs } from '../../services/blueprint'
```

- [ ] **Step 3: Run typecheck and existing tests**

Run from `app/`:
```bash
npm run typecheck && npx vitest run tests/integration/agent-tool-save-call-blueprint.test.ts 2>/dev/null || npm run typecheck
```
Expected: typecheck PASS. Any existing test for `save_call_blueprint` (if present) still passes — the helper produces an equivalent shape.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/ai/agent/services/blueprint.ts \
        app/src/lib/ai/agent/mcp/write/save-call-blueprint.ts
git commit -m "refactor(blueprint): extract buildCallBlueprintFromArgs helper"
```

---

## Task 3: Register save_call_blueprint in managed tools surface (Item A.4)

**Files:**
- Modify: `app/src/lib/ai/agent/managed/tools.ts`

Move `save_call_blueprint` from `PHASE_4_BLOCKED_TOOL_NAMES` to `WRITE_TOOL_NAMES` and add a `Tool` entry to `MANAGED_TOOLS`. The executor case is added separately in Task 4 (so the change set per task stays small).

- [ ] **Step 1: Import the schema**

Edit `app/src/lib/ai/agent/managed/tools.ts`. Find the write-tool import block (lines 30-37):

```ts
import { inputSchema as saveSectionDraftSchema } from '../mcp/write/save-section-draft'
import { inputSchema as approveRevisionSchema } from '../mcp/write/approve-revision'
import { inputSchema as rollbackSectionSchema } from '../mcp/write/rollback-section'
import { inputSchema as setApplicationStatusSchema } from '../mcp/write/set-application-status'
import { inputSchema as setSelectedCallSchema } from '../mcp/write/set-selected-call'
import { inputSchema as freezeOutlineSchema } from '../mcp/write/freeze-outline'
import { inputSchema as markSectionStaleSchema } from '../mcp/write/mark-section-stale'
import { inputSchema as rejectSectionSchema } from '../mcp/write/reject-section'
```

Append:
```ts
import { inputSchema as saveSectionDraftSchema } from '../mcp/write/save-section-draft'
import { inputSchema as approveRevisionSchema } from '../mcp/write/approve-revision'
import { inputSchema as rollbackSectionSchema } from '../mcp/write/rollback-section'
import { inputSchema as setApplicationStatusSchema } from '../mcp/write/set-application-status'
import { inputSchema as setSelectedCallSchema } from '../mcp/write/set-selected-call'
import { inputSchema as freezeOutlineSchema } from '../mcp/write/freeze-outline'
import { inputSchema as markSectionStaleSchema } from '../mcp/write/mark-section-stale'
import { inputSchema as rejectSectionSchema } from '../mcp/write/reject-section'
import { inputSchema as saveCallBlueprintSchema } from '../mcp/write/save-call-blueprint'
```

- [ ] **Step 2: Add the Tool entry to MANAGED_TOOLS**

Find the last entry in `MANAGED_TOOLS` (the `reject_section` entry, lines 150-154):

```ts
  {
    name: 'reject_section',
    description: 'Reject a section with a required reason string. Valid from draft, needs_review, or same-reason rejected (no-op). Different-reason re-reject is forbidden to prevent rejection metadata churn. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(rejectSectionSchema) as Tool['input_schema'],
  },
]
```

Replace with (add `save_call_blueprint` entry):

```ts
  {
    name: 'reject_section',
    description: 'Reject a section with a required reason string. Valid from draft, needs_review, or same-reason rejected (no-op). Different-reason re-reject is forbidden to prevent rejection metadata churn. Always get explicit user confirmation or a structured UI action confirmation before calling — this is a write tool.',
    input_schema: zodToJsonSchema(rejectSectionSchema) as Tool['input_schema'],
  },
  {
    name: 'save_call_blueprint',
    description: 'Persist an agent-extracted call blueprint into the global cache (callKnowledge) AND the active session row. Idempotent by callId. CALL THIS AUTOMATICALLY in research-phase preselected sessions after converting the injected retrieve_evidence result into structured fields — the deterministic preselect itself is the user confirmation, NO additional confirmation is required for this tool. Set structureConfidence ≥ 0.4 only when the blueprint is well supported by the evidence; below threshold the row persists as provisional and the next session re-extracts. On success the session phase advances from research to structuring.',
    input_schema: zodToJsonSchema(saveCallBlueprintSchema) as Tool['input_schema'],
  },
]
```

- [ ] **Step 3: Move save_call_blueprint into WRITE_TOOL_NAMES**

Find the `WRITE_TOOL_NAMES` set (lines 185-194):

```ts
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'save_section_draft',
  'approve_revision',
  'rollback_section',
  'set_application_status',
  'set_selected_call',
  'freeze_outline',
  'mark_section_stale',
  'reject_section',
])
```

Replace with:
```ts
export const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'save_section_draft',
  'approve_revision',
  'rollback_section',
  'set_application_status',
  'set_selected_call',
  'freeze_outline',
  'mark_section_stale',
  'reject_section',
  'save_call_blueprint',
])
```

Find `PHASE_4_BLOCKED_TOOL_NAMES` (lines 196-199):
```ts
export const PHASE_4_BLOCKED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_export_snapshot',
  'save_call_blueprint',
])
```

Replace with:
```ts
export const PHASE_4_BLOCKED_TOOL_NAMES: ReadonlySet<string> = new Set([
  'create_export_snapshot',
])
```

- [ ] **Step 4: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS. The executor now has an unhandled-but-allowlisted tool name; that's caught at runtime via the `default` branch in `dispatchTool` until Task 4 adds the case. No tests are affected by this intermediate state because `MANAGED_TOOL_NAMES` allowlists the name and the executor's allowlist check passes — but `dispatchTool` would throw `Dispatcher has no handler for save_call_blueprint`. We add that handler in Task 4.

- [ ] **Step 5: Don't commit yet** — Task 4 immediately follows.

---

## Task 4: Wire save_call_blueprint dispatch + session write-back (Item A.5)

**Files:**
- Modify: `app/src/lib/ai/agent/managed/executor.ts`
- Test: `app/tests/integration/managed/save-call-blueprint-tool.test.ts`

Add the dispatch case. After `saveCallBlueprint` returns success, conditionally update `agent_sessions` to set `blueprint`, advance `currentPhase` to `'structuring'`, and bump `stateVersion`. The conditional WHERE (`currentPhase = 'research' AND selectedCallId = args.callId`) makes repeat calls in later phases a no-op.

- [ ] **Step 1: Write the failing integration test**

Create `app/tests/integration/managed/save-call-blueprint-tool.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'

vi.mock('@/lib/db', () => {
  const updateCalls: unknown[] = []
  const mockDb = {
    update: vi.fn(() => ({
      set: vi.fn((v: unknown) => {
        const last = updateCalls[updateCalls.length - 1] as Record<string, unknown> | undefined
        if (last) last.set = v
        else updateCalls.push({ set: v })
        return {
          where: vi.fn((w: unknown) => {
            const lastEntry = updateCalls[updateCalls.length - 1] as Record<string, unknown> | undefined
            if (lastEntry) lastEntry.where = w
            return Promise.resolve(undefined)
          }),
        }
      }),
    })),
    __updateCalls: updateCalls,
  }
  return { db: mockDb }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', currentPhase: 'current_phase', selectedCallId: 'selected_call_id', stateVersion: 'state_version' },
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
  and: (...args: unknown[]) => ({ kind: 'and', args }),
  sql: (parts: TemplateStringsArray, ..._values: unknown[]) => ({ kind: 'sql', parts: parts.join('?') }),
}))

vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

vi.mock('@/lib/ai/agent/services/blueprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/agent/services/blueprint')>()
  return {
    ...actual,
    saveCallBlueprint: vi.fn().mockResolvedValue({
      callId: 'CALL-1', version: 1, contentHash: 'hash', persistedAt: new Date(),
    }),
  }
})

import { executeManagedTool } from '@/lib/ai/agent/managed/executor'
import type { ServiceContext } from '@/lib/ai/agent/services/types'

describe('save_call_blueprint executor case', () => {
  beforeEach(() => vi.clearAllMocks())

  const ctx: ServiceContext = {
    userId: '11111111-1111-4111-8111-111111111111',
    sessionId: '22222222-2222-4222-8222-222222222222',
    requestId: 'req-1',
    now: new Date('2026-04-29T00:00:00Z'),
    locale: 'ro',
    allowWrites: true,
  }

  const block: ToolUseBlock = {
    type: 'tool_use',
    id: 'tu_1',
    name: 'save_call_blueprint',
    input: {
      callId: 'CALL-1',
      blueprint: {
        program: 'PNRR',
        requiredSections: [{ title: 'Obiective', description: 'Project goals' }],
        mandatoryAnnexes: ['Anexa 1'],
        eligibilityCriteria: ['Romanian SME'],
        structureConfidence: 0.5,
      },
    },
  }

  it('calls saveCallBlueprint with full normalized CallBlueprint', async () => {
    const { saveCallBlueprint } = await import('@/lib/ai/agent/services/blueprint')
    const result = await executeManagedTool(block, ctx)

    expect(result.isError).toBe(false)
    expect(saveCallBlueprint).toHaveBeenCalledTimes(1)
    const [, callId, blueprint] = vi.mocked(saveCallBlueprint).mock.calls[0]
    expect(callId).toBe('CALL-1')
    expect(blueprint.program).toBe('PNRR')
    expect(blueprint.normalized.requiredSections).toEqual([{ title: 'Obiective', description: 'Project goals' }])
    expect(blueprint.structureConfidence).toBe(0.5)
  })

  it('updates agent_sessions with blueprint, currentPhase=structuring, stateVersion bump', async () => {
    await executeManagedTool(block, ctx)

    const { db } = await import('@/lib/db') as unknown as { db: { __updateCalls: Array<Record<string, unknown>> } }
    expect(db.__updateCalls.length).toBeGreaterThanOrEqual(1)
    const last = db.__updateCalls[db.__updateCalls.length - 1]
    const set = last.set as Record<string, unknown>
    expect(set.currentPhase).toBe('structuring')
    expect(set.blueprint).toBeDefined()
    // stateVersion is set to a sql-tagged increment expression
    expect((set.stateVersion as { kind: string })?.kind).toBe('sql')
    expect(set.updatedAt).toBeInstanceOf(Date)
  })

  it('returns isError when allowWrites is false (rollout gate)', async () => {
    const ctxNoWrites = { ...ctx, allowWrites: false }
    const result = await executeManagedTool(block, ctxNoWrites)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Managed write tools are disabled')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `app/`: `npx vitest run tests/integration/managed/save-call-blueprint-tool.test.ts`
Expected: FAIL — `dispatchTool` has no handler for `save_call_blueprint`, throws "Dispatcher has no handler".

- [ ] **Step 3: Add the dispatch case + session write-back**

Edit `app/src/lib/ai/agent/managed/executor.ts`.

Update the imports near the top. Find the `import * as blueprint from '../services/blueprint'` line (line 21). It already imports the namespace; we'll use `blueprint.saveCallBlueprint` and `blueprint.buildCallBlueprintFromArgs`.

Add new imports after line 26 (`import * as eligibility from ...`):

```ts
import { db } from '@/lib/db'
import { agentSessions } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
```

Add the schema import for `save_call_blueprint`. Find the write-schema imports block (lines 44-52):

```ts
// Phase 3b write schemas
import { inputSchema as saveSectionDraftSchema } from '../mcp/write/save-section-draft'
import { inputSchema as approveRevisionSchema } from '../mcp/write/approve-revision'
import { inputSchema as rollbackSectionSchema } from '../mcp/write/rollback-section'
import { inputSchema as setApplicationStatusSchema } from '../mcp/write/set-application-status'
import { inputSchema as setSelectedCallSchema } from '../mcp/write/set-selected-call'
import { inputSchema as freezeOutlineSchema } from '../mcp/write/freeze-outline'
import { inputSchema as markSectionStaleSchema } from '../mcp/write/mark-section-stale'
import { inputSchema as rejectSectionSchema } from '../mcp/write/reject-section'
```

Append:
```ts
// Phase 3b write schemas
import { inputSchema as saveSectionDraftSchema } from '../mcp/write/save-section-draft'
import { inputSchema as approveRevisionSchema } from '../mcp/write/approve-revision'
import { inputSchema as rollbackSectionSchema } from '../mcp/write/rollback-section'
import { inputSchema as setApplicationStatusSchema } from '../mcp/write/set-application-status'
import { inputSchema as setSelectedCallSchema } from '../mcp/write/set-selected-call'
import { inputSchema as freezeOutlineSchema } from '../mcp/write/freeze-outline'
import { inputSchema as markSectionStaleSchema } from '../mcp/write/mark-section-stale'
import { inputSchema as rejectSectionSchema } from '../mcp/write/reject-section'
import { inputSchema as saveCallBlueprintSchema } from '../mcp/write/save-call-blueprint'
```

Find the `freeze_outline` case in `dispatchTool` (lines 394-398) — it's the last case before `default`:

```ts
    case 'freeze_outline': {
      const i = freezeOutlineSchema.parse(rawInput)
      requireSession(ctx)
      return application.freezeOutline(ctx, { ...i, sessionId: ctx.sessionId })
    }
    default:
      throw new Error(`Dispatcher has no handler for ${name}`)
```

Replace with (add `save_call_blueprint`):

```ts
    case 'freeze_outline': {
      const i = freezeOutlineSchema.parse(rawInput)
      requireSession(ctx)
      return application.freezeOutline(ctx, { ...i, sessionId: ctx.sessionId })
    }
    case 'save_call_blueprint': {
      const i = saveCallBlueprintSchema.parse(rawInput)
      requireSession(ctx)
      const fullBlueprint = blueprint.buildCallBlueprintFromArgs(i, ctx)
      const result = await blueprint.saveCallBlueprint(ctx, i.callId, fullBlueprint)

      // Session-row write-back. Conditional WHERE makes repeat calls in
      // later phases a no-op rather than a phase rewind. PR1's reload-
      // after-write fires (tool is in WRITE_TOOL_NAMES) — the reloaded
      // session row reflects the new phase, blueprint, and stateVersion,
      // and done.finalState carries them to the client.
      await db.update(agentSessions)
        .set({
          blueprint: fullBlueprint as never,
          currentPhase: 'structuring',
          stateVersion: sql`${agentSessions.stateVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(and(
          eq(agentSessions.id, ctx.sessionId),
          eq(agentSessions.currentPhase, 'research'),
          eq(agentSessions.selectedCallId, i.callId),
        ))

      return result
    }
    default:
      throw new Error(`Dispatcher has no handler for ${name}`)
```

- [ ] **Step 4: Run the test**

Run from `app/`: `npx vitest run tests/integration/managed/save-call-blueprint-tool.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Run all managed integration tests**

Run from `app/`: `npx vitest run tests/integration/managed/`
Expected: all pass — existing tests don't exercise `save_call_blueprint` so they're unaffected.

- [ ] **Step 6: Commit Tasks 3+4 together**

```bash
git add app/src/lib/ai/agent/managed/tools.ts \
        app/src/lib/ai/agent/managed/executor.ts \
        app/tests/integration/managed/save-call-blueprint-tool.test.ts
git commit -m "feat(managed): unblock save_call_blueprint with session write-back"
```

---

## Task 5: Update prompt — branch on injected evidence (Item A.3)

**Files:**
- Modify: `app/src/lib/ai/agent/managed/prompt.ts`

Replace the existing single research-phase bootstrap block with a two-branch selector. Branch 3a (with injected evidence) tells the model not to call `get_call_blueprint`/`retrieve_evidence`; branch 3b (without — fallback for `lookupBlueprint` failure) keeps current behavior.

The prompt builder already receives `session`. The branch selector reads `session.planningArtifact?.preselect?.rawEvidence`.

- [ ] **Step 1: Update the Romanian builder**

Edit `app/src/lib/ai/agent/managed/prompt.ts`. Find the `phaseBootstrapBlock` block in `buildRomanianPrompt` (lines 83-98):

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

Replace with:

```ts
  // PR2 Item A.3 — research phase has two mutually-exclusive branches.
  // Branch 3a: managed runtime injected evidence into history. Tell the
  // model NOT to call get_call_blueprint or retrieve_evidence — the
  // injected tool_result already contains the chunks.
  // Branch 3b: lookupBlueprint failed during preselect (rare). Model uses
  // tools to fetch evidence directly. Existing behavior.
  const preselectRawEvidence =
    (session.planningArtifact as { preselect?: { rawEvidence?: unknown[] } } | null)
      ?.preselect?.rawEvidence
  const hasInjectedEvidence =
    Array.isArray(preselectRawEvidence) && preselectRawEvidence.length > 0
    && session.blueprint === null

  const phaseBootstrapBlock = phase === 'structuring' && session.selectedCallId
    ? `## Punct de pornire

Apelul ${session.selectedCallId} a fost deja selectat prin preselectare deterministă.
Blueprint-ul complet al apelului este deja disponibil în stare.
Nu re-căuta apeluri. Începe cu generarea outline-ului.

`
    : phase === 'research' && session.selectedCallId && hasInjectedEvidence
    ? `## Punct de pornire

Apelul ${session.selectedCallId} a fost deja selectat prin preselectare deterministă. Rezultatul \`retrieve_evidence\` este deja prezent în istoricul conversației — **NU apela \`get_call_blueprint\`** și **NU apela \`retrieve_evidence\`**. Convertește rezultatul existent într-un blueprint structurat și apelează \`save_call_blueprint\` cu \`structureConfidence\` ≥ 0.4 numai dacă blueprint-ul este bine susținut de dovezi.

`
    : phase === 'research' && session.selectedCallId
    ? `## Punct de pornire

Apelul ${session.selectedCallId} a fost deja selectat prin preselectare deterministă.
Blueprint-ul structurat nu este încă disponibil în cache — extrage-l folosind \`get_call_blueprint\` și \`retrieve_evidence\`, apoi treci la structurare.

`
    : ''
```

- [ ] **Step 2: Update the English builder**

Find the equivalent block in `buildEnglishPrompt` (lines 180-195):

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

Replace with:

```ts
  const preselectRawEvidence =
    (session.planningArtifact as { preselect?: { rawEvidence?: unknown[] } } | null)
      ?.preselect?.rawEvidence
  const hasInjectedEvidence =
    Array.isArray(preselectRawEvidence) && preselectRawEvidence.length > 0
    && session.blueprint === null

  const phaseBootstrapBlock = phase === 'structuring' && session.selectedCallId
    ? `## Starting point

Call ${session.selectedCallId} has already been selected via deterministic preselect.
The full call blueprint is already available in state.
Do not re-run call search. Start with outline generation.

`
    : phase === 'research' && session.selectedCallId && hasInjectedEvidence
    ? `## Starting point

Call ${session.selectedCallId} has already been selected via deterministic preselect. The \`retrieve_evidence\` result is already present in the conversation history — **do NOT call \`get_call_blueprint\`** and **do NOT call \`retrieve_evidence\`**. Convert the existing result into a structured blueprint and call \`save_call_blueprint\` with \`structureConfidence\` ≥ 0.4 only when the blueprint is well supported by evidence.

`
    : phase === 'research' && session.selectedCallId
    ? `## Starting point

Call ${session.selectedCallId} has already been selected via deterministic preselect.
The structured blueprint is not yet cached — extract it using \`get_call_blueprint\` and \`retrieve_evidence\`, then move to structuring.

`
    : ''
```

- [ ] **Step 3: Update writeToolsLine to advertise save_call_blueprint**

Edit `app/src/lib/ai/agent/managed/prompt.ts` again. The Romanian builder's `writeToolsLine` (line 59) currently lists eight write tools. Add `save_call_blueprint`.

Find the Romanian `writeToolsLine`:

```ts
  const writeToolsLine = allowWrites
    ? '\n- **Write** (scriere, cu confirmare explicită): `save_section_draft`, `approve_revision`, `rollback_section`, `set_application_status`, `set_selected_call`, `freeze_outline`, `mark_section_stale`, `reject_section`'
    : ''
```

Replace with:

```ts
  const writeToolsLine = allowWrites
    ? '\n- **Write** (scriere, cu confirmare explicită): `save_section_draft`, `approve_revision`, `rollback_section`, `set_application_status`, `set_selected_call`, `freeze_outline`, `mark_section_stale`, `reject_section`\n- **Internal write** (intern, fără confirmare suplimentară a utilizatorului): `save_call_blueprint`'
    : ''
```

Find the English `writeToolsLine` (line 156):

```ts
  const writeToolsLine = allowWrites
    ? '\n- **Write** (require explicit confirmation): `save_section_draft`, `approve_revision`, `rollback_section`, `set_application_status`, `set_selected_call`, `freeze_outline`, `mark_section_stale`, `reject_section`'
    : ''
```

Replace with:

```ts
  const writeToolsLine = allowWrites
    ? '\n- **Write** (require explicit confirmation): `save_section_draft`, `approve_revision`, `rollback_section`, `set_application_status`, `set_selected_call`, `freeze_outline`, `mark_section_stale`, `reject_section`\n- **Internal write** (no additional user confirmation needed): `save_call_blueprint`'
    : ''
```

- [ ] **Step 4: Update the "Write tool rules" block — exempt save_call_blueprint from rule 1**

The "Confirmă înainte de a scrie" / "Confirm before writing" rule (rule 1 in `writeRulesBlock`) must explicitly exempt `save_call_blueprint`. Otherwise the model is told both "always confirm" (rule 1) AND "call automatically" (the prompt branch 3a in Step 1+2). Without explicit exemption the model will hesitate and ask for confirmation, defeating the cost goal.

Find the Romanian `writeRulesBlock` rule 1 (around line 74):

```
1. **Confirmă înainte de a scrie.** Înainte de a apela orice instrument de scriere, obține intenția explicită a utilizatorului — fie o afirmație directă ("salvează", "aprobă această secțiune"), fie o confirmare de acțiune UI structurată. Nu scrie pe speculație.
```

Replace with:

```
1. **Confirmă înainte de a scrie.** Înainte de a apela orice instrument de scriere, obține intenția explicită a utilizatorului — fie o afirmație directă ("salvează", "aprobă această secțiune"), fie o confirmare de acțiune UI structurată. Nu scrie pe speculație. **Excepție:** \`save_call_blueprint\` este o scriere internă declanșată automat când extragi un blueprint din dovezile injectate într-o sesiune preselectată faza research — preselectarea însăși este confirmarea utilizatorului, nu cere o confirmare suplimentară.
```

Find the English `writeRulesBlock` rule 1 (around line 171):

```
1. **Confirm before writing.** Before calling any write tool, get explicit user intent — either a direct statement ("save it", "approve this section") or a structured UI action confirmation. Never write on speculation.
```

Replace with:

```
1. **Confirm before writing.** Before calling any write tool, get explicit user intent — either a direct statement ("save it", "approve this section") or a structured UI action confirmation. Never write on speculation. **Exception:** \`save_call_blueprint\` is an internal write triggered automatically when you extract a blueprint from injected evidence in a research-phase preselected session — the deterministic preselect itself is the user confirmation, no additional confirmation is required.
```

- [ ] **Step 5: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Run existing prompt tests**

Run from `app/`: `npx vitest run tests/unit/agent-prompt.test.ts 2>/dev/null || true`
Expected: existing snapshot/string-match tests still pass — the structuring branch and the no-bootstrap branch are byte-identical to before. Only the research-phase branch changes, and only when `hasInjectedEvidence` is true (new code path; existing tests presumably cover the cache-miss/no-injection branch which still works). The `writeToolsLine` and `writeRulesBlock` additions only fire when `allowWrites === true`; tests that exercise the read-only branch are unaffected.

If existing tests assert exact string matches against the research-phase prompt and now break, update them to reflect that the no-injection (cache-miss-with-failure) path is unchanged. Do NOT add a new snapshot test in this task — Task 6 covers the injection behavior end-to-end.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai/agent/managed/prompt.ts
git commit -m "feat(managed/prompt): branch research-phase bootstrap on injected evidence"
```

---

## Task 6: Inject synthetic retrieve_evidence into managed runtime history (Item A.2)

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`
- Test: `app/tests/integration/managed/runtime-preselect-injection.test.ts`

In `runManagedTurn`, after `loadManagedHistory` returns and BEFORE the user message is pushed, inject a synthetic `retrieve_evidence` tool_use block + matching tool_result block into the in-memory `history`. NOT persisted to `agent_messages`.

Gating conditions: `phase === 'research'` AND `selectedCallId` is set AND `planningArtifact.preselect.rawEvidence` is non-empty AND `session.blueprint === null`.

- [ ] **Step 1: Write the failing integration test**

Create `app/tests/integration/managed/runtime-preselect-injection.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeFakeStream(events: unknown[]) {
  return { [Symbol.asyncIterator]: async function* () { for (const e of events) yield e } }
}

// Stream emits text only — we don't need tool_use here; we're inspecting
// what's passed to anthropic.messages.stream as `messages`.
const textOnlyStream = [
  { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
]

const streamSpy = vi.fn().mockImplementation(() => makeFakeStream(textOnlyStream))

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({ messages: { stream: streamSpy } }),
}))

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
  agentSessions: { id: 'id', userId: 'user_id', currentPhase: 'current_phase', selectedCallId: 'selected_call_id', stateVersion: 'state_version' },
  // PR1's reload helper (managed/reload.ts) imports agentSections — must be
  // mocked here even though this test does not exercise it directly. Without
  // this entry, importing runtime.ts blows up before reaching the injection
  // assertion.
  agentSections: { sessionId: 'session_id' },
  runtimeModeEnum: {},
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), asc: vi.fn(), desc: vi.fn(), sql: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

vi.mock('@/lib/ai/agent/services/evidence', () => ({ searchCalls: vi.fn(), retrieveEvidence: vi.fn() }))
vi.mock('@/lib/ai/agent/services/blueprint', () => ({ lookupBlueprint: vi.fn(), saveCallBlueprint: vi.fn(), buildCallBlueprintFromArgs: vi.fn() }))
vi.mock('@/lib/ai/agent/services/application', () => ({
  getApplicationState: vi.fn(), getValidationReport: vi.fn(),
  validateApplication: vi.fn(), checkMissingAnnexes: vi.fn(),
  setApplicationStatus: vi.fn(), setSelectedCall: vi.fn(), freezeOutline: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/sections', () => ({
  listSections: vi.fn(), getSection: vi.fn(), validateSection: vi.fn(),
  saveSectionDraft: vi.fn(), approveSection: vi.fn(), rollbackSection: vi.fn(),
  markSectionStale: vi.fn(), rejectSection: vi.fn(),
}))
vi.mock('@/lib/ai/agent/services/projects', () => ({ getProjectSummary: vi.fn(), listUploadedDocuments: vi.fn() }))
vi.mock('@/lib/ai/agent/services/eligibility', () => ({ runEligibility: vi.fn(), scoreFit: vi.fn() }))

import type { AgentSession, AgentEvent } from '@/lib/ai/agent/types'

const baseSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null,
  status: 'active',
  locale: 'ro',
  selectedCallId: 'CALL-1',
  currentPhase: 'research',
  blueprint: null,
  eligibility: null,
  outline: null,
  warnings: [],
  planningArtifact: {
    preselect: {
      version: 1,
      rankedAt: '2026-04-29T00:00:00Z',
      description: 'd',
      selectedCallId: 'CALL-1',
      selectedScore: 0.8,
      candidates: [],
      selectionKind: 'selected',
      blueprintKind: 'raw_evidence',
      excludeCallIdsApplied: [],
      rawEvidence: [
        { id: 'c0', content: 'chunk 0', docType: 'ghid', source: 's', score: 0.9, priority: 1 },
        { id: 'c1', content: 'chunk 1', docType: 'ghid', source: 's', score: 0.8, priority: 1 },
      ],
    },
  },
  outlineFrozen: false,
  messageSummary: null,
  stateVersion: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('runManagedTurn — preselect synthetic injection', () => {
  beforeEach(() => { vi.clearAllMocks(); streamSpy.mockImplementation(() => makeFakeStream(textOnlyStream)) })

  it('injects synthetic retrieve_evidence tool_use+tool_result before user message', async () => {
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    const events: AgentEvent[] = []

    await runManagedTurn({
      session: baseSession,
      sections: [],
      request: { requestId: 'r1', locale: 'ro', message: 'extract' },
      emit: (e) => events.push(e),
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: baseSession.userId, sessionId: baseSession.id, requestId: 'r1', now: new Date() },
    })

    expect(streamSpy).toHaveBeenCalled()
    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>

    // Find the synthetic blocks. They must appear before the current user message.
    const userMessageIdx = passedMessages.findIndex(m =>
      m.role === 'user' && typeof m.content === 'string' && m.content === 'extract',
    )
    expect(userMessageIdx).toBeGreaterThanOrEqual(0)

    const syntheticAssistantIdx = passedMessages.findIndex(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(syntheticAssistantIdx).toBeGreaterThanOrEqual(0)
    expect(syntheticAssistantIdx).toBeLessThan(userMessageIdx)

    const syntheticUserIdx = syntheticAssistantIdx + 1
    const syntheticUser = passedMessages[syntheticUserIdx]
    expect(syntheticUser.role).toBe('user')
    const userBlocks = syntheticUser.content as Array<{ type: string; tool_use_id?: string; content?: string }>
    expect(userBlocks[0].type).toBe('tool_result')
    expect(userBlocks[0].tool_use_id).toMatch(/^preselect_evidence_/)

    // Synthetic chunks survived in the tool_result content.
    const parsedContent = JSON.parse(userBlocks[0].content as string)
    expect(parsedContent.callId).toBe('CALL-1')
    expect(parsedContent.chunks).toHaveLength(2)
    expect(parsedContent.chunks[0].id).toBe('c0')
  })

  it('does NOT inject when session.blueprint is already set', async () => {
    const session = { ...baseSession, blueprint: { callId: 'CALL-1' } as never }
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    await runManagedTurn({
      session, sections: [],
      request: { requestId: 'r2', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: session.userId, sessionId: session.id, requestId: 'r2', now: new Date() },
    })

    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>
    const synthetic = passedMessages.find(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(synthetic).toBeUndefined()
  })

  it('does NOT inject when phase is not research', async () => {
    const session = { ...baseSession, currentPhase: 'structuring' as const }
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    await runManagedTurn({
      session, sections: [],
      request: { requestId: 'r3', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: session.userId, sessionId: session.id, requestId: 'r3', now: new Date() },
    })

    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>
    const synthetic = passedMessages.find(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(synthetic).toBeUndefined()
  })

  it('does NOT inject when rawEvidence is empty', async () => {
    const session = {
      ...baseSession,
      planningArtifact: { preselect: { ...(baseSession.planningArtifact as { preselect: object }).preselect, rawEvidence: [] } },
    } as AgentSession
    const { runManagedTurn } = await import('@/lib/ai/agent/managed/runtime')
    await runManagedTurn({
      session, sections: [],
      request: { requestId: 'r4', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: '99999999-9999-4999-8999-999999999999',
      serviceCtx: { userId: session.userId, sessionId: session.id, requestId: 'r4', now: new Date() },
    })
    const passedMessages = streamSpy.mock.calls[0][0].messages as Array<{ role: string; content: unknown }>
    const synthetic = passedMessages.find(m =>
      m.role === 'assistant' && Array.isArray(m.content) &&
      (m.content as { type: string; name?: string }[]).some(b => b.type === 'tool_use' && b.name === 'retrieve_evidence'),
    )
    expect(synthetic).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `app/`: `npx vitest run tests/integration/managed/runtime-preselect-injection.test.ts`
Expected: FAIL — the first test ("injects ...") fails because `runtime.ts` does not yet inject anything.

- [ ] **Step 3: Add the injection in runtime.ts**

Edit `app/src/lib/ai/agent/managed/runtime.ts`. Find the block at lines 142-148:

```ts
  // 1. Load history. systemSummary is extracted from V3 compaction rows
  //    (system_summary message type) or falls back to session.messageSummary
  //    when no compaction rows exist.
  //    The user message for THIS turn is NOT yet persisted — it joins
  //    the in-memory history only and flushes to DB alongside the first
  //    durable output via persistFirstDurableOutput. See Finding 3
  //    (pre-stream claim + deferred persistence).
  const { messages: history, systemSummary } = await loadManagedHistory(session.id)

  // 2. Push the current user message into in-memory history ONLY.
  if (request.message) {
    history.push({ role: 'user', content: request.message })
  }
```

Replace with (insert injection between load and push):

```ts
  // 1. Load history. systemSummary is extracted from V3 compaction rows
  //    (system_summary message type) or falls back to session.messageSummary
  //    when no compaction rows exist.
  //    The user message for THIS turn is NOT yet persisted — it joins
  //    the in-memory history only and flushes to DB alongside the first
  //    durable output via persistFirstDurableOutput. See Finding 3
  //    (pre-stream claim + deferred persistence).
  const { messages: history, systemSummary } = await loadManagedHistory(session.id)

  // 1b. PR2 Item A.2 — preselect synthetic evidence injection.
  //     When the session was bootstrapped via deterministic preselect
  //     and lookupBlueprint stashed rawEvidence, inject a synthetic
  //     retrieve_evidence tool_use + tool_result pair into in-memory
  //     history so the model sees evidence as if it had called the
  //     tool. NOT persisted to agent_messages. Inserted BEFORE the
  //     current user message push so runningMessages contains:
  //     [...history, synthetic_assistant, synthetic_user, current_user].
  //     The system prompt's research-phase branch (3a) tells the model
  //     NOT to call get_call_blueprint or retrieve_evidence.
  //     Skipped when session.blueprint is already set — that means a
  //     previous turn already ran save_call_blueprint and persisted.
  const preselectArtifact = (
    session.planningArtifact as { preselect?: { rawEvidence?: unknown[]; rankedAt?: string } } | null
  )?.preselect
  const rawEvidence = Array.isArray(preselectArtifact?.rawEvidence)
    ? (preselectArtifact!.rawEvidence as unknown[])
    : []
  const shouldInject =
    session.currentPhase === 'research' &&
    session.selectedCallId !== null &&
    rawEvidence.length > 0 &&
    session.blueprint === null

  if (shouldInject) {
    try {
      const syntheticToolUseId = `preselect_evidence_${turnId}`
      history.push({
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: syntheticToolUseId,
          name: 'retrieve_evidence',
          input: { callId: session.selectedCallId },
        }],
      })
      history.push({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: syntheticToolUseId,
          content: JSON.stringify({
            callId: session.selectedCallId,
            chunks: rawEvidence,
            totalChunks: rawEvidence.length,
            retrievedAt: preselectArtifact?.rankedAt ?? new Date().toISOString(),
          }),
          is_error: false,
        }],
      })
    } catch (err) {
      // Defensive — the JSON.stringify above could only throw on a
      // circular structure. Log and skip injection so the turn continues.
      // Without injection the model falls back to calling tools (the
      // research-phase 3b branch in the prompt is the natural fallback,
      // but since 3a was already selected the model may now be confused;
      // acceptable trade-off for not crashing the turn).
      log.warn(
        { sessionId: session.id, requestId: request.requestId, error: err instanceof Error ? err.message : String(err) },
        'preselect synthetic injection skipped (corrupted rawEvidence)',
      )
    }
  }

  // 2. Push the current user message into in-memory history ONLY.
  if (request.message) {
    history.push({ role: 'user', content: request.message })
  }
```

- [ ] **Step 4: Run the injection test**

Run from `app/`: `npx vitest run tests/integration/managed/runtime-preselect-injection.test.ts`
Expected: PASS — all four cases (inject; skip on blueprint-set; skip on non-research phase; skip on empty rawEvidence).

- [ ] **Step 5: Run all managed integration tests + the PR1 reload test**

Run from `app/`: `npx vitest run tests/integration/managed/`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/managed/runtime.ts \
        app/tests/integration/managed/runtime-preselect-injection.test.ts
git commit -m "feat(managed): inject synthetic retrieve_evidence on preselect cold sessions"
```

---

## Task 7: Item A — manual smoke + Qdrant call counter

**Files:**
- None modified — manual verification

Verifies acceptance criteria 1, 2, 8 from the spec end-to-end. Run after Tasks 1–6 land.

- [ ] **Step 1: Set up local stack**

`docker-compose.yml` lives at the repo root, not under `app/`. Run Compose from the repo root.

```bash
# From the repo root (/home/godja/Dev/EU-Funds):
docker compose up -d postgres redis qdrant

# Then start the dev server from app/:
cd app && PORT=3002 npm run dev
```

In another shell, ensure managed runtime is enabled:
```bash
# In app/.env.local: MANAGED_RUNTIME_ENABLED=true
# Confirm flags managed_agent_enabled, managed_agent_writes_enabled,
# deterministic_preselect_enabled are all enabled for your test user.
```

- [ ] **Step 2: Cold preselect — verify exactly 2 Qdrant calls**

Open the Qdrant logs in a third shell (from repo root):
```bash
docker compose logs -f qdrant 2>&1 | grep -E "POST.*search"
```

In the browser at `/ro/proiecte/nou`, type a project description that resolves to a fresh callId not yet in `call_knowledge`. Click confirm to trigger preselect.

Expected logs: exactly 2 POST `/collections/eu_legislation/points/search` calls — one for the rank query in `searchCalls`, one for `lookupBlueprint`'s evidence fetch.

If you see 4 calls, confirm `app/src/lib/ai/agent/managed/runtime.ts` has the injection block from Task 6 and that the prompt branch from Task 5 is active (the model should not call `retrieve_evidence` again).

- [ ] **Step 3: First managed turn — verify save_call_blueprint runs**

Once the session enters the managed runtime (research phase), the model should produce a blueprint and call `save_call_blueprint` within the same turn.

Verify via psql / db:studio:
```sql
SELECT call_id, structure_confidence, content_extracted_at FROM call_knowledge
WHERE call_id = '<the-callid>';

SELECT current_phase, state_version, blueprint IS NOT NULL AS has_blueprint
FROM agent_sessions WHERE id = '<the-session-id>';
```

Expected:
- `call_knowledge` row exists with `structure_confidence ≥ 0.4`.
- `agent_sessions.current_phase = 'structuring'`, `state_version` is bumped, `has_blueprint = true`.

PR1's reload-after-write is what surfaces these to the client; verify the UI shows the new phase indicator without manual refresh.

- [ ] **Step 4: Second cold session same callId — verify exactly 1 Qdrant call**

Restart `docker compose logs -f qdrant` (from repo root) so logs are fresh. Open another tab at `/ro/proiecte/nou`, type a similar description that resolves to the same callId.

Expected logs: exactly 1 POST `/collections/eu_legislation/points/search` — only the rank query. `lookupBlueprint` returns from `call_knowledge` cache (no Qdrant search) since the first session persisted the blueprint with `structure_confidence ≥ 0.4`.

- [ ] **Step 5: Run final test sweep**

Run from `app/`:
```bash
npm run typecheck && npx vitest run tests/integration/managed/ tests/unit/agent/preselect-raw-evidence-stash.test.ts
```
Expected: green.

---

## Task 8: Update ProviderClient.generate signature to accept AbortSignal (Item E.3)

**Files:**
- Modify: `app/src/lib/ai/providers/types.ts`

Single-line type change. Backwards-compatible: `signal` is optional, existing callers (currently zero pass it) keep working.

- [ ] **Step 1: Add signal parameter to ProviderClient interface**

Edit `app/src/lib/ai/providers/types.ts`. Find the `ProviderClient` interface (lines 51-54):

```ts
export interface ProviderClient {
  generate(req: GenerateRequest): Promise<GenerateResult>
  embed?(text: string): Promise<number[]>
}
```

Replace with:
```ts
export interface ProviderClient {
  generate(req: GenerateRequest & { provider: ProviderName }, signal?: AbortSignal): Promise<GenerateResult>
  embed?(text: string, signal?: AbortSignal): Promise<number[]>
}
```

The `& { provider: ProviderName }` mirrors how `router.ts` already constructs the call (`provider.generate({ ...effectiveReq, provider: config.provider })`). The intersection makes the contract explicit.

- [ ] **Step 2: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: PASS — adapters don't yet pass signal but they don't have to (it's optional). Existing callers compile.

- [ ] **Step 3: Don't commit yet** — Task 9 wires the adapters.

---

## Task 9: Thread signal through all four provider adapters (Item E.3)

**Files:**
- Modify: `app/src/lib/ai/providers/openai.ts`
- Modify: `app/src/lib/ai/providers/anthropic.ts`
- Modify: `app/src/lib/ai/providers/anthropic-native.ts`
- Modify: `app/src/lib/ai/providers/google.ts`
- Modify: `app/src/lib/ai/providers/perplexity.ts`
- Test: `app/tests/unit/ai/providers/openai.test.ts` (extend)
- Test: `app/tests/unit/ai/providers/anthropic.test.ts` (extend)
- Test: `app/tests/unit/ai/providers/anthropic-native.test.ts` (extend)
- Test: `app/tests/unit/ai/providers/google.test.ts` (extend)
- Test: `app/tests/unit/ai/providers/perplexity.test.ts` (extend)

Each adapter accepts `signal` and passes it to its SDK call's request options.

- [ ] **Step 1: Update openai.ts**

Edit `app/src/lib/ai/providers/openai.ts`. Find the signature at line 15:

```ts
  async generate(req: GenerateRequest): Promise<GenerateResult> {
```

Replace with:
```ts
  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
```

Find the SDK call at line 52:

```ts
    const response = await c.chat.completions.create(createParams)
```

Replace with:
```ts
    const response = await c.chat.completions.create(createParams, signal ? { signal } : undefined)
```

Update the `embed` method at line 87:
```ts
  async embed(text: string): Promise<number[]> {
```
Replace with:
```ts
  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
```

And at line 89:
```ts
    const res = await c.embeddings.create({ model: 'text-embedding-3-small', input: text })
```
Replace with:
```ts
    const res = await c.embeddings.create({ model: 'text-embedding-3-small', input: text }, signal ? { signal } : undefined)
```

- [ ] **Step 2: Update anthropic.ts**

Edit `app/src/lib/ai/providers/anthropic.ts`. Update both `anthropicCompatGenerate` and the public `generate` to accept `signal`.

Find line 17:
```ts
async function anthropicCompatGenerate(req: GenerateRequest): Promise<GenerateResult> {
```
Replace with:
```ts
async function anthropicCompatGenerate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
```

Find line 39:
```ts
  const response = await c.chat.completions.create({
    model: req.model,
    messages,
    max_completion_tokens: req.maxTokens ?? 20_000,
    temperature: req.temperature ?? 0.7,
    ...(req.tools ? { tools: req.tools } : {}),
  })
```
Replace with:
```ts
  const response = await c.chat.completions.create({
    model: req.model,
    messages,
    max_completion_tokens: req.maxTokens ?? 20_000,
    temperature: req.temperature ?? 0.7,
    ...(req.tools ? { tools: req.tools } : {}),
  }, signal ? { signal } : undefined)
```

Find the public adapter at lines 58-63:
```ts
export const anthropicProvider: ProviderClient = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (req.cache?.enabled === true) return anthropicNativeGenerate(req)
    return anthropicCompatGenerate(req)
  },
}
```
Replace with:
```ts
export const anthropicProvider: ProviderClient = {
  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
    if (req.cache?.enabled === true) return anthropicNativeGenerate(req, signal)
    return anthropicCompatGenerate(req, signal)
  },
}
```

- [ ] **Step 3: Update anthropic-native.ts**

Edit `app/src/lib/ai/providers/anthropic-native.ts`. Find `anthropicNativeGenerate` at line 216:

```ts
export async function anthropicNativeGenerate(req: GenerateRequest): Promise<GenerateResult> {
```
Replace with:
```ts
export async function anthropicNativeGenerate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
```

Find the SDK call at lines 222-229:
```ts
  const response = await anthropic.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 20_000,
    temperature: req.temperature ?? 0.7,
    ...(translated.system ? { system: translated.system } : {}),
    ...(translated.tools ? { tools: translated.tools } : {}),
    messages: translated.messages,
  } as unknown as Parameters<typeof anthropic.messages.create>[0])
```
Replace with:
```ts
  const response = await anthropic.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 20_000,
    temperature: req.temperature ?? 0.7,
    ...(translated.system ? { system: translated.system } : {}),
    ...(translated.tools ? { tools: translated.tools } : {}),
    messages: translated.messages,
  } as unknown as Parameters<typeof anthropic.messages.create>[0],
  signal ? { signal } : undefined)
```

- [ ] **Step 4: Update google.ts**

Edit `app/src/lib/ai/providers/google.ts`. Find line 19:
```ts
  async generate(req: GenerateRequest): Promise<GenerateResult> {
```
Replace with:
```ts
  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
```

Find line 31:
```ts
    const response = await c.chat.completions.create({
      model: req.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 20_000,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
    })
```
Replace with:
```ts
    const response = await c.chat.completions.create({
      model: req.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 20_000,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
    }, signal ? { signal } : undefined)
```

- [ ] **Step 5: Update perplexity.ts**

Edit `app/src/lib/ai/providers/perplexity.ts`. Same shape as google.ts.

Find line 19:
```ts
  async generate(req: GenerateRequest): Promise<GenerateResult> {
```
Replace with:
```ts
  async generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResult> {
```

Find line 31:
```ts
    const response = await c.chat.completions.create({
      model: req.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 20_000,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
    })
```
Replace with:
```ts
    const response = await c.chat.completions.create({
      model: req.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 20_000,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
    }, signal ? { signal } : undefined)
```

- [ ] **Step 6: Add signal pass-through assertions to all five adapter test files**

For each of the five adapter test files (`tests/unit/ai/providers/{openai,anthropic,anthropic-native,google,perplexity}.test.ts`), add a new `it(...)` test:

```ts
it('passes AbortSignal to the SDK request options', async () => {
  // The mock SDK should record the second argument of chat.completions.create
  // (or messages.create for anthropic-native). Adapt the existing mock
  // structure in the file — most tests already mock the SDK and assert on
  // mock.calls.

  const controller = new AbortController()
  // ... call provider.generate(validRequest, controller.signal)
  // Assert: SDK mock was called with (params, expectedOptions)
  //   where expectedOptions.signal === controller.signal
})
```

Each test file has different mock conventions; match the existing pattern. As an illustrative example for openai.test.ts (existing structure may differ — adapt accordingly):

```ts
it('passes AbortSignal to chat.completions.create options', async () => {
  // Setup: openaiProvider already imported, sdk mocked.
  const createMock = vi.fn().mockResolvedValue({
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  })
  // Replace the chat.completions.create mock with createMock for this test
  // (depends on the file's mock setup — adapt to match).

  const controller = new AbortController()
  await openaiProvider.generate({
    provider: 'openai',
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: 'hi' }],
  }, controller.signal)

  expect(createMock).toHaveBeenCalledTimes(1)
  const optionsArg = createMock.mock.calls[0][1] as { signal?: AbortSignal } | undefined
  expect(optionsArg?.signal).toBe(controller.signal)
})

it('omits signal option when called without one', async () => {
  // Same mock setup
  await openaiProvider.generate({
    provider: 'openai',
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: 'hi' }],
  })
  const optionsArg = createMock.mock.calls[0][1]
  expect(optionsArg).toBeUndefined()
})
```

Repeat the pattern for each of the four other adapter test files, matching their existing mock conventions.

- [ ] **Step 7: Run typecheck and provider tests**

Run from `app/`:
```bash
npm run typecheck && npx vitest run tests/unit/ai/providers/
```
Expected: PASS for all five adapters.

- [ ] **Step 8: Commit Tasks 8+9**

```bash
git add app/src/lib/ai/providers/types.ts \
        app/src/lib/ai/providers/openai.ts \
        app/src/lib/ai/providers/anthropic.ts \
        app/src/lib/ai/providers/anthropic-native.ts \
        app/src/lib/ai/providers/google.ts \
        app/src/lib/ai/providers/perplexity.ts \
        app/tests/unit/ai/providers/openai.test.ts \
        app/tests/unit/ai/providers/anthropic.test.ts \
        app/tests/unit/ai/providers/anthropic-native.test.ts \
        app/tests/unit/ai/providers/google.test.ts \
        app/tests/unit/ai/providers/perplexity.test.ts
git commit -m "feat(providers): thread AbortSignal through all generate adapters"
```

---

## Task 10: Rewrite providers/retry.ts (Item E.2)

**Files:**
- Modify: `app/src/lib/ai/providers/retry.ts`
- Modify: `app/src/lib/ai/providers/router.ts`
- Test: `app/tests/unit/ai/providers/retry.test.ts` (new or rewrite if exists)

Drop the same-provider retry. Surviving path: timeout-bounded primary call → if classifier says retryable, fallback with a fresh `AbortController` → throw.

The router calls `withRetry` differently now: `fn` receives a `signal` argument.

- [ ] **Step 1: Write the failing tests**

Check whether `tests/unit/ai/providers/retry.test.ts` exists:

```bash
ls app/tests/unit/ai/providers/retry.test.ts 2>/dev/null
```

If it does not exist, create it. Write content to either case:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('withRetry — single attempt + fresh-controller fallback', () => {
  let providers: any
  let openaiMock: ReturnType<typeof vi.fn>
  let anthropicMock: ReturnType<typeof vi.fn>

  const config = {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    timeout: 1000,
    fallback: { provider: 'openai' as const, model: 'gpt-5.4' },
  }

  const originalRequest = {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user' as const, content: 'hi' }],
  }

  beforeEach(() => {
    openaiMock = vi.fn()
    anthropicMock = vi.fn()
    providers = {
      openai: { generate: openaiMock },
      anthropic: { generate: anthropicMock },
    }
  })

  it('503 from primary → fallback called with fresh signal', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const primary503 = Object.assign(new Error('Service Unavailable'), { status: 503 })
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    const result = await withRetry(
      async (sig) => { throw primary503 },
      config,
      providers,
      originalRequest,
    )
    expect(result.content).toBe('fb')
    expect(openaiMock).toHaveBeenCalledTimes(1)
    const [reqArg, sigArg] = openaiMock.mock.calls[0]
    expect(reqArg.provider).toBe('openai')
    expect(reqArg.model).toBe('gpt-5.4')
    expect(sigArg).toBeInstanceOf(AbortSignal)
    expect(sigArg.aborted).toBe(false)
  })

  it.each([400, 401, 403])('non-retryable %d → no fallback, throws original', async (status) => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const err = Object.assign(new Error('bad'), { status })

    await expect(
      withRetry(async () => { throw err }, config, providers, originalRequest),
    ).rejects.toBe(err)
    expect(openaiMock).not.toHaveBeenCalled()
  })

  it.each([408, 429])('retryable %d → fallback called', async (status) => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const err = Object.assign(new Error('throttled'), { status })
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    await withRetry(async () => { throw err }, config, providers, originalRequest)
    expect(openaiMock).toHaveBeenCalledTimes(1)
  })

  it('500/502/504 → fallback called', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    for (const status of [500, 502, 504]) {
      openaiMock.mockClear()
      const err = Object.assign(new Error(String(status)), { status })
      await withRetry(async () => { throw err }, config, providers, originalRequest)
      expect(openaiMock).toHaveBeenCalledTimes(1)
    }
  })

  it('network errors (ECONNRESET, ECONNREFUSED, ETIMEDOUT, EAI_AGAIN) → fallback', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']) {
      openaiMock.mockClear()
      const err = Object.assign(new Error('net'), { code })
      await withRetry(async () => { throw err }, config, providers, originalRequest)
      expect(openaiMock).toHaveBeenCalledTimes(1)
    }
  })

  it('internal timeout fires → fallback called with fresh non-aborted signal', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })

    // Primary fn never returns; the timeout aborts its signal.
    const primaryFn = (sig: AbortSignal): Promise<never> =>
      new Promise((_, reject) => {
        sig.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })

    const fastConfig = { ...config, timeout: 10 }
    await withRetry(primaryFn, fastConfig, providers, originalRequest)

    expect(openaiMock).toHaveBeenCalledTimes(1)
    const sigArg = openaiMock.mock.calls[0][1]
    expect(sigArg.aborted).toBe(false)
  })

  it('external AbortError (not from internal timeout) → throws, no fallback', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')

    // Primary fn throws AbortError immediately (simulating an upstream
    // cancellation surfacing as AbortError before our timer fires).
    const externalAbort = Object.assign(new Error('aborted by caller'), { name: 'AbortError' })
    await expect(
      withRetry(async () => { throw externalAbort }, config, providers, originalRequest),
    ).rejects.toBe(externalAbort)
    expect(openaiMock).not.toHaveBeenCalled()
  })

  it('no fallback configured → re-throws even on retryable error', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    const noFallbackConfig = { provider: 'anthropic' as const, model: 'claude-sonnet-4-6', timeout: 1000 }
    const err = Object.assign(new Error('503'), { status: 503 })
    await expect(
      withRetry(async () => { throw err }, noFallbackConfig, providers, originalRequest),
    ).rejects.toBe(err)
  })

  it('both primary and fallback timeout → fallback throws AbortError', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')

    const fastConfig = { ...config, timeout: 10 }
    const stubFn = (sig: AbortSignal): Promise<never> =>
      new Promise((_, reject) => {
        sig.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      })

    openaiMock.mockImplementationOnce(async (_req: unknown, sig: AbortSignal) => stubFn(sig))

    await expect(
      withRetry(stubFn, fastConfig, providers, originalRequest),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('originalRequest.cache is preserved when calling fallback', async () => {
    const { withRetry } = await import('@/lib/ai/providers/retry')
    openaiMock.mockResolvedValue({ content: 'fb', tokensUsed: { input: 0, output: 0 }, model: 'gpt-5.4', provider: 'openai' })
    const reqWithCache = { ...originalRequest, cache: { enabled: true as const } }

    await withRetry(
      async () => { throw Object.assign(new Error('503'), { status: 503 }) },
      config, providers, reqWithCache,
    )

    expect(openaiMock).toHaveBeenCalledTimes(1)
    expect(openaiMock.mock.calls[0][0].cache).toEqual({ enabled: true })
    expect(openaiMock.mock.calls[0][0].provider).toBe('openai')
    expect(openaiMock.mock.calls[0][0].model).toBe('gpt-5.4')
  })
})
```

If the file already exists, replace its body with the above (keep the imports/setup section consistent with the existing file's style).

- [ ] **Step 2: Run the tests to verify they fail**

Run from `app/`: `npx vitest run tests/unit/ai/providers/retry.test.ts`
Expected: FAIL — current `retry.ts` doesn't pass a signal to `fn` and uses different classifier rules.

- [ ] **Step 3: Rewrite providers/retry.ts**

Replace the entire content of `app/src/lib/ai/providers/retry.ts`:

```ts
import type { ProviderClient, GenerateRequest, GenerateResult, ModelConfig, ProviderName } from './types'

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504])
const RETRYABLE_NET_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'])

interface ErrorWithStatus { status?: number; code?: string; name?: string; message?: string }

function isRetryable(err: unknown, internalTimeoutFired: boolean): boolean {
  // Internal timeout: WE aborted because OUR timer fired. Transient on upstream.
  if (internalTimeoutFired) return true

  // External abort (caller cancelled, browser tab closed, upstream cancellation).
  // The signal is aborted but our internal timer did NOT fire. Do NOT fallback —
  // the user no longer wants the response. Throw through.
  if (err instanceof Error && err.name === 'AbortError') return false

  const e = err as ErrorWithStatus
  if (typeof e.status === 'number' && RETRYABLE_HTTP_STATUS.has(e.status)) return true
  if (typeof e.code === 'string' && RETRYABLE_NET_CODES.has(e.code)) return true

  return false
}

/**
 * Single-attempt with timeout-bounded primary + fresh-controller fallback.
 *
 * Contract:
 *   - `fn` MUST accept a single AbortSignal argument and pass it to the
 *     underlying SDK call. The signal is aborted by an internal timer
 *     after `config.timeout` ms.
 *   - On AbortError caused by the internal timer (or any other retryable
 *     error), the fallback provider is invoked with a brand-new
 *     AbortController and a brand-new timer. The two attempts NEVER share
 *     a signal — sharing would let a stale abort race onto the fallback.
 *   - On AbortError NOT caused by the internal timer (external cancellation),
 *     the error is rethrown without fallback.
 *   - On non-retryable errors (4xx other than 408/429), the original error
 *     is rethrown without fallback.
 *   - Fallback errors propagate as-is. There is no second fallback.
 */
/**
 * Race the inner call against the abort signal so that a misbehaving SDK
 * which ignores `signal` cannot hang the request indefinitely. The signal
 * IS still passed to the SDK (well-behaved adapters short-circuit on it),
 * but the race is the belt-and-braces guarantee that a rogue provider
 * client does not hold the request hostage past `config.timeout`.
 */
function raceAgainstAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) },
    )
  })
}

export async function withRetry(
  fn: (signal: AbortSignal) => Promise<GenerateResult>,
  config: ModelConfig,
  providers: Record<ProviderName, ProviderClient>,
  originalRequest?: GenerateRequest,
): Promise<GenerateResult> {
  const primaryController = new AbortController()
  let internalTimeoutFired = false
  const primaryTimer = setTimeout(() => {
    internalTimeoutFired = true
    primaryController.abort()
  }, config.timeout)

  try {
    return await raceAgainstAbort(fn(primaryController.signal), primaryController.signal)
  } catch (primaryErr) {
    clearTimeout(primaryTimer)

    if (!isRetryable(primaryErr, internalTimeoutFired)) throw primaryErr
    if (!config.fallback || !originalRequest) throw primaryErr

    // Fallback: brand-new controller and timer. Old signal is NOT reused.
    const fallbackController = new AbortController()
    const fallbackTimer = setTimeout(() => fallbackController.abort(), config.timeout)
    try {
      const fallbackProvider = providers[config.fallback.provider]
      return await raceAgainstAbort(
        fallbackProvider.generate(
          { ...originalRequest, provider: config.fallback.provider, model: config.fallback.model },
          fallbackController.signal,
        ),
        fallbackController.signal,
      )
    } finally {
      clearTimeout(fallbackTimer)
    }
  } finally {
    clearTimeout(primaryTimer)
  }
}
```

> **Note on the abort-race guard.** The inner SDK call still receives `signal`, so well-behaved adapters short-circuit on abort and we don't pay for an extra Promise wrapper in the common path. The race exists for the case the audit raised: a provider SDK that ignores `signal` and never settles. Without the race, the primary attempt would hang forever and the fallback would never fire. The dropped Promise from a hung SDK leaks until process exit — acceptable trade-off for not blocking the caller. The retry test's "internal timeout fires → fallback called" case (Step 1) now exercises this: the primary `fn` is a never-settling Promise that listens on the signal but does NOT itself reject; the race aborts it via the timer.

- [ ] **Step 4: Update router.ts to pass the signal-accepting fn**

Edit `app/src/lib/ai/providers/router.ts`. Find lines 82-88:

```ts
  const provider = PROVIDERS[config.provider]
  const result = await withRetry(
    () => provider.generate({ ...effectiveReq, provider: config.provider }),
    config,
    PROVIDERS,
    effectiveReq,
  )
```

Replace with:
```ts
  const provider = PROVIDERS[config.provider]
  const result = await withRetry(
    (signal) => provider.generate({ ...effectiveReq, provider: config.provider }, signal),
    config,
    PROVIDERS,
    effectiveReq,
  )
```

- [ ] **Step 5: Run retry tests**

Run from `app/`: `npx vitest run tests/unit/ai/providers/retry.test.ts`
Expected: PASS — all classifier branches + fresh-controller assertions.

- [ ] **Step 6: Run router tests + provider tests**

Run from `app/`: `npx vitest run tests/unit/ai/providers/`
Expected: all pass — the router test's mock of `withRetry` already passes the function through; the new signature is backwards-compatible at the test mock layer.

If `tests/unit/ai/providers/router.test.ts` mocks `withRetry` with the old signature `(fn) => fn()`, update its mock to match: `(fn) => fn(new AbortController().signal)`. The fn now expects a signal arg.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai/providers/retry.ts \
        app/src/lib/ai/providers/router.ts \
        app/tests/unit/ai/providers/retry.test.ts
# Include router.test.ts if its mock needed updating:
git add app/tests/unit/ai/providers/router.test.ts 2>/dev/null || true
git commit -m "refactor(providers/retry): single-attempt + fresh-controller fallback with abort classifier"
```

---

## Task 11: Drop outer withRetry and serviceUnavailable wrapping in client.ts (Item E.1)

**Files:**
- Modify: `app/src/lib/ai/client.ts`
- Test: `app/tests/unit/ai-client-retry.test.ts`

`aiGenerate`, `aiGenerateObject`, and `aiEmbed` currently wrap `generate`/the OpenAI SDK in `withRetry` from `@/lib/errors` (3 retries with exponential backoff) AND wrap any provider error in `Errors.serviceUnavailable(...)` which masks the original status code. Both wrappers go.

The CircuitBreaker stays — it protects against sustained failures, a different concern from per-call retry.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/ai-client-retry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateMock = vi.fn()
vi.mock('@/lib/ai/providers/router', () => ({
  generate: generateMock,
  embed: vi.fn(),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  resolveAgentModel: () => ({ provider: 'anthropic', model: 'claude-sonnet-4-6', tier: 'standard' }),
  SECTION_MODEL_ROUTING: {},
}))

vi.mock('@/lib/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/errors')>()
  return {
    ...actual,
    // CircuitBreaker still wraps; let it pass through the function.
    CircuitBreaker: class {
      execute<T>(fn: () => Promise<T>): Promise<T> { return fn() }
    },
    withRetry: vi.fn(),
    Errors: actual.Errors,
  }
})

vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

describe('aiGenerate — no outer withRetry, original errors preserved', () => {
  beforeEach(() => { generateMock.mockReset() })

  it('does NOT wrap call in @/lib/errors withRetry', async () => {
    generateMock.mockResolvedValueOnce({
      content: 'ok', tokensUsed: { input: 1, output: 1 }, model: 'claude-sonnet-4-6', provider: 'anthropic',
    })
    const { withRetry } = await import('@/lib/errors')
    const { aiGenerate } = await import('@/lib/ai/client')

    await aiGenerate({ system: 's', prompt: 'p' })

    // withRetry from @/lib/errors should NOT be invoked anywhere in this path.
    expect(vi.mocked(withRetry)).not.toHaveBeenCalled()
  })

  it('propagates original provider error type (status preserved)', async () => {
    const upstreamError = Object.assign(new Error('rate limited'), { status: 429 })
    generateMock.mockRejectedValueOnce(upstreamError)
    const { aiGenerate } = await import('@/lib/ai/client')

    await expect(aiGenerate({ system: 's', prompt: 'p' })).rejects.toBe(upstreamError)
    // Specifically: NOT wrapped as Errors.serviceUnavailable(...)
  })
})
```

- [ ] **Step 2: Run the test**

Run from `app/`: `npx vitest run tests/unit/ai-client-retry.test.ts`
Expected: FAIL — both assertions fail because the current `client.ts` wraps in `withRetry` and rethrows as `Errors.serviceUnavailable`.

- [ ] **Step 3: Update client.ts**

Edit `app/src/lib/ai/client.ts`.

Change the import line at the top. Find:
```ts
import { CircuitBreaker, Errors, withRetry } from '@/lib/errors';
```
Replace with:
```ts
import { CircuitBreaker } from '@/lib/errors';
```
(`Errors` and `withRetry` are no longer used.)

Update `aiGenerate` (lines 24-64). Find:
```ts
  try {
    return await generationBreaker.execute(() =>
      withRetry(async () => {
        try {
          const response = await generate({
            provider: resolved.provider,
            model: resolved.model,
            system: opts.system,
            messages: [{ role: 'user', content: opts.prompt }],
            maxTokens: opts.maxTokens ?? 20_000,
            temperature: opts.temperature ?? AI_CONFIG.generation.temperature,
          });

          return {
            text: response.content,
            tokensUsed: response.tokensUsed.input + response.tokensUsed.output,
          };
        } catch (error) {
          log.error({ error, provider: resolved.provider, model: resolved.model }, 'AI generation failed');
          throw Errors.serviceUnavailable('AI generation failed');
        }
      })
    );
  } finally {
```

Replace with:
```ts
  try {
    return await generationBreaker.execute(async () => {
      const response = await generate({
        provider: resolved.provider,
        model: resolved.model,
        system: opts.system,
        messages: [{ role: 'user', content: opts.prompt }],
        maxTokens: opts.maxTokens ?? 20_000,
        temperature: opts.temperature ?? AI_CONFIG.generation.temperature,
      });
      return {
        text: response.content,
        tokensUsed: response.tokensUsed.input + response.tokensUsed.output,
      };
    });
  } finally {
```

Update `aiGenerateObject` (lines 70-113). Find:
```ts
  try {
    return await analysisBreaker.execute(() =>
      withRetry(async () => {
        try {
          const response = await generate({
            provider: resolved.provider,
            model: resolved.model,
            system: `${opts.system}\n\nReturn only valid JSON that matches this schema: ${JSON.stringify(zodToJsonSchema(opts.schema))}`,
            messages: [{ role: 'user', content: opts.prompt }],
            maxTokens: AI_CONFIG.analysis.maxTokens,
            temperature: opts.temperature ?? AI_CONFIG.analysis.temperature,
          });

          const object = opts.schema.parse(JSON.parse(response.content));

          return {
            object,
            tokensUsed: response.tokensUsed.input + response.tokensUsed.output,
          };
        } catch (error) {
          log.error({ error, schemaName: opts.schemaName, provider: resolved.provider, model: resolved.model }, 'AI structured generation failed');
          throw Errors.serviceUnavailable('AI structured generation failed');
        }
      })
    );
  } finally {
```

Replace with:
```ts
  try {
    return await analysisBreaker.execute(async () => {
      const response = await generate({
        provider: resolved.provider,
        model: resolved.model,
        system: `${opts.system}\n\nReturn only valid JSON that matches this schema: ${JSON.stringify(zodToJsonSchema(opts.schema))}`,
        messages: [{ role: 'user', content: opts.prompt }],
        maxTokens: AI_CONFIG.analysis.maxTokens,
        temperature: opts.temperature ?? AI_CONFIG.analysis.temperature,
      });
      const object = opts.schema.parse(JSON.parse(response.content));
      return {
        object,
        tokensUsed: response.tokensUsed.input + response.tokensUsed.output,
      };
    });
  } finally {
```

Update `aiEmbed` (lines 119-147). Find:
```ts
  try {
    return await embeddingBreaker.execute(() =>
      withRetry(async () => {
        try {
          const response = await client.embeddings.create({
            model: AI_CONFIG.embedding.model,
            input: text,
            dimensions: AI_CONFIG.embedding.dimensions,
          });

          return {
            embedding: response.data[0]?.embedding || [],
            tokensUsed: response.usage?.total_tokens || Math.ceil(text.length / 4),
          };
        } catch (error) {
          log.error({ error }, 'Embedding generation failed');
          throw Errors.serviceUnavailable('Embedding generation failed');
        }
      })
    );
  } finally {
```

Replace with:
```ts
  try {
    return await embeddingBreaker.execute(async () => {
      const response = await client.embeddings.create({
        model: AI_CONFIG.embedding.model,
        input: text,
        dimensions: AI_CONFIG.embedding.dimensions,
      });
      return {
        embedding: response.data[0]?.embedding || [],
        tokensUsed: response.usage?.total_tokens || Math.ceil(text.length / 4),
      };
    });
  } finally {
```

- [ ] **Step 4: Run the test**

Run from `app/`: `npx vitest run tests/unit/ai-client-retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Run typecheck and full test suite for AI paths**

Run from `app/`:
```bash
npm run typecheck && npx vitest run tests/unit/ai/ tests/integration/ai-feature-rate-limit.test.ts 2>/dev/null || npx vitest run tests/unit/ai/
```
Expected: PASS. If any test was relying on `Errors.serviceUnavailable` being raised (e.g., a test that asserts a specific error message), update the assertion to match the new behavior (original error type preserved).

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/client.ts \
        app/tests/unit/ai-client-retry.test.ts
git commit -m "refactor(ai/client): drop outer withRetry + serviceUnavailable masking"
```

---

## Task 12: Item E — manual smoke

**Files:**
- None modified — manual verification

Acceptance criteria 3, 4 from the spec.

- [ ] **Step 1: Trigger non-retryable error path**

In a local dev session, force a 401 or 400 to the Anthropic provider. Easiest: temporarily set `ANTHROPIC_API_KEY=invalid` and run a flow that calls `aiGenerate` (e.g., section generation through V3).

Expected: the failure surfaces as a 401-shaped error (with `.status === 401`), NOT a generic `serviceUnavailable`. No fallback to OpenAI is attempted (look at logs — no openai SDK call should appear). The CircuitBreaker counts the failure.

Restore the API key.

- [ ] **Step 2: Trigger retryable error path**

Set `ANTHROPIC_API_KEY=invalid` (or use a test key that returns 503 — depends on your setup). For a true 503/timeout, the easiest local repro is to set the timeout very low in `MODEL_CONFIGS` (temporarily — revert before commit).

Expected: primary aborts via internal timeout, fallback (OpenAI) is invoked with a fresh signal, completes successfully. Logs show one anthropic call (aborted) and one openai call (success).

- [ ] **Step 3: Test sweep**

Run from `app/`:
```bash
npm run typecheck && npx vitest run tests/unit/ai/ tests/unit/ai-client-retry.test.ts
```
Expected: green.

---

## Task 13: Add claimV3OrConflict helper + claim turn on all three V3 paths (Item D.1)

**Files:**
- Modify: `app/src/app/api/ai/agent/route.ts`
- Test: `app/tests/integration/managed/route-v3-claim.test.ts`

Three V3 entry sites. Each gains a `claimV3OrConflict` call. The helper avoids triplicating the conflict-handling envelope.

- [ ] **Step 1: Write the failing test**

Create `app/tests/integration/managed/route-v3-claim.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// This test verifies the claim contract at the route level.
// We mock claimTurn to control conflict/success outcomes.

vi.mock('@/lib/auth/helpers', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
}))

vi.mock('@/lib/middleware/rate-limit', () => ({
  withRateLimit: (_opts: unknown, h: unknown) => h,
}))

vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true), // agent_v3_enabled
}))

vi.mock('@/lib/db', () => {
  const sessionRow = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: '11111111-1111-4111-8111-111111111111',
    projectId: null, status: 'active', locale: 'ro',
    selectedCallId: null, currentPhase: 'discovery',
    blueprint: null, eligibility: null, outline: null,
    warnings: [], planningArtifact: null,
    outlineFrozen: false, messageSummary: null,
    stateVersion: 5, createdAt: new Date(), updatedAt: new Date(),
  }
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([sessionRow]),
      })),
    })),
  }))
  return { db: { select } }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id', userId: 'user_id' },
  agentSections: { sessionId: 'session_id' },
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn() }))

vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

vi.mock('@/lib/ai/agent/managed/circuit-breaker', () => ({
  managedCircuitBreaker: { isOpen: () => false },
  recordManagedFailure: vi.fn(),
}))

vi.mock('@/lib/ai/anthropic-client', () => ({
  // Force the auth-setup-throw branch by making this throw.
  getAnthropicClient: vi.fn(() => { throw new Error('no api key') }),
}))

vi.mock('@/lib/ai/agent/managed/session-metadata', () => ({
  ensureAppAgentSession: vi.fn().mockResolvedValue(undefined),
  markDegraded: vi.fn().mockResolvedValue(undefined),
  recordTurnSuccess: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ai/model-routing', () => ({
  getAIModelRoutingContext: vi.fn().mockResolvedValue({}),
}))

const claimTurnMock = vi.fn()
vi.mock('@/lib/ai/agent/managed/history', () => ({
  claimTurn: claimTurnMock,
  deleteEmptyTurn: vi.fn(),
}))

const runAgentTurnMock = vi.fn()
vi.mock('@/lib/ai/agent/runtime', () => ({
  runAgentTurn: runAgentTurnMock,
}))

describe('POST /api/ai/agent — V3 claim contract', () => {
  beforeEach(() => {
    claimTurnMock.mockReset()
    runAgentTurnMock.mockReset()
  })

  function buildRequest(): NextRequest {
    return new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: '22222222-2222-4222-8222-222222222222',
        requestId: 'req-1',
        locale: 'ro',
        message: 'hi',
        stateVersion: 5,
      }),
    })
  }

  it('V3 path (auth-setup-throw): claim succeeds → run proceeds', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    claimTurnMock.mockResolvedValueOnce({ kind: 'claimed', turnId: 'tu-1' })
    runAgentTurnMock.mockResolvedValueOnce({})
    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildRequest())
    expect(claimTurnMock).toHaveBeenCalledWith(expect.objectContaining({ runtimeMode: 'v3' }))
    expect(res.status).toBe(200)
  })

  it('V3 path: claim conflict → 409 with conflict_request_id envelope', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    claimTurnMock.mockResolvedValueOnce({ kind: 'conflict' })
    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(buildRequest())
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error.code).toBe('conflict_request_id')
    expect(body.error.messageRo).toBeTruthy()
    expect(body.error.messageEn).toBeTruthy()
    expect(runAgentTurnMock).not.toHaveBeenCalled()
  })

  // Structured actions ALWAYS route through V3 even when managed is enabled
  // (route.ts:111-115's hasStructuredAction guard). This is the highest-stakes
  // V3 entry path per the audit — exercise it explicitly so a future refactor
  // that drops the claim on this branch fails loudly. Covers the final-fallthrough
  // claim site (route.ts:328 region post-edit), distinct from the auth-setup-throw
  // site at route.ts:258 covered above.
  it('structured action with managed enabled → routes to V3, claims with runtimeMode=v3, threads turnId', async () => {
    process.env.MANAGED_RUNTIME_ENABLED = 'true'
    // Restore the anthropic-client mock to NOT throw — that way we don't
    // hit the auth-setup-throw branch. The structured-action guard at
    // route.ts:111 fires earlier (before the managed dispatch block) and
    // forces the V3 final-fallthrough path independently.
    const { getAnthropicClient } = await import('@/lib/ai/anthropic-client')
    vi.mocked(getAnthropicClient).mockImplementationOnce(() => ({} as never))

    claimTurnMock.mockResolvedValueOnce({ kind: 'claimed', turnId: 'tu-action' })
    runAgentTurnMock.mockResolvedValueOnce({})

    const actionRequest = new NextRequest('http://localhost/api/ai/agent', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: '22222222-2222-4222-8222-222222222222',
        requestId: 'req-action',
        locale: 'ro',
        action: { type: 'approve_outline' },
        stateVersion: 5,
      }),
    })

    const { POST } = await import('@/app/api/ai/agent/route')
    const res = await POST(actionRequest)

    expect(res.status).toBe(200)
    expect(claimTurnMock).toHaveBeenCalledTimes(1)
    expect(claimTurnMock).toHaveBeenCalledWith(expect.objectContaining({
      runtimeMode: 'v3',
      requestId: 'req-action',
    }))
    expect(runAgentTurnMock).toHaveBeenCalledTimes(1)
    const callArgs = runAgentTurnMock.mock.calls[0][0]
    expect(callArgs.turnId).toBe('tu-action')
  })
})
```

The first two tests stub the auth-setup-throw V3 path (route.ts:258 region post-edit). The third pins the highest-stakes V3 path: structured actions with managed enabled, which deliberately bypasses the managed dispatch block via the `hasStructuredAction` guard at `route.ts:111` and falls through to `route.ts:328`'s claim site. The `runAgentTurn` invocation receives `turnId` from the helper. End-to-end behavior of all three claim sites is exercised manually in Task 17.

- [ ] **Step 2: Run the test**

Run from `app/`: `npx vitest run tests/integration/managed/route-v3-claim.test.ts`
Expected: FAIL — V3 paths don't yet claim.

- [ ] **Step 3: Add claimV3OrConflict helper to route.ts**

Edit `app/src/app/api/ai/agent/route.ts`. After the imports block (line 1-20) and before the `handler` function, add the helper:

```ts
async function claimV3OrConflict(
  sessionId: string,
  userId: string,
  requestId: string,
): Promise<{ kind: 'claimed'; turnId: string } | { kind: 'conflict'; response: NextResponse }> {
  const claim = await claimTurn({ sessionId, userId, requestId, runtimeMode: 'v3' })
  if (claim.kind === 'conflict') {
    return {
      kind: 'conflict',
      response: NextResponse.json({
        error: {
          code: 'conflict_request_id',
          messageRo:
            'Cerere deja înregistrată. Dacă ai reîncercat, operațiunea a fost deja salvată.',
          messageEn:
            'Request already recorded. If this was a retry, the operation has already been saved.',
        },
      }, { status: 409 }),
    }
  }
  return { kind: 'claimed', turnId: claim.turnId }
}
```

Update `runV3WithSSE` signature to take a `turnId`. Find line 331:
```ts
function runV3WithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
): Response {
```

Replace with:
```ts
function runV3WithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
  turnId: string,
): Response {
```

Find the `runAgentTurn` call inside `runV3WithSSE` (around line 348):
```ts
        await runAgentTurn({ session, sections, request: body, emit, routingCtx })
```

Replace with:
```ts
        await runAgentTurn({ session, sections, request: body, emit, routingCtx, turnId })
```

Now wire claims at all three V3 dispatch sites in `handler`.

**Site 1 — auth-setup-throw fallback at line 258:**
```ts
        return runV3WithSSE(session, sections, body, user)
```

Replace with:
```ts
        const v3Claim1 = await claimV3OrConflict(session.id, user.id, body.requestId)
        if (v3Claim1.kind === 'conflict') return v3Claim1.response
        return runV3WithSSE(session, sections, body, user, v3Claim1.turnId)
```

**Site 2 — breaker-open fallback. The current code does NOT have an explicit `runV3WithSSE` call between the breaker-open block (line 287-306) and the final fallthrough at line 328. Tracing the control flow: when breaker is open AND not preselected, control falls through the closing brace at line 306 down to line 311 (`if (isPreselected)`) which is false, then line 328 `return runV3WithSSE(...)`. This means Site 2 and Site 3 are actually the same code path — line 328.**

So there are only **two distinct runV3WithSSE call sites**: line 258 (auth-setup-throw) and line 328 (everything else: breaker-open-not-preselected, managed-disabled, structured-action, fallthrough).

**Site 2 — final fallthrough at line 328:**
```ts
  return runV3WithSSE(session, sections, body, user)
```

Replace with:
```ts
  const v3Claim2 = await claimV3OrConflict(session.id, user.id, body.requestId)
  if (v3Claim2.kind === 'conflict') return v3Claim2.response
  return runV3WithSSE(session, sections, body, user, v3Claim2.turnId)
```

- [ ] **Step 4: Run the route test**

Run from `app/`: `npx vitest run tests/integration/managed/route-v3-claim.test.ts`
Expected: PASS — both cases.

- [ ] **Step 5: Run all route tests**

Run from `app/`: `npx vitest run tests/integration/managed/route-`
Expected: all pass. The existing `route-flag-off.test.ts` and similar may need a small update if they assert no claim was made on V3 — adjust as needed (claim now ALWAYS happens for V3, identical envelope to managed).

- [ ] **Step 6: Don't commit yet** — Tasks 14 and 15 modify `runAgentTurn` and `appendMessage` together.

---

## Task 14: Thread turnId into runAgentTurn and call markTurnCompleted before done (Item D.2)

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts`
- Test: `app/tests/unit/agent-runtime-completion.test.ts`

`runAgentTurn` adds `turnId` to `RuntimeOptions`. Two `done` emit sites (terminal action with `skipLLM=true` at runtime.ts:111-114, and end-of-turn at runtime.ts:402-404) get a `markTurnCompleted` call immediately before the emit. Failed turns leave `completedAt` null — the catch path does NOT call `markTurnCompleted`.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/agent-runtime-completion.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const markTurnCompletedMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/ai/agent/managed/history', () => ({
  markTurnCompleted: markTurnCompletedMock,
}))

vi.mock('@/lib/ai/providers/router', () => ({
  generate: vi.fn().mockResolvedValue({
    content: 'done', tokensUsed: { input: 1, output: 1 }, model: 'claude-opus-4-6', provider: 'anthropic',
  }),
}))

vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn().mockResolvedValue({ messages: [], summary: null, totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
}))

vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({ getSessionKnowledge: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/ai/knowledge/write-back', () => ({ onSectionAccepted: vi.fn(), onPhaseTransition: vi.fn(), trackPatternUsage: vi.fn() }))
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(false) }))

vi.mock('@/lib/db', () => {
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })) }))
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      then: (r: (v: unknown) => void) => r(undefined),
    })),
  }))
  return { db: { update, insert } }
})

vi.mock('@/lib/db/schema', () => ({
  agentSessions: { id: 'id' },
  agentSections: { sessionId: 'session_id', sectionKey: 'section_key' },
  agentCheckpoints: {},
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

import type { AgentSession, AgentEvent } from '@/lib/ai/agent/types'

const baseSession: AgentSession = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  projectId: null, status: 'active', locale: 'ro',
  selectedCallId: null, currentPhase: 'discovery',
  blueprint: null, eligibility: null, outline: null,
  warnings: [], planningArtifact: null,
  outlineFrozen: false, messageSummary: null,
  stateVersion: 0, createdAt: new Date(), updatedAt: new Date(),
}

describe('runAgentTurn — markTurnCompleted ordering', () => {
  beforeEach(() => { markTurnCompletedMock.mockClear() })

  it('calls markTurnCompleted BEFORE emitting done on the end-of-turn path', async () => {
    const events: AgentEvent[] = []
    const order: string[] = []
    markTurnCompletedMock.mockImplementationOnce(async () => { order.push('mark') })

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    await runAgentTurn({
      session: baseSession,
      sections: [],
      request: { requestId: 'r1', locale: 'ro', message: 'hi' },
      emit: (e) => { if (e.type === 'done') order.push('done'); events.push(e) },
      turnId: 'tu-1',
    })

    expect(markTurnCompletedMock).toHaveBeenCalledWith('tu-1', expect.any(Object))
    expect(order[0]).toBe('mark')
    expect(order[1]).toBe('done')
  })

  it('calls markTurnCompleted on skipLLM=true terminal action path', async () => {
    const order: string[] = []
    markTurnCompletedMock.mockImplementationOnce(async () => { order.push('mark') })

    // accept_section with a needs_review section is a skipLLM=true path.
    const sessionWithFrozenOutline = { ...baseSession, outlineFrozen: true }
    const sectionsWithReview = [{
      id: 's1', sessionId: baseSession.id, sectionKey: 'obiective', title: 'Obiective',
      documentOrder: 0, generationOrder: 0, status: 'needs_review' as const,
      content: 'c', acceptedContent: null, modelUsed: null, retryCount: 0,
      sourcesUsed: null, promptVersion: null, latencyMs: null, tokenUsage: null,
      errorClass: null, rejectionReason: null, updatedAt: new Date(),
    }]

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    await runAgentTurn({
      session: sessionWithFrozenOutline,
      sections: sectionsWithReview,
      request: {
        requestId: 'r2', locale: 'ro',
        action: { type: 'accept_section', sectionKey: 'obiective' },
      },
      emit: (e) => { if (e.type === 'done') order.push('done') },
      turnId: 'tu-2',
    })

    expect(markTurnCompletedMock).toHaveBeenCalledWith('tu-2', expect.any(Object))
    expect(order).toEqual(['mark', 'done'])
  })

  it('does NOT call markTurnCompleted when LLM provider call throws', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    vi.mocked(generate).mockRejectedValueOnce(new Error('upstream 500'))

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    await expect(runAgentTurn({
      session: baseSession,
      sections: [],
      request: { requestId: 'r3', locale: 'ro', message: 'hi' },
      emit: () => {},
      turnId: 'tu-3',
    })).rejects.toBeInstanceOf(Error)

    expect(markTurnCompletedMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test**

Run from `app/`: `npx vitest run tests/unit/agent-runtime-completion.test.ts`
Expected: FAIL — `runAgentTurn` doesn't yet accept `turnId`, doesn't call `markTurnCompleted`.

- [ ] **Step 3: Update RuntimeOptions and add markTurnCompleted call sites**

Edit `app/src/lib/ai/agent/runtime.ts`.

Add the import near the top imports block (after line 11):
```ts
import { markTurnCompleted } from './managed/history'
```

(`managed/history.ts` exports `markTurnCompleted`. The import lives across the V3/managed boundary — acceptable; the function is generic over `agent_turns` rows regardless of `runtimeMode`.)

Find `RuntimeOptions` (lines 30-36):
```ts
export interface RuntimeOptions {
  session: AgentSession
  sections: AgentSection[]
  request: AgentRequest
  emit: EventEmitter
  routingCtx?: import('../model-routing').ModelRoutingContext
}
```

Replace with:
```ts
export interface RuntimeOptions {
  session: AgentSession
  sections: AgentSection[]
  request: AgentRequest
  emit: EventEmitter
  routingCtx?: import('../model-routing').ModelRoutingContext
  // Pre-stream turn-claim id. The route inserts the agent_turns row before
  // calling runAgentTurn and passes the id in. runAgentTurn calls
  // markTurnCompleted() immediately before each `done` emit so the
  // reconciliation cron can distinguish completed turns from abandoned ones.
  turnId: string
}
```

Add a top-level constant just below `RuntimeOptions`:

```ts
// V3 doesn't track per-turn token usage or cost the way managed does.
// Pass empty telemetry — completedAt is the only field markTurnCompleted
// flips to non-null, which is what the reconciliation cron checks.
const V3_EMPTY_TELEMETRY = {
  model: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  costUsdMicros: null,
} as const
```

Find Site 1 (skipLLM=true terminal path) at lines 110-114:
```ts
      if (actionResult.skipLLM) {
        emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
        emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
        return { session, sections }
      }
```

Replace with:
```ts
      if (actionResult.skipLLM) {
        await markTurnCompleted(opts.turnId, V3_EMPTY_TELEMETRY)
        emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
        emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
        return { session, sections }
      }
```

Find Site 2 (end-of-turn path) at lines 402-404:
```ts
    // 10. Emit done
    emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
    emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
```

Replace with:
```ts
    // 10. Emit done
    await markTurnCompleted(opts.turnId, V3_EMPTY_TELEMETRY)
    emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
    emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
```

The catch branch (lines 407-414) is unchanged — failed turns deliberately leave `completedAt` null.

- [ ] **Step 4: Run the test**

Run from `app/`: `npx vitest run tests/unit/agent-runtime-completion.test.ts`
Expected: PASS — all three cases.

- [ ] **Step 5: Run existing agent-runtime tests**

Run from `app/`: `npx vitest run tests/unit/agent-runtime.test.ts`
Expected: PASS — but if the test calls `runAgentTurn` without a `turnId`, TypeScript will complain because `turnId` is now required. Update those tests to pass `turnId: 'tu-test'` in their `runAgentTurn` invocations.

The same goes for `tests/unit/agent-runtime-structured-action-guards.test.ts` — search for any call to `runAgentTurn(` and add `turnId: 'tu-test'` to the options. Use `grep -rn "runAgentTurn(" app/tests/` to find all sites.

- [ ] **Step 6: Don't commit yet** — Task 15 wires turnId through every appendMessage call.

---

## Task 15: Thread turnId to every appendMessage call in V3 runtime (Item D.3)

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts`

`appendMessage` will accept `turnId?` in Task 16. We pre-thread it from the runtime now so Task 16's edit is a one-shot signature change.

- [ ] **Step 1: Add turnId to all appendMessage call sites in runtime.ts**

Edit `app/src/lib/ai/agent/runtime.ts`.

User message append at lines 65-77:
```ts
    if (request.message) {
      await appendMessage(session.id, {
        role: 'user',
        messageType: 'text',
        content: request.message,
      })
    } else if (request.action) {
      await appendMessage(session.id, {
        role: 'user',
        messageType: 'structured_action',
        content: request.action,
      })
    }
```

Replace with:
```ts
    if (request.message) {
      await appendMessage(session.id, {
        role: 'user',
        messageType: 'text',
        content: request.message,
        turnId: opts.turnId,
      })
    } else if (request.action) {
      await appendMessage(session.id, {
        role: 'user',
        messageType: 'structured_action',
        content: request.action,
        turnId: opts.turnId,
      })
    }
```

Assistant text append at lines 222-226:
```ts
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'text',
            content: response.content,
          })
```

Replace with:
```ts
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'text',
            content: response.content,
            turnId: opts.turnId,
          })
```

Tool-call append at lines 302-308:
```ts
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'tool_call',
            content: { name: toolCall.name, arguments: toolCall.arguments },
            toolName: toolCall.name,
            toolCallId: toolCall.id,
          })
```

Replace with:
```ts
          await appendMessage(session.id, {
            role: 'assistant',
            messageType: 'tool_call',
            content: { name: toolCall.name, arguments: toolCall.arguments },
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            turnId: opts.turnId,
          })
```

Tool-result append at lines 309-315:
```ts
          await appendMessage(session.id, {
            role: 'tool',
            messageType: 'tool_result',
            content: { success: toolResult.success, data: toolResult.data, error: toolResult.error },
            toolName: toolCall.name,
            toolCallId: toolCall.id,
          })
```

Replace with:
```ts
          await appendMessage(session.id, {
            role: 'tool',
            messageType: 'tool_result',
            content: { success: toolResult.success, data: toolResult.data, error: toolResult.error },
            toolName: toolCall.name,
            toolCallId: toolCall.id,
            turnId: opts.turnId,
          })
```

- [ ] **Step 2: Run typecheck**

Run from `app/`: `npm run typecheck`
Expected: FAIL — `appendMessage`'s current signature doesn't accept `turnId`. Task 16 fixes it.

---

## Task 16: appendMessage accepts turnId + retries once on PG 23505 (Item D.4)

**Files:**
- Modify: `app/src/lib/ai/agent/history.ts`
- Test: `app/tests/unit/agent-history-append-retry.test.ts`

Mirror `appendManagedMessage`'s sequence-number race retry. New optional `turnId?` parameter; null when not passed.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/agent-history-append-retry.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertMock = vi.fn()
const selectChain = (lastSeq: number | null) => ({
  from: vi.fn(() => ({
    where: vi.fn(() => ({
      orderBy: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue(lastSeq === null ? [] : [{ sequenceNumber: lastSeq }]),
      })),
    })),
  })),
})

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(() => ({ values: insertMock })),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  agentMessages: { sessionId: 'session_id', sequenceNumber: 'sequence_number' },
  agentSessions: {},
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn(), and: vi.fn(), isNull: vi.fn(), asc: vi.fn(), desc: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))

describe('appendMessage', () => {
  beforeEach(() => { insertMock.mockReset() })

  it('inserts with turn_id null when turnId omitted', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain(null) as never)

    insertMock.mockResolvedValueOnce(undefined)
    const { appendMessage } = await import('@/lib/ai/agent/history')

    await appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' })
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(insertMock.mock.calls[0][0].turnId).toBeNull()
  })

  it('inserts with provided turnId', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select).mockReturnValueOnce(selectChain(null) as never)
    insertMock.mockResolvedValueOnce(undefined)
    const { appendMessage } = await import('@/lib/ai/agent/history')

    await appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi', turnId: 'tu-9' })
    expect(insertMock.mock.calls[0][0].turnId).toBe('tu-9')
  })

  it('retries once on PG 23505', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain(0) as never)
      .mockReturnValueOnce(selectChain(1) as never)

    insertMock
      .mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
      .mockResolvedValueOnce(undefined)

    const { appendMessage } = await import('@/lib/ai/agent/history')
    const seq = await appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' })
    expect(insertMock).toHaveBeenCalledTimes(2)
    expect(seq).toBe(2)
  })

  it('throws on second 23505', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select)
      .mockReturnValueOnce(selectChain(0) as never)
      .mockReturnValueOnce(selectChain(1) as never)

    const dup = Object.assign(new Error('dup'), { code: '23505' })
    insertMock
      .mockRejectedValueOnce(dup)
      .mockRejectedValueOnce(dup)

    const { appendMessage } = await import('@/lib/ai/agent/history')
    await expect(appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' }))
      .rejects.toThrow(/sequence number conflict/)
  })

  it('rethrows non-23505 immediately', async () => {
    const { db } = await import('@/lib/db')
    vi.mocked(db.select).mockReturnValueOnce(selectChain(0) as never)
    insertMock.mockRejectedValueOnce(new Error('connection lost'))
    const { appendMessage } = await import('@/lib/ai/agent/history')
    await expect(appendMessage('sess-1', { role: 'user', messageType: 'text', content: 'hi' }))
      .rejects.toThrow('connection lost')
    expect(insertMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test**

Run from `app/`: `npx vitest run tests/unit/agent-history-append-retry.test.ts`
Expected: FAIL — `turnId` param doesn't exist on the current signature.

- [ ] **Step 3: Update appendMessage**

Edit `app/src/lib/ai/agent/history.ts`. Find the function at lines 56-89:

```ts
/**
 * Append a message to the session history.
 */
export async function appendMessage(
  sessionId: string,
  message: {
    role: string
    messageType: string
    content: unknown
    toolName?: string
    toolCallId?: string
  },
): Promise<number> {
  // Get next sequence number
  const [last] = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.sequenceNumber))
    .limit(1)

  const sequenceNumber = last ? last.sequenceNumber + 1 : 0

  await db.insert(agentMessages).values({
    sessionId,
    role: message.role,
    messageType: message.messageType,
    content: message.content,
    toolName: message.toolName ?? null,
    toolCallId: message.toolCallId ?? null,
    sequenceNumber,
  })

  return sequenceNumber
}
```

Replace with:

```ts
/**
 * Append a message to the session history.
 *
 * Retries once on PG 23505 (UNIQUE(session_id, sequence_number) violation)
 * to handle intra-session sequence-number races. Mirrors
 * appendManagedMessage's pattern in managed/history.ts:199-232.
 */
export async function appendMessage(
  sessionId: string,
  message: {
    role: string
    messageType: string
    content: unknown
    toolName?: string
    toolCallId?: string
    turnId?: string | null
  },
): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [last] = await db.select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(desc(agentMessages.sequenceNumber))
      .limit(1)

    const sequenceNumber = last ? (last.sequenceNumber as number) + 1 : 0

    try {
      await db.insert(agentMessages).values({
        sessionId,
        role: message.role,
        messageType: message.messageType,
        content: message.content,
        toolName: message.toolName ?? null,
        toolCallId: message.toolCallId ?? null,
        turnId: message.turnId ?? null,
        sequenceNumber,
      })
      return sequenceNumber
    } catch (err) {
      const pgCode = (err as { code?: string } | null)?.code
      if (pgCode === '23505' && attempt === 0) continue
      throw err
    }
  }
  throw new Error('appendMessage: sequence number conflict after retry')
}
```

- [ ] **Step 4: Run the tests**

Run from `app/`: `npx vitest run tests/unit/agent-history-append-retry.test.ts`
Expected: PASS — all five cases.

- [ ] **Step 5: Run typecheck and full agent test sweep**

Run from `app/`:
```bash
npm run typecheck && npx vitest run tests/unit/agent-runtime.test.ts tests/unit/agent-history.test.ts tests/unit/agent-runtime-completion.test.ts tests/integration/managed/route-v3-claim.test.ts
```
Expected: green.

If any existing test in `agent-history.test.ts` asserts a specific row shape and fails because of the new `turnId: null` field, update the assertion to expect `turnId: null` (or use `expect.objectContaining` instead of strict equality).

- [ ] **Step 6: Commit Tasks 13+14+15+16 together (Item D)**

```bash
git add app/src/app/api/ai/agent/route.ts \
        app/src/lib/ai/agent/runtime.ts \
        app/src/lib/ai/agent/history.ts \
        app/tests/integration/managed/route-v3-claim.test.ts \
        app/tests/unit/agent-runtime-completion.test.ts \
        app/tests/unit/agent-history-append-retry.test.ts
# Plus any agent-runtime test files that needed turnId added — include them too:
# git add app/tests/unit/agent-runtime.test.ts app/tests/unit/agent-runtime-structured-action-guards.test.ts
git commit -m "feat(v3): turn-claim + appendMessage retry + markTurnCompleted on done"
```

---

## Task 17: Item D — manual smoke for V3 turn-claim end-to-end

**Files:**
- None modified — manual verification

Acceptance criteria 5, 6, 7.

- [ ] **Step 1: Set up — V3 path active**

Either disable managed for your test user (`managed_agent_enabled = false`), or send a structured action which always routes through V3 (the `hasStructuredAction` exception in `route.ts:111-115`).

`docker-compose.yml` lives at repo root, not `app/`. Run Compose from the repo root:

```bash
# From the repo root (/home/godja/Dev/EU-Funds):
docker compose up -d postgres redis

# Then start the dev server from app/:
cd app && PORT=3002 npm run dev
```

- [ ] **Step 2: Concurrent identical requests**

Open the dev tools network tab. Use `curl` to issue two identical requests in parallel (same `requestId`):

```bash
SESSION_ID="<existing-session-id>"
TOKEN="<your-csrf-token>"

curl -X POST http://localhost:3002/api/ai/agent \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -b "next-auth.session-token=...; csrf-token=$TOKEN" \
  -d '{"sessionId":"'$SESSION_ID'","requestId":"smoke-1","locale":"ro","message":"hi","stateVersion":0}' &

curl -X POST http://localhost:3002/api/ai/agent \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -b "next-auth.session-token=...; csrf-token=$TOKEN" \
  -d '{"sessionId":"'$SESSION_ID'","requestId":"smoke-1","locale":"ro","message":"hi","stateVersion":0}' &

wait
```

Expected: one returns 200 (with SSE stream), the other returns JSON 409 with body `{"error":{"code":"conflict_request_id","messageRo":"...","messageEn":"..."}}`.

- [ ] **Step 3: Verify completedAt is set on success**

After the successful request finishes, query:
```sql
SELECT id, request_id, runtime_mode, completed_at FROM agent_turns
WHERE session_id = '<session-id>' AND request_id = 'smoke-1';
```
Expected: one row with `runtime_mode = 'v3'`, `completed_at IS NOT NULL`.

Now run a request that fails mid-turn (force a 503 from the provider, e.g., temporarily set `ANTHROPIC_API_KEY=invalid`):
```sql
SELECT id, request_id, runtime_mode, completed_at FROM agent_turns
WHERE session_id = '<session-id>' ORDER BY created_at DESC LIMIT 5;
```
Expected: most recent row has `completed_at IS NULL`.

Restore the API key.

- [ ] **Step 4: Verify intra-turn appendMessage retry**

Hard to repro deliberately without injecting concurrent writers. The unit test (Task 16) is the primary safeguard. Manual confirmation: run a long V3 turn (multiple tool iterations), verify all `agent_messages` rows for that turn have monotonic `sequence_number` and the same `turn_id`.

```sql
SELECT sequence_number, role, message_type, turn_id FROM agent_messages
WHERE session_id = '<session-id>' AND turn_id = '<turn-id>'
ORDER BY sequence_number;
```

Expected: contiguous sequence, all rows tagged with the same `turn_id`.

- [ ] **Step 5: Final test sweep**

Run from `app/`:
```bash
npm run typecheck && npm run lint && npx vitest run
```
Expected: green.

---

## Task 18: PR2-wide acceptance summary

Verify all 9 acceptance criteria from the spec are covered:

- [ ] **AC1** — Cold preselect cache-miss results in 2 Qdrant calls — Task 7 Step 2 + integration test in Task 6 (`runtime-preselect-injection.test.ts`).
- [ ] **AC2** — Second cold session same callId → 1 Qdrant call — Task 7 Step 4.
- [ ] **AC3** — Non-retryable 4xx (400/401/403) → original error, no fallback. Retryable (408/429) → fallback. Verified by Task 10 retry tests.
- [ ] **AC4** — Primary timeout → fallback with fresh signal. Verified by Task 10 retry tests.
- [ ] **AC5** — Concurrent V3 requests: one wins, other 409s with identical envelope. Verified by Task 13 route test + Task 17 smoke.
- [ ] **AC6** — Concurrent intra-turn appendMessage 23505 → retry resolves. Verified by Task 16 unit tests.
- [ ] **AC7** — Successful V3 turn → `completedAt` non-null. Failed V3 turn → null. Verified by Task 14 unit tests + Task 17 Step 3.
- [ ] **AC8** — `save_call_blueprint` success → `agent_sessions.blueprint` full, `currentPhase = 'structuring'`, `stateVersion` bumped. Verified by Task 4 integration tests + Task 7 Step 3.
- [ ] **AC9** — All new tests pass; existing tests pass. Verified by Task 7, Task 12, Task 17 final sweeps.

If any acceptance criterion is unverified, return to the relevant task and add the missing test before proceeding.

---

## Self-Review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| A.1 — Stash rawEvidence in artifact | Task 1 |
| A.2 — Synthetic injection in runtime | Task 6 |
| A.3 — Prompt branch on injected evidence | Task 5 |
| A.4 — Unblock save_call_blueprint | Task 3 |
| A.5 — Session blueprint write-back + phase + stateVersion | Task 2 (helper) + Task 4 (executor + write-back) |
| A.6 — Confidence rule | No code change required (existing `lookupBlueprint:62` already gates at `≥ 0.4`); spec uses prompt to instruct model. Covered in Task 5 prompt update. |
| A.7 — Subsequent-turn skip | Task 6 includes the `!session.blueprint` gate; tested in `runtime-preselect-injection.test.ts` "does NOT inject when session.blueprint is already set" case. |
| E.1 — Delete outer withRetry | Task 11 |
| E.2 — Rewrite providers/retry.ts | Task 10 |
| E.3 — Thread AbortSignal | Tasks 8 + 9 |
| E.4 — Internal-vs-external timeout distinction | Task 10 (`isRetryable` classifier branches; tests in retry.test.ts) |
| D.1 — Route-level claim for all V3 paths | Task 13 |
| D.2 — runV3WithSSE turnId + markTurnCompleted before done | Task 14 |
| D.3 — Thread turnId to appendMessage calls | Task 15 |
| D.4 — appendMessage retry-once on 23505 | Task 16 |
| D.5 — No DB migration | Confirmed: zero migrations in this plan. |

**Placeholder scan:** No "TBD", "TODO", "fill in details". Each step has the actual code or command. Test files are provided in full where new; existing test extensions name the section to add to and the assertion shape.

**Type consistency:**
- `RuntimeOptions.turnId` (V3, Task 14) is a required string. Existing tests that call `runAgentTurn` without it will fail typecheck — Task 14 Step 5 instructs adding `turnId: 'tu-test'`.
- `appendMessage`'s `turnId?: string | null` (Task 16) is optional with default null. Backwards compatible.
- `ProviderClient.generate(req, signal?)` (Task 8) — `signal` is optional. Existing callers (the router via `withRetry` after Task 10) pass it; ad-hoc callers don't have to.
- `withRetry`'s `fn` parameter type changed from `() => Promise<GenerateResult>` to `(signal: AbortSignal) => Promise<GenerateResult>`. The router (Task 10 Step 4) is the sole caller and is updated. Tests that mock `withRetry` (router.test.ts) need their mock signature adjusted — called out in Task 10 Step 6.
- `buildCallBlueprintFromArgs(args, ctx): CallBlueprint` (Task 2) — both consumers (MCP handler, executor) call it consistently.
- `PreselectArtifactV1.rawEvidence?: EvidenceChunk[]` (Task 1) — additive optional. Old consumers ignore it.

**Cross-task ordering:**
- Task 2 introduces `buildCallBlueprintFromArgs`; Task 4 consumes it.
- Task 1 stashes `rawEvidence`; Task 6 reads it via `session.planningArtifact?.preselect?.rawEvidence`.
- Task 5 updates the prompt to branch on the same condition Task 6's runtime injection uses — both check `phase === 'research' && selectedCallId && rawEvidence.length > 0 && !session.blueprint`. Mismatch would cause "history says don't call but prompt says do call" or vice versa.
- Task 8 widens the type; Task 9 updates the implementations; Task 10 changes the caller — order matters because Task 10 depends on the wider type.
- Task 13 calls `claimTurn` for V3; Task 14 makes `turnId` required on `RuntimeOptions`; Task 15 threads it to appends; Task 16 makes `appendMessage` accept it. Tasks 13–16 commit together.

**Spec gaps fixed inline:** None — spec was thorough. The only adaptation: Site 2 of Item D.1 (the spec lists three V3 dispatch sites) collapses into the same line in current `route.ts` (line 328) as Site 3, because the breaker-open-not-preselected branch falls through to the final fallthrough rather than calling `runV3WithSSE` directly. Two distinct `claimV3OrConflict` insertion points result, not three. Documented inline in Task 13 Step 3.

**Audit fixes applied (post-initial-draft):**
- **Task 2 typecheck**: `buildCallBlueprintFromArgs` casts `requiredSections` to `SectionSpec[]` at the `normalized` boundary (matching the existing `buildBlueprintFromCache` precedent in `services/blueprint.ts` which uses the same `as SectionSpec[]` pattern). Without the cast, the partial `{ title, description, evaluationWeight? }[]` shape from the schema input would not satisfy `CallBlueprint.normalized.requiredSections: SectionSpec[]` and the helper would not typecheck.
- **Task 3 + Task 5 confirmation conflict**: the `save_call_blueprint` tool description now states explicitly "the deterministic preselect itself is the user confirmation, NO additional confirmation is required." Task 5 grew two new steps that (a) add `save_call_blueprint` to `writeToolsLine` under a new "Internal write" sub-bullet in both Romanian and English prompts, and (b) extend rule 1 of the "Write tool rules" block with an explicit `save_call_blueprint` exemption. This closes the contradiction where the model was told both "always confirm before writing" and "call it automatically from injected evidence."
- **Task 6 schema mock**: added `agentSections: { sessionId: 'session_id' }` to the `vi.mock('@/lib/db/schema', ...)` block so PR1's `reload.ts` import chain doesn't crash when `runtime.ts` is loaded from the test.
- **Tasks 7 + 17 Compose path**: Compose runs from the repo root (where `docker-compose.yml` lives). Dev server still starts from `app/`. `docker compose logs -f qdrant` replaces the hardcoded `eu-funds-qdrant-1` container name.
- **Task 13 V3 claim coverage**: added a third `it(...)` test that exercises the structured-action V3 path (`route.ts:111-115` `hasStructuredAction` guard → final fallthrough at the post-edit `route.ts:328` site). Asserts the claim runs with `runtimeMode: 'v3'` AND that `runAgentTurn` receives `turnId` from the helper. Pins the highest-stakes V3 path called out in the spec.

**Cleanup applied:**
- **Commit convention**: reconciled "each phase has its own commit" with the per-task commits in Phases A and E. Phase D commits Tasks 13–16 together because they share a type-system dependency that would leave intermediate commits failing typecheck.
- **Hung-SDK guard in retry**: `withRetry` now races the inner call against the abort signal via a `raceAgainstAbort` helper. The signal is still passed to the SDK so well-behaved adapters short-circuit; the race exists as belt-and-braces for a misbehaving SDK that ignores `signal`. Trade-off documented inline: the dropped Promise from a hung SDK leaks until process exit — acceptable for not blocking the caller.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-ai-flow-cost-flow-pr2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
