# Google/Perplexity Tool-Call History Audit — 2026-04

**Purpose:** Before router adapters throw `UnsupportedOperationError` on Google/Perplexity calls that include `messages[].tool_calls`, confirm no production code path passes such history to either provider.

**Scope:** All `generate()` call sites under `app/src/` that dispatch through `app/src/lib/ai/providers/router.ts`. The legacy `createGatewayClient(...).generate(...)` path in `app/src/lib/ai/gateway.ts` bypasses the router entirely (it instantiates OpenAI-compatible clients directly per provider), so it is out of scope for Tasks 6 & 7 — those tasks modify `providers/google.ts` and `providers/perplexity.ts` only.

## Methodology

1. Grepped `generate\(|generate \(` under `app/src/` (`.ts`/`.tsx`, excluding `test` and `types.ts`).
2. Discarded matches that are not the router `generate()` function (JSZip `zip.generate()`, provider interface definitions, adapter implementations, router internals, retry helper).
3. For each remaining caller, traced:
   - How `provider` is resolved (hardcoded vs `resolveAgentModel({ task })` vs gateway).
   - How `messages` is constructed (single-turn user vs accumulated history).
   - Whether `messages[]` can ever carry tool-call history (assistant messages with `tool_calls` on them, or `role: 'tool'` follow-ups).

Fallback behavior from `app/src/lib/ai/providers/retry.ts` was also considered: on retry exhaustion, the router dispatches the original request to a fallback provider from `MODEL_CONFIGS[model].fallback`. If the original request contains tool history and the fallback resolves to Google/Perplexity, Tasks 6/7 would break that path. Fallback edges reviewed below.

## Call sites audited

One entry per router call site. `resolveAgentModel()` semantics come from `app/src/lib/ai/model-routing.ts` (task → tier → `ROUTING_DEFAULTS`).

- **`app/src/lib/ai/client.ts:36`** — `aiGenerate`. Provider resolves via `resolveAgentModel({ task: 'editing' })` → `standard` tier → default `anthropic` / `claude-sonnet-4-6`. `standard` is overridable; a user preference of `gemini-pro` / `gemini-flash` / `nano-banana` routes to Google when the `gemini-3-preview` feature flag is on. Messages: `[{role:'user', content: opts.prompt}]`. **No `tool_calls` ever constructed.** No `tools` passed.

- **`app/src/lib/ai/client.ts:83`** — `aiGenerateObject`. Provider resolves via `resolveAgentModel({ task: 'structure_extraction' })` → `budget` tier → `openai` / `gpt-5.4`. `budget` is NOT in `OVERRIDABLE_TIERS`, so user overrides are blocked (`tier_not_overridable`). Cannot hit Google or Perplexity. Messages: `[{role:'user', content: opts.prompt}]`. **No `tool_calls`.**

- **`app/src/lib/ai/agent/runtime.ts:162`** — V3 agent runtime. Provider is HARDCODED: `provider: 'anthropic'`, `model: 'claude-opus-4-6'`. `resolveAgentModel()` is NOT called at this site. The runtime is the ONLY caller that accumulates multi-turn `llmMessages` and feeds them back to the LLM (line 276 pushes `{role: 'tool', content, tool_call_id}` after each tool execution). It passes `tools` (line 167) but currently does NOT construct assistant messages with `tool_calls` on them (line 178 / 185 only push `{role: 'assistant', content}`). Task 24 will add `tool_calls` to assistant history. Because the target model is hardcoded to Anthropic, the only way this request could reach Google/Perplexity is via the router fallback: `MODEL_CONFIGS['claude-opus-4-6'].fallback = { provider: 'openai', model: 'gpt-5.4' }` — fallback is OpenAI, not Google or Perplexity. **Tool-call history cannot reach Google/Perplexity from this site.**

- **`app/src/lib/ai/agent/services/freshness.ts:60`** — `refreshCallFreshness`. Provider resolves via `resolveAgentModel({ task: 'freshness_check' })` → `research` tier → `perplexity` / `sonar-pro` (research tier is hard-pinned to Perplexity; `resolveAgentModel` throws if the provider isn't Perplexity). Messages: single-turn `[{role:'user', content: '…Call: …'}]`. **No `tools` passed. No `tool_calls`.** Can hit Perplexity, but sends zero tool history.

- **`app/src/lib/ai/agent/tools/extract-structure.ts:47`** — `extract_structure` tool. Provider resolves via `resolveAgentModel({ task: 'structure_extraction' })` → `budget` tier → `openai` / `gpt-5.4`. Not overridable. Messages: single-turn user. **No `tool_calls`.**

- **`app/src/lib/ai/agent/tools/resolve-call.ts:65`** — `resolve_call` tool. Same routing as above (`structure_extraction` → budget → OpenAI, not overridable). Messages: single-turn user. **No `tool_calls`.**

- **`app/src/lib/ai/agent/tools/generate-section.ts:169`** — `generate_section` tool. Provider resolves via `resolveAgentModel({ task: 'section_generation', importance })` → `critical` / `standard` / `budget` tier. `standard` is overridable to Google (`gemini-pro`, `gemini-flash`, `nano-banana`) with the `gemini-3-preview` flag. Messages: single-turn `[{role:'user', content:'Generate the "…" section now.'}]`. **No `tools` passed. No `tool_calls`.**

- **`app/src/lib/ai/agent/tools/regenerate-section.ts:82`** — `regenerate_section` tool. Same routing as `generate_section`; escalation after N retries forces `critical` tier (Anthropic Opus). Messages: single-turn user. **No `tool_calls`.**

### Non-router paths (out of scope, noted for completeness)

- **`app/src/lib/discovery/pipeline.ts:72`** — Uses `createGatewayClient(...).generate(...)` from `app/src/lib/ai/gateway.ts`, not the router. The gateway has its own set of OpenAI-compatible clients and its own fallback table (`FALLBACK_PROVIDER`). Tasks 6/7 modify `providers/google.ts` and `providers/perplexity.ts`, which the gateway does NOT import. This site is unaffected regardless.

## Router fallback edges (from `types.ts` `MODEL_CONFIGS`)

Edges where the FALLBACK resolves to Google or Perplexity:

- `gpt-5.4-nano` → fallback `google` / `gemini-3-flash`.
- `sonar` → fallback `google` / `gemini-3-flash`.
- `sonar-pro` → fallback `google` / `gemini-3-flash`.

Of the call sites above, none currently routes to `gpt-5.4-nano`, `sonar`, or `sonar-pro` WITH tool-call history. The only site that carries history (`runtime.ts`) hardcodes Anthropic Opus (fallback OpenAI). Freshness/research uses `sonar-pro` but sends single-turn messages. Section generation with Google override carries single-turn messages. **No fallback edge currently carries `tool_calls` into Google or Perplexity.**

## Findings

- [x] Zero call sites route tool-call history to Google.
- [x] Zero call sites route tool-call history to Perplexity.
- [x] Action: `UnsupportedOperationError` can be safely added in Tasks 6 & 7.

No site constructs `messages[].tool_calls` today. The single multi-turn caller (V3 runtime) hardcodes Anthropic and falls back to OpenAI. The `discovery/pipeline.ts` Perplexity call site is on the gateway path, which bypasses the router adapters entirely. Tasks 6 & 7 are safe to land.

## Guardrails for future work

- **Task 24** (V3 runtime: push `tool_calls` onto assistant history): keep the hardcoded Anthropic target, or add an explicit assertion that the resolved provider is Anthropic before pushing tool-call history. If the hardcode is later replaced by `resolveAgentModel`, ensure the routing tier is not reachable by a Google/Perplexity override.
- **New tool-using callers**: any future `generate()` caller that passes `tools` AND accumulates assistant `tool_calls` / `role:'tool'` messages MUST route to Anthropic or OpenAI only. If it can resolve to Google/Perplexity, the router will throw `UnsupportedOperationError` after Tasks 6/7.
- **New fallback edges**: if a future `MODEL_CONFIGS` entry adds a Google/Perplexity fallback for a model that tool-using callers can target (e.g., adding a Google fallback to `claude-opus-4-6`), re-audit before shipping.
