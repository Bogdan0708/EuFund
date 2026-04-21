# V3 + RAG Prompt Caching — Plan 1 (PR 0 + PR 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the provider-neutral router cache contract (§5), the Anthropic native translator (§6.1), telemetry and cost infrastructure (§9), the V3 assistant-message push consolidation (§7.3), and the Google/Perplexity `UnsupportedOperationError` — with **zero caller opt-ins** — so PR 2 can safely opt V3 into caching.

**Architecture:** `GenerateRequest.cache?` and `GenerateResult.cacheUsage?` extend the existing router contract. Anthropic's adapter branches: non-cache path keeps the OpenAI-compat shim, cache path uses a new `anthropic-native.ts` native-SDK translator. Router skips the `prompt_cache_enabled` flag read when `req.cache?.enabled !== true` — keeping PR 1 truly behavior-neutral. V3 runtime gets a one-push-per-iteration fix that also adds `tool_calls` onto the assistant message (required for native Anthropic tool replay; also fixes a latent shim bug that this PR probes and documents).

**Tech Stack:** TypeScript, Next.js 14, Vitest, Drizzle (hand-authored migrations per `CLAUDE.md`), `@anthropic-ai/sdk`, `openai`, `lib/feature-flags`, `lib/monitoring/metrics`, `lib/logger`.

**Reference:** Design spec at `docs/superpowers/specs/2026-04-21-v3-rag-prompt-caching-design.md`. Section numbers below (§N.M) refer to that document.

**Scope boundary:** This plan ends with a green PR 1 merged to master. **No caller opts in to caching in this plan.** V3 opt-in is Plan 2; RAG opt-in is Plan 3; one-shots are Plan 4; Managed centralization is Plan 5.

---

## Task 0: Create a working branch from master

**Files:**
- None (git only)

- [ ] **Step 1: Verify clean master**

Run: `git status && git log -1 --oneline`
Expected: Clean tree; HEAD at `ba92dba` or later (the spec + presence-test commits).

- [ ] **Step 2: Create branch**

```bash
git checkout -b feature/prompt-cache-pr1-router-contract
```

- [ ] **Step 3: Push branch to establish remote tracking**

```bash
git push -u origin feature/prompt-cache-pr1-router-contract
```

---

## PR 0 — V3 system-prompt stability audit (prerequisite)

**This is a standalone commit on the branch**, merged with PR 1 or in a small precursor PR. It blocks PR 2 only, not the rest of PR 1. It must exist before PR 2 can ship.

### Task 1: Write and commit the V3 system-prompt stability audit

**Files:**
- Create: `docs/runbooks/audits/v3-prompt-stability-2026-04.md`

- [ ] **Step 1: Read the V3 prompt builder**

Run: `cat app/src/lib/ai/agent/prompt.ts | head -100`
Read the full file. Identify every string template literal and every interpolated value.

- [ ] **Step 2: Grep for non-stable sources in the prompt module**

Run:
```bash
grep -nE 'Date\.now|new Date\(|toISOString|randomUUID|crypto\.|requestId|performance\.now' app/src/lib/ai/agent/prompt.ts
grep -nE 'Date\.now|new Date\(|toISOString|randomUUID|crypto\.|requestId|performance\.now' app/src/lib/ai/agent/types.ts
```
Expected: either empty, or a concrete list of lines to audit.

- [ ] **Step 3: Inspect inputs to `buildSystemPrompt(session, sections)`**

Run:
```bash
grep -nE 'buildSystemPrompt' app/src/lib/ai/agent/
```
Confirm the function's inputs: `session` (id, currentPhase, locale, outline, systemSummary), `sections` (array of section states). Document which of those fields feeds the prompt, which are stable across turns, and which change per-phase.

- [ ] **Step 4: Read `lib/ai/agent/policies.ts` and `transitions.ts` for any prompt-visible policy strings**

Run: `grep -nE 'systemPrompt|prompt' app/src/lib/ai/agent/policies.ts app/src/lib/ai/agent/transitions.ts`
Expected: note any policy text that feeds the system prompt.

- [ ] **Step 5: Write the audit document**

Write `docs/runbooks/audits/v3-prompt-stability-2026-04.md` with the following headings and concrete findings under each:

```markdown
# V3 System-Prompt Stability Audit — 2026-04

**Purpose:** Verify that the V3 runtime's `systemPrompt` is stable across turns within a given `(sessionId, phase)` pairing, so that Anthropic prompt caching produces cache reads instead of churning writes.

**Source:** `app/src/lib/ai/agent/prompt.ts:buildSystemPrompt()`.

## 1. Inputs to `buildSystemPrompt`
- `session.id` — stable across turns.
- `session.currentPhase` — changes on phase transition; invalidation expected.
- `session.locale` — stable.
- `session.outline` — stable across turns once set.
- `session.systemSummary` — changes when compaction runs; invalidation expected.
- `sections` — a map of section states...

## 2. Grep results for non-stable content
[paste grep output]

## 3. Findings
- [ ] No `Date.now()` / `new Date()` / timestamp interpolation — CONFIRMED / FOUND at line X.
- [ ] No per-call UUIDs / request IDs — CONFIRMED / FOUND at line X.
- [ ] No user PII or per-call identifiers in the prompt prefix — CONFIRMED / FOUND at line X.
- [ ] Tool-list ordering is deterministic per phase — CONFIRMED / needs fix.
- [ ] Policy matrix output is stable per phase — CONFIRMED / needs fix.

## 4. Required fixes (if any)
[One entry per finding; or "None — prompt is cache-stable as-is."]

## 5. Cacheability verdict
[ ] V3 system prompt is cache-stable within `(sessionId, phase)` — proceed to PR 2.
[ ] V3 system prompt has instability that must be fixed before PR 2.
```

Fill in sections 1-5 based on the actual grep + inspection results. This is the audit artifact; it is real, not a template.

- [ ] **Step 6: Commit the audit**

```bash
git add docs/runbooks/audits/v3-prompt-stability-2026-04.md
git commit -m "docs(audits): V3 system-prompt stability audit for prompt caching (PR 0)"
```

---

## PR 1 — Router cache infrastructure

**Zero caller opt-ins.** All tasks below modify the router, adapters, telemetry, cost, and V3 runtime's assistant-message push. V3 **does not** pass `req.cache` yet — that's Plan 2.

---

### Task 2: Add `UnsupportedOperationError` to the errors module

**Files:**
- Modify: `app/src/lib/errors/index.ts`
- Test: `app/tests/unit/lib/errors/unsupported-operation.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/lib/errors/unsupported-operation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { UnsupportedOperationError } from '@/lib/errors'

describe('UnsupportedOperationError', () => {
  it('carries a provider + feature descriptor in the message', () => {
    const err = new UnsupportedOperationError('google', 'tool_calls in messages')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('UnsupportedOperationError')
    expect(err.message).toContain('google')
    expect(err.message).toContain('tool_calls in messages')
  })

  it('exposes provider and feature as readable fields', () => {
    const err = new UnsupportedOperationError('perplexity', 'cache.breakpoints.tools')
    expect(err.provider).toBe('perplexity')
    expect(err.feature).toBe('cache.breakpoints.tools')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/unit/lib/errors/unsupported-operation.test.ts`
Expected: FAIL — `UnsupportedOperationError` not exported.

- [ ] **Step 3: Implement the class**

Append to `app/src/lib/errors/index.ts`:

```typescript
export class UnsupportedOperationError extends Error {
  readonly provider: string
  readonly feature: string
  constructor(provider: string, feature: string) {
    super(`Provider "${provider}" does not support: ${feature}`)
    this.name = 'UnsupportedOperationError'
    this.provider = provider
    this.feature = feature
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/unit/lib/errors/unsupported-operation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/errors/index.ts app/tests/unit/lib/errors/unsupported-operation.test.ts
git commit -m "feat(errors): add UnsupportedOperationError for provider capability gaps"
```

---

### Task 3: Extend router types with cache + tool_calls shapes

**Files:**
- Modify: `app/src/lib/ai/providers/types.ts`
- Test: `app/tests/unit/ai/providers/types.test.ts` (new — compile-time sanity)

- [ ] **Step 1: Write the compile-time sanity test**

Create `app/tests/unit/ai/providers/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type {
  CacheOptions,
  CacheUsage,
  CacheDisabledReason,
  CacheHit,
  RouterToolCall,
  RouterMessage,
  GenerateRequest,
  GenerateResult,
} from '@/lib/ai/providers/types'

describe('router cache type shapes', () => {
  it('CacheOptions accepts the v1 breakpoint union', () => {
    const opts: CacheOptions = {
      enabled: true,
      key: 'v3:abc:drafting',
      breakpoints: ['system', 'tools'],
      ttlSeconds: 300,
    }
    expect(opts.enabled).toBe(true)
  })

  it('CacheUsage has the documented shape', () => {
    const usage: CacheUsage = {
      requested: true,
      enabled: true,
      disabledReason: 'none',
      identityKey: 'a'.repeat(64),
      supported: true,
      reads: 100,
      writes: 0,
      hit: 'read',
      effectiveTtlSeconds: 300,
    }
    expect(usage.hit).toBe('read')
  })

  it('RouterToolCall matches OpenAI wire shape', () => {
    const tc: RouterToolCall = {
      id: 'call_123',
      type: 'function',
      function: { name: 'search_calls', arguments: '{}' },
    }
    expect(tc.type).toBe('function')
  })

  it('RouterMessage permits assistant + tool_calls', () => {
    const msg: RouterMessage = {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'x', arguments: '{}' } }],
    }
    expect(msg.role).toBe('assistant')
  })

  it('GenerateResult.cacheUsage is optional', () => {
    const result: GenerateResult = {
      content: 'ok',
      tokensUsed: { input: 10, output: 5 },
      model: 'claude-opus-4-6',
      provider: 'anthropic',
    }
    expect(result.cacheUsage).toBeUndefined()
  })

  it('CacheDisabledReason enumerates the three values', () => {
    const reasons: CacheDisabledReason[] = ['global_kill_switch', 'request_disabled', 'none']
    expect(reasons).toHaveLength(3)
  })

  it('CacheHit enumerates the four values', () => {
    const hits: CacheHit[] = ['read', 'miss', 'disabled', 'unsupported']
    expect(hits).toHaveLength(4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails (type-check fails)**

Run: `cd app && npx vitest run tests/unit/ai/providers/types.test.ts`
Expected: FAIL — imports not found.

- [ ] **Step 3: Extend `app/src/lib/ai/providers/types.ts`**

Replace the file's contents with:

```typescript
export interface GenerateRequest {
  system?: string
  messages: RouterMessage[]
  provider: ProviderName
  model: string
  maxTokens?: number
  temperature?: number
  tools?: ToolSchema[]
  cache?: CacheOptions
}

export interface GenerateResult {
  content: string
  tokensUsed: { input: number; output: number }
  model: string
  provider: ProviderName
  toolCalls?: ToolCallResult[]
  cacheUsage?: CacheUsage
}

export interface RouterMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: RouterToolCall[]
}

export interface RouterToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface ToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ToolCallResult {
  id: string
  name: string
  arguments: string
}

export type ProviderName = 'openai' | 'anthropic' | 'google' | 'perplexity'

export interface ProviderClient {
  generate(req: GenerateRequest): Promise<GenerateResult>
  embed?(text: string): Promise<number[]>
}

export interface ModelConfig {
  provider: ProviderName
  model: string
  timeout: number
  fallback?: { provider: ProviderName; model: string }
}

export interface CacheOptions {
  enabled: boolean
  key?: string
  breakpoints?: Array<'system' | 'tools'>
  ttlSeconds?: number
}

export type CacheDisabledReason = 'global_kill_switch' | 'request_disabled' | 'none'
export type CacheHit = 'read' | 'miss' | 'disabled' | 'unsupported'

export interface CacheUsage {
  requested: boolean
  enabled: boolean
  disabledReason: CacheDisabledReason
  identityKey: string
  supported: boolean
  reads: number
  writes: number
  hit: CacheHit
  effectiveTtlSeconds?: number
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  'claude-opus-4-6': { provider: 'anthropic', model: 'claude-opus-4-6', timeout: 180_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'claude-sonnet-4-6': { provider: 'anthropic', model: 'claude-sonnet-4-6', timeout: 90_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'claude-haiku-4-5': { provider: 'anthropic', model: 'claude-haiku-4-5', timeout: 30_000, fallback: { provider: 'openai', model: 'gpt-5.4-mini' } },
  'gpt-5.4': { provider: 'openai', model: 'gpt-5.4', timeout: 60_000, fallback: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
  'gpt-5.4-mini': { provider: 'openai', model: 'gpt-5.4-mini', timeout: 45_000, fallback: { provider: 'anthropic', model: 'claude-haiku-4-5' } },
  'gpt-5.4-nano': { provider: 'openai', model: 'gpt-5.4-nano', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
  'gemini-3.1-pro': { provider: 'google', model: 'gemini-3.1-pro', timeout: 90_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'gemini-3-flash': { provider: 'google', model: 'gemini-3-flash', timeout: 30_000, fallback: { provider: 'openai', model: 'gpt-5.4-mini' } },
  'nano-banana': { provider: 'google', model: 'nano-banana', timeout: 60_000, fallback: { provider: 'openai', model: 'gpt-5.4' } },
  'sonar': { provider: 'perplexity', model: 'sonar', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
  'sonar-pro': { provider: 'perplexity', model: 'sonar-pro', timeout: 30_000, fallback: { provider: 'google', model: 'gemini-3-flash' } },
}

export { SECTION_MODEL_ROUTING, type RoutingTier } from '../model-routing'
```

- [ ] **Step 4: Run the sanity test and typecheck**

Run: `cd app && npx vitest run tests/unit/ai/providers/types.test.ts && npm run typecheck`
Expected: test PASS + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/types.ts app/tests/unit/ai/providers/types.test.ts
git commit -m "feat(ai/providers): extend router types with cache options and tool_calls"
```

---

### Task 4: Write canonical JSON + identity key helper

**Files:**
- Create: `app/src/lib/ai/providers/cache-key.ts`
- Test: `app/tests/unit/ai/providers/cache-key.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/ai/providers/cache-key.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { canonicalJson, deriveIdentityKey } from '@/lib/ai/providers/cache-key'
import type { GenerateRequest } from '@/lib/ai/providers/types'

describe('canonicalJson', () => {
  it('sorts object keys deterministically at all depths', () => {
    const a = canonicalJson({ b: 1, a: { d: 2, c: 3 } })
    const b = canonicalJson({ a: { c: 3, d: 2 }, b: 1 })
    expect(a).toBe(b)
  })

  it('preserves array order (arrays are semantic)', () => {
    const a = canonicalJson(['x', 'y'])
    const b = canonicalJson(['y', 'x'])
    expect(a).not.toBe(b)
  })

  it('serialises strings, numbers, booleans, null', () => {
    expect(canonicalJson({ a: 'x', b: 1, c: true, d: null })).toBe('{"a":"x","b":1,"c":true,"d":null}')
  })
})

describe('deriveIdentityKey', () => {
  const baseReq: Pick<GenerateRequest, 'provider' | 'model' | 'system' | 'tools'> = {
    provider: 'anthropic',
    model: 'claude-opus-4-6',
    system: 'You are an assistant.',
    tools: [{
      type: 'function',
      function: {
        name: 'search',
        description: 'searches',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    }],
  }

  it('produces a 64-char lowercase hex sha256', () => {
    const key = deriveIdentityKey(baseReq)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is stable across shuffled object-key order in tool schemas', () => {
    const shuffled = {
      ...baseReq,
      tools: [{
        type: 'function' as const,
        function: {
          parameters: { properties: { q: { type: 'string' } }, type: 'object' },
          description: 'searches',
          name: 'search',
        },
      }],
    }
    expect(deriveIdentityKey(baseReq)).toBe(deriveIdentityKey(shuffled))
  })

  it('changes when tool order changes (tool order is semantic)', () => {
    const twoTools = {
      ...baseReq,
      tools: [
        baseReq.tools![0],
        {
          type: 'function' as const,
          function: { name: 'other', description: '', parameters: {} },
        },
      ],
    }
    const reversed = { ...twoTools, tools: [twoTools.tools![1], twoTools.tools![0]] }
    expect(deriveIdentityKey(twoTools)).not.toBe(deriveIdentityKey(reversed))
  })

  it('does not incorporate messages (they must be excluded)', () => {
    // Same signature even though hypothetical messages differ — messages are not in the Pick<>.
    const a = deriveIdentityKey(baseReq)
    const b = deriveIdentityKey({ ...baseReq })
    expect(a).toBe(b)
  })

  it('changes when provider changes', () => {
    const k1 = deriveIdentityKey(baseReq)
    const k2 = deriveIdentityKey({ ...baseReq, provider: 'openai' })
    expect(k1).not.toBe(k2)
  })

  it('changes when model changes', () => {
    const k1 = deriveIdentityKey(baseReq)
    const k2 = deriveIdentityKey({ ...baseReq, model: 'claude-sonnet-4-6' })
    expect(k1).not.toBe(k2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/cache-key.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `app/src/lib/ai/providers/cache-key.ts`:

```typescript
import { createHash } from 'crypto'
import type { GenerateRequest, ToolSchema } from './types'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']'
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  const pairs = keys.map((k) =>
    JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]),
  )
  return '{' + pairs.join(',') + '}'
}

function normalizeTool(tool: ToolSchema): unknown {
  // Force a fresh object so canonicalJson's key sort applies to every nested
  // level, including `parameters`. Returned as `unknown` because canonicalJson
  // accepts arbitrary JSON-compatible values.
  return {
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    },
  }
}

export function deriveIdentityKey(
  req: Pick<GenerateRequest, 'provider' | 'model' | 'system' | 'tools'>,
): string {
  const payload = canonicalJson({
    provider: req.provider,
    model: req.model,
    system: req.system ?? '',
    tools: (req.tools ?? []).map(normalizeTool),
  })
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/cache-key.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/cache-key.ts app/tests/unit/ai/providers/cache-key.test.ts
git commit -m "feat(ai/providers): canonical JSON + identity-key derivation"
```

---

### Task 5: Audit Google/Perplexity callers for tool-call history (prereq for Task 6-7)

**Files:**
- Create: `docs/runbooks/audits/google-perplexity-toolcall-audit-2026-04.md`
- No code changes.

- [ ] **Step 1: Grep every `generate(` call site under `app/src/`**

Run:
```bash
cd app && grep -rnE 'generate\(|generate \(' src/ --include='*.ts' --include='*.tsx' | grep -v 'test' | grep -v 'types.ts'
```
Expected: a list of call sites.

- [ ] **Step 2: For each call site, trace whether it can be Google or Perplexity AND can pass `messages[].tool_calls`**

Inspect each call site. Rule of thumb:
- If the site uses `resolveAgentModel({ task: 'research' })`, provider will be Perplexity.
- If the site uses `resolveAgentModel({ task: 'freshness_check' })`, provider will be Perplexity (tier `research`).
- If the site hardcodes `provider: 'google'` or resolves through a user override that can pick Gemini, it may route to Google.
- A call site "passes `messages[].tool_calls`" only if it constructs assistant messages with tool calls from prior turns. V3 runtime is the primary such caller; `aiGenerate` one-shots build `[{role:'user', content:prompt}]` and never include prior-turn tool history.

- [ ] **Step 3: Write the audit document**

Write `docs/runbooks/audits/google-perplexity-toolcall-audit-2026-04.md` with concrete findings:

```markdown
# Google/Perplexity Tool-Call History Audit — 2026-04

**Purpose:** Before router adapters throw `UnsupportedOperationError` on Google/Perplexity calls that include `messages[].tool_calls`, confirm no production code path passes such history to either provider.

## Call sites audited
- `app/src/lib/ai/agent/runtime.ts:162` — V3 runtime. Provider: `anthropic` (hardcoded today). **Does** push tool_calls after Task 24. Does not currently route to Google/Perplexity.
- `app/src/lib/ai/client.ts:36` — `aiGenerate` and `aiGenerateObject`. Messages: `[{role:'user', content:prompt}]`. **Never** includes tool_calls.
- [One entry per call site found in Step 1]

## Findings
- [ ] Zero call sites route tool-call history to Google.
- [ ] Zero call sites route tool-call history to Perplexity.
- [ ] Action: `UnsupportedOperationError` can be safely added in Tasks 6 & 7.

If any site is found that would break: list it here with a mitigation (migrate off tool-call history, or route to a supporting provider, or gate the `UnsupportedOperationError` addition behind a flag).
```

Fill in Findings with concrete data.

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/audits/google-perplexity-toolcall-audit-2026-04.md
git commit -m "docs(audits): Google/Perplexity tool-call history audit (PR 1 prereq)"
```

---

### Task 6: Google adapter — ignore cache, throw on tool_calls

**Files:**
- Modify: `app/src/lib/ai/providers/google.ts`
- Test: `app/tests/unit/ai/providers/google.test.ts` (new or extended)

- [ ] **Step 1: Read the current Google adapter**

Run: `cat app/src/lib/ai/providers/google.ts`
Note the current `generate()` signature and body.

- [ ] **Step 2: Write the failing tests**

Context: `app/src/lib/ai/providers/google.ts` uses the OpenAI SDK against Google's OpenAI-compatible endpoint (`generativelanguage.googleapis.com/v1beta/openai/`). Mock `openai` the same way as the OpenAI and Perplexity tests.

Create `app/tests/unit/ai/providers/google.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UnsupportedOperationError } from '@/lib/errors'
import type { GenerateRequest } from '@/lib/ai/providers/types'

const createMock = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: createMock } } })),
}))

describe('googleProvider.generate', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
  })

  it('cache.enabled=true returns cacheUsage with supported:false, hit:unsupported', async () => {
    const { googleProvider } = await import('@/lib/ai/providers/google')
    const req: GenerateRequest = {
      provider: 'google',
      model: 'gemini-3-flash',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, breakpoints: ['system'] },
    }
    const result = await googleProvider.generate(req)
    expect(result.cacheUsage).toBeDefined()
    expect(result.cacheUsage!.supported).toBe(false)
    expect(result.cacheUsage!.hit).toBe('unsupported')
    expect(result.cacheUsage!.enabled).toBe(true)
    expect(result.cacheUsage!.disabledReason).toBe('none')
    expect(result.cacheUsage!.reads).toBe(0)
    expect(result.cacheUsage!.writes).toBe(0)
  })

  it('cache.enabled=false does NOT emit cacheUsage (router owns disabled presence, §5.2/§5.4)', async () => {
    const { googleProvider } = await import('@/lib/ai/providers/google')
    const result = await googleProvider.generate({
      provider: 'google',
      model: 'gemini-3-flash',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(result.cacheUsage).toBeUndefined()
  })

  it('throws UnsupportedOperationError when messages contain tool_calls', async () => {
    const { googleProvider } = await import('@/lib/ai/providers/google')
    const req: GenerateRequest = {
      provider: 'google',
      model: 'gemini-3-flash',
      messages: [{
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
      }],
    }
    await expect(googleProvider.generate(req)).rejects.toBeInstanceOf(UnsupportedOperationError)
  })

  it('omits cacheUsage when req.cache was not provided', async () => {
    const { googleProvider } = await import('@/lib/ai/providers/google')
    const result = await googleProvider.generate({
      provider: 'google',
      model: 'gemini-3-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.cacheUsage).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/google.test.ts`
Expected: FAIL (`UnsupportedOperationError` not thrown, `cacheUsage` not set).

- [ ] **Step 4: Modify `google.ts`**

Open `app/src/lib/ai/providers/google.ts`. Add the imports and two code additions:

```typescript
import { UnsupportedOperationError } from '@/lib/errors'
import { deriveIdentityKey } from './cache-key'

// …at the very top of generate(req), before any network work…
if (req.messages.some((m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0)) {
  throw new UnsupportedOperationError('google', 'tool_calls in messages')
}

// …after constructing result and before returning…
// Adapter only emits cacheUsage when caller opted in with cache.enabled === true.
// Router owns the disabled presence (§5.2) for cache.enabled === false / omitted.
if (req.cache?.enabled === true) {
  result.cacheUsage = {
    requested: true,
    enabled: true,
    disabledReason: 'none',
    identityKey: deriveIdentityKey(req),
    supported: false,
    reads: 0,
    writes: 0,
    hit: 'unsupported',
    ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
  }
}
```

(Preserve the existing OpenAI-SDK mechanics from `google.ts`; only add the guard and the cacheUsage block.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/google.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/providers/google.ts app/tests/unit/ai/providers/google.test.ts
git commit -m "feat(ai/providers/google): reject tool_calls in messages; emit cacheUsage when cache requested"
```

---

### Task 7: Perplexity adapter — same treatment

**Files:**
- Modify: `app/src/lib/ai/providers/perplexity.ts`
- Test: `app/tests/unit/ai/providers/perplexity.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/ai/providers/perplexity.test.ts`. Mirror the Google test file from Task 6 verbatim (same `openai` SDK mock pattern — Perplexity uses the OpenAI-compat SDK), substituting `perplexityProvider`, `provider: 'perplexity'`, and `model: 'sonar-pro'`. All six test cases carry over (cache on → cacheUsage present with supported:false, cache off → cacheUsage undefined, cache omitted → cacheUsage undefined, tool_calls in messages → throw).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/perplexity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Modify `perplexity.ts`**

Apply the same code pattern as Task 6 Step 4, substituting `'perplexity'` as the provider string. The `req.cache?.enabled === true` guard is identical — router still owns the disabled-presence case.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/perplexity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/perplexity.ts app/tests/unit/ai/providers/perplexity.test.ts
git commit -m "feat(ai/providers/perplexity): reject tool_calls in messages; emit cacheUsage when cache requested"
```

---

### Task 8: OpenAI adapter — prompt_cache_key + cached_tokens + tool_calls passthrough

**Files:**
- Modify: `app/src/lib/ai/providers/openai.ts`
- Test: `app/tests/unit/ai/providers/openai.test.ts` (new)

- [ ] **Step 1: Read the current OpenAI adapter**

Run: `cat app/src/lib/ai/providers/openai.ts`
Note: current code builds `messages` and calls `chat.completions.create`. It does not pass `prompt_cache_key` nor extract `cached_tokens`.

- [ ] **Step 2: Write the failing tests**

Create `app/tests/unit/ai/providers/openai.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: createMock } },
  })),
}))

describe('openaiProvider.generate', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: {
        prompt_tokens: 1000,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 400 },
      },
    })
  })

  it('passes prompt_cache_key when cache.enabled and caller provided key', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, key: 'custom-key' },
    })
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ prompt_cache_key: 'custom-key' }))
  })

  it('falls back to identity key when cache.enabled and caller omits key', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    const call = createMock.mock.calls[0][0]
    expect(call.prompt_cache_key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('omits prompt_cache_key when cache.enabled=false', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    const call = createMock.mock.calls[0][0]
    expect(call.prompt_cache_key).toBeUndefined()
  })

  it('extracts cached_tokens into cacheUsage.reads', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(result.cacheUsage).toBeDefined()
    expect(result.cacheUsage!.reads).toBe(400)
    expect(result.cacheUsage!.writes).toBe(0)
    expect(result.cacheUsage!.hit).toBe('read')
    expect(result.cacheUsage!.supported).toBe(true)
  })

  it('hit=miss when cached_tokens is 0', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } },
    })
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(result.cacheUsage!.hit).toBe('miss')
  })

  it('passes assistant tool_calls through to OpenAI message shape', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'search', arguments: '{}' } }],
        },
        { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' },
      ],
    })
    const call = createMock.mock.calls[0][0]
    const assistantMsg = call.messages.find((m: { role: string }) => m.role === 'assistant')
    expect(assistantMsg.tool_calls).toHaveLength(1)
    expect(assistantMsg.tool_calls[0].id).toBe('c1')
  })

  it('omits cacheUsage at the adapter level when cache.enabled=false (router owns disabled presence)', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(result.cacheUsage).toBeUndefined()
  })

  it('omits cacheUsage when req.cache not provided (§5.4)', async () => {
    const { openaiProvider } = await import('@/lib/ai/providers/openai')
    const result = await openaiProvider.generate({
      provider: 'openai',
      model: 'gpt-5.4',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.cacheUsage).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/openai.test.ts`
Expected: FAIL (adapter does not yet pass `prompt_cache_key` or emit `cacheUsage`).

- [ ] **Step 4: Rewrite `openai.ts`**

Replace with:

```typescript
import OpenAI from 'openai'
import type { ProviderClient, GenerateRequest, GenerateResult } from './types'
import { deriveIdentityKey } from './cache-key'

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return client
}

export const openaiProvider: ProviderClient = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const c = getClient()

    const messages = [
      ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || '' }
        }
        if (m.role === 'assistant' && m.tool_calls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content,
            tool_calls: m.tool_calls.map((tc) => ({
              id: tc.id,
              type: tc.type,
              function: { name: tc.function.name, arguments: tc.function.arguments },
            })),
          }
        }
        return { role: m.role, content: m.content }
      }),
    ] as OpenAI.ChatCompletionMessageParam[]

    const identityKey = req.cache ? deriveIdentityKey(req) : undefined

    const createParams: OpenAI.ChatCompletionCreateParams = {
      model: req.model,
      messages,
      max_completion_tokens: req.maxTokens ?? 20_000,
      temperature: req.temperature ?? 0.7,
      ...(req.tools ? { tools: req.tools } : {}),
      ...(req.cache?.enabled && identityKey
        ? { prompt_cache_key: req.cache.key ?? identityKey }
        : {}),
    }

    const response = await c.chat.completions.create(createParams)
    const choice = response.choices[0]

    const result: GenerateResult = {
      content: choice.message.content ?? '',
      tokensUsed: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 },
      model: req.model,
      provider: 'openai',
      toolCalls: choice.message.tool_calls
        ?.filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
        .map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
    }

    // Adapter emits cacheUsage only when the caller opted in (§5.2, §5.4).
    // Router owns the disabled presence for cache.enabled=false and kill-switch cases.
    if (req.cache?.enabled === true && identityKey) {
      const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0
      result.cacheUsage = {
        requested: true,
        enabled: true,
        disabledReason: 'none',
        identityKey,
        supported: true,
        reads: cachedTokens,
        writes: 0,
        hit: cachedTokens > 0 ? 'read' : 'miss',
        ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
      }
    }

    return result
  },
  async embed(text: string): Promise<number[]> {
    const c = getClient()
    const res = await c.embeddings.create({ model: 'text-embedding-3-small', input: text })
    return res.data[0].embedding
  },
}
```

Note: `prompt_cache_key` is a non-typed passthrough field accepted by the OpenAI SDK when forwarded to `chat.completions.create` via an augmented params object. If the TS compiler objects, cast through `unknown` as `OpenAI.ChatCompletionCreateParams & { prompt_cache_key?: string }`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/openai.test.ts && npm run typecheck`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/providers/openai.ts app/tests/unit/ai/providers/openai.test.ts
git commit -m "feat(ai/providers/openai): prompt_cache_key + cached_tokens + tool_calls passthrough"
```

---

### Task 9: Native Anthropic translator — scaffolding + system + tools

**Files:**
- Create: `app/src/lib/ai/providers/anthropic-native.ts`
- Test: `app/tests/unit/ai/providers/anthropic-native.test.ts` (new)

- [ ] **Step 1: Write the failing tests (scope: system + tools only for this task)**

Create `app/tests/unit/ai/providers/anthropic-native.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { translateRequestToAnthropic } from '@/lib/ai/providers/anthropic-native'
import type { GenerateRequest } from '@/lib/ai/providers/types'

const baseReq: GenerateRequest = {
  provider: 'anthropic',
  model: 'claude-opus-4-6',
  system: 'You are helpful.',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [
    { type: 'function', function: { name: 'a', description: 'a tool', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'b', description: 'b tool', parameters: { type: 'object', properties: {} } } },
  ],
  cache: { enabled: true, breakpoints: ['system', 'tools'] },
}

describe('translateRequestToAnthropic — system block', () => {
  it('wraps system into a text block with cache_control when breakpoints includes system', () => {
    const out = translateRequestToAnthropic(baseReq)
    expect(out.system).toEqual([
      { type: 'text', text: 'You are helpful.', cache_control: { type: 'ephemeral' } },
    ])
  })

  it('wraps system into a plain text block when breakpoints omits system', () => {
    const out = translateRequestToAnthropic({
      ...baseReq,
      cache: { enabled: true, breakpoints: ['tools'] },
    })
    expect(out.system).toEqual([{ type: 'text', text: 'You are helpful.' }])
  })

  it('omits system entirely when req.system is undefined', () => {
    const out = translateRequestToAnthropic({ ...baseReq, system: undefined })
    expect(out.system).toBeUndefined()
  })
})

describe('translateRequestToAnthropic — tools', () => {
  it('converts OpenAI-shape tools to Anthropic native shape', () => {
    const out = translateRequestToAnthropic(baseReq)
    expect(out.tools).toEqual([
      { name: 'a', description: 'a tool', input_schema: { type: 'object', properties: {} }, cache_control: undefined },
      { name: 'b', description: 'b tool', input_schema: { type: 'object', properties: {} }, cache_control: { type: 'ephemeral' } },
    ])
  })

  it('stamps cache_control only on the LAST tool when breakpoints includes tools', () => {
    const out = translateRequestToAnthropic(baseReq)
    expect(out.tools![0].cache_control).toBeUndefined()
    expect(out.tools![out.tools!.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('does not stamp any tool when breakpoints omits tools', () => {
    const out = translateRequestToAnthropic({ ...baseReq, cache: { enabled: true, breakpoints: ['system'] } })
    for (const t of out.tools!) expect(t.cache_control).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `translateRequestToAnthropic` (system + tools only for this task)**

Create `app/src/lib/ai/providers/anthropic-native.ts`:

```typescript
import type { GenerateRequest } from './types'

const CACHE_CONTROL_EPHEMERAL = { type: 'ephemeral' as const }

export interface AnthropicNativeSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: 'ephemeral' }
}

export interface AnthropicNativeTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
  cache_control?: { type: 'ephemeral' }
}

export interface AnthropicNativeRequest {
  system?: AnthropicNativeSystemBlock[]
  tools?: AnthropicNativeTool[]
  messages: unknown[]  // filled in by later tasks
}

export function translateRequestToAnthropic(req: GenerateRequest): AnthropicNativeRequest {
  const cacheSystem = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('system')
  const cacheTools = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('tools')

  const out: AnthropicNativeRequest = { messages: [] }

  if (req.system !== undefined) {
    out.system = [{
      type: 'text',
      text: req.system,
      ...(cacheSystem ? { cache_control: CACHE_CONTROL_EPHEMERAL } : {}),
    }]
  }

  if (req.tools && req.tools.length > 0) {
    out.tools = req.tools.map((t, i) => {
      const isLast = i === req.tools!.length - 1
      return {
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
        cache_control: cacheTools && isLast ? CACHE_CONTROL_EPHEMERAL : undefined,
      }
    })
  }

  return out
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/anthropic-native.ts app/tests/unit/ai/providers/anthropic-native.test.ts
git commit -m "feat(ai/providers/anthropic-native): translate system + tools with cache_control"
```

---

### Task 10: Native Anthropic translator — user/assistant/tool messages

**Files:**
- Modify: `app/src/lib/ai/providers/anthropic-native.ts`
- Modify: `app/tests/unit/ai/providers/anthropic-native.test.ts`

- [ ] **Step 1: Append failing tests for message translation**

Append to the test file:

```typescript
describe('translateRequestToAnthropic — messages', () => {
  const withMessages = (messages: GenerateRequest['messages']): GenerateRequest => ({
    ...baseReq,
    messages,
    tools: undefined,
    cache: { enabled: false },
  })

  it('passes plain user message through', () => {
    const out = translateRequestToAnthropic(withMessages([{ role: 'user', content: 'hello' }]))
    expect(out.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('passes plain assistant message (no tool_calls) through as string content', () => {
    const out = translateRequestToAnthropic(withMessages([{ role: 'assistant', content: 'hi back' }]))
    expect(out.messages).toEqual([{ role: 'assistant', content: 'hi back' }])
  })

  it('translates assistant with tool_calls to content blocks (text + tool_use)', () => {
    const out = translateRequestToAnthropic(withMessages([
      {
        role: 'assistant',
        content: 'calling tool',
        tool_calls: [{
          id: 'toolu_1',
          type: 'function',
          function: { name: 'search', arguments: '{"q":"x"}' },
        }],
      },
    ]))
    expect(out.messages).toEqual([{
      role: 'assistant',
      content: [
        { type: 'text', text: 'calling tool' },
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'x' } },
      ],
    }])
  })

  it('omits the text block when assistant content is empty alongside tool_calls', () => {
    const out = translateRequestToAnthropic(withMessages([
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 't1', type: 'function', function: { name: 's', arguments: '{}' } }],
      },
    ]))
    expect(out.messages[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 's', input: {} }],
    })
  })

  it('wraps a single tool-role message into a user message with a single tool_result block', () => {
    const out = translateRequestToAnthropic(withMessages([
      { role: 'tool', content: '{"ok":true}', tool_call_id: 'toolu_1' },
    ]))
    expect(out.messages).toEqual([{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' }],
    }])
  })

  it('groups contiguous tool messages into one user message with ordered tool_result blocks (§6.1)', () => {
    const out = translateRequestToAnthropic(withMessages([
      { role: 'tool', content: 'first', tool_call_id: 'toolu_a' },
      { role: 'tool', content: 'second', tool_call_id: 'toolu_b' },
    ]))
    expect(out.messages).toEqual([{
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_a', content: 'first' },
        { type: 'tool_result', tool_use_id: 'toolu_b', content: 'second' },
      ],
    }])
  })

  it('starts a new user group when a non-tool message breaks contiguity', () => {
    const out = translateRequestToAnthropic(withMessages([
      { role: 'tool', content: 'a', tool_call_id: 't_a' },
      { role: 'assistant', content: 'thinking' },
      { role: 'tool', content: 'b', tool_call_id: 't_b' },
    ]))
    expect(out.messages).toHaveLength(3)
    expect(out.messages[0]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't_a', content: 'a' }],
    })
    expect(out.messages[2]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't_b', content: 'b' }],
    })
  })

  it('throws when a system-role message appears (system lives in req.system)', () => {
    expect(() => translateRequestToAnthropic(withMessages([{ role: 'system', content: 'no' }])))
      .toThrow(/system.*req\.system/i)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: new cases FAIL.

- [ ] **Step 3: Implement message translation**

Add to `app/src/lib/ai/providers/anthropic-native.ts`:

```typescript
export interface AnthropicTextBlock { type: 'text'; text: string }
export interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
export interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string }

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

export interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

function translateMessages(msgs: GenerateRequest['messages']): AnthropicMessage[] {
  const out: AnthropicMessage[] = []
  let currentToolGroup: AnthropicToolResultBlock[] | null = null

  const flushToolGroup = () => {
    if (currentToolGroup && currentToolGroup.length > 0) {
      out.push({ role: 'user', content: currentToolGroup })
    }
    currentToolGroup = null
  }

  for (const m of msgs) {
    if (m.role === 'system') {
      throw new Error('System-role messages must be passed via req.system, not req.messages')
    }

    if (m.role === 'tool') {
      if (!currentToolGroup) currentToolGroup = []
      currentToolGroup.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id ?? '',
        content: m.content,
      })
      continue
    }

    flushToolGroup()

    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content })
      continue
    }

    // assistant
    if (m.tool_calls && m.tool_calls.length > 0) {
      const blocks: AnthropicContentBlock[] = []
      if (m.content && m.content.length > 0) blocks.push({ type: 'text', text: m.content })
      for (const tc of m.tool_calls) {
        let input: unknown = {}
        try { input = JSON.parse(tc.function.arguments) } catch { input = {} }
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input })
      }
      out.push({ role: 'assistant', content: blocks })
    } else {
      out.push({ role: 'assistant', content: m.content })
    }
  }

  flushToolGroup()
  return out
}
```

Modify `translateRequestToAnthropic` to populate `messages`:

```typescript
export function translateRequestToAnthropic(req: GenerateRequest): AnthropicNativeRequest {
  const cacheSystem = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('system')
  const cacheTools = req.cache?.enabled === true && (req.cache.breakpoints ?? []).includes('tools')

  const out: AnthropicNativeRequest = { messages: translateMessages(req.messages) }

  if (req.system !== undefined) {
    out.system = [{
      type: 'text',
      text: req.system,
      ...(cacheSystem ? { cache_control: CACHE_CONTROL_EPHEMERAL } : {}),
    }]
  }

  if (req.tools && req.tools.length > 0) {
    out.tools = req.tools.map((t, i) => {
      const isLast = i === req.tools!.length - 1
      return {
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
        cache_control: cacheTools && isLast ? CACHE_CONTROL_EPHEMERAL : undefined,
      }
    })
  }

  return out
}
```

Adjust `AnthropicNativeRequest.messages` type: replace `unknown[]` with `AnthropicMessage[]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/anthropic-native.ts app/tests/unit/ai/providers/anthropic-native.test.ts
git commit -m "feat(ai/providers/anthropic-native): translate user/assistant/tool messages with grouped tool_result"
```

---

### Task 11: Native Anthropic — response translation + usage extraction + TTL clamp

**Files:**
- Modify: `app/src/lib/ai/providers/anthropic-native.ts`
- Modify: `app/tests/unit/ai/providers/anthropic-native.test.ts`

- [ ] **Step 1: Append failing tests**

```typescript
import { translateResponseFromAnthropic, clampTtl } from '@/lib/ai/providers/anthropic-native'

describe('translateResponseFromAnthropic', () => {
  it('extracts text content from text blocks', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }, { model: 'claude-opus-4-6' })
    expect(result.content).toBe('hello')
    expect(result.toolCalls).toBeUndefined()
  })

  it('extracts tool_use blocks into router toolCalls shape', () => {
    const result = translateResponseFromAnthropic({
      content: [
        { type: 'text', text: 'calling' },
        { type: 'tool_use', id: 'toolu_1', name: 'search', input: { q: 'x' } },
      ],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }, { model: 'claude-opus-4-6' })
    expect(result.content).toBe('calling')
    expect(result.toolCalls).toEqual([{ id: 'toolu_1', name: 'search', arguments: '{"q":"x"}' }])
  })

  it('populates cacheUsage when request.cache is present', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 500, cache_read_input_tokens: 1200 },
    }, {
      model: 'claude-opus-4-6',
      cacheRequested: { enabled: true },
      identityKey: 'a'.repeat(64),
    })
    expect(result.cacheUsage).toEqual({
      requested: true,
      enabled: true,
      disabledReason: 'none',
      identityKey: 'a'.repeat(64),
      supported: true,
      reads: 1200,
      writes: 500,
      hit: 'read',
    })
  })

  it('hit=miss when reads is zero', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 },
    }, { model: 'claude-opus-4-6', cacheRequested: { enabled: true }, identityKey: 'b'.repeat(64) })
    expect(result.cacheUsage!.hit).toBe('miss')
  })

  it('no cacheUsage when cacheRequested omitted', () => {
    const result = translateResponseFromAnthropic({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 100, output_tokens: 20 },
    }, { model: 'claude-opus-4-6' })
    expect(result.cacheUsage).toBeUndefined()
  })
})

describe('clampTtl', () => {
  it('returns the input when <= 300', () => {
    expect(clampTtl(120)).toEqual({ effective: 120, clamped: false })
    expect(clampTtl(300)).toEqual({ effective: 300, clamped: false })
  })

  it('clamps to 300 and flags when > 300', () => {
    expect(clampTtl(600)).toEqual({ effective: 300, clamped: true })
  })

  it('returns undefined effective when input is undefined', () => {
    expect(clampTtl(undefined)).toEqual({ effective: undefined, clamped: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: new cases FAIL.

- [ ] **Step 3: Implement response translator + clampTtl**

Append to `app/src/lib/ai/providers/anthropic-native.ts`:

```typescript
import type { GenerateResult, CacheOptions } from './types'

export interface AnthropicNativeResponse {
  content: AnthropicContentBlock[]
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

export interface TranslateResponseContext {
  model: string
  cacheRequested?: CacheOptions
  identityKey?: string
  effectiveTtlSeconds?: number
}

export function translateResponseFromAnthropic(
  resp: AnthropicNativeResponse,
  ctx: TranslateResponseContext,
): GenerateResult {
  let text = ''
  const toolCalls: { id: string; name: string; arguments: string }[] = []

  for (const block of resp.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      })
    }
  }

  const result: GenerateResult = {
    content: text,
    tokensUsed: { input: resp.usage.input_tokens, output: resp.usage.output_tokens },
    model: ctx.model,
    provider: 'anthropic',
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }

  // Defensive guard: the native path is only reached when cache.enabled === true
  // (per the Anthropic adapter branch), but we assert the invariant here so a
  // mis-wired caller cannot leak a disabled-shape cacheUsage from this code path.
  if (ctx.cacheRequested?.enabled === true && ctx.identityKey) {
    const reads = resp.usage.cache_read_input_tokens ?? 0
    const writes = resp.usage.cache_creation_input_tokens ?? 0
    result.cacheUsage = {
      requested: true,
      enabled: true,
      disabledReason: 'none',
      identityKey: ctx.identityKey,
      supported: true,
      reads,
      writes,
      hit: reads > 0 ? 'read' : 'miss',
      ...(ctx.effectiveTtlSeconds !== undefined ? { effectiveTtlSeconds: ctx.effectiveTtlSeconds } : {}),
    }
  }

  return result
}

let ttlClampWarned = false

export function clampTtl(input: number | undefined): { effective: number | undefined; clamped: boolean } {
  if (input === undefined) return { effective: undefined, clamped: false }
  if (input <= 300) return { effective: input, clamped: false }
  if (!ttlClampWarned) {
    // eslint-disable-next-line no-console
    console.warn('[anthropic-native] ttlSeconds > 300 requested; clamping to 300. Subsequent clamps silent.')
    ttlClampWarned = true
  }
  return { effective: 300, clamped: true }
}

// Test-only reset.
export function __resetTtlClampWarningForTests() { ttlClampWarned = false }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/anthropic-native.ts app/tests/unit/ai/providers/anthropic-native.test.ts
git commit -m "feat(ai/providers/anthropic-native): response translation + cacheUsage + TTL clamp"
```

---

### Task 12: Native Anthropic — end-to-end `anthropicNativeGenerate` wiring

**Files:**
- Modify: `app/src/lib/ai/providers/anthropic-native.ts`
- Modify: `app/tests/unit/ai/providers/anthropic-native.test.ts`

- [ ] **Step 1: Append failing tests for the full generate() wrapper**

```typescript
import { vi } from 'vitest'
import { anthropicNativeGenerate } from '@/lib/ai/providers/anthropic-native'

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: 'hi' }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      })),
    },
  })),
}))

describe('anthropicNativeGenerate — end to end', () => {
  it('sends the translated request and returns router-shape result with cacheUsage', async () => {
    const result = await anthropicNativeGenerate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, breakpoints: ['system'] },
    })
    expect(result.content).toBe('hi')
    expect(result.cacheUsage).toBeDefined()
    expect(result.cacheUsage!.supported).toBe(true)
  })

  it('passes effectiveTtlSeconds back when caller provided ttlSeconds', async () => {
    const result = await anthropicNativeGenerate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true, breakpoints: ['system'], ttlSeconds: 600 },
    })
    expect(result.cacheUsage!.effectiveTtlSeconds).toBe(300)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: FAIL — `anthropicNativeGenerate` not exported.

- [ ] **Step 3: Implement `anthropicNativeGenerate`**

Append to `app/src/lib/ai/providers/anthropic-native.ts`:

```typescript
import { getAnthropicClient } from '@/lib/ai/anthropic-client'
import { deriveIdentityKey } from './cache-key'
import type { GenerateRequest, GenerateResult } from './types'

export async function anthropicNativeGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const anthropic = getAnthropicClient()
  const translated = translateRequestToAnthropic(req)
  const { effective: effectiveTtlSeconds } = clampTtl(req.cache?.ttlSeconds)
  const identityKey = req.cache ? deriveIdentityKey(req) : undefined

  const response = await anthropic.messages.create({
    model: req.model,
    max_tokens: req.maxTokens ?? 4096,
    temperature: req.temperature,
    ...(translated.system ? { system: translated.system } : {}),
    ...(translated.tools ? { tools: translated.tools } : {}),
    messages: translated.messages,
  } as unknown as Parameters<typeof anthropic.messages.create>[0])

  return translateResponseFromAnthropic(response as unknown as AnthropicNativeResponse, {
    model: req.model,
    cacheRequested: req.cache,
    identityKey,
    effectiveTtlSeconds,
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-native.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/anthropic-native.ts app/tests/unit/ai/providers/anthropic-native.test.ts
git commit -m "feat(ai/providers/anthropic-native): end-to-end anthropicNativeGenerate wrapper"
```

---

### Task 13: Probe — capture current OpenAI-compat shim behavior on tool turns (pre-fix)

**Purpose:** Answer §5.10's question: is the shim already silently broken on tool turns, or was V3 coincidentally never exercising the broken path? Findings inform Task 14's expectations.

**Files:**
- Test: `app/tests/unit/ai/providers/anthropic-shim-tool-probe.test.ts` (new)
- Create: `docs/runbooks/audits/anthropic-shim-tool-probe-2026-04.md`

- [ ] **Step 1: Write a probe test that captures current behavior**

Create `app/tests/unit/ai/providers/anthropic-shim-tool-probe.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMock = vi.fn()

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: createMock } } })),
}))

describe('[PROBE] Anthropic OpenAI-compat shim with tool_calls in messages', () => {
  beforeEach(() => {
    createMock.mockReset()
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
  })

  it('captures what happens when the router passes a tool turn today (before Task 14 fix)', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
        { role: 'tool', content: '{"r":1}', tool_call_id: 'c1' },
      ],
    })
    const request = createMock.mock.calls[0][0]
    const assistantMsg = request.messages.find((m: { role: string }) => m.role === 'assistant')
    // This assertion documents CURRENT behavior. Update it in the audit doc once observed.
    // If `tool_calls` is undefined, the shim silently drops them (latent bug).
    // If `tool_calls` is present, the current shim was accidentally passing them through.
    console.log('PROBE_OBSERVATION', JSON.stringify({
      assistantHasToolCalls: Array.isArray(assistantMsg?.tool_calls),
      toolRoleMessagePresent: request.messages.some((m: { role: string }) => m.role === 'tool'),
    }))
    // No assertion here — Task 14 makes this pass with tool_calls present.
    expect(request).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the probe to capture behavior**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic-shim-tool-probe.test.ts 2>&1 | tee /tmp/probe.log`
Expected: test passes; `PROBE_OBSERVATION` line in output documents current behavior.

- [ ] **Step 3: Write the probe audit**

Write `docs/runbooks/audits/anthropic-shim-tool-probe-2026-04.md`:

```markdown
# Anthropic OpenAI-Compat Shim Probe — 2026-04

**Purpose:** Before Task 14 consolidates `RouterMessage.tool_calls` on the shim path, document the shim's pre-fix behavior when the router hands it a tool turn.

## Probe
`app/tests/unit/ai/providers/anthropic-shim-tool-probe.test.ts`

## Observation
[Paste the PROBE_OBSERVATION line from the test output.]

- `assistantHasToolCalls`: true / false
- `toolRoleMessagePresent`: true / false

## Interpretation
- If `assistantHasToolCalls` is false and a `tool`-role message is present → the shim was silently dropping the assistant tool-call history. Any live tool turn routed through Anthropic would have been malformed and would have failed against the real API. Task 14 fixes this for both cached and non-cached paths.
- If `assistantHasToolCalls` is true → the shim was already passing them through coincidentally (likely because the current `RouterMessage` type didn't carry them, so V3 also wasn't pushing them — the observation is vacuously true). Task 14's changes still make the behavior explicit and testable.

## Conclusion
Task 14 makes both cache and non-cache paths emit `tool_calls` on assistant messages. No existing production path is knowingly exercising the broken shape (V3 never pushed tool_calls), so this fix is latent-bug-closing rather than customer-regressing.
```

- [ ] **Step 4: Commit**

```bash
git add app/tests/unit/ai/providers/anthropic-shim-tool-probe.test.ts docs/runbooks/audits/anthropic-shim-tool-probe-2026-04.md
git commit -m "docs(audits): capture Anthropic OpenAI-compat shim pre-fix tool-turn behavior"
```

---

### Task 14: Anthropic adapter — branch on cache.enabled; pass tool_calls through shim

**Files:**
- Modify: `app/src/lib/ai/providers/anthropic.ts`
- Test: `app/tests/unit/ai/providers/anthropic.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/ai/providers/anthropic.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const nativeMock = vi.fn()
const shimCreateMock = vi.fn()

vi.mock('@/lib/ai/providers/anthropic-native', () => ({
  anthropicNativeGenerate: nativeMock,
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: shimCreateMock } } })),
}))

describe('anthropicProvider.generate — branching', () => {
  beforeEach(() => {
    nativeMock.mockReset()
    shimCreateMock.mockReset()
    nativeMock.mockResolvedValue({
      content: 'native', tokensUsed: { input: 1, output: 1 }, model: 'claude-opus-4-6', provider: 'anthropic',
    })
    shimCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'shim' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
  })

  it('uses the native path when cache.enabled=true', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(nativeMock).toHaveBeenCalledTimes(1)
    expect(shimCreateMock).not.toHaveBeenCalled()
  })

  it('uses the shim path when cache.enabled=false', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(shimCreateMock).toHaveBeenCalledTimes(1)
    expect(nativeMock).not.toHaveBeenCalled()
  })

  it('uses the shim path when cache is omitted', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(shimCreateMock).toHaveBeenCalledTimes(1)
    expect(nativeMock).not.toHaveBeenCalled()
  })

  it('shim path passes assistant tool_calls through to the OpenAI message shape', async () => {
    const { anthropicProvider } = await import('@/lib/ai/providers/anthropic')
    await anthropicProvider.generate({
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }],
        },
        { role: 'tool', content: '{"ok":true}', tool_call_id: 'c1' },
      ],
    })
    const call = shimCreateMock.mock.calls[0][0]
    const asst = call.messages.find((m: { role: string }) => m.role === 'assistant')
    expect(asst.tool_calls).toHaveLength(1)
    expect(asst.tool_calls[0].id).toBe('c1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/anthropic.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `app/src/lib/ai/providers/anthropic.ts`**

```typescript
import OpenAI from 'openai'
import type { ProviderClient, GenerateRequest, GenerateResult } from './types'
import { anthropicNativeGenerate } from './anthropic-native'

let shimClient: OpenAI | null = null
function getShimClient(): OpenAI {
  if (!shimClient) {
    shimClient = new OpenAI({
      baseURL: 'https://api.anthropic.com/v1/',
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: { 'anthropic-version': '2023-06-01' },
    })
  }
  return shimClient
}

async function anthropicCompatGenerate(req: GenerateRequest): Promise<GenerateResult> {
  const c = getShimClient()
  const messages = [
    ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
    ...req.messages.map((m) => {
      if (m.role === 'tool') {
        return { role: 'tool' as const, content: m.content, tool_call_id: m.tool_call_id || '' }
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        return {
          role: 'assistant' as const,
          content: m.content,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: tc.type,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
        }
      }
      return { role: m.role, content: m.content }
    }),
  ] as OpenAI.ChatCompletionMessageParam[]
  const response = await c.chat.completions.create({
    model: req.model,
    messages,
    max_completion_tokens: req.maxTokens ?? 20_000,
    temperature: req.temperature ?? 0.7,
    ...(req.tools ? { tools: req.tools } : {}),
  })
  const choice = response.choices[0]
  return {
    content: choice.message.content ?? '',
    tokensUsed: { input: response.usage?.prompt_tokens ?? 0, output: response.usage?.completion_tokens ?? 0 },
    model: req.model,
    provider: 'anthropic',
    toolCalls: choice.message.tool_calls
      ?.filter((tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function')
      .map((tc) => ({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments })),
  }
}

export const anthropicProvider: ProviderClient = {
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    if (req.cache?.enabled === true) return anthropicNativeGenerate(req)
    return anthropicCompatGenerate(req)
  },
}
```

- [ ] **Step 4: Run all provider tests**

Run: `cd app && npx vitest run tests/unit/ai/providers/ && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/providers/anthropic.ts app/tests/unit/ai/providers/anthropic.test.ts
git commit -m "feat(ai/providers/anthropic): branch on cache.enabled; pass tool_calls through shim path"
```

---

### Task 15: Feature flag migration for `prompt_cache_enabled` (seeded false)

**Files:**
- Create: `app/drizzle/NNNN_prompt_cache_flag.sql`
- Modify: `app/drizzle/meta/_journal.json`

- [ ] **Step 1: Determine the next migration index**

Run: `tail -20 app/drizzle/meta/_journal.json`
Find the highest `idx:` value; the new migration is that plus one. Note the timestamp format.

- [ ] **Step 2: Create the migration file**

Create `app/drizzle/NNNN_prompt_cache_flag.sql` (replace `NNNN` with the zero-padded next index):

```sql
INSERT INTO feature_flags (key, enabled, description, targeting, created_at, updated_at)
VALUES (
  'prompt_cache_enabled',
  false,
  'Global kill-switch for router prompt caching',
  '{}'::jsonb,
  now(),
  now()
)
ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 3: Append the journal entry**

Open `app/drizzle/meta/_journal.json`, append an entry with `idx: N+1`, `tag: "NNNN_prompt_cache_flag"`, `when` greater than the previous entry (use `Date.now()` in ms). Preserve JSON validity.

- [ ] **Step 4: Run the migration against local Postgres**

Run: `cd app && npm run db:migrate`
Expected: migration applies cleanly; `SELECT key, enabled FROM feature_flags WHERE key='prompt_cache_enabled';` returns `(prompt_cache_enabled, false)`.

- [ ] **Step 5: Commit**

```bash
git add app/drizzle/NNNN_prompt_cache_flag.sql app/drizzle/meta/_journal.json
git commit -m "feat(db): seed prompt_cache_enabled feature flag (disabled by default)"
```

---

### Task 16: Router — cache resolution + identity key + presence rule

**Files:**
- Modify: `app/src/lib/ai/providers/router.ts`
- Test: `app/tests/unit/ai/providers/router.test.ts` (new)

- [ ] **Step 1: Read the current router**

Run: `cat app/src/lib/ai/providers/router.ts`
Note the existing `generate()` structure and the `withRetry` wrapper.

- [ ] **Step 2: Write the failing tests**

Create `app/tests/unit/ai/providers/router.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const isFeatureEnabledMock = vi.fn()
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: isFeatureEnabledMock }))

const anthropicMock = vi.fn()
vi.mock('@/lib/ai/providers/anthropic', () => ({ anthropicProvider: { generate: anthropicMock } }))

const openaiMock = vi.fn()
vi.mock('@/lib/ai/providers/openai', () => ({ openaiProvider: { generate: openaiMock } }))

const googleMock = vi.fn()
vi.mock('@/lib/ai/providers/google', () => ({ googleProvider: { generate: googleMock } }))

const perplexityMock = vi.fn()
vi.mock('@/lib/ai/providers/perplexity', () => ({ perplexityProvider: { generate: perplexityMock } }))

vi.mock('@/lib/ai/providers/retry', () => ({
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

describe('router.generate — cache resolution + presence', () => {
  beforeEach(() => {
    isFeatureEnabledMock.mockReset()
    anthropicMock.mockReset()
    openaiMock.mockReset()
    anthropicMock.mockResolvedValue({
      content: 'ok', tokensUsed: { input: 10, output: 5 }, model: 'claude-opus-4-6', provider: 'anthropic',
      cacheUsage: { requested: true, enabled: true, disabledReason: 'none', identityKey: 'k', supported: true, reads: 100, writes: 0, hit: 'read' },
    })
  })

  it('does NOT read the feature flag when req.cache is omitted', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ provider: 'anthropic', model: 'claude-opus-4-6', messages: [{ role: 'user', content: 'hi' }] })
    expect(isFeatureEnabledMock).not.toHaveBeenCalled()
  })

  it('does NOT read the feature flag when req.cache.enabled=false', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(isFeatureEnabledMock).not.toHaveBeenCalled()
  })

  it('reads the flag (with bypassCache) only when req.cache.enabled=true', async () => {
    isFeatureEnabledMock.mockResolvedValue(true)
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(isFeatureEnabledMock).toHaveBeenCalledWith('prompt_cache_enabled', { bypassCache: true })
  })

  it('forces enabled=false with disabledReason=global_kill_switch when flag is off', async () => {
    isFeatureEnabledMock.mockResolvedValue(false)
    anthropicMock.mockResolvedValueOnce({
      content: 'ok', tokensUsed: { input: 10, output: 5 }, model: 'claude-opus-4-6', provider: 'anthropic',
    })
    const { generate } = await import('@/lib/ai/providers/router')
    const result = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(anthropicMock.mock.calls[0][0].cache).toMatchObject({ enabled: false })
    expect(result.cacheUsage!.enabled).toBe(false)
    expect(result.cacheUsage!.disabledReason).toBe('global_kill_switch')
    expect(result.cacheUsage!.requested).toBe(true)
  })

  it('populates GenerateResult.cacheUsage when req.cache was provided (presence rule §5.4)', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    const withCacheFalse = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: false },
    })
    expect(withCacheFalse.cacheUsage).toBeDefined()
    expect(withCacheFalse.cacheUsage!.requested).toBe(false)
    expect(withCacheFalse.cacheUsage!.enabled).toBe(false)
    expect(withCacheFalse.cacheUsage!.disabledReason).toBe('request_disabled')
  })

  it('leaves GenerateResult.cacheUsage undefined when req.cache was omitted', async () => {
    anthropicMock.mockResolvedValueOnce({
      content: 'ok', tokensUsed: { input: 10, output: 5 }, model: 'claude-opus-4-6', provider: 'anthropic',
    })
    const { generate } = await import('@/lib/ai/providers/router')
    const result = await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(result.cacheUsage).toBeUndefined()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/router.test.ts`
Expected: FAIL.

- [ ] **Step 4: Rewrite the router**

Replace `app/src/lib/ai/providers/router.ts`:

```typescript
import type { ProviderClient, ProviderName, GenerateRequest, GenerateResult, CacheUsage } from './types'
import { MODEL_CONFIGS } from './types'
import { openaiProvider } from './openai'
import { anthropicProvider } from './anthropic'
import { googleProvider } from './google'
import { perplexityProvider } from './perplexity'
import { withRetry } from './retry'
import { deriveIdentityKey } from './cache-key'
import { isFeatureEnabled } from '@/lib/feature-flags'

const PROVIDERS: Record<ProviderName, ProviderClient> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
  google: googleProvider,
  perplexity: perplexityProvider,
}

async function resolveCacheState(req: GenerateRequest): Promise<{
  resolvedCache: GenerateRequest['cache']
  presence: CacheUsage | null
}> {
  const identityKey = deriveIdentityKey(req)

  if (!req.cache) {
    return { resolvedCache: undefined, presence: null }
  }

  if (req.cache.enabled !== true) {
    return {
      resolvedCache: { ...req.cache, enabled: false },
      presence: {
        requested: false,
        enabled: false,
        disabledReason: 'request_disabled',
        identityKey,
        supported: false,
        reads: 0,
        writes: 0,
        hit: 'disabled',
        ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
      },
    }
  }

  const flagEnabled = await isFeatureEnabled('prompt_cache_enabled', { bypassCache: true })
  if (!flagEnabled) {
    return {
      resolvedCache: { ...req.cache, enabled: false },
      presence: {
        requested: true,
        enabled: false,
        disabledReason: 'global_kill_switch',
        identityKey,
        supported: false,
        reads: 0,
        writes: 0,
        hit: 'disabled',
        ...(req.cache.ttlSeconds !== undefined ? { effectiveTtlSeconds: req.cache.ttlSeconds } : {}),
      },
    }
  }

  return { resolvedCache: { ...req.cache, enabled: true }, presence: null }
}

export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  const config = MODEL_CONFIGS[req.model]
  if (!config) throw new Error(`Unknown model: ${req.model}`)

  const { resolvedCache, presence } = await resolveCacheState(req)
  const effectiveReq: GenerateRequest = { ...req, cache: resolvedCache }

  const provider = PROVIDERS[config.provider]
  const result = await withRetry(
    () => provider.generate({ ...effectiveReq, provider: config.provider }),
    config,
    PROVIDERS,
    effectiveReq,
  )

  if (req.cache !== undefined && result.cacheUsage === undefined && presence !== null) {
    result.cacheUsage = presence
  }

  if (req.cache === undefined) {
    delete result.cacheUsage
  }

  return result
}

export async function embed(text: string): Promise<number[]> {
  return openaiProvider.embed!(text)
}
```

- [ ] **Step 5: Run router tests**

Run: `cd app && npx vitest run tests/unit/ai/providers/router.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/providers/router.ts app/tests/unit/ai/providers/router.test.ts
git commit -m "feat(ai/providers/router): cache resolution + identityKey + §5.4 presence rule"
```

---

### Task 17: Pricing table

**Files:**
- Create: `app/src/lib/ai/cost/pricing-table.ts`
- Test: `app/tests/unit/ai/cost/pricing-table.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/ai/cost/pricing-table.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { PRICING_V1 } from '@/lib/ai/cost/pricing-table'

describe('PRICING_V1', () => {
  it('tags a table version', () => {
    expect(PRICING_V1._tableVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('includes current Anthropic models with cache multipliers', () => {
    const opus = PRICING_V1.anthropic['claude-opus-4-6']
    expect(opus).toBeDefined()
    expect(opus.cacheWriteMultiplier).toBe(1.25)
    expect(opus.cacheReadMultiplier).toBe(0.10)
    expect(opus.inputPerMTok).toBeGreaterThan(0)
    expect(opus.outputPerMTok).toBeGreaterThan(0)
  })

  it('includes current OpenAI models with a cache discount', () => {
    const gpt = PRICING_V1.openai['gpt-5.4']
    expect(gpt).toBeDefined()
    expect(gpt.cachedInputDiscount).toBe(0.5)
    expect(gpt.inputPerMTok).toBeGreaterThan(0)
    expect(gpt.outputPerMTok).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/cost/pricing-table.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create the pricing table**

Create `app/src/lib/ai/cost/pricing-table.ts`:

```typescript
// Rates are in USD micro-units per million tokens. Pulled from provider pricing
// pages on the _tableVersion date. Update _tableVersion when any rate changes.
export const PRICING_V1 = {
  _tableVersion: '2026-04-21' as const,
  anthropic: {
    'claude-opus-4-6':   { inputPerMTok: 15_000_000, outputPerMTok: 75_000_000, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.10 },
    'claude-sonnet-4-6': { inputPerMTok:  3_000_000, outputPerMTok: 15_000_000, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.10 },
    'claude-haiku-4-5':  { inputPerMTok:    800_000, outputPerMTok:  4_000_000, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.10 },
  },
  openai: {
    'gpt-5.4':      { inputPerMTok: 3_000_000, outputPerMTok: 15_000_000, cachedInputDiscount: 0.5 },
    'gpt-5.4-mini': { inputPerMTok:   600_000, outputPerMTok:  2_400_000, cachedInputDiscount: 0.5 },
    'gpt-5.4-nano': { inputPerMTok:   150_000, outputPerMTok:    600_000, cachedInputDiscount: 0.5 },
  },
} as const

export type PricingTable = typeof PRICING_V1
```

Note: verify the concrete rate values against the current Anthropic and OpenAI public pricing pages before committing. If the platform rates differ from the values above, update them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/cost/pricing-table.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/cost/pricing-table.ts app/tests/unit/ai/cost/pricing-table.test.ts
git commit -m "feat(ai/cost): versioned pricing table with cache multipliers and discount"
```

---

### Task 18: Anthropic cost helper — cache-aware formula

**Files:**
- Modify: `app/src/lib/ai/cost/anthropic-pricing.ts`
- Test: `app/tests/unit/ai/cost/anthropic-pricing.test.ts` (new or extended)

- [ ] **Step 1: Read the current helper**

Run: `cat app/src/lib/ai/cost/anthropic-pricing.ts`
Note the current `UsageLike` shape and `computeAnthropicCostMicros(usage, model)` behavior. Confirm field names Anthropic SDK returns (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`).

- [ ] **Step 2: Write the failing tests**

Create `app/tests/unit/ai/cost/anthropic-pricing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeAnthropicCostMicros } from '@/lib/ai/cost/anthropic-pricing'
import { PRICING_V1 } from '@/lib/ai/cost/pricing-table'

describe('computeAnthropicCostMicros — cache-aware', () => {
  const model = 'claude-opus-4-6'
  const rates = PRICING_V1.anthropic[model]

  it('zero cache fields ⇒ base formula', () => {
    const cost = computeAnthropicCostMicros({ input_tokens: 1000, output_tokens: 500 }, model)
    const expected = Math.round(1000 * rates.inputPerMTok / 1_000_000) + Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(cost).toBe(expected)
  })

  it('cache fields non-overlapping with input_tokens', () => {
    // 1000 standard input, 800 written, 400 read. All separate fields.
    const usage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 800,
      cache_read_input_tokens: 400,
    }
    const expected =
      Math.round(1000 * rates.inputPerMTok / 1_000_000) +
      Math.round(800 * rates.inputPerMTok * rates.cacheWriteMultiplier / 1_000_000) +
      Math.round(400 * rates.inputPerMTok * rates.cacheReadMultiplier / 1_000_000) +
      Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(computeAnthropicCostMicros(usage, model)).toBe(expected)
  })

  it('returns 0 when model is not in the table (graceful fallback)', () => {
    expect(computeAnthropicCostMicros({ input_tokens: 100, output_tokens: 50 }, 'unknown-model')).toBe(0)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/cost/anthropic-pricing.test.ts`
Expected: FAIL.

- [ ] **Step 4: Rewrite `anthropic-pricing.ts`**

```typescript
import { PRICING_V1 } from './pricing-table'

export interface UsageLike {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function addUsage(a: UsageLike, b: UsageLike): UsageLike {
  return {
    input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  }
}

export function computeAnthropicCostMicros(usage: UsageLike, model: string): number {
  const rates = (PRICING_V1.anthropic as Record<string, typeof PRICING_V1.anthropic['claude-opus-4-6']>)[model]
  if (!rates) return 0

  const input = usage.input_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0

  const inputCost = Math.round((input * rates.inputPerMTok) / 1_000_000)
  const writeCost = Math.round((cacheWrite * rates.inputPerMTok * rates.cacheWriteMultiplier) / 1_000_000)
  const readCost = Math.round((cacheRead * rates.inputPerMTok * rates.cacheReadMultiplier) / 1_000_000)
  const outputCost = Math.round((output * rates.outputPerMTok) / 1_000_000)

  return inputCost + writeCost + readCost + outputCost
}
```

Preserve any existing exports (`addUsage`) that the Managed runtime already imports. Inspect `lib/ai/agent/managed/runtime.ts:81` and make sure the signature still matches.

- [ ] **Step 5: Run all cost tests + typecheck**

Run: `cd app && npx vitest run tests/unit/ai/cost/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/cost/anthropic-pricing.ts app/tests/unit/ai/cost/anthropic-pricing.test.ts
git commit -m "feat(ai/cost): cache-aware Anthropic cost formula using pricing table"
```

---

### Task 19: OpenAI cost helper

**Files:**
- Create: `app/src/lib/ai/cost/openai-pricing.ts`
- Test: `app/tests/unit/ai/cost/openai-pricing.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/ai/cost/openai-pricing.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { computeOpenAICostMicros } from '@/lib/ai/cost/openai-pricing'
import { PRICING_V1 } from '@/lib/ai/cost/pricing-table'

describe('computeOpenAICostMicros', () => {
  const model = 'gpt-5.4'
  const rates = PRICING_V1.openai[model]

  it('zero cached tokens ⇒ full input cost', () => {
    const cost = computeOpenAICostMicros({ prompt_tokens: 1000, completion_tokens: 500 }, model)
    const expected =
      Math.round(1000 * rates.inputPerMTok / 1_000_000) +
      Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(cost).toBe(expected)
  })

  it('cached tokens are billed at the discount', () => {
    const cost = computeOpenAICostMicros({
      prompt_tokens: 1000,
      completion_tokens: 500,
      prompt_tokens_details: { cached_tokens: 400 },
    }, model)
    const expected =
      Math.round((1000 - 400) * rates.inputPerMTok / 1_000_000) +
      Math.round(400 * rates.inputPerMTok * rates.cachedInputDiscount / 1_000_000) +
      Math.round(500 * rates.outputPerMTok / 1_000_000)
    expect(cost).toBe(expected)
  })

  it('unknown model ⇒ 0', () => {
    expect(computeOpenAICostMicros({ prompt_tokens: 100, completion_tokens: 50 }, 'unknown')).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/cost/openai-pricing.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `app/src/lib/ai/cost/openai-pricing.ts`:

```typescript
import { PRICING_V1 } from './pricing-table'

export interface OpenAIUsageLike {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export function computeOpenAICostMicros(usage: OpenAIUsageLike, model: string): number {
  const rates = (PRICING_V1.openai as Record<string, typeof PRICING_V1.openai['gpt-5.4']>)[model]
  if (!rates) return 0

  const prompt = usage.prompt_tokens ?? 0
  const completion = usage.completion_tokens ?? 0
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  const nonCached = Math.max(0, prompt - cached)

  const inputCost = Math.round((nonCached * rates.inputPerMTok) / 1_000_000)
  const cachedCost = Math.round((cached * rates.inputPerMTok * rates.cachedInputDiscount) / 1_000_000)
  const outputCost = Math.round((completion * rates.outputPerMTok) / 1_000_000)

  return inputCost + cachedCost + outputCost
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app && npx vitest run tests/unit/ai/cost/openai-pricing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/ai/cost/openai-pricing.ts app/tests/unit/ai/cost/openai-pricing.test.ts
git commit -m "feat(ai/cost): OpenAI cost helper with cached_tokens discount"
```

---

### Task 20: Router telemetry — structured log + Prometheus counters

**Files:**
- Modify: `app/src/lib/ai/providers/router.ts`
- Modify: `app/src/lib/monitoring/metrics.ts`
- Test: `app/tests/unit/ai/providers/router-telemetry.test.ts` (new)

Context: `app/src/lib/monitoring/metrics.ts` is a custom in-memory registry (`metrics.counter(name, help)` / `metrics.inc(name, labels, value)`), not `prom-client`. Task 20 adds wrapper functions (`trackAiCacheCall`, etc.) in the same style as the existing `trackRequest` / `trackExternalAPI` exports.

- [ ] **Step 1: Write the failing tests**

Create `app/tests/unit/ai/providers/router-telemetry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const logInfoMock = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { child: () => ({ info: logInfoMock, warn: vi.fn(), error: vi.fn() }) },
}))

const trackCall = vi.fn()
const trackReads = vi.fn()
const trackWrites = vi.fn()
const trackDisabled = vi.fn()
vi.mock('@/lib/monitoring/metrics', () => ({
  metrics: { counter: vi.fn(), inc: vi.fn() },
  trackAiCacheCall: trackCall,
  trackAiCacheReadTokens: trackReads,
  trackAiCacheWriteTokens: trackWrites,
  trackAiCacheDisabled: trackDisabled,
}))

vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => true) }))

vi.mock('@/lib/ai/providers/anthropic', () => ({
  anthropicProvider: {
    generate: vi.fn(async (req) => ({
      content: 'ok',
      tokensUsed: { input: 100, output: 20 },
      model: req.model,
      provider: 'anthropic',
      ...(req.cache ? {
        cacheUsage: {
          requested: true, enabled: req.cache.enabled, disabledReason: 'none', identityKey: 'x'.repeat(64),
          supported: true, reads: 80, writes: 0, hit: 'read',
        },
      } : {}),
    })),
  },
}))

vi.mock('@/lib/ai/providers/openai', () => ({ openaiProvider: { generate: vi.fn() } }))
vi.mock('@/lib/ai/providers/google', () => ({ googleProvider: { generate: vi.fn() } }))
vi.mock('@/lib/ai/providers/perplexity', () => ({ perplexityProvider: { generate: vi.fn() } }))
vi.mock('@/lib/ai/providers/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))

describe('router telemetry', () => {
  beforeEach(() => {
    logInfoMock.mockReset()
    trackCall.mockReset()
    trackReads.mockReset()
    trackWrites.mockReset()
    trackDisabled.mockReset()
  })

  it('logs a cache object on every call, even when cache is omitted', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const logArg = logInfoMock.mock.calls[0][0]
    expect(logArg.cache).toMatchObject({
      requested: false,
      enabled: false,
      disabledReason: 'request_disabled',
      hit: 'disabled',
      supported: false,
      reads: 0,
      writes: 0,
    })
  })

  it('records the hit=read counter on a cache read', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(trackCall).toHaveBeenCalledWith('anthropic', 'claude-opus-4-6', 'read')
    expect(trackReads).toHaveBeenCalledWith('anthropic', 'claude-opus-4-6', 'unspecified', 80)
  })

  it('records the disabled counter with the correct reason', async () => {
    const ff = await import('@/lib/feature-flags')
    vi.mocked(ff.isFeatureEnabled).mockResolvedValueOnce(false)
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({
      provider: 'anthropic', model: 'claude-opus-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      cache: { enabled: true },
    })
    expect(trackDisabled).toHaveBeenCalledWith('global_kill_switch')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app && npx vitest run tests/unit/ai/providers/router-telemetry.test.ts`
Expected: FAIL — metric exports and log fields don't exist yet.

- [ ] **Step 3: Register counters and expose wrapper functions**

Open `app/src/lib/monitoring/metrics.ts`. Just below the existing counter registrations (near `metrics.counter('ai_requests_total', ...)`), add:

```typescript
metrics.counter('ai_cache_calls_total', 'Router AI cache call outcomes');
metrics.counter('ai_cache_reads_tokens_total', 'Router AI cache read tokens');
metrics.counter('ai_cache_writes_tokens_total', 'Router AI cache write tokens');
metrics.counter('ai_cache_disabled_total', 'Router AI cache disable reasons');
```

And below the existing `trackExternalAPI` export (matching its style), add:

```typescript
export function trackAiCacheCall(provider: string, model: string, hit: string): void {
  metrics.inc('ai_cache_calls_total', { provider, model, hit });
}

export function trackAiCacheReadTokens(provider: string, model: string, task: string, tokens: number): void {
  if (tokens > 0) metrics.inc('ai_cache_reads_tokens_total', { provider, model, task }, tokens);
}

export function trackAiCacheWriteTokens(provider: string, model: string, task: string, tokens: number): void {
  if (tokens > 0) metrics.inc('ai_cache_writes_tokens_total', { provider, model, task }, tokens);
}

export function trackAiCacheDisabled(reason: 'global_kill_switch' | 'request_disabled'): void {
  metrics.inc('ai_cache_disabled_total', { reason });
}
```

- [ ] **Step 4: Wire telemetry into the router**

Modify `app/src/lib/ai/providers/router.ts`. Add imports:

```typescript
import { logger } from '@/lib/logger'
import {
  trackAiCacheCall,
  trackAiCacheReadTokens,
  trackAiCacheWriteTokens,
  trackAiCacheDisabled,
} from '@/lib/monitoring/metrics'

const log = logger.child({ component: 'ai-router' })
```

Inside `generate()`, after computing `result` and before returning:

```typescript
const identityKeyForLog = result.cacheUsage?.identityKey ?? deriveIdentityKey(req)
const loggedCache = result.cacheUsage ?? {
  requested: false,
  enabled: false,
  disabledReason: 'request_disabled' as const,
  identityKey: identityKeyForLog,
  supported: false,
  reads: 0,
  writes: 0,
  hit: 'disabled' as const,
}

log.info({
  provider: config.provider,
  model: req.model,
  cache: {
    ...loggedCache,
    identityKey: loggedCache.identityKey.slice(0, 16),
  },
}, 'ai_call_completed')

trackAiCacheCall(config.provider, req.model, loggedCache.hit)
trackAiCacheReadTokens(config.provider, req.model, 'unspecified', loggedCache.reads)
trackAiCacheWriteTokens(config.provider, req.model, 'unspecified', loggedCache.writes)
if (loggedCache.disabledReason === 'global_kill_switch' || loggedCache.disabledReason === 'request_disabled') {
  trackAiCacheDisabled(loggedCache.disabledReason)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd app && npx vitest run tests/unit/ai/providers/router-telemetry.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/providers/router.ts app/src/lib/monitoring/metrics.ts app/tests/unit/ai/providers/router-telemetry.test.ts
git commit -m "feat(ai/router): structured cache log + Prometheus counters"
```

---

### Task 21: V3 runtime — consolidate assistant-message push (bug fix; no caller opts in)

**Files:**
- Modify: `app/src/lib/ai/agent/runtime.ts`
- Test: `app/tests/unit/ai/agent/runtime-message-push.test.ts` (new — scoped to the push logic)

- [ ] **Step 1: Read the current push sites**

Run: `sed -n '160,300p' app/src/lib/ai/agent/runtime.ts`
Identify the two push sites noted in the spec (§7.3): the no-tool branch and the tool branch. Confirm the current shape of `llmMessages`.

- [ ] **Step 2: Write the failing test**

Create `app/tests/unit/ai/agent/runtime-message-push.test.ts`. This is a focused test on the consolidation — it stubs the router and asserts the shape of messages passed to `generate()` over a two-iteration loop.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateMock = vi.fn()

vi.mock('@/lib/ai/providers/router', () => ({ generate: generateMock }))
vi.mock('@/lib/ai/agent/policies', () => ({ checkPolicyGate: () => ({ allowed: true }) }))
vi.mock('@/lib/ai/agent/tools/registry', () => ({ getToolsForPhase: () => [] }))
vi.mock('@/lib/ai/agent/tools/index', () => ({}))
vi.mock('@/lib/ai/agent/history', () => ({
  loadContext: async () => ({ summary: null, messages: [] }),
  appendMessage: vi.fn(),
  compactIfNeeded: vi.fn(),
}))
vi.mock('@/lib/ai/agent/prompt', () => ({ buildSystemPrompt: () => 'system' }))
vi.mock('@/lib/ai/knowledge/session-knowledge', () => ({ getSessionKnowledge: async () => [] }))
vi.mock('@/lib/ai/knowledge/write-back', () => ({ onSectionAccepted: vi.fn(), onPhaseTransition: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: { insert: () => ({ values: async () => {} }) } }))

describe('V3 runAgentTurn — assistant-message push consolidation', () => {
  beforeEach(() => generateMock.mockReset())

  it('pushes exactly one assistant message per iteration, with tool_calls when present', async () => {
    generateMock.mockResolvedValueOnce({
      content: 'thinking',
      toolCalls: [{ id: 'c1', name: 't', arguments: '{}' }],
    })
    // Second iteration: tool result fed in, assistant responds with text only.
    generateMock.mockResolvedValueOnce({ content: 'done' })

    const { runAgentTurn } = await import('@/lib/ai/agent/runtime')
    const session = {
      id: 's1', userId: 'u1', currentPhase: 'drafting', locale: 'ro', stateVersion: 1,
      updatedAt: new Date(), outline: [], systemSummary: null,
    } as Parameters<typeof runAgentTurn>[0]['session']
    await runAgentTurn({
      session, sections: [], request: { message: 'hi' }, emit: () => {},
    })

    // Iteration 2's `messages` arg should contain: user 'hi', assistant with tool_calls, tool 'done'.
    const iter2Messages = generateMock.mock.calls[1][0].messages
    const assistantIdx = iter2Messages.findIndex((m: { role: string }) => m.role === 'assistant')
    expect(assistantIdx).toBeGreaterThanOrEqual(0)
    const asst = iter2Messages[assistantIdx]
    expect(asst.tool_calls).toBeDefined()
    expect(asst.tool_calls).toHaveLength(1)
    expect(asst.tool_calls[0]).toEqual({
      id: 'c1',
      type: 'function',
      function: { name: 't', arguments: '{}' },
    })
    // Count assistant messages — must be exactly one per preceding iteration.
    const assistantMsgs = iter2Messages.filter((m: { role: string }) => m.role === 'assistant')
    expect(assistantMsgs).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd app && npx vitest run tests/unit/ai/agent/runtime-message-push.test.ts`
Expected: FAIL.

- [ ] **Step 4: Consolidate the push**

Open `app/src/lib/ai/agent/runtime.ts`. Find the block that starts around line 170 (the two-branch push). Replace both push sites with a single block placed **immediately after** the `generate()` call:

```typescript
// After `const response = await generate({ ... })` — one push per iteration:
const assistantMessage: { role: 'assistant'; content: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] } = {
  role: 'assistant',
  content: response.content ?? '',
  ...(response.toolCalls && response.toolCalls.length > 0
    ? {
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }
    : {}),
}
llmMessages.push(assistantMessage)

if (!response.toolCalls || response.toolCalls.length === 0) {
  if (response.content) {
    emit({ type: 'text_delta', content: response.content })
    await appendMessage(session.id, {
      role: 'assistant',
      messageType: 'text',
      content: response.content,
    })
  }
  break
}

// Otherwise emit any text and continue to tool processing.
if (response.content) {
  emit({ type: 'text_delta', content: response.content })
}
```

Remove the old text-only `llmMessages.push({ role: 'assistant', content: response.content })` calls in both the no-tool and tool branches.

- [ ] **Step 5: Run the test to verify it passes + full V3 test suite**

Run: `cd app && npx vitest run tests/unit/ai/agent/ && npm run typecheck`
Expected: PASS (new test + any existing V3 tests). If existing tests check the old push shape, update them to expect the new shape.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/ai/agent/runtime.ts app/tests/unit/ai/agent/runtime-message-push.test.ts
git commit -m "fix(ai/agent/runtime): consolidate assistant-message push to one per iteration, include tool_calls"
```

---

### Task 22: Contract snapshot tests

**Files:**
- Create: `app/tests/contract/ai/providers/generate-request.test.ts` (new)

- [ ] **Step 1: Write the snapshot tests**

Create `app/tests/contract/ai/providers/generate-request.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const anthropicNativeCreateMock = vi.fn()
const openaiCreateMock = vi.fn()
const shimCreateMock = vi.fn()

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: vi.fn(() => ({ messages: { create: anthropicNativeCreateMock } })),
}))

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation((opts) => ({
    chat: { completions: { create: opts?.baseURL?.includes('anthropic') ? shimCreateMock : openaiCreateMock } },
  })),
}))

vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/ai/providers/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))

const canonicalRequest = {
  provider: 'anthropic' as const,
  model: 'claude-opus-4-6',
  system: 'You are helpful.',
  tools: [{
    type: 'function' as const,
    function: { name: 'search', description: 'search tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
  }],
  messages: [
    { role: 'user' as const, content: 'find X' },
    {
      role: 'assistant' as const,
      content: 'calling',
      tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'search', arguments: '{"q":"X"}' } }],
    },
    { role: 'tool' as const, content: '{"hit":1}', tool_call_id: 'c1' },
  ],
}

describe('contract — Anthropic native request body', () => {
  beforeEach(() => {
    anthropicNativeCreateMock.mockReset()
    anthropicNativeCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })
  })
  it('matches the snapshot when cache is enabled', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, cache: { enabled: true, breakpoints: ['system', 'tools'] } })
    expect(anthropicNativeCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
})

describe('contract — Anthropic OpenAI-compat shim request body', () => {
  beforeEach(() => {
    shimCreateMock.mockReset()
    shimCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
  })
  it('matches the snapshot when cache is absent', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate(canonicalRequest)
    expect(shimCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
  it('matches the snapshot when cache.enabled=false', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, cache: { enabled: false } })
    expect(shimCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
})

describe('contract — OpenAI request body', () => {
  beforeEach(() => {
    openaiCreateMock.mockReset()
    openaiCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } },
    })
  })
  it('matches the snapshot when cache is enabled', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, provider: 'openai', model: 'gpt-5.4', cache: { enabled: true, key: 'test-key' } })
    expect(openaiCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
  it('matches the snapshot when cache is absent', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    await generate({ ...canonicalRequest, provider: 'openai', model: 'gpt-5.4' })
    expect(openaiCreateMock.mock.calls[0][0]).toMatchSnapshot()
  })
})
```

- [ ] **Step 2: Run the snapshots (first run creates them)**

Run: `cd app && npx vitest run tests/contract/ai/providers/generate-request.test.ts -u`
Expected: snapshots created; tests PASS.

- [ ] **Step 3: Manually review the generated snapshot file**

Run: `cat app/tests/contract/ai/providers/__snapshots__/generate-request.test.ts.snap`
Confirm the Anthropic native snapshot has `cache_control` blocks on system + last tool, and that all three `tool_use`/`tool_result` blocks are correctly paired in one user message.

- [ ] **Step 4: Run the tests a second time to confirm snapshots are stable**

Run: `cd app && npx vitest run tests/contract/ai/providers/generate-request.test.ts`
Expected: PASS (no regeneration).

- [ ] **Step 5: Commit**

```bash
git add app/tests/contract/ai/providers/
git commit -m "test(contract): snapshot provider request bodies for cache on/off and no-cache paths"
```

---

### Task 23: Golden transcript harness — no-tool scenario

**Files:**
- Create: `app/tests/golden/ai/v3-runtime.test.ts` (new)
- Create: `app/tests/golden/ai/_helpers/record-replay.ts` (new)

- [ ] **Step 1: Write the helper**

Create `app/tests/golden/ai/_helpers/record-replay.ts`:

```typescript
import type { GenerateRequest, GenerateResult } from '@/lib/ai/providers/types'

export interface NormalizedRequest {
  provider: string
  model: string
  system: unknown
  tools: unknown
  messages: unknown
  // cache metadata stripped
}

export function normalizeAnthropicNativeRequest(req: unknown): NormalizedRequest {
  const r = req as { model: string; system?: unknown; tools?: unknown; messages: unknown }
  const stripCache = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(stripCache)
    if (o && typeof o === 'object') {
      const copy: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k === 'cache_control') continue
        copy[k] = stripCache(v)
      }
      return copy
    }
    return o
  }
  return {
    provider: 'anthropic',
    model: r.model,
    system: stripCache(r.system),
    tools: stripCache(r.tools),
    messages: stripCache(r.messages),
  }
}

export function normalizeShimRequest(req: unknown): NormalizedRequest {
  const r = req as { model: string; messages: unknown; tools?: unknown }
  // Shim has no cache fields; normalize anyway for type symmetry.
  return {
    provider: 'anthropic',
    model: r.model,
    system: undefined,
    tools: r.tools,
    messages: r.messages,
  }
}

export type RecordedResponse = GenerateResult
export type Recording = { request: NormalizedRequest; response: RecordedResponse }
```

- [ ] **Step 2: Write the golden test (no tools, two turns)**

Create `app/tests/golden/ai/v3-runtime.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeAnthropicNativeRequest, normalizeShimRequest } from './_helpers/record-replay'

const nativeCreateMock = vi.fn()
const shimCreateMock = vi.fn()

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({ messages: { create: nativeCreateMock } }),
}))
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: shimCreateMock } },
  })),
}))
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/ai/providers/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))

const fixedNativeResponse = {
  content: [{ type: 'text', text: 'Hello there.' }],
  usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 80, cache_read_input_tokens: 0 },
}
const fixedShimResponse = {
  choices: [{ message: { content: 'Hello there.' } }],
  usage: { prompt_tokens: 100, completion_tokens: 10 },
}

describe('golden — V3 runtime no-tool parity', () => {
  beforeEach(() => {
    nativeCreateMock.mockReset()
    shimCreateMock.mockReset()
    nativeCreateMock.mockResolvedValue(fixedNativeResponse)
    shimCreateMock.mockResolvedValue(fixedShimResponse)
  })

  it('cache-on and cache-off produce the same normalized request', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    const baseReq = {
      provider: 'anthropic' as const,
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user' as const, content: 'hi' }],
    }
    await generate({ ...baseReq, cache: { enabled: false } })
    const offShape = normalizeShimRequest(shimCreateMock.mock.calls[0][0])

    await generate({ ...baseReq, cache: { enabled: true, breakpoints: ['system'] } })
    const onShape = normalizeAnthropicNativeRequest(nativeCreateMock.mock.calls[0][0])

    // Semantic message shape must match after cache-metadata stripping.
    expect(onShape.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(offShape.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(offShape.model).toBe(onShape.model)
  })

  it('cache-on request has cache_control blocks; cache-off does not', async () => {
    const { generate } = await import('@/lib/ai/providers/router')
    const baseReq = {
      provider: 'anthropic' as const,
      model: 'claude-opus-4-6',
      system: 'You are helpful.',
      messages: [{ role: 'user' as const, content: 'hi' }],
    }
    await generate({ ...baseReq, cache: { enabled: true, breakpoints: ['system'] } })
    const nativeBody = nativeCreateMock.mock.calls[0][0] as { system: unknown }
    expect(JSON.stringify(nativeBody.system)).toContain('cache_control')

    await generate({ ...baseReq, cache: { enabled: false } })
    const shimBody = shimCreateMock.mock.calls[0][0] as { messages: unknown }
    expect(JSON.stringify(shimBody)).not.toContain('cache_control')
  })
})
```

- [ ] **Step 3: Run the golden tests**

Run: `cd app && npx vitest run tests/golden/ai/v3-runtime.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/tests/golden/ai/v3-runtime.test.ts app/tests/golden/ai/_helpers/record-replay.ts
git commit -m "test(golden): V3 no-tool cache-on/off parity with cache-metadata stripping"
```

---

### Task 24: Golden transcript — tool-loop scenario

**Files:**
- Create: `app/tests/golden/ai/v3-tool-loop.test.ts` (new)

- [ ] **Step 1: Write the golden test**

Create `app/tests/golden/ai/v3-tool-loop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeAnthropicNativeRequest, normalizeShimRequest } from './_helpers/record-replay'

const nativeCreateMock = vi.fn()
const shimCreateMock = vi.fn()

vi.mock('@/lib/ai/anthropic-client', () => ({
  getAnthropicClient: () => ({ messages: { create: nativeCreateMock } }),
}))
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: shimCreateMock } } })),
}))
vi.mock('@/lib/feature-flags', () => ({ isFeatureEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/ai/providers/retry', () => ({ withRetry: (fn: () => Promise<unknown>) => fn() }))

describe('golden — V3 tool-loop parity', () => {
  beforeEach(() => {
    nativeCreateMock.mockReset()
    shimCreateMock.mockReset()
  })

  const tooledRequest = (cache: { enabled: boolean; breakpoints?: ('system' | 'tools')[] } | undefined) => ({
    provider: 'anthropic' as const,
    model: 'claude-opus-4-6',
    system: 'You are helpful.',
    tools: [{
      type: 'function' as const,
      function: { name: 'search', description: 'search tool', parameters: { type: 'object', properties: { q: { type: 'string' } } } },
    }],
    messages: [
      { role: 'user' as const, content: 'find X' },
      {
        role: 'assistant' as const,
        content: 'calling',
        tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'search', arguments: '{"q":"X"}' } }],
      },
      { role: 'tool' as const, content: '{"hit":1}', tool_call_id: 'c1' },
    ],
    ...(cache ? { cache } : {}),
  })

  it('normalized request shapes match between cache-on and cache-off for a tool-loop turn', async () => {
    nativeCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Found X.' }],
      usage: { input_tokens: 50, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })
    shimCreateMock.mockResolvedValue({
      choices: [{ message: { content: 'Found X.' } }],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    })

    const { generate } = await import('@/lib/ai/providers/router')

    await generate(tooledRequest(undefined))
    const offShape = normalizeShimRequest(shimCreateMock.mock.calls[0][0])

    await generate(tooledRequest({ enabled: true, breakpoints: ['system', 'tools'] }))
    const onShape = normalizeAnthropicNativeRequest(nativeCreateMock.mock.calls[0][0])

    // Shim shape keeps OpenAI-style messages (role:'tool' entries as-is).
    // Native shape groups tool_result into a user message. The two aren't byte-equal
    // across shapes — but within each provider, the message SEMANTICS preserve: assistant
    // message with one tool_use, immediately followed by a tool_result for c1.
    // Assert the invariants that matter.
    const onMessages = onShape.messages as Array<{ role: string; content: unknown }>
    expect(onMessages).toHaveLength(3)
    expect(onMessages[1].role).toBe('assistant')
    expect(JSON.stringify(onMessages[1].content)).toContain('tool_use')
    expect(JSON.stringify(onMessages[1].content)).toContain('c1')
    expect(onMessages[2].role).toBe('user')
    expect(JSON.stringify(onMessages[2].content)).toContain('tool_result')

    const offMessages = offShape.messages as Array<{ role: string; tool_calls?: unknown; tool_call_id?: string }>
    const assistantInOff = offMessages.find((m) => m.role === 'assistant')
    expect(assistantInOff?.tool_calls).toBeDefined()
    const toolInOff = offMessages.find((m) => m.role === 'tool')
    expect(toolInOff?.tool_call_id).toBe('c1')
  })

  it('cache-on native body has cache_control on system + last tool', async () => {
    nativeCreateMock.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })
    const { generate } = await import('@/lib/ai/providers/router')
    await generate(tooledRequest({ enabled: true, breakpoints: ['system', 'tools'] }))
    const body = nativeCreateMock.mock.calls[0][0] as { system: unknown; tools: Array<{ cache_control?: unknown }> }
    expect(JSON.stringify(body.system)).toContain('cache_control')
    expect(body.tools[body.tools.length - 1].cache_control).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `cd app && npx vitest run tests/golden/ai/v3-tool-loop.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/tests/golden/ai/v3-tool-loop.test.ts
git commit -m "test(golden): V3 tool-loop cache-on/off semantic preservation"
```

---

### Task 25: Documentation — CLAUDE.md + runbook scaffold

**Files:**
- Modify: `CLAUDE.md` (root)
- Create: `docs/runbooks/ai-caching.md`

- [ ] **Step 1: Extend the root CLAUDE.md**

Find the "AI Providers" section (`grep -n 'AI Providers' CLAUDE.md` from `/home/godja/Dev/EU-Funds/`). Append:

```markdown
**Prompt caching (router-level)**: `GenerateRequest.cache?: CacheOptions` and `GenerateResult.cacheUsage?: CacheUsage` are the provider-neutral handles. The Anthropic adapter branches: `cache.enabled=true` uses native `@anthropic-ai/sdk` via `providers/anthropic-native.ts`; `cache.enabled=false` (or omitted) stays on the OpenAI-compat shim. OpenAI gets `prompt_cache_key` when enabled. Google/Perplexity accept the option but only report `supported: false` and throw `UnsupportedOperationError` if `messages[]` contains `tool_calls`. See `docs/superpowers/specs/2026-04-21-v3-rag-prompt-caching-design.md` for the full contract. Global kill-switch: `prompt_cache_enabled` feature flag (seeded `false`). The router only reads the flag when `req.cache?.enabled === true` — PR 1 introduces zero DB traffic for non-opted-in callers.
```

- [ ] **Step 2: Create the runbook**

Create `docs/runbooks/ai-caching.md` with the Q&A content from §12 of the design spec. Copy verbatim — this is the runbook referenced at deploy time.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/runbooks/ai-caching.md
git commit -m "docs(ai): CLAUDE.md + runbook for router-level prompt caching"
```

---

### Task 26: Full test suite + typecheck + lint

- [ ] **Step 1: Run the full test suite**

Run: `cd app && npm run test`
Expected: all tests PASS.

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `cd app && npm run lint`
Expected: no new errors; pre-existing ones acceptable per CLAUDE.md.

- [ ] **Step 4: If any fail, fix and re-run**

Address each failure. Commit fixes with descriptive messages. Do not skip or disable tests.

---

### Task 27: Local smoke — router behavior-neutrality

**Files:**
- None (manual).

- [ ] **Step 1: Start local stack**

Run: `cd /home/godja/Dev/EU-Funds && docker compose up -d postgres redis`
Wait until healthy.

- [ ] **Step 2: Run migrations**

Run: `cd app && npm run db:migrate`
Expected: `NNNN_prompt_cache_flag` applied; `feature_flags.prompt_cache_enabled = false`.

- [ ] **Step 3: Start dev server**

Run: `cd app && PORT=3002 npm run dev`
Wait for "ready" banner.

- [ ] **Step 4: Hit a one-shot AI endpoint that uses `aiGenerate` (e.g., existing chat surface)**

Use an existing smoke path that exercises `generate()` at least once. Monitor stdout for `ai_call_completed` log lines.

Expected:
- Log includes a `cache` object.
- For all callers: `cache.requested: false`, `cache.enabled: false`, `cache.disabledReason: 'request_disabled'`, `cache.hit: 'disabled'`.
- **No** `cache_control` string in any outgoing request body (confirm via adding a breakpoint in the adapter's create() or by running a packet capture in dev).
- No errors.

- [ ] **Step 5: Flip the feature flag to true via admin API (or directly in DB for the smoke)**

Run: `docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c "UPDATE feature_flags SET enabled=true WHERE key='prompt_cache_enabled';"`

- [ ] **Step 6: Hit the endpoint again**

Expected: telemetry still shows `cache.requested: false` (no caller opts in). No behavior change.

- [ ] **Step 7: Flip the flag back to false**

Run: `docker exec eu-funds-postgres-1 psql -U fondeu -d fondeu -c "UPDATE feature_flags SET enabled=false WHERE key='prompt_cache_enabled';"`

- [ ] **Step 8: Stop dev server**

Kill the dev server process.

---

### Task 28: Staging smoke — PR 1 zero-opt-in gate

**Files:**
- None (operational).

- [ ] **Step 1: Push branch and open PR**

```bash
git push origin feature/prompt-cache-pr1-router-contract
gh pr create --title "feat(ai/providers): router-level prompt caching contract (PR 1)" --body "$(cat <<'EOF'
## Summary
- Router `cache?: CacheOptions` + `cacheUsage?: CacheUsage`.
- Anthropic adapter branches: native for cache, shim otherwise; shim now passes `tool_calls` through.
- OpenAI `prompt_cache_key` + `cached_tokens` extraction.
- Google/Perplexity: cache ignored; `UnsupportedOperationError` on `tool_calls` in messages (audited — no prod callers affected).
- V3 runtime: assistant-message push consolidated to one per iteration, carries `tool_calls` (bug fix, zero opt-in).
- Feature flag `prompt_cache_enabled` seeded `false`.
- Cost module cache-aware; versioned pricing table.
- Structured log + Prometheus counters.
- PR 0 V3 prompt-stability audit committed; Google/Perplexity tool-call audit committed; Anthropic shim tool-turn probe committed.

## Scope gate
**No caller opts in to caching in this PR.** V3 opt-in is Plan 2 / PR 2.

## Test plan
- [x] Unit tests across providers, router, cost, translator, cache-key
- [x] Contract snapshot tests
- [x] Golden transcripts: no-tool + tool-loop
- [x] Local smoke: `cache.requested: false` on all existing callers
- [ ] Staging smoke (Task 28)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Wait for CI green**

Run: `gh pr checks --watch`
Expected: quality + security-gates + build-and-test all green.

- [ ] **Step 3: Deploy to staging per project workflow**

Follow the existing staging deploy process for this repo. Do NOT enable `prompt_cache_enabled` on staging yet.

- [ ] **Step 4: Run a V3 session on staging**

Use the staging V3 endpoint with a test account. A 5-turn session is sufficient.

Expected for every turn:
- Log entry shape matches `cache: { requested: false, enabled: false, disabledReason: 'request_disabled', ... }`.
- Zero `cache_control` in request bodies (verify via staging log of outbound HTTP or by toggling a temporary debug log in the adapter).
- No regression in V3 behavior vs pre-PR baseline.

- [ ] **Step 5: Run a `ragQuery` on staging**

Hit the existing RAG endpoint once with a stable system prompt.

Expected: same `cache.requested: false` shape; no errors.

- [ ] **Step 6: Document smoke results in the PR**

Post a comment to the PR with:
- Screenshot or text paste of one `ai_call_completed` log entry showing the `cache` object.
- Confirmation that `cache.requested` was false across all turns.
- Confirmation that no `cache_control` leaked into outbound requests.

- [ ] **Step 7: Merge PR**

Once smoke is clean and reviewers approve, merge into master via `gh pr merge --squash --delete-branch` (or the project's standard merge mode).

Expected: master is clean; `ba92dba` + PR 1 commits on master; downstream Plans 2-5 can start.

---

## Self-review checklist

Run these after completing all tasks above, before calling the plan done.

- [ ] **Spec coverage:**
  - §4 file references — addressed by Tasks 3, 8, 14, 16, 18, 21.
  - §5.1 types — Task 3.
  - §5.2 resolution flow — Task 16.
  - §5.3 identity key — Task 4.
  - §5.4 presence rule — Tasks 3, 6, 7, 8, 11, 16 (test).
  - §5.5 invalidation — documented in spec; no code enforcement (by design).
  - §5.6 retry & fallback — existing `withRetry` preserved in Task 16.
  - §6.1 Anthropic native + branch — Tasks 9–14.
  - §6.2 OpenAI — Task 8.
  - §6.3 Google — Task 6.
  - §6.4 Perplexity — Task 7.
  - §7.3 V3 assistant push — Task 21.
  - §9.1–9.2 telemetry — Task 20.
  - §9.3–9.4 cost — Tasks 17–19.
  - §10.2 goldens — Tasks 23–24.
  - §10.3 adapter units — Tasks 6, 7, 8, 9, 10, 11, 12, 14.
  - §10.4 resolution + presence — Task 16.
  - §10.5 identity key — Task 4.
  - §10.6 Anthropic cost — Task 18.
  - §10.7 contract snapshots — Task 22.
  - §11.2 feature flag — Task 15.
  - §11.4 PR 1 staging gate — Task 28.
  - §12 runbook — Task 25.
  - §15 Q1 fix-in-PR-1 — Task 14 (addresses shim), Task 21 (addresses V3); probe in Task 13.
  - §15 Q2 audit — Task 5.

- [ ] **No placeholders:** Each task has exact code, exact commands, exact expected output. "TBD" appears zero times outside of audit-result fields that the engineer fills in during execution.

- [ ] **Type consistency:** `CacheOptions`, `CacheUsage`, `RouterMessage`, `RouterToolCall` names are used identically across Tasks 3, 4, 6–14, 16, 20–24.

- [ ] **PR 1 is zero-opt-in:** grep `app/src/lib/` after Task 28 for `cache: { enabled: true` — the only hits should be in test files, not in runtime code paths that executes in production. V3 runtime does **not** pass `req.cache` in this plan; that's Plan 2.

- [ ] **Staging smoke confirms no cache path is active:** Task 28 Step 4-6 asserts `cache.requested: false` everywhere.

---

## End of plan

After Task 28 merges, Plan 1 is complete. Plan 2 (V3 opt-in + canary) will be written against the merged master. Do not modify any caller to pass `cache: { enabled: true }` in this plan.
