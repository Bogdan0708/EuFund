# V3 + RAG Prompt Caching — Plan 2 (PR 2a, PR 2b, PR 2c — V3 opt-in + canary)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt the V3 runtime into Anthropic prompt caching and run it to 100% in production via a flag-gated canary, without touching the router, adapters, translator, cost, or telemetry modules landed in PR 1.

**Architecture:** Three PRs, each lands independently.
- **PR 2a** splits `buildSystemPrompt()` so the stable prefix (role + rules + `PHASE_GUIDANCE[phase]`) is byte-identical across turns within `(sessionId, phase)` and the volatile "Current Session State" tail becomes a separate `role: 'system'` message that the native Anthropic translator will hoist as an **uncached** additional system block. Zero cache opt-in — pure refactor, guarded by a structural stability test (asserts `req.system` byte-equality across turns and state-block travel, not text-output parity against the pre-refactor runtime).
- **PR 2b** adds a V3-specific rollout flag `v3_prompt_cache_enabled` (percentage targeted on `userId`) and threads `cache: { enabled: true, breakpoints: ['system', 'tools'] }` into the `generate()` call site in `runtime.ts` only when the flag resolves true for the session's user. Global kill switch `prompt_cache_enabled` (Plan 1) remains the outer gate.
- **PR 2c** is operational: ramp the V3 flag `1% → 10% → 50% → 100%` in production, with explicit canary tripwires and rollback procedure.

**Tech Stack:** TypeScript, Next.js 14, Vitest, Drizzle (hand-authored migrations per `CLAUDE.md`), `@anthropic-ai/sdk` (indirectly via PR 1's native adapter), `lib/feature-flags`, `lib/monitoring/metrics`, `lib/logger`.

**Reference:**
- Design spec: `docs/superpowers/specs/2026-04-21-v3-rag-prompt-caching-design.md`. Section numbers below (§N.M) refer to that document.
- PR 0 audit: `docs/runbooks/audits/v3-prompt-stability-2026-04.md`.
- PR 1 plan (landed as commit `78052eb`): `docs/superpowers/plans/2026-04-21-v3-rag-prompt-caching-pr0-pr1.md`.
- Runbook: `docs/runbooks/ai-caching.md`.

**Scope boundary:** V3 only. Do not modify:
- `lib/ai/providers/router.ts` (router resolution + logging + metrics — landed in PR 1).
- `lib/ai/providers/anthropic.ts`, `anthropic-native.ts`, `openai.ts`, `google.ts`, `perplexity.ts` (adapters — landed in PR 1).
- `lib/ai/providers/cache-key.ts` (identity key — landed in PR 1).
- `lib/ai/cost/*` (cost helpers — landed in PR 1).
- `lib/monitoring/metrics.ts` (Prometheus counters — landed in PR 1).
- `lib/ai/providers/types.ts` (router contract — landed in PR 1).

RAG opt-in is **Plan 3**. One-shot callers are **Plan 4**. Managed model centralization is **Plan 5**. Those are out of scope here.

---

## Decisions locked for this plan (justification)

### D1. Cache key strategy: do **NOT** override `cache.key` for V3.

Router auto-derives `identityKey = sha256(provider + model + system + tools)` per §5.3. V3 today is Anthropic-only (`provider: 'anthropic'`, `model: 'claude-opus-4-6'` — see `lib/ai/agent/runtime.ts:167-173`).

- Anthropic caching is implicit and prefix-byte-equality based — `cache.key` is **ignored** by the Anthropic adapter. Setting a per-session key gains nothing on the primary path.
- `cache.key` is only consumed by OpenAI as `prompt_cache_key` (§6.2). If V3 ever cross-provider-fallbacks onto OpenAI (`MODEL_CONFIGS[claude-opus-4-6].fallback`), a **shared** identityKey across sessions with the same stable prefix maximizes OpenAI's cache routing hit rate. A per-session `v3:{sessionId}:{phase}` key would fragment OpenAI's cache and cold-start every session.
- Telemetry grouping uses `identityKey` (§9.1 log shape), which naturally groups same-phase V3 sessions — exactly what ops wants.

Spec §7.2's code example shows `key: 'v3:${session.id}:${session.currentPhase}'`. **This plan deviates from that example** for the reasons above. If a future V3 change requires isolation (e.g. session-scoped prompt elements intentionally enter the prefix), revisit.

### D2. Breakpoints: `['system', 'tools']` — both.

- **System**: After PR 2a, `req.system` is byte-identical for the life of `(sessionId, phase)` (PR 0 audit §5 verdict; further stabilized by PR 2a structural split).
- **Tools**: `getToolsForPhase(phase)` is deterministic per-process (see Task 2 verification, which checks name order AND full zodToJsonSchema output hash). Adapter stamps `cache_control` on the **last** tool only (`anthropic-native.ts:119-128`), so tool-list order stability + schema-bytes stability are both prerequisites.

### D3. Volatile tail: Option (a) from PR 0 audit §4 — move out of `req.system`, push as a `role: 'system'` message.

The native adapter's `translateMessages()` hoists `role: 'system'` entries in `messages` to **additional uncached system blocks** appended after `req.system` (`anthropic-native.ts:52-59, 111-114`). The cached prefix stays stable; the volatile state block is delivered to the model in a near-adjacent position but as an uncached block.

**Effective system-block ordering change (acknowledged, not mitigated):**

| | Pre-refactor (single `req.system` string) | Post-refactor (split) |
|---|---|---|
| Block 1 | persona ("You are FondEU…") | persona ("You are FondEU…") |
| Block 2 | `## Current Session State` (Phase, Selected call, Eligibility, Session knowledge, Sections, Active warnings) | `## Rules` |
| Block 3 | `## Rules` | `## Current Phase Guidance` |
| Block 4 | `## Current Phase Guidance` | `## Current Session State` (hoisted from the `role: 'system'` message) |
| Block 5 | *(none)* | `Previous conversation summary` (if any; hoisted from existing `history.summary` push) |

The content delivered to the model is **identical**; the order shifts session state from block 2 to the last system block. This is accepted as a minor behavior change. Rationale:

- The model's reasoning does not rely on a strict ordering between "rules" and "current state" — rules refer to capabilities, state is session-local data. Rules before state is a common pattern in agent prompts and is unlikely to degrade quality.
- At temperature 0 the text output is sensitive to ordering; the parity test in Task 7 is **structural** (asserts `req.system` stability + state block travels as the first `role:'system'` message), not text-output comparison against the pre-refactor runtime. The plan accepts the structural guarantee up to staging validation (Task 15), which exercises a real V3 session and checks for functional (not byte-level) behavior parity.
- A stricter golden — byte-equal output across pre/post — is rejected because (i) we have no mocked Anthropic call at temperature 0 in the existing test harness, and (ii) the refactor is explicitly a delivery-mechanism change, not a semantics-preserving rename.

Why not Option (b) — place the cache breakpoint between the stable prefix and the volatile tail? The PR 1 native adapter takes `req.system: string` as a **single** block (§6.1). It has no API to split one string into two blocks with one cache_control marker between them. Implementing (b) would require extending `req.system` to accept multiple blocks — that's a **router contract change**, explicitly out of scope for Plan 2.

Option (a) is the minimal change that keeps Plan 2 inside its scope boundary.

### D4. Rollout gate: add V3-specific flag `v3_prompt_cache_enabled` with percentage targeting.

Plan 1 seeded `prompt_cache_enabled` (global kill switch) as `false`. Plan 2 adds `v3_prompt_cache_enabled` with `targeting: { percentage: 0 }` by default, ramped through PR 2c.

**Two-flag architecture:**
- `prompt_cache_enabled` (global, Plan 1, `bypassCache: true` at router) — one flip kills caching for every caller in ≤15s.
- `v3_prompt_cache_enabled` (V3-specific, Plan 2, checked in `runtime.ts` before building `cache` option) — surgical V3 rollback without affecting future RAG / one-shot opt-ins.

Both must be true for V3 to cache. The V3 flag read happens once per turn, before `generate()`. The 60s LRU cache on the V3 flag is acceptable (percentage ramps are not emergency rollbacks — if a canary is bad, flip the **global** kill switch, not the V3 flag).

### D5. Canary tripwires (PR 2c).

**Measurement note:** Existing Prometheus counters have labels `{provider, model, hit}` and `{provider, model, task}` only — no `userId`, `cohort`, or `flag_bucket` label (`lib/monitoring/metrics.ts:125-139`). Router logs include `cache.*` fields and `identityKey` (first 16 chars) but not `userId` (`router.ts:114-121`). **Adding cohort labels is out of scope** (no telemetry edits per scope boundary).

This means "1% cohort hit rate" cannot be computed directly from Prometheus as a bucketed metric. The plan works around this by exploiting a scope-specific property: **V3 is the only caller that passes `cache: { enabled: true }` at this stage**, because Plan 3 (RAG) and Plan 4 (one-shots) have not landed. Therefore any call with `cache.requested=true AND cache.enabled=true AND model=claude-opus-4-6` in structured logs **is** a V3 caching turn inside the current flag-bucket cohort. Ratio from log aggregation on those filters gives the effective cohort hit rate.

This monitoring approach is only valid until Plan 3 lands (RAG shares the Anthropic model for some callers, but RAG's `aiGenerate()` routes via a different model/task — still distinguishable via the `task` label or identityKey prefix). If the plan sequencing changes and RAG lands before PR 2c reaches 100%, re-evaluate the filter.

Pause ramp or auto-rollback on any of:

| Signal | Source (log filter or metric) | Threshold | Action |
|---|---|---|---|
| **V3 cache hit rate**: `reads / (reads + writes)` | Log aggregation on `ai_call_completed` with `cache.requested=true AND cache.enabled=true AND model=claude-opus-4-6`, summing `cache.reads` and `cache.writes` over a trailing 30-min window (minimum 100 events) | ≥ 40% once steady state is reached (≥ 30 min after first turn hits the cached prefix) | **< 40%** = pause ramp, investigate prompt churn per runbook §12. Do not auto-advance. |
| **V3 turn success rate**: terminal state reached (no 5xx, no `Tool timeout` beyond existing baseline) | Log query on `/api/ai/agent` | Drop ≤ 1 p.p. vs 7-day pre-ramp baseline (computed over all V3 traffic; the ramped cohort is a subset, so a regression specific to the cohort dilutes into the whole) | **Drop > 2 p.p.** = immediate rollback (flip global kill). |
| **`/api/ai/agent` 5xx rate** | Log query | No regression vs 7-day pre-ramp baseline (all-V3 rate; same dilution caveat) | **Any regression sustained > 15 min** = rollback. |
| **`/api/ai/agent` P50 / P99 latency** | Log query | No regression vs 7-day baseline (all-V3; cohort-specific regressions may be masked at 1%) | **P99 up > 20% sustained > 15 min** = pause + investigate; **P99 up > 40%** = rollback. |
| **Cost per session** (input + output + cache reads + cache writes) | Log aggregation on `ai_call_completed` with same filters as cache hit rate row, using `cache.writes`, `cache.reads`, `tokensUsed.input`, `tokensUsed.output` and the rate constants in `PRICING_V1.anthropic['claude-opus-4-6']` | No increase vs 7-day pre-ramp baseline | **> +10%** = pause; **> +25%** = rollback (write-churn pattern per runbook §12). |

Dilution caveat: at 1% cohort, a cohort-only regression in non-cache-specific metrics (5xx, success rate) may be statistically invisible against whole-V3 noise. The plan accepts this — at 1% the primary signal to watch is the cache-specific rows (hit rate, cost per session), which filter down to the cohort by construction. Whole-V3 regressions become sensitive at the 10%+ stages.

Baselines are captured the day **before** the 1% ramp starts (Task 17).

### D6. Preselect interaction: narrow coupling — only structured actions on preselected sessions reach V3.

Reading `app/src/app/api/ai/agent/route.ts:179-319` carefully, the actual routing is **not** "preselected sessions route through V3 once managed is off" (my earlier reading was wrong). It is:

- `isPreselected = (planning_artifact.preselect.version === 1) && !hasStructuredAction` — line 199.
- **Non-action preselected turns** (plain `message` turns) `isPreselected=true` and fail closed with 503 `MANAGED_UNAVAILABLE` at lines 246-257, 294-305, and the final 308-320 guard. They **never** reach V3.
- **Structured-action turns on preselected sessions** (`approve_outline`, `accept_section`, `select_call`, etc.) set `hasStructuredAction=true`, which makes `isPreselected=false`, which lets the request fall through to V3's `runV3WithSSE` path (line 258 or the final fallback at ~321 after line 308).

So V3 runs only the structured-action subset of preselected traffic. Those turns start from `phase=structuring` or `research` (preselect's bootstrap), with `selectedCallId` and `blueprint` already cached in the session.

**Cache implications for preselected-action turns:**
- The stable `req.system` is `buildSystemPrompt(session, sections)` — after PR 2a this contains only persona + rules + `PHASE_GUIDANCE[session.currentPhase]`. Structuring and research phases are exactly the phases a preselected session starts in, so their `PHASE_GUIDANCE` strings are stable byte-identical content. No prompt churn specific to preselect.
- The tool list for `structuring` / `research` is deterministic per Task 2 verification.
- Structured-action flows tend to be 1-2 turn interactions (user clicks "accept", V3 responds). Each action is typically its own tool loop. Across sessions hitting the same `(phase, stable-prefix, tool-list)`, identityKey collides naturally — so cache reads accumulate across sessions (same prefix bytes → same Anthropic cache entry).
- Cache writes on action turns may be less amortized than on discovery flows (fewer turns per session) — monitor at 10%+ ramp whether cost-per-session regressions skew toward action-heavy cohorts. If so, not a blocker; just a finding for the SLO snapshot in Task 21.

**Assumption to re-validate if managed Phase 3 lands mid-canary:** Managed Phase 3 would change which paths reach V3. If it centralizes more flows into managed, V3 caching has a smaller surface; if it reverts anything back to V3, re-audit what reaches `generate()`. Managed itself has its own caching pattern (§7.4) and is not router-mediated.

### D7. Rollback path (verbatim commands + SLA).

Global kill (disables caching for every caller — fastest, broadest):
```bash
curl -X PATCH https://fondeu-platform-857599941951.europe-west2.run.app/api/v1/admin/feature-flags/prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"enabled": false}'
```
**SLA: next request reads the updated value.** Router uses `isFeatureEnabled('prompt_cache_enabled', { bypassCache: true })` (see `router.ts:54`). No 60s cache delay.

V3-scoped kill (keeps RAG/one-shots cached when they land; surgical for a V3-only regression):
```bash
curl -X PATCH https://fondeu-platform-857599941951.europe-west2.run.app/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"enabled": false}'
```
**SLA: up to 60s** (V3 flag read uses default LRU cache). For emergencies prefer the global kill.

Target operational SLA from alert-fire to flag-flip completion: **15 seconds** end-to-end. Document verified in Task 24.

---

## Stop-and-escalate conditions

Halt this plan and surface to the user (Bogdan) if:

1. **Tool-list ordering OR schema bytes turn out to be non-deterministic** across two calls to `getToolsForPhase(phase)` for the same phase within one process (Task 2). This would invalidate the `'tools'` breakpoint and require upstream sort stabilization before Plan 2b can safely opt in.
2. **The PR 2a parity test shows req.system drift** (Task 7) — `captured[0].system !== captured[1].system` across two turns in the same phase, which means volatile content leaked into the stable prefix. This breaks cacheability and needs investigation before PR 2b can opt in.
3. **Preselected sessions surface a coupling** — e.g. preselect path unexpectedly mutates the stable prompt prefix, or managed Phase 3 lands mid-canary and changes V3's runtime semantics.
4. **PR 0 audit §4 recommendation (structural split) conflicts with spec §11.2** (feature flag bootstrap). On this reading they are **not in conflict**: §11.2 just seeds the global flag at `false`; §4 recommends structural changes this plan implements. Proceed. If a reviewer reads them differently, escalate.
5. **1% cohort cache hit rate < 10%** after 30 min of steady state — indicates prompt churn despite PR 2a. Investigate before ramping to 10%.

---

## PR 2a — V3 prompt restructuring (pure refactor, no cache opt-in)

**Goal of this PR:** Split `buildSystemPrompt()` so `req.system` is a stable, cacheable prefix and the volatile state block becomes a separate `role: 'system'` message injected into `llmMessages`. Zero caller opts into caching yet.

**Scope:** `app/src/lib/ai/agent/prompt.ts`, `app/src/lib/ai/agent/runtime.ts`, new tests. No changes to router, adapters, tools, types, or schema.

---

### Task 1: Create a working branch from master and verify PR 1 landed

**Files:**
- None (git only)

- [ ] **Step 1: Verify clean master at PR 1 merge commit**

Run: `git status && git log -1 --oneline`
Expected: Clean tree; HEAD at `78052eb` or later (PR 1 merge commit "feat(ai/providers): router-level prompt caching contract").

- [ ] **Step 2: Create branch**

```bash
git checkout -b feature/prompt-cache-pr2a-v3-prompt-restructure
```

- [ ] **Step 3: Verify PR 1 modules exist (pre-flight)**

Run:
```bash
ls app/src/lib/ai/providers/anthropic-native.ts app/src/lib/ai/providers/cache-key.ts app/src/lib/ai/cost/pricing-table.ts app/drizzle/0032_prompt_cache_flag.sql
```
Expected: all four files exist. If any are missing, PR 1 did not land as expected — **STOP and escalate**.

- [ ] **Step 4: Push branch to establish remote tracking**

```bash
git push -u origin feature/prompt-cache-pr2a-v3-prompt-restructure
```

---

### Task 2: Write a failing test for tool-list determinism across two calls

**Files:**
- Test: `app/tests/unit/ai/agent/tools/registry-determinism.test.ts` (new)

- [ ] **Step 1: Write the failing test**

The test must verify **the canonical tool-schema shape used for identity/cache stability**, not just tool names. Per `runtime.ts:152-159`, each tool is serialized as `{ type: 'function', function: { name, description, parameters: zodToJsonSchema(inputSchema) } }`. The native adapter then translates to `{ name, description, input_schema }` (`anthropic-native.ts:119-128`) and stamps `cache_control` on the last tool only.

We assert stability at two layers:
1. **Canonical stability** (via `hashToolSchemas` below): sorts object keys recursively before hashing — matches what `deriveIdentityKey` does internally (`cache-key.ts`). If this drifts, the router's identityKey grouping breaks.
2. **Raw insertion-order stability** (via `JSON.stringify(buildToolSchemas(phase))` equality): catches a scenario where object-key insertion order from `zodToJsonSchema` varies across calls — canonical hash would miss that because canonicalization sorts keys. Anthropic SDK's own JSON serialization uses insertion order, so this is the literal wire-bytes check that matters for the `cache_control` on the last tool.

If either layer fails, the `'tools'` cache breakpoint invalidates every call. Stop and escalate.

Create `app/tests/unit/ai/agent/tools/registry-determinism.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { getToolsForPhase } from '@/lib/ai/agent/tools/registry'
import { zodToJsonSchema } from '@/lib/ai/agent/utils'
import '@/lib/ai/agent/tools/index' // ensure tools self-register
import { deriveIdentityKey } from '@/lib/ai/providers/cache-key'
import type { ToolSchema } from '@/lib/ai/providers/types'

type ToolSchemaShape = ToolSchema

function buildToolSchemas(phase: Parameters<typeof getToolsForPhase>[0]): ToolSchemaShape[] {
  return getToolsForPhase(phase).map(tool => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.inputSchema),
    },
  }))
}

function hashToolSchemas(schemas: ToolSchemaShape[]): string {
  // canonical JSON via sorted keys recursively — mirrors what the identity key
  // derivation does internally. Any ordering drift in parameters would alter
  // this hash.
  const canon = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(canon)
    if (x && typeof x === 'object') {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(x as Record<string, unknown>).sort()) {
        out[k] = canon((x as Record<string, unknown>)[k])
      }
      return out
    }
    return x
  }
  return createHash('sha256').update(JSON.stringify(canon(schemas))).digest('hex')
}

describe('tool registry — determinism per phase', () => {
  const phases = ['discovery', 'research', 'structuring', 'drafting', 'review'] as const

  it.each(phases)('getToolsForPhase(%s) returns the same tool NAME order on repeat calls', (phase) => {
    const first = getToolsForPhase(phase).map(t => t.name)
    const second = getToolsForPhase(phase).map(t => t.name)
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(0)
  })

  it.each(phases)('tool SCHEMAS (zodToJsonSchema output) are canonically stable across repeat builds for phase %s', (phase) => {
    const schemas1 = buildToolSchemas(phase)
    const schemas2 = buildToolSchemas(phase)
    expect(hashToolSchemas(schemas1)).toBe(hashToolSchemas(schemas2))
  })

  it.each(phases)('tool SCHEMAS preserve raw insertion-order bytes across repeat builds for phase %s (literal wire-bytes stability)', (phase) => {
    // Anthropic SDK serializes with insertion order; this check catches a drift
    // canonical hashing would mask. If zodToJsonSchema returns keys in a new
    // order on a second call, the last-tool cache_control byte-prefix shifts
    // and cache hits vanish even though identityKey would still match.
    const raw1 = JSON.stringify(buildToolSchemas(phase))
    const raw2 = JSON.stringify(buildToolSchemas(phase))
    expect(raw1).toBe(raw2)
  })

  it.each(phases)('identityKey from (anthropic, claude-opus-4-6, system-sentinel, tools-for-%s) is stable across repeat derivations', (phase) => {
    const tools = buildToolSchemas(phase)
    const system = '<sentinel-stable-system>'
    const k1 = deriveIdentityKey({ provider: 'anthropic', model: 'claude-opus-4-6', system, tools })
    const k2 = deriveIdentityKey({ provider: 'anthropic', model: 'claude-opus-4-6', system, tools })
    expect(k1).toBe(k2)
    expect(k1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('getToolsForPhase returns no duplicate tool names within a phase', () => {
    for (const phase of phases) {
      const names = getToolsForPhase(phase).map(t => t.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it passes today**

Run: `cd app && npx vitest run tests/unit/ai/agent/tools/registry-determinism.test.ts`
Expected: PASS on all three `it.each` suites × five phases, plus the disjoint-name check.

**If any phase fails the schema-stability or identityKey-stability assertion → `zodToJsonSchema` output is non-deterministic → STOP and escalate (stop-and-escalate condition §1).** A common fix would be pinning the library version or wrapping its output in a canonical-JSON normalization — but that's a router-contract-adjacent change outside Plan 2's scope; surface it to the user.

**If tool NAME order is stable but SCHEMAS are not**, the fix is likely in `zodToJsonSchema` key ordering; still a scope-expanding change — escalate.

- [ ] **Step 3: Commit**

```bash
git add app/tests/unit/ai/agent/tools/registry-determinism.test.ts
git commit -m "test(agent/tools): assert getToolsForPhase is deterministic per phase"
```

---

### Task 3: Rewrite existing prompt tests to reflect the split

**Context:** `app/tests/unit/agent-prompt.test.ts:31` currently asserts `buildSystemPrompt()` contains blueprint (`PNRR-C11`), structure confidence (`85%`), sections (`rezumat`, `accepted`, `draft`), and session knowledge. After Task 4 these move to `buildSessionStateBlock()`. We rewrite the existing file — not add a parallel one — so the codebase keeps one source of truth per module.

**Files:**
- Modify: `app/tests/unit/agent-prompt.test.ts`

- [ ] **Step 1: Rewrite the existing test file**

Open `app/tests/unit/agent-prompt.test.ts`. Replace its entire content with:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildSessionStateBlock } from '@/lib/ai/agent/prompt'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'discovery',
    projectId: null,
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  }
}

describe('buildSystemPrompt (stable cacheable prefix)', () => {
  it('includes agent persona', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).toContain('FondEU')
    expect(prompt).toContain('cereri de finanțare')
  })

  it('includes current phase guidance', () => {
    const prompt = buildSystemPrompt(makeSession({ currentPhase: 'drafting' }), [])
    expect(prompt).toContain('Generate sections one at a time')
  })

  it('includes rules about not inventing facts', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).toContain('Never invent')
  })

  it('is byte-identical across turns within the same phase when only sections/warnings change', () => {
    const sessionA = makeSession({ currentPhase: 'drafting', warnings: [] })
    const sessionB = makeSession({
      currentPhase: 'drafting',
      warnings: [{ code: 'X', message: 'y', severity: 'info' }],
    })
    const sectionsA: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'draft', documentOrder: 0 } as any,
    ]
    const sectionsB: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'accepted', documentOrder: 0 } as any,
      { sectionKey: 'buget', title: 'B', status: 'draft', documentOrder: 1 } as any,
    ]
    expect(buildSystemPrompt(sessionA, sectionsA)).toBe(buildSystemPrompt(sessionB, sectionsB))
  })

  it('differs across phases', () => {
    const s1 = buildSystemPrompt(makeSession({ currentPhase: 'drafting' }), [])
    const s2 = buildSystemPrompt(makeSession({ currentPhase: 'review' }), [])
    expect(s1).not.toBe(s2)
  })

  it('does NOT contain volatile session-state markers (those moved to buildSessionStateBlock)', () => {
    const prompt = buildSystemPrompt(makeSession(), [])
    expect(prompt).not.toContain('Current Session State')
    expect(prompt).not.toContain('Active warnings')
    expect(prompt).not.toContain('Session knowledge')
    // Also: blueprint/selectedCallId must no longer appear in the stable prefix.
    expect(prompt).not.toContain('Selected call:')
    expect(prompt).not.toContain('Structure confidence:')
  })
})

describe('buildSessionStateBlock (volatile tail, delivered as role:system message)', () => {
  it('includes blueprint info when present', () => {
    const block = buildSessionStateBlock(makeSession({
      blueprint: { callId: 'PNRR-C11', structureConfidence: 0.85 } as any,
    }), [])
    expect(block).toContain('PNRR-C11')
    expect(block).toContain('85%')
  })

  it('includes section statuses when present', () => {
    const sections: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'Rezumat executiv', status: 'accepted', documentOrder: 0 } as any,
      { sectionKey: 'buget', title: 'Buget', status: 'draft', documentOrder: 7 } as any,
    ]
    const block = buildSessionStateBlock(makeSession({ currentPhase: 'drafting' }), sections)
    expect(block).toContain('rezumat')
    expect(block).toContain('accepted')
    expect(block).toContain('draft')
  })

  it('includes session knowledge summary when present', () => {
    const session = {
      ...makeSession({ currentPhase: 'drafting' }),
      _knowledgeSummary: '3 pages: brief, decision_log, section_pattern(methodology)',
    } as any
    const block = buildSessionStateBlock(session, [])
    expect(block).toContain('Session knowledge')
    expect(block).toContain('3 pages')
  })

  it('shows "none yet" when no knowledge summary', () => {
    const block = buildSessionStateBlock(makeSession(), [])
    expect(block).toContain('Session knowledge: none yet')
  })

  it('reflects warning changes across turns (volatility is expected)', () => {
    const s1 = buildSessionStateBlock(makeSession({ warnings: [] }), [])
    const s2 = buildSessionStateBlock(makeSession({
      warnings: [{ code: 'W1', message: 'm', severity: 'warning' }],
    }), [])
    expect(s1).not.toBe(s2)
  })

  it('starts with "## Current Session State" heading for adapter hoisting recognizability', () => {
    const block = buildSessionStateBlock(makeSession(), [])
    expect(block.startsWith('## Current Session State')).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails (pre-implementation)**

Run: `cd app && npx vitest run tests/unit/agent-prompt.test.ts`
Expected: FAIL — `buildSessionStateBlock` is not exported; current `buildSystemPrompt` still contains `Current Session State` and `Selected call:`.

---

### Task 4: Implement the split in `prompt.ts`

**Files:**
- Modify: `app/src/lib/ai/agent/prompt.ts`

- [ ] **Step 1: Rewrite `prompt.ts` to split stable and volatile content**

Replace the entire contents of `app/src/lib/ai/agent/prompt.ts` with:

```typescript
import type { AgentSession, AgentSection, Phase, EligibilityResult } from './types'
import type { CallBlueprint } from '@/lib/ai/agent/types'

type SessionWithKnowledgeSummary = AgentSession & { _knowledgeSummary?: string }

function formatEligibility(elig: EligibilityResult | null): string {
  if (!elig) return 'Not checked yet'
  if (elig.failCount > 0) return `BLOCKED — ${elig.failCount} hard failures`
  if (elig.warningCount > 0) return `Passed with ${elig.warningCount} warnings (score: ${elig.score}%)`
  return `Passed (score: ${elig.score}%)`
}

function formatSections(sections: AgentSection[]): string {
  if (sections.length === 0) return 'No sections yet'
  return sections
    .sort((a, b) => a.documentOrder - b.documentOrder)
    .map(s => `  - ${s.sectionKey}: ${s.status}`)
    .join('\n')
}

function formatWarnings(warnings: { code: string; message: string; severity: string }[]): string {
  if (warnings.length === 0) return 'None'
  return warnings.map(w => `  - [${w.severity}] ${w.message}`).join('\n')
}

const PHASE_GUIDANCE: Record<Phase, string> = {
  discovery: 'Help the user describe their project and organization. Ask about sector, region, budget range, timeline. When ready, search for matching calls.',
  research: 'Search for matching calls. When the user selects one, resolve it and present the blueprint. Run eligibility checks.',
  structuring: 'Extract and present the required application structure. Show the outline for approval. Address any eligibility issues.',
  drafting: 'Generate sections one at a time in generation order. After each, offer: accept, regenerate with feedback, or skip. Show progress.',
  review: 'Validate the full application. Show missing items, warnings, annexes checklist. Guide toward completion.',
}

/**
 * Stable cacheable system prefix. Byte-identical for the life of (sessionId, phase)
 * when used with the Anthropic cache path. See docs/runbooks/audits/v3-prompt-stability-2026-04.md.
 *
 * IMPORTANT: do not interpolate session state, warnings, sections, timestamps,
 * or any per-turn mutable content here. That volatile tail lives in
 * buildSessionStateBlock() and is delivered as a separate role:'system' message
 * in the conversation (hoisted to an uncached system block by the Anthropic
 * native adapter — see lib/ai/providers/anthropic-native.ts:52-59, 111-114).
 */
export function buildSystemPrompt(session: AgentSession, _sections: AgentSection[]): string {
  return `You are FondEU, an expert assistant for Romanian EU funding applications.
You help users prepare cereri de finanțare (funding applications).

## Rules
- Never invent facts. Use tools to retrieve information.
- Always cite which tool/source provided a fact.
- When you don't have enough information, say so and suggest which tool to use.
- Present section structures and eligibility results for confirmation before proceeding.
- Speak Romanian by default, switch to English if the user does.
- Be direct and specific. Users are professionals preparing real applications.

## Current Phase Guidance
${PHASE_GUIDANCE[session.currentPhase]}
`
}

/**
 * Volatile per-turn session state. Delivered to the model as a role:'system'
 * message so the native Anthropic translator hoists it to an additional,
 * uncached, top-level system block after the cached req.system prefix.
 *
 * This preserves the exact content the model saw pre-split; only the delivery
 * mechanism changes (single cached block → cached prefix + uncached state block).
 */
export function buildSessionStateBlock(session: AgentSession, sections: AgentSection[]): string {
  const bp = session.blueprint as CallBlueprint | null

  const knowledgeSummary = (session as SessionWithKnowledgeSummary)._knowledgeSummary
  const knowledgeLine = knowledgeSummary
    ? `- Session knowledge: ${knowledgeSummary}`
    : '- Session knowledge: none yet'

  return `## Current Session State
- Phase: ${session.currentPhase}
- Selected call: ${bp?.callId ?? session.selectedCallId ?? 'none yet'}
- Structure confidence: ${bp?.structureConfidence != null ? `${Math.round(bp.structureConfidence * 100)}%` : 'N/A'}
- Eligibility: ${formatEligibility(session.eligibility)}
${knowledgeLine}
- Sections:
${formatSections(sections)}
- Active warnings:
${formatWarnings(session.warnings)}
`
}
```

- [ ] **Step 2: Run the prompt test to verify it passes**

Run: `cd app && npx vitest run tests/unit/agent-prompt.test.ts`
Expected: PASS — all cases in both `describe` blocks green.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/ai/agent/prompt.ts app/tests/unit/agent-prompt.test.ts
git commit -m "refactor(agent/prompt): split buildSystemPrompt into stable prefix + volatile state block"
```

---

### Task 5: Patch existing `runtime-message-push.test.ts` mock to include `buildSessionStateBlock`

**Context:** `app/tests/unit/ai/agent/runtime-message-push.test.ts:48` currently mocks `@/lib/ai/agent/prompt` with `{ buildSystemPrompt: () => 'system' }`. After Task 6 imports `buildSessionStateBlock`, the mock must export it too, or the import resolves to `undefined` and the runtime crashes mid-test.

**Files:**
- Modify: `app/tests/unit/ai/agent/runtime-message-push.test.ts`

- [ ] **Step 1: Update the prompt mock**

In `app/tests/unit/ai/agent/runtime-message-push.test.ts`, change line 48 from:

```typescript
vi.mock('@/lib/ai/agent/prompt', () => ({ buildSystemPrompt: () => 'system' }))
```

to:

```typescript
vi.mock('@/lib/ai/agent/prompt', () => ({
  buildSystemPrompt: () => 'system',
  buildSessionStateBlock: () => '## Current Session State\n- stub for tests\n',
}))
```

- [ ] **Step 2: Run the existing runtime-message-push test to confirm it still passes**

Run: `cd app && npx vitest run tests/unit/ai/agent/runtime-message-push.test.ts`
Expected: PASS — the assistant-message-push behavior is unchanged; this patch only keeps the mock surface aligned with the split.

**Do not commit yet** — this change pairs with Task 6's runtime edit in the same commit (runtime imports the new export; mock supports it).

---

### Task 6: Wire `buildSessionStateBlock` into `runtime.ts` as a `role: 'system'` message

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts:128` and the messages-building block at `runtime.ts:132-147`.

- [ ] **Step 1: Read the current runtime code at the change site**

Run: `sed -n '115,150p' app/src/lib/ai/agent/runtime.ts`
Confirm current shape before editing.

- [ ] **Step 2: Update the import in `runtime.ts`**

In `app/src/lib/ai/agent/runtime.ts`, change line 7 from:

```typescript
import { buildSystemPrompt } from './prompt'
```

to:

```typescript
import { buildSystemPrompt, buildSessionStateBlock } from './prompt'
```

- [ ] **Step 3: Insert the session-state `role: 'system'` message into `llmMessages`**

Find the block in `runtime.ts` that currently reads (around lines 128-147):

```typescript
    const systemPrompt = buildSystemPrompt(session, sections)
    const phaseTools = getToolsForPhase(session.currentPhase)

    // Build messages array for LLM
    const llmMessages: {
      role: 'user' | 'assistant' | 'system' | 'tool'
      content: string
      tool_call_id?: string
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }[] = []
    if (history.summary) {
      llmMessages.push({ role: 'system', content: `Previous conversation summary:\n${history.summary}` })
    }
    for (const msg of history.messages) {
      llmMessages.push({ role: msg.role as 'user' | 'assistant' | 'system', content: msg.content })
    }
    // Add current user message
    if (request.message) {
      llmMessages.push({ role: 'user', content: request.message })
    }
```

Replace with:

```typescript
    const systemPrompt = buildSystemPrompt(session, sections)
    const sessionStateBlock = buildSessionStateBlock(session, sections)
    const phaseTools = getToolsForPhase(session.currentPhase)

    // Build messages array for LLM
    const llmMessages: {
      role: 'user' | 'assistant' | 'system' | 'tool'
      content: string
      tool_call_id?: string
      tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
    }[] = []

    // Volatile session state — delivered as a role:'system' message so the
    // Anthropic native adapter hoists it to an uncached additional system block
    // after the cached req.system prefix. See docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md §D3.
    llmMessages.push({ role: 'system', content: sessionStateBlock })

    if (history.summary) {
      llmMessages.push({ role: 'system', content: `Previous conversation summary:\n${history.summary}` })
    }
    for (const msg of history.messages) {
      llmMessages.push({ role: msg.role as 'user' | 'assistant' | 'system', content: msg.content })
    }
    // Add current user message
    if (request.message) {
      llmMessages.push({ role: 'user', content: request.message })
    }
```

- [ ] **Step 4: Verify typecheck + lint**

Run: `cd app && npm run typecheck && npm run lint`
Expected: clean (no new errors vs baseline).

---

### Task 7: Parity test — V3 multi-turn req.system stability

**Goal:** Assert that across two consecutive turns in the same phase, `req.system` is byte-identical and the first `role: 'system'` message in `llmMessages` is the session-state block (varying with session state while the prefix stays stable).

**Mock pattern:** Mirror the established runtime test setup in `app/tests/unit/ai/agent/runtime-message-push.test.ts:10-72` and `app/tests/unit/agent-runtime.test.ts:1-67` — both exist in master at PR 1's HEAD. They use `vi.mock` on `@/lib/ai/providers/router`, `@/lib/ai/agent/history`, `@/lib/db`, `@/lib/logger`, `@/lib/ai/knowledge/*`, with a plain `makeSession()` helper. We copy that shape exactly.

**Files:**
- Test: `app/tests/unit/ai/agent/runtime-prompt-restructure.test.ts` (new)

- [ ] **Step 1: Write the test file**

Create `app/tests/unit/ai/agent/runtime-prompt-restructure.test.ts`:

```typescript
// app/tests/unit/ai/agent/runtime-prompt-restructure.test.ts
//
// Plan 2 PR 2a parity check: after splitting buildSystemPrompt into a stable
// prefix and buildSessionStateBlock (volatile tail), two consecutive turns in
// the same phase must deliver byte-identical req.system, with the volatile
// content appearing as the first role:'system' message in llmMessages.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const capturedCalls: Array<{
  system: string | undefined
  messages: Array<{ role: string; content: string }>
}> = []

const generateMock = vi.fn(async (req: {
  system?: string
  messages: Array<{ role: string; content: string }>
}) => {
  // Snapshot both system and messages (messages is a reference that runtime
  // keeps mutating across the tool loop; deep-copy is required).
  capturedCalls.push({
    system: req.system,
    messages: req.messages.map(m => ({ ...m })),
  })
  return {
    content: 'done',
    tokensUsed: { input: 0, output: 0 },
    model: 'claude-opus-4-6',
    provider: 'anthropic',
    toolCalls: [],
  }
})

// History mock is stateful: turn 1 sees no prior context; turn 2 sees a one-message history.
const historyState = { messages: [] as Array<{ role: string; content: string }>, summary: null as string | null }
vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: vi.fn(async () => ({ ...historyState, totalCount: historyState.messages.length })),
  appendMessage: vi.fn(async (_sid: string, msg: { role: string; content: unknown }) => {
    historyState.messages.push({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
    })
    return 0
  }),
  compactIfNeeded: vi.fn(async () => ({ compacted: false })),
}))

vi.mock('@/lib/ai/providers/router', () => ({ generate: generateMock }))
vi.mock('@/lib/ai/agent/tools/registry', () => ({ getToolsForPhase: () => [] }))
vi.mock('@/lib/ai/agent/tools/index', () => ({}))
vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({ getSessionKnowledge: async () => [] }))
vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn(),
  onPhaseTransition: vi.fn(),
  trackPatternUsage: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        then: (resolve: (v: unknown) => void) => resolve(undefined),
      }),
    }),
  },
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession, AgentSection } from '@/lib/ai/agent/types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'drafting',
    projectId: null,
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as AgentSession
}

beforeEach(() => {
  capturedCalls.length = 0
  historyState.messages = []
  historyState.summary = null
  generateMock.mockClear()
})

describe('V3 runtime — prompt restructure parity (PR 2a)', () => {
  it('req.system is byte-identical across two consecutive turns in the same phase', async () => {
    const session = makeSession({ currentPhase: 'drafting' })
    const sectionsT1: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'draft', documentOrder: 0 } as AgentSection,
    ]
    const sectionsT2: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'accepted', documentOrder: 0 } as AgentSection,
      { sectionKey: 'buget', title: 'B', status: 'draft', documentOrder: 1 } as AgentSection,
    ]

    await runAgentTurn({
      session, sections: sectionsT1,
      request: { message: 'turn 1', requestId: 'req-1', locale: 'ro' },
      emit: () => {},
    })
    await runAgentTurn({
      session, sections: sectionsT2,
      request: { message: 'turn 2', requestId: 'req-2', locale: 'ro' },
      emit: () => {},
    })

    expect(capturedCalls).toHaveLength(2)
    expect(capturedCalls[0].system).toBe(capturedCalls[1].system)
    expect(capturedCalls[0].system).toContain('FondEU')
    // Stable prefix must not contain volatile markers.
    expect(capturedCalls[0].system).not.toContain('Current Session State')
    expect(capturedCalls[0].system).not.toContain('Sections:')
  })

  it('first role:system message in llmMessages is the session-state block and differs across turns when sections change', async () => {
    const session = makeSession({ currentPhase: 'drafting' })
    const sectionsT1: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'draft', documentOrder: 0 } as AgentSection,
    ]
    const sectionsT2: AgentSection[] = [
      { sectionKey: 'rezumat', title: 'R', status: 'accepted', documentOrder: 0 } as AgentSection,
    ]

    await runAgentTurn({
      session, sections: sectionsT1,
      request: { message: 'turn 1', requestId: 'req-1', locale: 'ro' },
      emit: () => {},
    })
    await runAgentTurn({
      session, sections: sectionsT2,
      request: { message: 'turn 2', requestId: 'req-2', locale: 'ro' },
      emit: () => {},
    })

    const firstSystemT1 = capturedCalls[0].messages.find(m => m.role === 'system')
    const firstSystemT2 = capturedCalls[1].messages.find(m => m.role === 'system')
    expect(firstSystemT1).toBeDefined()
    expect(firstSystemT2).toBeDefined()
    expect(firstSystemT1!.content.startsWith('## Current Session State')).toBe(true)
    expect(firstSystemT2!.content.startsWith('## Current Session State')).toBe(true)
    // T1 shows 'draft' for rezumat; T2 shows 'accepted'. Verifies volatility travels.
    expect(firstSystemT1!.content).toContain('rezumat: draft')
    expect(firstSystemT2!.content).toContain('rezumat: accepted')
    expect(firstSystemT1!.content).not.toBe(firstSystemT2!.content)
  })
})
```

- [ ] **Step 2: Run the test**

Run: `cd app && npx vitest run tests/unit/ai/agent/runtime-prompt-restructure.test.ts`
Expected: PASS — `req.system` byte-equal across turns; state-block content differs.

**If it FAILS** → either the split produces different `req.system` across turns (bug in Task 4) or the state block is not being pushed (bug in Task 6). **STOP and escalate** per stop-and-escalate condition §2.

- [ ] **Step 3: Run the full agent-related test suite**

Run: `cd app && npx vitest run tests/unit/agent-prompt.test.ts tests/unit/agent-runtime.test.ts tests/unit/ai/agent`
Expected: all pass. If `agent-runtime.test.ts` or any other existing test fails that was green on master, the refactor is a semantic regression; revert and investigate.

- [ ] **Step 4: Run typecheck + lint**

Run: `cd app && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit (bundles Tasks 5 + 6 + 7 into one commit)**

Tasks 5 (mock patch), 6 (runtime wiring), and 7 (parity test) all depend on each other and must land together — splitting them would leave master briefly broken (mock export mismatch or runtime import failure).

```bash
git add \
  app/src/lib/ai/agent/runtime.ts \
  app/tests/unit/ai/agent/runtime-message-push.test.ts \
  app/tests/unit/ai/agent/runtime-prompt-restructure.test.ts
git commit -m "feat(agent/runtime): deliver session-state block as role:'system' message for cacheable system prefix"
```

---

### Task 8: Open PR 2a

**Files:**
- None (gh CLI)

- [ ] **Step 1: Push the branch**

```bash
git push
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create \
  --title "refactor(agent/prompt): split stable prefix and volatile state block (PR 2a)" \
  --body "$(cat <<'EOF'
## Summary
- Split `buildSystemPrompt()` so `req.system` is a stable, cacheable prefix (role + rules + `PHASE_GUIDANCE[phase]`). Volatile session state moves into new `buildSessionStateBlock()`.
- Runtime pushes the state block as a \`role: 'system'\` message; the Anthropic native adapter (landed in PR 1) hoists it to an additional **uncached** top-level system block, so the cached prefix stays byte-stable across turns within `(sessionId, phase)`.
- Zero caller opts into caching in this PR — pure refactor. V3 cache opt-in is PR 2b.

## Test plan
- [x] `tests/unit/ai/agent/tools/registry-determinism.test.ts` — name-order, zodToJsonSchema byte-stability, identityKey stability, no duplicate names per phase.
- [x] `tests/unit/agent-prompt.test.ts` (rewritten) — `buildSystemPrompt` is byte-identical across turns in the same phase when sections/warnings change; `buildSessionStateBlock` contains the moved content (blueprint, sections, warnings, knowledge).
- [x] `tests/unit/ai/agent/runtime-prompt-restructure.test.ts` — two-turn V3 scenario: `captured[0].system === captured[1].system`; first `role:'system'` message in `llmMessages` starts with `## Current Session State` and differs across turns.
- [x] `tests/unit/ai/agent/runtime-message-push.test.ts` mock patched to export `buildSessionStateBlock`.
- [x] Existing `tests/unit/agent-runtime.test.ts` + full `tests/unit/ai/agent/**` all pass.
- [x] `npm run typecheck && npm run lint` clean.

## Scope
Pure refactor. No router, adapter, cost, or telemetry changes. No flag changes.

See: `docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md` §D3 for the volatile-tail decision rationale.
EOF
)"
```

- [ ] **Step 3: Wait for CI to go green**

Run: `gh pr checks --watch` (or `gh pr view --json statusCheckRollup`).
Expected: all required checks pass. Codex review welcome but not blocking.

- [ ] **Step 4: Request review and merge when approved**

Do not self-merge. Wait for reviewer approval; merge via the UI.

- [ ] **Step 5: Verify merge and pull master**

After merge:
```bash
git checkout master && git pull && git log -1 --oneline
```
Expected: HEAD is the PR 2a merge commit.

---

## PR 2b — V3 opts into caching via new rollout flag

**Goal of this PR:** Add `v3_prompt_cache_enabled` feature flag (percentage-targeted), check it inside `runtime.ts`, and pass `cache: { enabled: true, breakpoints: ['system', 'tools'] }` on the `generate()` call only when the flag resolves true for the session's user. Global kill switch `prompt_cache_enabled` (Plan 1) remains the outer gate — it is **not** re-plumbed here.

**Scope:** New migration, `app/src/lib/ai/agent/runtime.ts` call-site change, new unit tests. No router or adapter changes.

---

### Task 9: Create a working branch from master

**Files:**
- None (git only)

- [ ] **Step 1: Confirm PR 2a is merged on master**

Run: `git checkout master && git pull && git log --oneline -5`
Expected: the PR 2a commit is present.

- [ ] **Step 2: Create branch**

```bash
git checkout -b feature/prompt-cache-pr2b-v3-optin
```

- [ ] **Step 3: Push branch to establish remote tracking**

```bash
git push -u origin feature/prompt-cache-pr2b-v3-optin
```

---

### Task 10: Hand-author migration to seed `v3_prompt_cache_enabled` flag

**Files:**
- Create: `app/drizzle/0033_v3_prompt_cache_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Confirm next free migration index**

Run: `ls app/drizzle/*.sql | tail -3 && tail -15 app/drizzle/meta/_journal.json`
Expected: latest is `0032_prompt_cache_flag`; next free index is `33`. If not, adjust the filename and journal entry accordingly — do not skip numbers.

- [ ] **Step 2: Write the migration SQL**

Create `app/drizzle/0033_v3_prompt_cache_flag.sql`:

```sql
-- Seed the v3_prompt_cache_enabled feature flag.
-- V3-specific rollout flag: gates whether the V3 agent runtime opts into
-- Anthropic prompt caching by passing cache: { enabled: true } on the
-- generate() call. Orthogonal to the global kill switch prompt_cache_enabled
-- (both flags must resolve true for caching to be active).
--
-- Seeded with percentage: 0 so no users hit caching at deploy time.
-- Ramp via PATCH /api/v1/admin/feature-flags/v3_prompt_cache_enabled during
-- the production canary (see docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md PR 2c).
--
-- Idempotent: safe to re-run.
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'v3_prompt_cache_enabled',
  true,
  'V3 agent runtime: opt-in to prompt caching. Percentage-targeted on userId.',
  '{"percentage": 0}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
```

Note: `enabled: true` at the row level — the effective gate is the `percentage: 0` in `targeting`. This matches the feature-flag evaluation semantics in `app/src/lib/feature-flags/index.ts:117-123` (percentage < 100 + userId present → deterministic bucket check). 0% = no user passes the bucket check.

- [ ] **Step 3: Append to `_journal.json`**

Edit `app/drizzle/meta/_journal.json`. Append a new entry after `0032_prompt_cache_flag`:

```json
    {
      "idx": 33,
      "version": "7",
      "when": 1776988800003,
      "tag": "0033_v3_prompt_cache_flag",
      "breakpoints": true
    }
```

(Use `when` strictly greater than the previous entry's. `1776988800003` is fine if the `0032` entry is `1776988800002`.)

- [ ] **Step 4: Apply the migration to the dev DB**

Run: `cd app && npm run db:migrate`
Expected: migration runs successfully; `0033_v3_prompt_cache_flag` logged as applied.

- [ ] **Step 5: Verify the flag landed**

Run:
```bash
docker exec eu-funds-postgres-1 psql -U postgres -d eufunding -c \
  "SELECT key, enabled, targeting FROM feature_flags WHERE key = 'v3_prompt_cache_enabled';"
```
Expected: one row, `enabled=t`, `targeting={"percentage": 0}`.

- [ ] **Step 6: Commit**

```bash
git add app/drizzle/0033_v3_prompt_cache_flag.sql app/drizzle/meta/_journal.json
git commit -m "feat(migrations): seed v3_prompt_cache_enabled flag at 0% for canary rollout"
```

---

### Task 11: Write the failing test for runtime cache-gate logic

**Mock pattern:** Same shape as Task 7 and existing `runtime-message-push.test.ts`; we add a mock for `@/lib/feature-flags.isFeatureEnabled` so the test controls the V3 flag resolution per case.

**Files:**
- Test: `app/tests/unit/ai/agent/runtime-cache-gate.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/ai/agent/runtime-cache-gate.test.ts`:

```typescript
// app/tests/unit/ai/agent/runtime-cache-gate.test.ts
//
// Plan 2 PR 2b: V3 runtime must pass `cache: { enabled: true, breakpoints: ['system', 'tools'] }`
// to generate() iff `isFeatureEnabled('v3_prompt_cache_enabled', { userId })` resolves true.
// No cache.key override (identityKey-only per plan §D1).
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface CapturedArg {
  cache?: unknown
  provider: string
  model: string
  messages: unknown[]
}

const captured: CapturedArg[] = []
const generateMock = vi.fn(async (req: CapturedArg) => {
  captured.push(JSON.parse(JSON.stringify(req)))
  return {
    content: 'ok',
    tokensUsed: { input: 0, output: 0 },
    model: req.model,
    provider: req.provider,
    toolCalls: [],
  }
})

const isFeatureEnabledMock = vi.fn(async () => false)

vi.mock('@/lib/ai/providers/router', () => ({ generate: generateMock }))
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: isFeatureEnabledMock,
  invalidateFlagCache: vi.fn(),
}))
vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: async () => ({ summary: null, messages: [], totalCount: 0 }),
  appendMessage: vi.fn().mockResolvedValue(0),
  compactIfNeeded: vi.fn().mockResolvedValue({ compacted: false }),
}))
vi.mock('@/lib/ai/agent/tools/registry', () => ({ getToolsForPhase: () => [] }))
vi.mock('@/lib/ai/agent/tools/index', () => ({}))
vi.mock('@/lib/ai/agent/prompt', () => ({
  buildSystemPrompt: () => 'stable-prefix',
  buildSessionStateBlock: () => '## Current Session State\n- stub\n',
}))
vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({ getSessionKnowledge: async () => [] }))
vi.mock('@/lib/ai/knowledge/write-back', () => ({
  onSectionAccepted: vi.fn(),
  onPhaseTransition: vi.fn(),
  trackPatternUsage: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) },
}))
vi.mock('@/lib/db', () => ({
  db: {
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
        then: (resolve: (v: unknown) => void) => resolve(undefined),
      }),
    }),
  },
}))

import { runAgentTurn } from '@/lib/ai/agent/runtime'
import type { AgentSession } from '@/lib/ai/agent/types'

const SESSION_USER_ID = '22222222-2222-4222-8222-222222222222'
function makeSession(): AgentSession {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: SESSION_USER_ID,
    status: 'active', locale: 'ro', selectedCallId: null, currentPhase: 'drafting',
    projectId: null,
    blueprint: null, eligibility: null, outline: null, warnings: [],
    outlineFrozen: false,
    planningArtifact: null, messageSummary: null, stateVersion: 0,
    createdAt: new Date(), updatedAt: new Date(),
  } as AgentSession
}

beforeEach(() => {
  captured.length = 0
  isFeatureEnabledMock.mockReset()
  generateMock.mockClear()
})

describe('V3 runtime — cache opt-in flag gating (PR 2b)', () => {
  it('omits req.cache when v3_prompt_cache_enabled resolves false', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r1', locale: 'ro' },
      emit: () => {},
    })
    expect(captured).toHaveLength(1)
    expect(captured[0].cache).toBeUndefined()
  })

  it('passes cache: { enabled: true, breakpoints: [system, tools] } when the flag resolves true', async () => {
    isFeatureEnabledMock.mockResolvedValue(true)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r2', locale: 'ro' },
      emit: () => {},
    })
    expect(captured).toHaveLength(1)
    expect(captured[0].cache).toEqual({ enabled: true, breakpoints: ['system', 'tools'] })
  })

  it('does NOT set cache.key (identityKey-only per plan §D1)', async () => {
    isFeatureEnabledMock.mockResolvedValue(true)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r3', locale: 'ro' },
      emit: () => {},
    })
    expect(captured).toHaveLength(1)
    const cache = captured[0].cache as { key?: string } | undefined
    expect(cache?.key).toBeUndefined()
  })

  it('calls isFeatureEnabled with v3_prompt_cache_enabled and session.userId', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    await runAgentTurn({
      session: makeSession(),
      sections: [],
      request: { message: 'hi', requestId: 'r4', locale: 'ro' },
      emit: () => {},
    })
    expect(isFeatureEnabledMock).toHaveBeenCalledWith(
      'v3_prompt_cache_enabled',
      { userId: SESSION_USER_ID },
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/unit/ai/agent/runtime-cache-gate.test.ts`
Expected: FAIL — `runtime.ts` does not yet check `v3_prompt_cache_enabled` or pass `cache`.

---

### Task 12: Thread the cache option into `runtime.ts`

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts:167-173` (the `generate()` call inside the tool loop).

- [ ] **Step 1: Add the flag import**

Near the top of `app/src/lib/ai/agent/runtime.ts`, add (if not already present):

```typescript
import { isFeatureEnabled } from '@/lib/feature-flags'
```

- [ ] **Step 2: Resolve the flag once per turn, before the tool loop**

Find the block in `runtime.ts` (around line 149-150) that reads:

```typescript
    // 5. Call LLM with tool loop (max iterations to prevent runaway)
    const { generate } = await import('@/lib/ai/providers/router')
```

Insert **after** it, and **before** the `MAX_TOOL_ITERATIONS` constant:

```typescript
    // V3 cache opt-in — resolved once per turn; constant across tool-loop iterations
    // within a single turn. Percentage-targeted on session.userId via targeting.percentage.
    // Global kill switch prompt_cache_enabled still gates at the router level (PR 1).
    // See docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md §D4.
    const v3CacheEnabled = await isFeatureEnabled('v3_prompt_cache_enabled', {
      userId: session.userId,
    })
```

- [ ] **Step 3: Update the `generate()` call to pass the cache option conditionally**

Find the `generate({ ... })` call (around lines 167-173):

```typescript
      const response = await generate({
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        system: systemPrompt,
        messages: llmMessages,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
      })
```

Replace with:

```typescript
      const response = await generate({
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        system: systemPrompt,
        messages: llmMessages,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        // Omit cache entirely when the V3 flag resolves false — the router
        // skips the global-flag read on that path (router.ts:33-35).
        ...(v3CacheEnabled
          ? { cache: { enabled: true as const, breakpoints: ['system', 'tools'] as const } }
          : {}),
      })
```

Note: we do **NOT** set `cache.key` — the router's identityKey handles correlation per §D1.

- [ ] **Step 4: Run the cache-gate test to verify it passes**

Run: `cd app && npx vitest run tests/unit/ai/agent/runtime-cache-gate.test.ts`
Expected: all four cases PASS.

- [ ] **Step 5: Run the full agent test suite**

Run: `cd app && npx vitest run tests/unit/agent-prompt.test.ts tests/unit/agent-runtime.test.ts tests/unit/ai/agent`
Expected: all pass.

- [ ] **Step 6: Run typecheck + lint**

Run: `cd app && npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add app/src/lib/ai/agent/runtime.ts app/tests/unit/ai/agent/runtime-cache-gate.test.ts
git commit -m "feat(agent/runtime): opt into prompt caching when v3_prompt_cache_enabled is on"
```

---

### Task 13: Local smoke — dev stack, flag off → on, verify cache writes/reads

**Files:**
- None (manual local test)

- [ ] **Step 1: Verify global kill switch is on in local DB**

Run:
```bash
docker exec eu-funds-postgres-1 psql -U postgres -d eufunding -c \
  "UPDATE feature_flags SET enabled = true WHERE key = 'prompt_cache_enabled';"
docker exec eu-funds-postgres-1 psql -U postgres -d eufunding -c \
  "SELECT key, enabled, targeting FROM feature_flags WHERE key IN ('prompt_cache_enabled', 'v3_prompt_cache_enabled');"
```
Expected: both rows present; `prompt_cache_enabled` enabled = t; `v3_prompt_cache_enabled` targeting `{"percentage":0}`.

- [ ] **Step 2: Start the dev server**

Run: `cd app && npm run dev` (or `PORT=3002 npm run dev` per project convention — CLAUDE.md says port 3002 is the FondEU dev default).

- [ ] **Step 3: Baseline — one V3 turn with V3 flag at 0%**

Log in as a test user; start a V3 agent session; send one message. Tail the server logs and look for the `ai_call_completed` log line.

Expected:
- `cache.requested: false` (because V3 did not pass `cache` — flag bucket was 0%).
- `cache.enabled: false`, `disabledReason: 'request_disabled'`.

- [ ] **Step 4: Ramp V3 flag to 100% locally**

Run:
```bash
docker exec eu-funds-postgres-1 psql -U postgres -d eufunding -c \
  "UPDATE feature_flags SET targeting = '{\"percentage\": 100}'::jsonb WHERE key = 'v3_prompt_cache_enabled';"
```

Wait up to 60s for the in-process LRU to expire, OR restart the dev server to force a fresh read.

- [ ] **Step 5: Run a fresh V3 session with V3 flag at 100%**

Start a new session (don't reuse the baseline session — fresh context makes turn 1 a cache write and turn 2 a read). Send two messages back-to-back.

Expected in logs:
- Turn 1: `cache.requested: true`, `cache.enabled: true`, `cache.writes > 0`, `cache.reads = 0`, `hit: 'miss'`.
- Turn 2: `cache.reads > 0`, `hit: 'read'` (if the cached prefix is above the Anthropic minimum prefix-token threshold — V3's system + tools should comfortably clear it, but if the session's system prefix is short on turn 2 the read may be 0; see note).

**If turn 2 shows `cache.writes > 0` AND `cache.reads = 0` on a repeated same-phase turn** → prompt is churning. Diff `buildSystemPrompt` output across the two turns; something volatile leaked into `req.system`. **STOP and escalate.**

- [ ] **Step 6: Test the global kill switch**

While a session is mid-conversation, flip `prompt_cache_enabled` to false:
```bash
docker exec eu-funds-postgres-1 psql -U postgres -d eufunding -c \
  "UPDATE feature_flags SET enabled = false WHERE key = 'prompt_cache_enabled';"
```

Send another turn. Expected:
- `cache.requested: true`, `cache.enabled: false`, `disabledReason: 'global_kill_switch'`.
- Response latency/quality unchanged (falls back to uncached Anthropic path).

Flip it back to true and confirm caching resumes.

- [ ] **Step 7: Restore 0% for merge**

```bash
docker exec eu-funds-postgres-1 psql -U postgres -d eufunding -c \
  "UPDATE feature_flags SET targeting = '{\"percentage\": 0}'::jsonb WHERE key = 'v3_prompt_cache_enabled';"
```

(The migration ships 0%; we want master to be at 0% until PR 2c ramp.)

- [ ] **Step 8: Document local smoke evidence**

Append a brief note to `docs/runbooks/ai-caching.md` (between the existing sections) or record the log excerpts in the PR description. Include:
- Turn 2 cache `reads` count (actual number from your local logs).
- Kill-switch behavior (both flags independently disabling).

---

### Task 14: Open PR 2b

**Files:**
- None (gh CLI)

- [ ] **Step 1: Push the branch**

```bash
git push
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create \
  --title "feat(agent/runtime): opt V3 into prompt caching behind v3_prompt_cache_enabled (PR 2b)" \
  --body "$(cat <<'EOF'
## Summary
- Seeds new feature flag `v3_prompt_cache_enabled` at `percentage: 0` (migration 0033).
- V3 runtime now resolves the flag once per turn (via `session.userId`) and passes `cache: { enabled: true, breakpoints: ['system', 'tools'] }` on the `generate()` call only when the flag resolves true. Global kill switch `prompt_cache_enabled` (Plan 1) remains the outer gate at the router.
- Does **not** set `cache.key` — identityKey auto-derivation is preferred (V3 is Anthropic-only today; cross-provider fallback benefits from shared cache buckets). See plan §D1.

## Test plan
- [x] `tests/unit/ai/agent/runtime-cache-gate.test.ts` — four assertions: flag false → no `cache`; flag true → `cache: { enabled: true, breakpoints: ['system', 'tools'] }`; no `cache.key`; flag check uses `session.userId`.
- [x] `tests/unit/agent-prompt.test.ts`, `tests/unit/agent-runtime.test.ts`, `tests/unit/ai/agent/*` — full agent test suite passes.
- [x] `npm run typecheck && npm run lint` clean.
- [x] Local smoke (Task 13): baseline (V3 flag 0%) → ramp to 100% → observed `cache.writes > 0` on turn 1, `cache.reads > 0` on turn 2. Global kill switch flip observed to disable caching on the next request.

## Rollout
- Deploy with `v3_prompt_cache_enabled.targeting.percentage = 0` (no users cache).
- PR 2c ramps via admin API: 1% → 10% → 50% → 100% with tripwires per plan §D5.

## Scope
No router, adapter, cost, telemetry, or type-contract changes. Call site + flag only.

See: `docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md` PR 2b.
EOF
)"
```

- [ ] **Step 3: Wait for CI**

Run: `gh pr checks --watch`
Expected: all required checks pass.

- [ ] **Step 4: Request review, merge, pull master**

Do not self-merge. After approval and merge:

```bash
git checkout master && git pull && git log -1 --oneline
```

- [ ] **Step 5: Verify staging migration applied**

If staging auto-deploys on merge: confirm the migration ran and the flag row exists on staging (adjust the DB-access path to your staging environment).

If staging migrates on a separate step, run `npm run db:migrate` against staging. Verify `v3_prompt_cache_enabled` exists with `targeting = '{"percentage": 0}'`.

---

### Task 15: Staging validation of PR 2b

**Files:**
- None (manual staging test)

- [ ] **Step 1: Confirm global flag state on staging**

Ensure `prompt_cache_enabled` is `enabled: true` on staging. If it is not, enable it for this validation:
```bash
# Via admin API against staging URL — replace <STAGING_URL> and auth headers.
curl -X PATCH <STAGING_URL>/api/v1/admin/feature-flags/prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"enabled": true}'
```

- [ ] **Step 2: Ramp V3 flag to 100% on staging**

```bash
curl -X PATCH <STAGING_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"targeting": {"percentage": 100}}'
```

- [ ] **Step 3: Run a 5-turn V3 session on staging**

Use a staging test account. Create a project and run five back-to-back turns in `drafting` phase. Capture `ai_call_completed` log lines.

Expected:
- Turn 1: `cache.writes > 0`, `cache.reads = 0`, `hit: 'miss'`.
- Turns 2-5: `cache.reads > 0`, `hit: 'read'` on at least 3 of the 4 follow-up turns (Anthropic's 5-min ephemeral TTL is comfortably within a 5-turn interactive flow).
- No 5xx. No tool-timeout regression. Response text is sensible.

- [ ] **Step 4: Capture baselines for canary**

Query staging logs for:
- Baseline `/api/ai/agent` P50 / P99 latency over the last 7 days (pre-flag-ramp).
- Baseline 5xx rate over the last 7 days.
- Baseline V3 turn success rate (terminal-state-reached / total-turns) over the last 7 days.
- Baseline average cost per session (sum `tokensUsed.input * rate + tokensUsed.output * rate` across a 24h window).

Save the baselines in a scratch file or share in the team channel. These are the reference values for the PR 2c tripwires (plan §D5).

- [ ] **Step 5: Reset staging V3 flag to 0% after validation**

```bash
curl -X PATCH <STAGING_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"targeting": {"percentage": 0}}'
```

PR 2c starts the production ramp from 1%, not from whatever staging is at. Keep staging aligned at 0% so mid-canary rollback to 0% is a true no-op elsewhere.

---

## PR 2c — Production canary ramp 1% → 10% → 50% → 100%

**Goal of this PR:** Gated rollout of V3 prompt caching in production, via feature-flag ramps and monitoring against the tripwires in plan §D5. No code changes — operational only. Documented for traceability.

---

### Task 16: Pre-canary checklist (no code changes)

**Files:**
- None (ops checklist; record completion in the rollout tracking doc).

- [ ] **Step 1: Confirm PR 2b is merged and deployed to production**

Run:
```bash
gh pr list --state merged --label "prompt-caching" # or similar; verify PR 2b URL
curl -s <PROD_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'X-CSRF-Token: <admin-csrf>' --cookie 'authjs.session-token=<admin-session>'
```
Expected: row exists, `enabled: true`, `targeting.percentage: 0`.

- [ ] **Step 2: Confirm global flag is enabled in production**

```bash
curl -s <PROD_URL>/api/v1/admin/feature-flags/prompt_cache_enabled \
  -H 'X-CSRF-Token: <admin-csrf>' --cookie 'authjs.session-token=<admin-session>'
```
Expected: `enabled: true`. If false, enable it — that is Plan 1's global gate, and PR 2c cannot ramp V3 caching through a closed kill switch.

- [ ] **Step 3: Snapshot production baselines**

Run log queries against production covering the trailing 7 days — collect:
- `/api/ai/agent` P50 latency.
- `/api/ai/agent` P99 latency.
- `/api/ai/agent` 5xx rate (per 1000 requests).
- V3 turn success rate (terminal state reached / total turns).
- Average cost per V3 session (input + output token costs).

Document these five numbers in the rollout tracking issue / channel message. They are the reference for tripwire evaluation at each ramp stage.

- [ ] **Step 4: Confirm the runbook is in place**

Run: `cat docs/runbooks/ai-caching.md`
Expected: Sections from PR 1 runbook exist. If missing the V3-specific entries, add:

```markdown
## V3-specific rollout ops

**Q: How do I ramp V3 caching?**
`PATCH /api/v1/admin/feature-flags/v3_prompt_cache_enabled { "targeting": { "percentage": N } }`.
Percentage is deterministic on `(flagKey + userId)` MD5 hash; same user always gets the same bucket within a flag.

**Q: How do I kill V3 caching surgically without affecting RAG/one-shots later?**
Flip `v3_prompt_cache_enabled.enabled = false` (up to 60s cache delay on V3 flag reads). For emergency, prefer the global kill (`prompt_cache_enabled.enabled = false`, effective next request).
```

If this content is already there, no edit needed.

---

### Task 17: Ramp to 1% — canary stage 1

**Files:**
- None (ops).

- [ ] **Step 1: Schedule the ramp**

Pick a low-traffic production window (confirm with the operator / on-call). Announce in the team channel: "V3 prompt caching → 1% at <TIME>".

- [ ] **Step 2: Flip the flag**

```bash
curl -X PATCH <PROD_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"targeting": {"percentage": 1}}'
```

Record timestamp.

- [ ] **Step 3: Watch for 30 minutes**

Monitor the five tripwire signals (plan §D5) vs pre-ramp baselines. Specifically:
- Cache hit rate in the 1% cohort (log filter: sessions in the 0-0 bucket for this flag).
- `/api/ai/agent` 5xx rate.
- `/api/ai/agent` P99.
- V3 turn success rate.
- Cost per session.

Mental model: the 1% cohort is small. Expect noisy short-window metrics; look for obvious regressions, not marginal shifts.

- [ ] **Step 4: Decision point**

- **All tripwires green** → proceed to Task 18.
- **Cache hit rate < 10% after 30 min** → pause ramp, investigate prompt churn per runbook §12. **Stop-and-escalate** (plan §Stop §5).
- **Any hard tripwire breach** (5xx regression sustained > 15 min, P99 > 40%, success rate drop > 2 p.p.) → immediate rollback per Task 23.

- [ ] **Step 5: Hold at 1% for 24 hours**

After the 30-minute watch, continue monitoring passively for 24 hours. This covers the first real daytime traffic window. Automated alert on any tripwire signal breach.

---

### Task 18: Ramp to 10% — canary stage 2

**Files:**
- None (ops).

- [ ] **Step 1: Confirm stage 1 passed 24-hour hold**

Review: tripwires still green? No user-facing complaints? Cost steady?

- [ ] **Step 2: Flip to 10%**

```bash
curl -X PATCH <PROD_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"targeting": {"percentage": 10}}'
```

Record timestamp.

- [ ] **Step 3: Watch for 60 minutes, then hold 24h**

Same tripwires as Task 17. Sample size is 10× larger; noise drops and signals are more reliable. Cache hit rate should be **≥ 40% within 30 minutes of steady state**.

- [ ] **Step 4: Decision point**

- **All tripwires green and hit rate ≥ 40%** → proceed to Task 19.
- **Hit rate < 40% after 30 min of steady state** → pause. Diff `buildSystemPrompt` output across two turns in a real production session; if it's still stable, check tool-list order in the actual runtime (import-time side effects can differ between dev and prod). Do not advance until hit rate is met or a root cause is understood and fixed.
- **Any hard tripwire breach** → rollback per Task 23.

---

### Task 19: Ramp to 50% — canary stage 3

**Files:**
- None (ops).

- [ ] **Step 1: Confirm stage 2 passed 24-hour hold**

- [ ] **Step 2: Flip to 50%**

```bash
curl -X PATCH <PROD_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"targeting": {"percentage": 50}}'
```

- [ ] **Step 3: Watch 60 minutes, then hold 48h**

At 50% the cost impact becomes load-bearing. Specifically watch the **cost-per-session** tripwire: a bad write/read ratio shows up here if it was masked at 10%.

- [ ] **Step 4: Decision point**

- All tripwires green → proceed to Task 20.
- Cost up > 10% vs baseline → pause; investigate write/read ratio per runbook §12.
- Any hard tripwire breach → rollback per Task 23.

---

### Task 20: Ramp to 100% — canary stage 4

**Files:**
- None (ops).

- [ ] **Step 1: Confirm stage 3 passed 48-hour hold**

- [ ] **Step 2: Flip to 100%**

```bash
curl -X PATCH <PROD_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"targeting": {"percentage": 100}}'
```

- [ ] **Step 3: 48-hour post-ramp watch**

Same tripwires. No new bucket logic kicks in going from 50% → 100%; variance should drop further.

- [ ] **Step 4: Declare V3 rollout complete**

Announce in the team channel. Update the rollout tracking issue with the final numbers: sustained cache hit rate, P50/P99 deltas, 5xx delta, cost per session delta.

---

### Task 21: Two-week SLO watch

**Files:**
- None (ops).

- [ ] **Step 1: Track §13 SLO targets for 2 weeks**

Per design spec §13:

| Metric | Target |
|---|---|
| V3 cache hit rate on sessions ≥ 3 turns | ≥ 40% |
| P50 / P99 latency on `/api/ai/*` | No regression vs pre-PR-2 baseline |
| 5xx rate on `/api/ai/*` | No regression vs pre-PR-2 baseline |

- [ ] **Step 2: At week 1, snapshot the numbers**

Post in the team channel. Compare against baselines recorded in Task 16.

- [ ] **Step 3: At week 2, snapshot and close out**

If all targets held for 2 weeks → PR 2c canary closes successfully. Move V3 flag from "canary" to "steady state" in the rollout doc. Plan 3 (RAG opt-in) can now begin.

---

### Task 22: Document the canary outcome

**Files:**
- Modify: `docs/runbooks/ai-caching.md` (append a "2026-04 V3 rollout outcome" section).
- Create (optional): an AAR per CLAUDE.md Self-Improving Loop if the ramp surfaced anything surprising.

- [ ] **Step 1: Append outcome summary to the runbook**

Append the following section to `docs/runbooks/ai-caching.md`:

```markdown
## 2026-04 V3 rollout outcome

**Duration:** <start date> → <end date>
**Final state:** `v3_prompt_cache_enabled` at 100%; `prompt_cache_enabled` at true.

**Observed:**
- V3 sustained cache hit rate: <X>%.
- P50 delta: <Y>. P99 delta: <Z>.
- 5xx delta: <A>.
- Cost-per-session delta: <B>.

**Tripwires that fired:** <list or "none">.
**Lessons:** <any prompt-stability finding worth preserving>.
```

Fill in actual numbers.

- [ ] **Step 2: If any retries or investigations happened, write an AAR**

Per CLAUDE.md: "Tasks with retries or investigations" require an AAR at `~/.claude/projects/-home-godja/memory/aars/YYYY-MM-DD-v3-prompt-cache-canary.md`. Keep it short: what went wrong, root cause, fix, what to do differently.

- [ ] **Step 3: Commit documentation changes**

```bash
git checkout -b docs/prompt-cache-v3-canary-outcome
git add docs/runbooks/ai-caching.md
git commit -m "docs(runbooks/ai-caching): capture V3 prompt caching canary outcome"
git push -u origin docs/prompt-cache-v3-canary-outcome
gh pr create --title "docs(runbooks): V3 prompt caching canary outcome" \
  --body "Final numbers from the V3 prompt caching canary per plan PR 2c. No code."
```

Merge after a light review.

---

### Task 23: Rollback procedure (referenced by ramp tasks)

**Files:**
- None (this is the reference procedure; tasks above dispatch to it).

If any **hard tripwire** breaches during the canary (plan §D5): sustained 5xx regression > 15 min, P99 up > 40%, V3 success rate drop > 2 p.p., or cost up > 25%:

- [ ] **Step 1: Flip the global kill switch FIRST (fastest, broadest)**

```bash
curl -X PATCH <PROD_URL>/api/v1/admin/feature-flags/prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"enabled": false}'
```

Effect: **next request** — no cache delay. Router reads this flag with `bypassCache: true`.

- [ ] **Step 2: Verify traffic is on the uncached path**

Watch `ai_call_completed` logs for 2-3 minutes. Expected: all entries show `cache.disabledReason: 'global_kill_switch'`. If any still show `disabledReason: 'none'` and real cache reads/writes, the flag flip did not propagate — re-verify the PATCH succeeded and re-fire.

- [ ] **Step 3: Drop V3 flag to 0% (defense in depth)**

```bash
curl -X PATCH <PROD_URL>/api/v1/admin/feature-flags/v3_prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"targeting": {"percentage": 0}}'
```

- [ ] **Step 4: Alert and investigate**

Notify the team channel. Capture:
- Exact timestamp of the tripwire breach.
- Tripwire signal + value.
- Rollback flip timestamp.
- Time to recovery (traffic back on uncached path, signal back in range).

Open an investigation — follow the runbook questions (`Cache hit rate dropped`, `Cost went up`, `Anthropic native transport 4xx errors`). Do not re-enable caching until root cause is identified and mitigated.

- [ ] **Step 5: Document in an AAR**

Per CLAUDE.md Self-Improving Loop, write an AAR at `~/.claude/projects/-home-godja/memory/aars/YYYY-MM-DD-v3-prompt-cache-rollback.md`.

---

### Task 24: Verify rollback SLA (non-blocking — run during Task 17 low-risk window)

**Files:**
- None (ops).

- [ ] **Step 1: During the 1% canary (Task 17), time a rollback end-to-end**

While the canary is live at 1%, perform an intentional rollback drill in a pre-announced window:

1. Record T0: decision to rollback.
2. Execute the global kill flip (Task 23 Step 1).
3. Record T1: first `ai_call_completed` log line in production showing `disabledReason: 'global_kill_switch'`.

**Expected T1 - T0 ≤ 15 seconds.**

If > 15 s, investigate: the router uses `bypassCache: true` which should be sub-second; delay likely lives in log propagation, not the flag read. Document in the runbook.

- [ ] **Step 2: Re-ramp to 1% after the drill**

```bash
curl -X PATCH <PROD_URL>/api/v1/admin/feature-flags/prompt_cache_enabled \
  -H 'Content-Type: application/json' \
  -H 'X-CSRF-Token: <admin-csrf>' \
  --cookie 'authjs.session-token=<admin-session>' \
  -d '{"enabled": true}'
```

Resume canary at 1% and continue with Task 17 Step 3.

---

## Self-review checklist (run after writing this plan)

- [x] **Spec coverage §11 (rollout):** PR 2b seeds a V3-scoped flag; PR 2c implements the staged 1% → 10% → 50% → 100% ramp with documented tripwires. Global kill switch preserved.
- [x] **Spec coverage §9 (telemetry):** No new telemetry added — Plan 1 landed the structured log + Prometheus counters the tripwires rely on. Plan confirms which metrics feed which tripwire.
- [x] **Spec coverage §13 (SLO targets):** Task 21 tracks the 2-week SLO watch and maps each §13 target to a tripwire or monitoring signal.
- [x] **PR 0 audit §4 volatile-tail recommendation:** Resolved via plan §D3 and Tasks 4+6 implementation (move volatile tail out of `req.system` to a `role: 'system'` message; the native adapter hoists it uncached).
- [x] **Tool-list ordering + schema bytes:** Task 2 verifies name-order AND zodToJsonSchema byte-stability AND identityKey stability. If any fails → stop-and-escalate §1.
- [x] **Scope boundary (no router / adapter / cost / telemetry edits):** Confirmed per task. Only `prompt.ts`, `runtime.ts`, one migration + tests + docs touched.
- [x] **PR 1 guarantees preserved:** Runtime only *adds* a `cache` option when V3 flag is on. Adapters emit `cacheUsage` only when caller opts in (unchanged). No `cache_control` leaks for non-opted-in callers.
- [x] **Rollback path:** Global kill switch first (sub-second next-request SLA), V3 flag drop as defense in depth. Verified in Task 24 drill during 1% canary.
- [x] **Preselect coupling:** §D6 documents the narrow coupling — only structured-action turns on preselected sessions reach V3 (non-action turns 503 `MANAGED_UNAVAILABLE` per `app/src/app/api/ai/agent/route.ts:179-320`). Cache-impact caveat noted for action-heavy cohorts at 10%+ ramp. Re-validate if managed Phase 3 lands mid-canary.
- [x] **No placeholders:** Every task has concrete files, commands, and code. Tests in Tasks 7 and 11 inline the full mock setup mirroring `app/tests/unit/ai/agent/runtime-message-push.test.ts` (which exists in master at PR 1's HEAD). No `expect.fail(...)` scaffolds.
- [x] **Type consistency:** `buildSystemPrompt(session, _sections)` signature unchanged at the callsite level. `buildSessionStateBlock(session, sections)` is new; its name is used identically in prompt.ts, runtime.ts, the rewritten `agent-prompt.test.ts`, the patched `runtime-message-push.test.ts` mock, and the new parity + cache-gate tests.
- [x] **Existing tests patched, not abandoned:** `agent-prompt.test.ts` is rewritten in place (Task 3); `runtime-message-push.test.ts` mock is patched (Task 5). No parallel `prompt.test.ts` under `tests/unit/ai/agent/` — one source of truth per module.
- [x] **Preselect path verified against code:** §D6 reflects `app/src/app/api/ai/agent/route.ts:179-320` — only structured actions on preselected sessions reach V3; non-action preselected turns 503 `MANAGED_UNAVAILABLE`. Narrow coupling documented.
- [x] **Behavior-parity caveat surfaced:** §D3 acknowledges the system-block ordering change (persona/state/rules/phase → persona/rules/phase/state). Parity test is structural, not textual output comparison.
- [x] **Cohort monitoring caveat surfaced:** §D5 acknowledges Prometheus counters lack cohort labels; tripwires are computed from structured logs using the `cache.requested=true AND cache.enabled=true AND model=claude-opus-4-6` predicate, which isolates V3 caching traffic since no other caller opts in during PR 2c's ramp window.
- [x] **Spec conflict:** §7.2 example includes `cache.key = 'v3:${sessionId}:${phase}'`; this plan deviates for reasons in §D1. Decision documented.
- [ ] **Plan tracked in git:** Commit the plan file to master before branching for Task 1 — see the "Committing this plan to master" section below. Check this off once the commit lands.

## Committing this plan to master

The plan file itself is currently untracked. Before execution starts, commit it so the branch history for PR 2a references a stable plan URL:

```bash
git checkout master && git pull
git add docs/superpowers/plans/2026-04-22-v3-rag-prompt-caching-pr2-v3-optin.md
git commit -m "docs(plans): V3 prompt caching opt-in + canary (Plan 2)"
git push
```

Then branch for Task 1 from that fresh master. This is optional — Task 1 can also land the plan file on the PR 2a branch — but committing first keeps the plan reference stable for anyone reading PR descriptions.

## End of plan
