# V3 + RAG Prompt Caching — Design Spec

- **Date**: 2026-04-21
- **Track**: 1 of 5 (see Follow-up §17)
- **Status**: Brainstorm complete; pending user written review
- **Successor specs**: eval harness + observability (Track 3); reranker/contextual retrieval (Track 2); knowledge surface integrations (Track 4); continuous freshness pipeline (Track 5)

---

## 1. Context & motivation

The two Claude-backed surfaces that dominate production AI spend today — the V3 agent runtime (`lib/ai/agent/runtime.ts`) and the one-shot generation path (`lib/ai/client.ts` → `aiGenerate()` → `ragQuery` + 5 other callers) — do not use provider prompt caching.

The Managed Agents runtime (`lib/ai/agent/managed/runtime.ts`) already caches via Anthropic's native `cache_control: { type: 'ephemeral' }` markers on the system prompt and the tool list, and reads its per-turn reduction telemetry via `cache_creation_input_tokens` / `cache_read_input_tokens`. That pattern is not portable to V3 as-is because V3 routes through `lib/ai/providers/router.ts` → `providers/anthropic.ts`, which is an OpenAI-compatibility shim that does not expose `cache_control`.

This spec extends the provider router to carry a provider-neutral cache option, adds a native Anthropic transport for the cache path, centralizes the V3 and Managed model choices through `resolveAgentModel()`, and rolls out caching to V3 first, then RAG, then one-shot callers.

Managed Agents is **not** migrated onto the router. It remains on direct SDK streaming; its model choice is centralized.

## 2. Scope

1. Extend `GenerateRequest` with a provider-neutral `cache?: CacheOptions` and `GenerateResult` with `cacheUsage?: CacheUsage`.
2. Extend `GenerateRequest.messages` with a `tool_calls?: RouterToolCall[]` field on assistant messages (prerequisite for native Anthropic tool replay; also fixes the V3 runtime's missing assistant-tool-call push).
3. Per-adapter translation: Anthropic (native SDK on cache path; OpenAI-compat shim on non-cache path), OpenAI (stable ordering + `prompt_cache_key`), Google (capability plumbing + no-op), Perplexity (no-op).
4. V3 runtime: unhardcode `claude-opus-4-6`, use `resolveAgentModel({ task: 'agent_turn' })`, opt in to caching.
5. Managed runtime: unhardcode `claude-sonnet-4-6`, use `resolveAgentModel({ task: 'managed_turn' })`. Keep existing caching in place. **This is a PR 5 housekeeping change; it does not block PRs 1–4.**
6. `aiGenerate()` and `aiGenerateObject()` signature extension: optional `task`, optional `cache`. Migrate callers (RAG, compliance, doc analyzer, risk, discovery, deadline) one PR at a time.
7. Telemetry: structured log `cache.*` fields on every call; new Prometheus counters; cost accounting via versioned pricing table.
8. Rollout: kill-switch flag `prompt_cache_enabled`; per-PR staged merge order V3 → RAG → one-shots; PR 2 gets a real production canary via flag flip.
9. Tests: behavior-preservation goldens, adapter units, contract snapshots, cache-resolution semantics, cost formulas.

## 3. Non-goals

- **Router streaming**. Managed runtime stays on direct Anthropic SDK because it multiplexes SSE + tool loops. Unifying later is its own spec.
- **Gemini explicit context caching**. v1 ships the capability plumbing; the stateful "create cache resource → reference → invalidate" lifecycle is deferred to a dedicated spec. The router contract must not block it.
- **RAG retrieved-context caching**. Retrieved chunks vary per query and are not a stable prefix. v1 only caches the RAG system prompt (itself subject to a stability audit — see §10.5).
- **Embeddings / reranker / eval harness**. Tracks 2–3.
- **Grafana dashboards, cost budgets, finance reporting**. Dashboard work belongs to Track 3.
- **Anthropic 1h extended cache beta**. Follow-up after 5-min ephemeral baselines stabilize.
- **Managed runtime migration onto the router**. Separate design.
- **Router-level request deduplication or full response caching**. Different optimization class.

## 4. Current state (file references)

| Concern | File:line | Current behavior |
|---|---|---|
| Router entrypoint | `lib/ai/providers/router.ts:16` | `generate(req)` dispatches to provider adapter; no cache option |
| `GenerateRequest` type | `lib/ai/providers/types.ts:1-9` | `messages[]` has no assistant `tool_calls` field |
| Anthropic adapter | `lib/ai/providers/anthropic.ts:7-13` | Uses `new OpenAI({ baseURL: 'api.anthropic.com/v1/' })` compat shim — cannot pass `cache_control` |
| OpenAI adapter | `lib/ai/providers/openai.ts:1-15` | No `prompt_cache_key`; no `cached_tokens` extraction |
| Native Anthropic client | `lib/ai/anthropic-client.ts` | Existing singleton used by Managed runtime; reusable for the cache path |
| V3 runtime call | `lib/ai/agent/runtime.ts:162-168` | Hardcodes `provider: 'anthropic', model: 'claude-opus-4-6'`; no cache option |
| V3 assistant push | `lib/ai/agent/runtime.ts:170-186, 276` | Two branches push assistant text-only; **never** pushes the assistant `tool_calls` before the `tool` role result |
| Managed runtime model | `lib/ai/agent/managed/runtime.ts:85` | Hardcodes `MODEL = 'claude-sonnet-4-6'` |
| Managed cache pattern (reference) | `lib/ai/agent/managed/runtime.ts:95, 167-179` | System block + last tool both stamped with `cache_control: { type: 'ephemeral' }` |
| `aiGenerate()` | `lib/ai/client.ts:24-64` | No `task` / no `cache` input; no `cacheUsage` output |
| RAG generate call | `lib/rag/pipeline.ts:251` | Calls `aiGenerate()`; system prompt is static per locale |
| Model routing defaults | `lib/ai/model-routing.ts:59-65` | `ROUTING_DEFAULTS` keyed by tier |
| Task type union | `lib/ai/model-routing.ts:16-25` | 9 existing task names; no `agent_turn` or `managed_turn` |
| Cost helper (Anthropic) | `lib/ai/cost/anthropic-pricing.ts` | `computeAnthropicCostMicros(usage)`; does not account for cache fields |

## 5. Router contract

### 5.1 New types (`lib/ai/providers/types.ts`)

```ts
export interface CacheOptions {
  enabled: boolean
  key?: string                                          // caller-provided; opaque; wins over derived identityKey
  breakpoints?: Array<'system' | 'tools'>               // v1 breakpoints only; intent hints, not guarantees
  ttlSeconds?: number                                   // provider may clamp/ignore
}

export type CacheDisabledReason =
  | 'global_kill_switch'    // prompt_cache_enabled flag is false
  | 'request_disabled'      // caller passed cache.enabled: false, or omitted cache entirely
  | 'none'                  // enabled: true

export type CacheHit = 'read' | 'miss' | 'disabled' | 'unsupported'

export interface CacheUsage {
  requested: boolean                                    // caller passed cache.enabled: true
  enabled: boolean                                      // after kill-switch resolution
  disabledReason: CacheDisabledReason
  identityKey: string                                   // always computed; 64-char hex sha256
  supported: boolean                                    // adapter honored any cache hint
  reads: number                                         // cache read tokens
  writes: number                                        // cache write tokens
  hit: CacheHit
  effectiveTtlSeconds?: number                          // populated when caller set ttlSeconds
}

export interface RouterToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface RouterMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string                                 // tool role only
  tool_calls?: RouterToolCall[]                         // assistant role only
}

export interface GenerateRequest {
  system?: string
  messages: RouterMessage[]
  provider: ProviderName
  model: string
  maxTokens?: number
  temperature?: number
  tools?: ToolSchema[]
  cache?: CacheOptions                                  // default: treated as { enabled: false }
}

export interface GenerateResult {
  content: string
  tokensUsed: { input: number; output: number }
  model: string
  provider: ProviderName
  toolCalls?: ToolCallResult[]
  cacheUsage?: CacheUsage                               // present whenever cache was attempted
}
```

### 5.2 Resolution flow (`lib/ai/providers/router.ts`)

1. Compute `identityKey = deriveIdentityKey(req)` — always, even when caching is off (telemetry correlation).
2. Resolve `enabled`:
   - Read feature flag: `isFeatureEnabled('prompt_cache_enabled', { bypassCache: true })`.
   - If flag is false → force `enabled = false`, `disabledReason = 'global_kill_switch'`.
   - Else if caller passed `cache.enabled === true` → `enabled = true`, `disabledReason = 'none'`.
   - Else → `enabled = false`, `disabledReason = 'request_disabled'`.
3. Build provider dispatch call with resolved cache state.
4. Adapter receives `{ ...req, cache: { enabled, key, breakpoints, ttlSeconds }, _identityKey }` and populates `cacheUsage.reads/writes/supported/hit/effectiveTtlSeconds`.
5. Router assembles final `GenerateResult.cacheUsage` by merging its resolution fields with the adapter's telemetry.

### 5.3 Identity key derivation

```ts
// lib/ai/providers/cache-key.ts
export function deriveIdentityKey(
  req: Pick<GenerateRequest, 'provider' | 'model' | 'system' | 'tools'>,
): string {
  const payload = canonicalJson({
    provider: req.provider,
    model: req.model,
    system: req.system ?? '',
    tools: (req.tools ?? []).map(normalizeTool),
  })
  return sha256Hex(payload) // 64 hex chars
}
```

Rules:
- `canonicalJson`: recursive key sort on objects; arrays keep caller order (tool order is semantic on both providers).
- `normalizeTool`: recursively sort keys in `parameters` / nested schemas.
- `messages` never enters the key.
- Caller-provided `cache.key` wins over `identityKey` for any adapter that consumes keys (OpenAI `prompt_cache_key`). `identityKey` is always logged for telemetry correlation, regardless.
- Helper is ~20 LOC hand-rolled; no new dependency.

### 5.4 Invalidation rules (documented, not enforced)

- **Anthropic**: byte change in the cached prefix invalidates naturally; phase change rewrites V3's system; tool-list change naturally invalidates.
- **OpenAI**: prefix-ordering change or `prompt_cache_key` change → new cache entry.
- Caller responsibility: produce stable prefix content. Router does not enforce stability; it just doesn't break it.

### 5.5 Retry & fallback interaction

- `lib/ai/providers/retry.ts` wraps the adapter call. Cache options flow unchanged on same-provider retry. Anthropic re-reads cache on retry.
- Cross-provider fallback (`MODEL_CONFIGS[model].fallback`): the `cache` option travels unchanged; each adapter honors its own slice. Anthropic-native `cache_control` blocks are never constructed for an OpenAI adapter call.

## 6. Per-provider implementation

### 6.1 Anthropic — transport branch

`lib/ai/providers/anthropic.ts` becomes a thin branch:

| `cache.enabled` | Transport |
|---|---|
| `false` | Existing OpenAI-compat shim at `api.anthropic.com/v1/` (unchanged) |
| `true` | Native `@anthropic-ai/sdk` via existing `getAnthropicClient()` — dispatches to `providers/anthropic-native.ts` |

**`providers/anthropic-native.ts`** (new module — native translation + call + response parse):

Request translation:
- `req.system: string` → `system: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }]` iff `breakpoints` includes `'system'`.
- `req.tools: ToolSchema[]` (OpenAI `{ type: 'function', function: {...} }`) → Anthropic native `{ name, description, input_schema }`. If `breakpoints` includes `'tools'`, stamp `cache_control: { type: 'ephemeral' }` on the **last** tool only.
- `req.messages` → Anthropic native:
  - `role: 'user'` → `{ role: 'user', content: msg.content }`.
  - `role: 'assistant'` with no `tool_calls` → `{ role: 'assistant', content: msg.content }`.
  - `role: 'assistant'` with `tool_calls` → `{ role: 'assistant', content: [ ...(msg.content ? [{ type: 'text', text: msg.content }] : []), ...tool_calls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) })) ] }`.
  - `role: 'tool'` → `{ role: 'user', content: [{ type: 'tool_result', tool_use_id: msg.tool_call_id, content: msg.content }] }`.
  - `role: 'system'` messages must not appear (router asserts): system lives only in `req.system`.

Response parse:
- Extract `content[]`: text blocks → concatenated `content` string; `tool_use` blocks → `toolCalls: [{ id, name, arguments: JSON.stringify(input) }]`.
- `usage.cache_creation_input_tokens` → `cacheUsage.writes`.
- `usage.cache_read_input_tokens` → `cacheUsage.reads`.
- `cacheUsage.supported = true`; `hit = reads > 0 ? 'read' : 'miss'`.
- `ttlSeconds > 300` silently clamped; `effectiveTtlSeconds = 300`; warn-once-per-process on mismatch (module-level `let warned = false`).

`providers/anthropic.ts` structure after this change:

```ts
export const anthropicProvider: ProviderClient = {
  async generate(req) {
    if (req.cache?.enabled === true) {
      return anthropicNativeGenerate(req)       // imports anthropic-native.ts
    }
    return anthropicCompatGenerate(req)         // existing shim code, unchanged semantics,
                                                // PLUS handles new RouterMessage.tool_calls field
                                                // (maps through to OpenAI-shape tool_calls on assistant messages)
  },
}
```

### 6.2 OpenAI

- Transport unchanged.
- When `cache.enabled`, include `prompt_cache_key: cache.key ?? _identityKey` in `chat.completions.create(...)` params.
- Caller-supplied `tools` preserved in order (adapter does not reorder).
- Response: extract `usage.prompt_tokens_details.cached_tokens` → `cacheUsage.reads`; `writes = 0`; `supported = true`; `hit = reads > 0 ? 'read' : 'miss'`.
- New `RouterMessage.tool_calls` maps directly to OpenAI's `ChatCompletionMessageParam.tool_calls`.

### 6.3 Google

- Accept `cache` option; emit no cache-specific parameters; behavior otherwise unchanged.
- Response: `cacheUsage.supported = false`; `reads = 0`; `writes = 0`; `hit = 'unsupported'`.
- **If any `messages[i].tool_calls` is present**, adapter throws `UnsupportedOperationError`. No silent serialization.

### 6.4 Perplexity

- Same as Google: ignore `cache`; throw `UnsupportedOperationError` if `tool_calls` appears in messages.

## 7. Model centralization

### 7.1 New TaskTypes (`lib/ai/model-routing.ts`)

```ts
export type TaskType =
  | ...existing...
  | 'agent_turn'       // V3 agent loop
  | 'managed_turn'     // Managed runtime (centralization only; does not route through generate())

// mapTaskToTier additions:
case 'agent_turn':    return 'critical'    // → claude-opus-4-6
case 'managed_turn':  return 'standard'    // → claude-sonnet-4-6
```

Rationale: reusing `'planning'` for V3 would couple V3's budget to every future `planning` caller. Dedicated task names decouple.

### 7.2 V3 runtime patch (`lib/ai/agent/runtime.ts`)

Replace lines 162-168:

```ts
const resolved = resolveAgentModel({ task: 'agent_turn', ctx: opts.routingCtx })
const response = await generate({
  provider: resolved.provider,
  model: resolved.model,
  system: systemPrompt,
  messages: llmMessages,
  tools: toolSchemas.length > 0 ? toolSchemas : undefined,
  cache: {
    enabled: true,
    key: `v3:${session.id}:${session.currentPhase}`,
    breakpoints: ['system', 'tools'],
  },
})
```

### 7.3 V3 assistant-message push consolidation

The current runtime has two assistant-message push sites (`:178` no-tool branch; `:185` tool branch). The tool branch pushes text only — the `tool_calls` are never added to `llmMessages`. This breaks native Anthropic tool replay.

Replace both sites with one push per iteration:

```ts
// After `response = await generate(...)`:
const assistantMessage: RouterMessage = {
  role: 'assistant',
  content: response.content ?? '',
  ...(response.toolCalls?.length
    ? {
        tool_calls: response.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      }
    : {}),
}
llmMessages.push(assistantMessage)

if (!response.toolCalls?.length) {
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

if (response.content) {
  emit({ type: 'text_delta', content: response.content })
}
// continue to tool processing as before
```

**The consolidation lands in PR 1**, not PR 2. It is also the fix for the latent bug in the OpenAI-compat shim (see §14).

### 7.4 Managed runtime patch (`lib/ai/agent/managed/runtime.ts`)

Replace line 85:

```ts
// Was: const MODEL = 'claude-sonnet-4-6'
const resolved = resolveAgentModel({ task: 'managed_turn', ctx: serviceCtx.routingCtx })
// resolved.model used everywhere MODEL is used today
```

`ServiceContext` gains `routingCtx?: ModelRoutingContext` — added as part of PR 5 only. Does not block PRs 1–4.

Managed runtime stays on direct Anthropic SDK. Its native `cache_control` stamping at lines 167-179 is unchanged. Managed does not use the router's cache option.

## 8. Call-site changes (one-shots)

### 8.1 `aiGenerate()` / `aiGenerateObject()` signature

```ts
export async function aiGenerate(opts: {
  system: string
  prompt: string
  task?: TaskType                   // default: 'editing' (unchanged behavior)
  cache?: CacheOptions              // default: omitted → treated as enabled: false
  temperature?: number
  maxTokens?: number
}): Promise<{ text: string; tokensUsed: number; cacheUsage?: CacheUsage }>
```

Same treatment for `aiGenerateObject()`. `cache.breakpoints` defaults to `['system']` (no tools on one-shot path).

One-shots keep tier defaults — no `routingCtx` plumbing in v1. User model preferences remain a V3-only concern.

### 8.2 Caller migration map

| Caller | File | Task | Cache key | PR |
|---|---|---|---|---|
| RAG | `lib/rag/pipeline.ts:251` | `'editing'` | `rag:static-system-v1:${locale}` | PR 3 |
| Compliance | `lib/ai/compliance-engine.ts` | `'quality_check'` | `oneshot:compliance:v1` | PR 4a |
| Doc analyzer | `lib/ai/document-analyzer.ts` | `'classification'` | `oneshot:doc-analyzer:v1` | PR 4b |
| Risk assessment | `lib/ai/risk-assessment.ts` | `'quality_check'` | `oneshot:risk:v1` | PR 4c |
| Discovery | `lib/discovery/pipeline.ts` | `'matching'` | `oneshot:discovery:v1` | PR 4d |
| Deadline intel | `lib/ai/deadline-intelligence.ts` | `'freshness_check'` | `oneshot:deadline:v1` | PR 4e |
| Stragglers surfaced in audit | TBD | TBD | `oneshot:${name}:v1` | PR 4f |

Each caller gets a per-PR system-prompt stability audit before opting in, following the V3 template in §8.3 (committed as `docs/runbooks/audits/<caller>-prompt-stability-2026-04.md`). PRs 3 and 4a–f each carry their own audit doc in the same commit.

### 8.3 V3 system-prompt stability audit (PR 0 prerequisite for PR 2)

Committed as `docs/runbooks/audits/v3-prompt-stability-2026-04.md`. Covers:

- `buildSystemPrompt(session, sections)` in `lib/ai/agent/prompt.ts`: grep for `new Date()`, `Date.now()`, timestamp formatting, `crypto.randomUUID()`, request IDs, any per-call identifier.
- Session summary, locale, policy matrix output, phase tool-list ordering.
- If any non-stable content is found, either (a) move it out of `systemPrompt` into the first user message, or (b) flag that section as non-cacheable and document why.

Audit doc is reviewed and signed off before PR 2 enables caching.

## 9. Telemetry & cost

### 9.1 Structured log (existing `logger` in runtime / client)

Every `generate()` call emits:

```jsonc
{
  "event": "ai_call_completed",
  "provider": "anthropic",
  "model": "claude-opus-4-6",
  "task": "agent_turn",
  "durationMs": 1204.2,
  "tokensUsed": { "input": 3800, "output": 520 },
  "cache": {
    "requested": true,
    "enabled": true,
    "disabledReason": "none",
    "identityKey": "a1b2c3d4...",      // first 16 chars logged
    "supported": true,
    "reads": 3200,
    "writes": 0,
    "hit": "read",
    "effectiveTtlSeconds": 300
  }
}
```

### 9.2 Prometheus counters (extend `lib/monitoring/metrics.ts`)

- `ai_cache_reads_tokens_total{provider, model, task}` — counter.
- `ai_cache_writes_tokens_total{provider, model, task}` — counter.
- `ai_cache_calls_total{provider, model, hit}` — counter. `hit ∈ {read, miss, disabled, unsupported}`.
- `ai_cache_disabled_total{reason}` — counter. `reason ∈ {global_kill_switch, request_disabled}`.

No Grafana dashboards in this spec (§11.3).

### 9.3 Versioned pricing table (new `lib/ai/cost/pricing-table.ts`)

```ts
export const PRICING_V1 = {
  _tableVersion: '2026-04-21',
  anthropic: {
    'claude-opus-4-6':   { inputPerMTok, outputPerMTok, cacheWriteMultiplier: 1.25, cacheReadMultiplier: 0.10 },
    'claude-sonnet-4-6': { /* same fields */ },
    'claude-haiku-4-5':  { /* same fields */ },
  },
  openai: {
    'gpt-5.4':      { inputPerMTok, outputPerMTok, cachedInputDiscount: 0.5 },
    'gpt-5.4-mini': { /* same fields */ },
    'gpt-5.4-nano': { /* same fields */ },
  },
} as const
```

Concrete rate values are filled from provider pricing pages when PR 1 is authored. Cost tests assert formula correctness against the table; pricing changes bump `_tableVersion`.

### 9.4 Cost helper updates

- `lib/ai/cost/anthropic-pricing.ts`: `computeAnthropicCostMicros(usage, model)` becomes cache-aware. Net cost = base `input * rate + output * rate + cache_creation * rate * 1.25 + cache_read * rate * 0.10`, with base-input token count excluding cache tokens.
- New `lib/ai/cost/openai-pricing.ts` (mirror shape): applies `cachedInputDiscount` to `prompt_tokens_details.cached_tokens`.

## 10. Testing

### 10.1 Test pyramid

```
Contract snapshots  (per-provider request body shapes)
      ↑
Golden transcripts  (cache-on vs cache-off semantic parity, including tool turns)
      ↑
Integration         (full generate() with mocked SDKs)
      ↑
Unit                (translators, key derivation, resolver, pricing)
```

No new Playwright coverage. Caching never crosses the browser; provider SDKs are mocked in E2E anyway.

### 10.2 Behavior-preservation goldens (the load-bearing guarantee)

`tests/golden/ai/` directory. Scenarios:

- `v3-runtime.test.ts` — multi-turn V3 with phase progression, **no** tool calls.
- `v3-tool-loop.test.ts` — V3 session where turn 1 calls one tool, receives a result, and iterates; turn 2 either emits text or calls a second tool. (Mandatory — this is the scenario that would have exposed the §7.3 bug.)
- `rag-pipeline.test.ts` — `ragQuery` with fixed retrieved context.
- `oneshot-*.test.ts` — one per one-shot caller.

Each scenario runs the same inputs twice against a record-replay mock of the provider SDK:

1. `cache.enabled = false` → record normalized request bodies per turn + response text + `toolCalls`.
2. `cache.enabled = true` → record the same.

Normalization strips cache metadata (`cache_control` blocks, `prompt_cache_key`, `anthropic-beta` headers, `usage` fields). Assertions:

- `normalize(cacheOn.request) === normalize(cacheOff.request)` byte-equal per turn.
- Cache-on request additionally contains `cache_control` / `prompt_cache_key`.
- `response.content` identical (temperature 0 in tests).
- `toolCalls` array deep-equal in order, name, arguments.
- Iteration count identical.
- Messages persisted to history identical.

### 10.3 Adapter unit tests

- `tests/unit/ai/providers/anthropic-native.test.ts`:
  - `system` + `breakpoints: ['system']` → cached system block.
  - `tools` + `breakpoints: ['tools']` → `cache_control` on last tool only; earlier tools unchanged.
  - Round-trip: prior `tool_use` → subsequent `tool_result` with matching `tool_use_id`.
  - Two-tool parallel case: single assistant message with two `tool_use` blocks; subsequent user message carries two `tool_result` blocks in matching order.
  - Response parse: mixed text + `tool_use` blocks → router `content` + `toolCalls`.
  - Usage fields → `CacheUsage.reads/writes/hit`.
- `tests/unit/ai/providers/anthropic.test.ts`:
  - `cache.enabled = false` → native SDK never touched (shim branch).
  - `cache.enabled = true` → shim never touched (native branch).
  - Shim branch also supports new `RouterMessage.tool_calls` field (translates to OpenAI-shape).
- `tests/unit/ai/providers/openai.test.ts`:
  - `cache.enabled = true` + caller key → `prompt_cache_key` in request.
  - `cache.enabled = true` + no caller key → `prompt_cache_key = identityKey`.
  - `cache.enabled = false` → no `prompt_cache_key`.
  - Cached tokens extracted from usage.
- `tests/unit/ai/providers/{google,perplexity}.test.ts`:
  - `cache` input ignored; `supported: false`.
  - Messages containing `tool_calls` → `UnsupportedOperationError`.

### 10.4 Cache resolution semantics

`tests/unit/ai/providers/cache-resolve.test.ts`:

| Scenario | Expected |
|---|---|
| `prompt_cache_enabled=true`, caller `enabled: true` | `enabled: true`, `disabledReason: 'none'` |
| `prompt_cache_enabled=false`, caller `enabled: true` | `enabled: false`, `disabledReason: 'global_kill_switch'` |
| `prompt_cache_enabled=true`, caller `enabled: false` | `enabled: false`, `disabledReason: 'request_disabled'` |
| Caller omits `cache` entirely | `enabled: false`, `disabledReason: 'request_disabled'` |
| Google provider, `enabled: true` | `enabled: true`, `supported: false`, `disabledReason: 'none'`, `hit: 'unsupported'` |
| `ttlSeconds: 600` | `effectiveTtlSeconds: 300`, warning exactly once per process |
| `ttlSeconds: 300` | `effectiveTtlSeconds: 300`, no warning |
| `ttlSeconds: 120` | `effectiveTtlSeconds: 120`, no warning |

### 10.5 Identity key stability

`tests/unit/ai/providers/cache-key.test.ts`:

- Same logical input, shuffled object key order → same key.
- Reordered `tools` → different key (order is semantic).
- Reordered `messages` → same key (messages excluded).
- Caller-provided `cache.key` passed to OpenAI adapter; `identityKey` still logged.
- Output is 64-char hex.

### 10.6 Cost accounting

`tests/unit/ai/cost/anthropic-pricing.test.ts`:

- Given `usage = { input: 1000, output: 500, cache_creation: 800, cache_read: 400 }` and `PRICING_V1.anthropic['claude-opus-4-6']`, assert computed cost matches `(input - cache_creation - cache_read) * inputRate + cache_creation * inputRate * 1.25 + cache_read * inputRate * 0.10 + output * outputRate`, using table values (no hardcoded numbers in test prose).
- Zero cache fields → cost equals the pre-PR-1 formula (no regression).

`tests/unit/ai/cost/openai-pricing.test.ts`:
- `prompt_tokens_details.cached_tokens = N` → input cost reduced by `N * cachedInputDiscount`.

### 10.7 Contract snapshot tests

`tests/contract/ai/providers/*.snap`:

For a canonical tuple `(system: "…", messages: […with one tool round-trip…], tools: […], cache: {…})`, snapshot the exact request body sent to each SDK `messages.create` / `chat.completions.create`. Covered combinations:

- Anthropic native (cache on).
- Anthropic shim (cache off — including the new `tool_calls` field passthrough).
- OpenAI (cache on, cache off).
- Google / Perplexity (cache ignored; no `tool_calls` in messages).
- Google / Perplexity with `tool_calls` in messages → `UnsupportedOperationError` thrown.

Snapshot failure = wire shape drift. Manual review required to update.

### 10.8 Per-PR acceptance criteria

| PR | Gate |
|---|---|
| 1 — Router contract + message shape + telemetry + cost + translator | All §10 tests pass. Staging: run one V3 session; assert no `cache_control` in request bodies (no caller opts in), `cache.requested=false` in telemetry. |
| 2 — V3 adopts cache | PR 0 V3 prompt audit signed off. `v3-runtime` + `v3-tool-loop` goldens pass. Production canary per §11.5. |
| 3 — RAG adopts cache | RAG prompt audit signed off. `rag-pipeline` golden passes. Staging: CacheUsage emitted, no output drift, no errors. **Cache reads may be zero** if RAG system prompt is below provider minimums — not a blocker. |
| 4a-f — one-shots | Per-caller prompt audit signed off. Per-caller golden passes. Staging: CacheUsage emitted + no drift + no errors. Same best-effort posture on cache reads. |
| 5 — Managed model centralization | Existing Managed smoke tests pass; Managed cache telemetry unchanged; `resolveAgentModel({ task: 'managed_turn' })` returns sonnet. |

### 10.9 Out-of-scope for testing

- Real Anthropic / OpenAI API hits in CI. All provider SDKs mocked; wire shape reviewed via contract snapshots.
- Load / rate-limit tests. Caching reduces cost, not request count.

## 11. Rollout

### 11.1 PR sequencing

| PR | Scope | Est. | Blocking for |
|---|---|---|---|
| 0 | V3 system-prompt stability audit committed as `docs/runbooks/audits/v3-prompt-stability-2026-04.md` | 0.5d | PR 2 |
| 1 | Router contract (`CacheOptions`, `CacheUsage`, `RouterMessage`, `RouterToolCall`, `deriveIdentityKey`, canonical JSON) + `anthropic-native.ts` translator + V3 assistant-message push fix (§7.3) + adapter updates (shim `tool_calls` passthrough, OpenAI `prompt_cache_key`, Google/Perplexity `UnsupportedOperationError`) + telemetry + cost module + pricing table + all §10 tests | ~2w | PRs 2–5 |
| 2 | V3 opts in: `resolveAgentModel({ task: 'agent_turn' })` + `cache: { enabled: true, … }` + enable feature flag in production after canary | ~1w | — |
| 3 | RAG opts in via `aiGenerate()` with `task` + `cache` | ~3d | — |
| 4a–f | One-shot callers migrate (compliance → doc-analyzer → risk → discovery → deadline → stragglers) | ~2d each | — |
| 5 | Managed runtime model centralization + `ServiceContext.routingCtx` | ~3d | — |

### 11.2 Feature flag bootstrap

New migration `drizzle/NNNN_prompt_cache_flag.sql` (next free index per `meta/_journal.json`):

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

Seeded **false**. Enabled during PR 2 canary window (§11.5), not at deploy time.

Router reads via `isFeatureEnabled('prompt_cache_enabled', { bypassCache: true })` — the cache read happens on every `generate()` call, and the 60s LRU cache would otherwise delay an emergency disable.

### 11.3 Observability surfaces in v1

- Structured log `cache.*` object on every `generate()` call (§9.1).
- Prometheus counters (§9.2).
- **No Grafana dashboard.** Added later in Track 3 (observability/eval). Operational queries use the existing log aggregation tools.

### 11.4 Staging validation per PR

| PR | Staging check |
|---|---|
| 1 | One V3 session and one RAG query on staging. No behavior diff vs pre-PR-1. All callers log `cache.requested=false`. Zero `cache_control` in request bodies. |
| 2 | On staging: flip `prompt_cache_enabled = true` for the test window. Run a 5-turn V3 session; assert `cache_read_input_tokens > 0` from turn 2 onward and output matches a canned golden reply byte-for-byte. Flip back to `false` at end of window. (Production flag handling is §11.5.) |
| 3 | 10 `ragQuery` calls across `ro` + `en`. CacheUsage emitted, no output drift, no errors. Cache reads best-effort. |
| 4a–f | Per caller: one real invocation with known input. CacheUsage populated. No output drift. |
| 5 | Managed smoke: sonnet selected via routing; existing Managed cache telemetry unchanged. |

### 11.5 Production canary for PR 2

Native Anthropic transport is not transparent metadata. PR 2 rolls out as:

1. Deploy PR 2 with `prompt_cache_enabled = false` (no runtime behavior change — V3 paths still hit the shim).
2. Enable the flag in a controlled production window (low-traffic window; pre-arranged with operator).
3. Watch for 30–60 minutes: `/api/ai/agent` 5xx rate, P50/P99 latency, tool-loop error rate (`Tool timeout` in logs), `cache_read_input_tokens` trending.
4. Decision: keep enabled → proceed to PR 3; or disable and investigate.

Rollback lever during the window is a single flag flip. Code revert only if a bug is discovered post-window that the flag cannot shield.

### 11.6 Subsequent PR rollouts

PRs 3, 4a-f, 5 deploy with `prompt_cache_enabled` already on. Each PR runs a 48h post-deploy watch on `/api/ai/*` error rates and latency before the next PR merges.

## 12. Runbook (committed as `docs/runbooks/ai-caching.md`)

**Q: How do I turn caching off globally?**
`PATCH /api/v1/admin/feature-flags/prompt_cache_enabled { enabled: false }`. Effective on the next request — the router reads with `bypassCache: true`.

**Q: V3 output drifted after PR 2 — is caching to blame?**
1. Set `prompt_cache_enabled = false`. Replay the session. If drift persists → not caching; investigate V3 normally.
2. If drift stops → translator bug. Revert PR 2 or the offending code change. Reproduce against `anthropic-native.test.ts`.

**Q: Cache hit rate dropped to near-zero on V3.**
- Usually a system-prompt regression. Diff recent `lib/ai/agent/prompt.ts` commits; look for newly interpolated timestamps, UUIDs, user IDs, or request IDs in the cached prefix.
- Check `ai_cache_writes_tokens_total / ai_cache_reads_tokens_total` ratio. High writes + low reads = prompt churning per call.

**Q: Cost went up after ramp.**
- Check `ai_cache_writes_tokens_total`. Cache writes cost 1.25× base input — a churning prompt net-raises cost.
- Compare `PRICING_V1._tableVersion` against current provider pricing pages.

**Q: Anthropic native transport 4xx errors.**
- Verify §7.3 invariant: every `tool_result` pairs with a preceding assistant message containing the matching `tool_use`.
- Verify tool-list stability: if tools are reordered between turns, the `cache_control` on the last tool invalidates every call.

## 13. SLO targets (2-week baseline after PR 2 ships)

| Metric | Target | Action on miss |
|---|---|---|
| V3 cache hit rate on sessions ≥ 3 turns | ≥ 40% | Investigate prompt stability; no auto-rollback |
| RAG / one-shot cache reads | Best-effort; ≥ 0 | No action; reads may be zero if system prompt below provider minimums |
| P50 / P99 latency on `/api/ai/*` | No regression vs pre-PR-2 | Rollback trigger |
| 5xx rate on `/api/ai/*` | No regression vs pre-PR-2 | Rollback trigger |

RAG and one-shot cache thresholds are deliberately absent. Provider cache minimums (~1024 prompt-prefix tokens for Anthropic, similar for OpenAI) mean many of these system prompts won't trigger reads. The operational value of those PRs is the machinery being in place — V3 carries the cost benefit.

## 14. Risks

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| Translator bug in `anthropic-native.ts` mutates tool args or reorders blocks | Medium | V3 output drift | Golden tests (§10.2); PR 2 canary; flag rollback |
| V3 prompt audit misses a non-stable field | Medium | Zero caching benefit + 1.25× write cost | PR 0 audit doc; hit-rate monitoring; runbook §12 |
| PR 1 probe reveals pre-existing shim bug on tool turns | Medium | Latent bug with unknown customer impact | Fix in PR 1 (see §15 Q1 decision). Once `RouterMessage.tool_calls` exists, both cached and non-cached paths get the correct shape. |
| Google/Perplexity caller is currently passing tool-call history | Medium | Hard failure on a path that works today | PR 1 prerequisite audit (see §15 Q2 decision): grep callers of `generate()` and verify no `messages[].tool_calls` routes to Google/Perplexity today. Throw only after audit confirms no regression. |
| Parallel tool_calls in V3 break native Anthropic ordering | Low (V3 serializes tool execution today) | 4xx from Anthropic | Two-tool unit test in §10.3; ordering preserved by translator. No runtime cap added (see §15 Q3 decision). |
| Tool-call `id` collisions between OpenAI and Anthropic formats | Low | Round-trip failure | Preserve `id` verbatim; asserted in `anthropic-native.test.ts` |
| Cost regression from high-write / low-read pattern | Low | +10–25% Anthropic spend | Metric ratio alert via simple log query (runbook §12). Dashboards in Track 3. |
| Anthropic 5-min ephemeral cache evicts during quiet sessions | Expected | Cache miss on resumed sessions | Accepted v1 behavior. 1h extended cache is follow-up. |
| Cross-provider fallback carries Anthropic semantics into OpenAI | Low | OpenAI ignores unknown fields safely | Contract snapshot tests (§10.7) lock wire shape per provider |
| DB outage disables caching (fail-closed `prompt_cache_enabled`) | Low | Caching off during incident; not a correctness issue | Accepted — fail-closed is the correct behavior for a kill switch |

## 15. Open decisions resolved

**Q1 — Pre-existing OpenAI-compat shim bug on tool turns, if PR 1 probe finds one.**
**Resolution: fix in PR 1.** Once `RouterMessage.tool_calls` exists, both cached and non-cached paths receive the correct assistant tool-call history. Preserving the broken shape would leave two semantics in the router and make future debugging worse.

**Q2 — Google/Perplexity callers with tool-call history.**
**Resolution: audit as PR 1 prerequisite.** Concrete step: `rg "generate\(" lib/` and trace every call to confirm no Google/Perplexity call path can pass `messages[].tool_calls`. If one exists, either keep that path off tool-call history or route it to a supporting provider. `UnsupportedOperationError` is shipped only after the audit confirms zero production regression.

**Q3 — Parallel tool-call cap in V3.**
**Resolution: no cap in this spec.** Trust the translator; test the two-tool case. A runtime cap is a V3 behavior change outside the scope of prompt caching. If ordering breaks in practice, that becomes a separate V3 tool-loop correctness fix.

## 16. Decision log

| # | Decision | Rationale | Source |
|---|---|---|---|
| D1 | Router-level caching + V3/RAG/one-shot rollout + model centralization | V3 may live 6+ months; avoid Anthropic-only bake-in | Section 1 review |
| D2 | Google = capability plumbing only; explicit context caching is non-goal | Stateful create/reference/invalidate lifecycle is its own subsystem | Section 1 review |
| D3 | Single kill switch `prompt_cache_enabled`; caller-level `cache.enabled` | Avoid two allow-flags on the same decision | Section 2 review |
| D4 | Rollout order V3 → RAG → one-shots | V3 has the biggest stable prefix; RAG/one-shots may not clear provider minimums | Section 4 review |
| D5 | Anthropic cache path uses native SDK via a separate `anthropic-native.ts` module; OpenAI-compat shim remains for non-cache | Shim cannot express `cache_control`; isolating native translation keeps it independently testable | Section 3 review |
| D6 | Drop `messages_prefix` breakpoint in v1 | No stable message prefix in current call sites; underspecified given live conversation turns | Section 3 review |
| D7 | `RouterToolCall` matches OpenAI wire shape; `tool_calls?` added to `RouterMessage` | Native Anthropic needs `tool_use` / `tool_result` pairing; reduces translation loss | Section 5 review |
| D8 | V3 assistant-message push consolidated to one per iteration (in PR 1) | Current code has two branches; avoids duplicate push; fixes the missing-`tool_calls` latent bug | Section 5 review |
| D9 | Google/Perplexity throw `UnsupportedOperationError` when `tool_calls` present; no silent serialization | Prevents silent semantic drift | Section 5 review |
| D10 | `CacheUsage.disabledReason ∈ {global_kill_switch, request_disabled, none}`; provider-unsupported captured by `supported: false` | Cleaner semantics; no double-counting | Section 3 review |
| D11 | `CacheUsage.hit ∈ {read, miss, disabled, unsupported}` | `full`/`partial` are hard to define reliably in v1 | Section 3 review |
| D12 | `ttlSeconds > 300` silently clamped; `effectiveTtlSeconds` exposed in `CacheUsage`; warn-once-per-process | Noise control during rollout | Section 3 review |
| D13 | Identity key derived via canonical JSON (sorted object keys, stable tool shape); always computed and logged | OpenAI needs the key; telemetry correlation requires it on every call | Section 3 review |
| D14 | `aiGenerate.cache` uses the full `CacheOptions` shape with default `breakpoints: ['system']` | Avoids a second mini-contract | Section 4 review |
| D15 | One-shots use tier defaults in v1; no `routingCtx` threading into `aiGenerate` | User model preference is a V3 concern, not a caching-spec concern | Section 4 review |
| D16 | `ServiceContext.routingCtx` lands in PR 5 only | Non-blocking for PRs 1–4 | Section 4 review |
| D17 | PR 5 (Managed model centralization) stays in this spec, explicitly non-blocking | Convenient cleanup; not caching-critical | Section 4 review |
| D18 | Versioned pricing table `PRICING_V1` with `_tableVersion`; tests assert the formula against entries | Numbers change; formula shouldn't; prose-level percentages rot | Section 5 review |
| D19 | Golden tests compare normalized semantic request (cache metadata stripped), not only mocked output | Output-only diffs hide message-shape bugs | Section 5 review |
| D20 | No Grafana dashboard in PR 1 | Section 3 non-goal reiterated (Track 3 deliverable) | Section 6 review |
| D21 | Feature flag seeded `enabled: false`, enabled during PR 2 canary | Canary lever; avoids auto-on at deploy | Section 6 review |
| D22 | PR 2 production canary: deploy flag-off → enable controlled window → watch → keep or disable | Native transport is not harmless metadata | Section 6 review |
| D23 | Staging gates for PRs 3–4: CacheUsage emitted + no output drift + no errors; cache reads best-effort | Provider ~1024-token minimum may leave RAG/one-shot system prompts below threshold | Section 6 review |
| D24 | Q1: fix latent shim bug in PR 1 rather than preserve bug-for-bug | Two semantics in the router is worse than a focused fix | Section 7 review |
| D25 | Q2: audit Google/Perplexity callers as PR 1 prerequisite before shipping `UnsupportedOperationError` | Throwing on a path that works today would be a production regression | Section 7 review |
| D26 | Q3: no parallel-tool-call runtime cap in this spec | Cap is a V3 correctness concern, not a caching concern | Section 7 review |

## 17. Follow-up work (out of scope, mapped to successor specs)

- **Track 2 — Reranker + contextual retrieval**: Cohere / Voyage rerank after hybrid search; Anthropic contextual chunks for legal docs.
- **Track 3 — Eval harness + observability**: Langfuse or Braintrust; Grafana dashboards for caching and retrieval; cost budgets.
- **Track 4 — Knowledge surface integrations**: Obsidian → Qdrant sync with YAML metadata; NotebookLM as a curated-answer MCP fallback.
- **Track 5 — Continuous freshness pipeline**: scheduled crawler-engine runs; stale-source gating in retrieval.
- **Anthropic 1h extended cache**: evaluated after 5-min ephemeral baselines stabilize.
- **Gemini explicit context caching**: stateful create / reference / invalidate lifecycle; separate spec.
- **Managed runtime migration onto router**: requires router streaming support; separate design.
