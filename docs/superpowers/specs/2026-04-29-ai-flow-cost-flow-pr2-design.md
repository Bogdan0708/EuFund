# AI Flow Cost & Flow Cleanup — PR2 Design

**Date:** 2026-04-29
**Scope:** Managed runtime preselect bootstrap, provider router, V3 route idempotency. No DB migrations, no new constraints, no SSE shape changes.
**Sibling spec:** PR1 (`2026-04-29-ai-flow-stability-pr1-design.md`). Land PR1 first; PR2 depends on PR1's reload-after-write contract being in place but does not extend it.

## Problem

The 2026-04-29 AI flow audit found three cost/correctness defects that aren't user-visible but burn money and leave gaps in idempotency:

1. **Triple Qdrant retrieval per cold preselect session.** `preselect.initializeSession` calls `lookupBlueprint` which on cache miss runs a Qdrant search and returns `rawEvidence`. The result is discarded (`preselect.ts:128`). The session is created with `phase = 'research'`, and the system prompt then tells the model to call `get_call_blueprint` AND `retrieve_evidence`, both of which hit Qdrant for the same `callId`. Because `save_call_blueprint` is in `PHASE_4_BLOCKED_TOOL_NAMES` (`executor.ts:78`), the extracted blueprint is never persisted — every cold session for the same call repeats the dance.

2. **Stacked retry layers with uncancelled SDK calls.** `aiGenerate` and `aiGenerateObject` (`client.ts:33,80`) wrap `generate` in `withRetry` from `@/lib/errors` (3 retries, exponential backoff). `generate` calls `withRetry` from `providers/retry.ts` (1 immediate retry on 5xx, then fallback). Then the SDK retries internally. Worst-case nesting is ~36 HTTP calls per request. `providers/retry.ts:17-26` aborts via `Promise.race` but never wires `AbortSignal` into `provider.generate`, so the original SDK call keeps running — both primary and fallback can complete and we pay for both. The `serviceUnavailable` wrapping in `client.ts:50` masks original status codes, defeating retry classification.

3. **V3 lacks turn-claim idempotency and sequence-number race protection.** The route only calls `claimTurn` on the managed branch (`route.ts:266`). All three V3 entry paths (managed auth setup throw, breaker open, managed-disabled/structured-action/fallthrough) reach `runAgentTurn` with no `request_id` dedup. Plus, V3's `appendMessage` (`history.ts:59`) lacks the retry-once-on-PG-23505 logic that `appendManagedMessage` has — concurrent intra-session writers can fail unrecoverably mid-turn. Structured actions (the highest-stakes V3 path per the audit) run on the lower-safety runtime.

PR2 fixes all three. The theme: delete more than we add.

## Non-goals

- Anything from PR1: managed reload-after-write (B), workspace busy gate (C), iteration-cap persistence (F1), tool error localization (F2). PR1 lands first.
- V3 deferred-persistence pattern (mirroring managed's `firstOutputPersisted` semantics). Out of scope — D explicitly preserves V3's immediate-append flow to keep blast radius tight.
- Shared runtime base class between managed and V3.
- Other Phase 4 tools (`create_export_snapshot`). Only `save_call_blueprint` is unblocked.
- New SSE event shape, new DB columns, new uniqueness constraints. PR2 is purely behavioral.

## Architecture

Three independent items. Each touches a small, isolated surface:

| Item | Files touched |
|---|---|
| A — Collapse cache-miss research dance | `app/src/lib/ai/agent/services/preselect.ts`, `app/src/lib/ai/agent/services/blueprint.ts` (new helper), `app/src/lib/ai/agent/managed/runtime.ts`, `app/src/lib/ai/agent/managed/prompt.ts`, `app/src/lib/ai/agent/managed/tools.ts`, `app/src/lib/ai/agent/managed/executor.ts`, `app/src/lib/ai/agent/mcp/write/save-call-blueprint.ts` |
| E — One retry/fallback layer | `app/src/lib/ai/client.ts`, `app/src/lib/ai/providers/retry.ts`, `app/src/lib/ai/providers/types.ts` (signal wiring), `app/src/lib/ai/providers/{openai,anthropic,google,perplexity}.ts` (signal pass-through) |
| D — V3 turn-claim + appendMessage retry | `app/src/app/api/ai/agent/route.ts`, `app/src/lib/ai/agent/runtime.ts`, `app/src/lib/ai/agent/history.ts` |

### A — Collapse the cache-miss research dance

**1. Stash `rawEvidence` in `planningArtifact.preselect`.**

`PreselectArtifactV1` gains an optional field. No version bump (additive, non-breaking):

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
  rawEvidence?: EvidenceChunk[]  // NEW — present when blueprintKind === 'raw_evidence'
}
```

In `preselect.ts:120-129`, replace the `if (result.cached) ... else { blueprintKind = 'raw_evidence' }` block to stash the chunks instead of discarding:

```ts
if (result.cached) {
  blueprintKind = 'structured'
  blueprintPayload = result.blueprint
} else {
  blueprintKind = 'raw_evidence'
  // Top-15 cap is enforced HERE so the invariant stays local. lookupBlueprint
  // returns up to 20 chunks; we slice to 15 to match retrieve_evidence's
  // default maxChunks (the model's expected envelope shape on injection).
  rawEvidenceForArtifact = (result.rawEvidence ?? []).slice(0, 15)
}
```

The artifact constructor at `preselect.ts:142` includes `rawEvidence: rawEvidenceForArtifact` when present.

**2. First-turn synthetic injection in `runManagedTurn`.**

In `managed/runtime.ts`, after `loadManagedHistory` returns and BEFORE the current user message is pushed into `history`, gate on:

- `phase === 'research'`
- `session.selectedCallId` is set
- `planningArtifact.preselect?.rawEvidence` is non-empty
- `session.blueprint` is null (no blueprint already persisted — this is the cold-start condition)

When all true, push a synthetic assistant `tool_use` + user `tool_result` pair into `history` (not `runningMessages`) so the synthetic pair lands BEFORE the current user message in the resulting `runningMessages` array. NOT persisted to `agent_messages`; in-memory only. Unique synthetic id: `preselect_evidence_${turnId}` (deterministic per turn, unique per session).

**Insertion point:** at `runtime.ts:142-148`, between the `loadManagedHistory` call and the `if (request.message) history.push(...)` block. After both steps run, `runningMessages = [...history]` contains: `[...prior history (empty on first turn), synthetic_assistant_tool_use, synthetic_user_tool_result, current_user_message]`.

```ts
// Pseudocode — runs AFTER loadManagedHistory, BEFORE the user-message push
const { messages: history, systemSummary } = await loadManagedHistory(session.id)

const preselectArtifact = (session.planningArtifact as { preselect?: PreselectArtifactV1 } | null)?.preselect
const shouldInject =
  session.currentPhase === 'research' &&
  session.selectedCallId !== null &&
  preselectArtifact?.rawEvidence !== undefined &&
  preselectArtifact.rawEvidence.length > 0 &&
  session.blueprint === null

if (shouldInject) {
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
        chunks: preselectArtifact.rawEvidence,
        totalChunks: preselectArtifact.rawEvidence.length,
        retrievedAt: preselectArtifact.rankedAt,
      }),
      is_error: false,
    }],
  })
}

// Existing block — unchanged
if (request.message) {
  history.push({ role: 'user', content: request.message })
}
```

The system prompt is unchanged structurally — its cache_control breakpoint survives because the prompt text is identical across cold sessions for the same phase. Only `history` (and downstream `runningMessages`) carries per-session evidence, which was always uncached.

**3. Prompt change — split research-phase bootstrap into two branches.**

A single additive note is not enough: the existing research-phase block (`prompt.ts:91-97`, both Ro/En) explicitly tells the model to call BOTH `get_call_blueprint` AND `retrieve_evidence`. Adding "if a result is present, use it" leaves the model free to call those tools anyway, which would re-hit Qdrant and defeat the cost goal.

Replace the block with two mutually-exclusive branches selected by session state inside `buildManagedSystemPrompt` (no new function parameter — the prompt builder already receives `session`):

- **Branch 3a — preselect with injected evidence** (when `phase === 'research'` AND `selectedCallId` AND `planningArtifact?.preselect?.rawEvidence?.length > 0` AND `!session.blueprint`):

  > Romanian: "Apelul {selectedCallId} a fost deja selectat prin preselectare deterministă. Rezultatul `retrieve_evidence` este deja prezent în istoricul conversației — NU apela `get_call_blueprint` și NU apela `retrieve_evidence`. Convertește rezultatul existent într-un blueprint structurat și apelează `save_call_blueprint` cu `structureConfidence` ≥ 0.4 numai dacă blueprint-ul este bine susținut de dovezi."

  English equivalent. Names of fields and tools stay in English (they're identifiers, not prose).

- **Branch 3b — preselect without injected evidence** (cache miss + `lookupBlueprint` failure path; rare): the existing block stands as-is. Model uses `get_call_blueprint` and `retrieve_evidence` to fetch evidence directly. This path remains a fallback for when preselect couldn't stash anything.

The branch selector lives in `prompt.ts`. The runtime does not need to pass any new flag — the same session fields that drive injection in step 2 also drive the prompt branch in step 3, ensuring perfect consistency between "what's in history" and "what the prompt tells the model to do".

**Field name correctness.** Both branches use `structureConfidence`. This MUST match the actual MCP tool schema (`save-call-blueprint.ts:26` defines `structureConfidence: z.number().optional()` — there is no `confidence` field). If the prompt instructed the model to set `confidence`, the schema would reject it (or silently drop it via Zod's optional handling) and the service-side default of `0.3` would apply (`save-call-blueprint.ts:55` and `blueprint.ts:163`), making every persist a cache-miss. The prompt MUST use `structureConfidence`.

**4. Unblock `save_call_blueprint` and wire it into the managed tool surface.**

The MCP file `mcp/write/save-call-blueprint.ts` already exists, but it does NOT export its `inputShape` and the tool is not registered in `MANAGED_TOOLS`. Plumbing required:

In `mcp/write/save-call-blueprint.ts`:
- Change `const inputShape = {...}` to `export const inputShape = {...}` (mirrors the pattern other MCP write files use).
- Add `export const inputSchema = z.object(inputShape)` at module level (mirrors `save-section-draft.ts` etc.).

In `managed/tools.ts`:
- Add the import: `import { inputSchema as saveCallBlueprintSchema } from '../mcp/write/save-call-blueprint'`.
- Add a `Tool` entry to `MANAGED_TOOLS` with name `'save_call_blueprint'`, the description from the MCP registration, and `input_schema: zodToJsonSchema(saveCallBlueprintSchema)` (or whatever the existing pattern is — match the other writes).
- Remove `'save_call_blueprint'` from `PHASE_4_BLOCKED_TOOL_NAMES`.
- Add `'save_call_blueprint'` to `WRITE_TOOL_NAMES`.

In `managed/executor.ts:dispatchTool`:
- Add a case for `save_call_blueprint`. Validate input against `saveCallBlueprintSchema`. Call the existing `saveCallBlueprint` service (`blueprint.ts:142`).
- After the service call succeeds (it writes to `call_knowledge` only), **also update `agent_sessions.blueprint`** with the structured payload from `args.blueprint`. Without this update, `session.blueprint` would never become non-null after a save, and the injection skip condition (`!session.blueprint` in step 2) would never trigger on subsequent turns. See "5. Session-blueprint write-back" below.
- The write rollout flag (`managed_agent_writes_enabled`) and the parallel-write cap apply automatically because the tool is in `WRITE_TOOL_NAMES`.
- No narrow-context gating (research-phase only) — `ServiceContext` lacks the session state needed to enforce that without a separate DB read; rely on rollout flag + parallel-write cap. Confidence threshold provides the data-quality gate.

**5. Session-blueprint write-back, phase advancement, stateVersion bump.**

`saveCallBlueprint` writes to `call_knowledge` (the global cache) but NOT to `agent_sessions` (the session's local state). Three pieces must update on the session row when `save_call_blueprint` succeeds in a research-phase preselect context:

1. **`blueprint`** — the full normalized `CallBlueprint` shape, NOT raw `args.blueprint`. The schema field at `save-call-blueprint.ts:20-29` is partial (fields like `evaluationGrid`, `cofinancingRate`, `verifiedAt`, `raw`, `normalized` are constructed by the MCP handler at `save-call-blueprint.ts:39-56` to satisfy the `CallBlueprint` type). Persisting the raw partial input would write a shape that doesn't satisfy `AgentSession.blueprint: CallBlueprint | null`, breaking downstream consumers.

   **Refactor:** extract the blueprint-building logic from `save-call-blueprint.ts:39-56` into a shared helper in `services/blueprint.ts`, e.g., `buildCallBlueprintFromArgs(args, ctx): CallBlueprint`. Both the MCP handler and the managed executor call this helper. The result is what gets passed to `saveCallBlueprint(...)` AND persisted into `agent_sessions.blueprint`.

2. **`currentPhase`** — advance from `'research'` to `'structuring'` when the session is in research with a selected call. Without this, the next turn re-enters the research bootstrap (synthetic injection skipped because blueprint is set, but prompt still says research), confusing the model. The phase advancement is the natural next state.

3. **`stateVersion`** — bump by 1. Phase change is UI-visible state; PR1's reload-after-write surfaces the new phase to the client, and the next request must carry the new `stateVersion` for CAS to pass. The MCP file's comment at `save-call-blueprint.ts:4` ("idempotent by callId — no stateVersion guard needed") refers to the tool NOT requiring `expectedStateVersion` as INPUT, not to the OUTPUT being state-neutral. With phase advancement, the output is state-changing, so we bump.

In the executor's `save_call_blueprint` handler, after `saveCallBlueprint` returns success:

```ts
const blueprint: CallBlueprint = buildCallBlueprintFromArgs(args, ctx)
const result = await saveCallBlueprint(ctx, args.callId, blueprint)

// Session-row write-back. Conditional on currentPhase === 'research' so
// repeat calls in later phases don't accidentally rewind state. The
// callId guard ensures we only advance when the persisted blueprint
// matches the session's selected call.
await db.update(agentSessions)
  .set({
    blueprint: blueprint,
    currentPhase: 'structuring',
    stateVersion: sql`${agentSessions.stateVersion} + 1`,
    updatedAt: new Date(),
  })
  .where(and(
    eq(agentSessions.id, ctx.sessionId),
    eq(agentSessions.currentPhase, 'research'),
    eq(agentSessions.selectedCallId, args.callId),
  ))
```

The conditional WHERE makes the operation safe under repeated calls: if the session has already moved past research (e.g., the model called save_call_blueprint twice or a different turn already advanced phase), the second update is a no-op rather than a phase rewind. PR1's reload-after-write fires (tool is in `WRITE_TOOL_NAMES`); the reloaded session row reflects the new phase, blueprint, and stateVersion — UI sees all three changes on `done.finalState`.

**Concurrency.** No CAS conflict possible within the same turn because the parallel-write cap blocks a second concurrent write. Across turns, the bumped stateVersion is what PR1's CAS guards against — the next request from the client will carry the fresh stateVersion (delivered via `done.finalState`).

**6. Confidence rule.**

- Prompt instructs model to set `structureConfidence ≥ 0.4` only when the extracted blueprint is meaningfully supported by the evidence.
- Service-side: `saveCallBlueprint` persists regardless of confidence (existing behavior). `lookupBlueprint:62` already gates cache eligibility at `structureConfidence >= 0.4`. Below threshold → row exists with status `provisional`, future `lookupBlueprint` returns cache miss, no regression.
- No new validation. The threshold is the natural data-quality gate.

**7. Subsequent-turn skip.**

The injection condition includes `!session.blueprint`. Once `save_call_blueprint` runs successfully and the executor's session-blueprint write-back persists the structured payload, the next turn's loaded session row has `session.blueprint` non-null, so injection skips. `rawEvidence` stays in `planningArtifact.preselect` indefinitely — harmless (a few KB of jsonb), no active clearing.

### E — One retry/fallback layer with proper cancellation

**1. Delete the outer `withRetry` wrapping in `client.ts`.**

`aiGenerate` (`client.ts:33-54`) and `aiGenerateObject` (`client.ts:80-103`) currently wrap `generate` in `withRetry` from `@/lib/errors`. Remove that wrapping. Keep the `CircuitBreaker.execute` wrapping (different concern — protects against sustained failures, not retries).

`aiEmbed` (`client.ts:125-143`) similarly drops its outer `withRetry`. The OpenAI SDK has internal retries; we don't need a second layer.

Also remove the `try/catch` blocks at lines 49-52, 98-101, and 138-141 that wrap any provider error as `Errors.serviceUnavailable(...)`. The classifier in `providers/retry.ts` needs the original error to decide retryability.

**2. Rewrite `providers/retry.ts`.**

Drop the same-provider retry. Surviving path: timeout-bounded primary call → if classifier says retryable, fallback → throw.

```ts
// providers/retry.ts (post-PR2)

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 500, 502, 503, 504])

interface ErrorWithStatus { status?: number; code?: string; name?: string; message?: string }

function isRetryable(err: unknown, internalTimeout: boolean): boolean {
  // Internal-timeout abort: WE aborted because OUR timer fired.
  // This is a transient condition on the upstream provider — fallback is appropriate.
  if (internalTimeout) return true

  // External abort (caller cancelled, browser tab closed, upstream request cancelled).
  // The caller's signal is aborted but our internal timer did NOT fire.
  // Do NOT fallback — the user no longer wants the response. Throw through.
  if (err instanceof Error && err.name === 'AbortError') {
    return false
  }

  const e = err as ErrorWithStatus
  if (typeof e.status === 'number' && RETRYABLE_HTTP_STATUS.has(e.status)) return true

  // Network-level failures — node-fetch / undici / SDK transports
  if (e.code === 'ECONNRESET' || e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT' || e.code === 'EAI_AGAIN') return true

  return false
}

export async function withRetry(
  fn: (signal: AbortSignal) => Promise<GenerateResult>,
  config: ModelConfig,
  providers: Record<ProviderName, ProviderClient>,
  originalRequest?: GenerateRequest,
): Promise<GenerateResult> {
  // Primary attempt: own controller, our timeout.
  const primaryController = new AbortController()
  let internalTimeoutFired = false
  const primaryTimer = setTimeout(() => {
    internalTimeoutFired = true
    primaryController.abort()
  }, config.timeout)

  try {
    return await fn(primaryController.signal)
  } catch (primaryErr) {
    clearTimeout(primaryTimer)

    if (!isRetryable(primaryErr, internalTimeoutFired)) throw primaryErr
    if (!config.fallback || !originalRequest) throw primaryErr

    // Fallback: fresh controller, fresh timeout. Old aborted signal is NOT reused.
    const fallbackController = new AbortController()
    const fallbackTimer = setTimeout(() => fallbackController.abort(), config.timeout)
    try {
      const fallbackProvider = providers[config.fallback.provider]
      return await fallbackProvider.generate(
        { ...originalRequest, provider: config.fallback.provider, model: config.fallback.model },
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

**3. Thread `AbortSignal` through provider clients.**

`providers/types.ts` — `ProviderClient.generate` signature gains a second optional parameter:

```ts
interface ProviderClient {
  generate(req: GenerateRequest & { provider: ProviderName }, signal?: AbortSignal): Promise<GenerateResult>
  embed?(text: string, signal?: AbortSignal): Promise<number[]>
}
```

Each provider adapter (`openai.ts`, `anthropic.ts`, `google.ts`, `perplexity.ts`) accepts `signal` and passes it through to the SDK. Both `@anthropic-ai/sdk` and `openai` accept `{ signal }` on request options as the second argument:

```ts
// openai.ts (illustrative)
const response = await client.chat.completions.create(
  { model, messages, temperature, max_tokens },
  { signal },  // <- new
)
```

Existing adapters that don't yet accept signal must be updated. Native streaming paths (`anthropic-native.ts` for cache support) need the same treatment.

**4. Internal-timeout vs external-abort distinction.**

The `internalTimeoutFired` flag (set inside the primary `setTimeout` callback) is the source of truth for whether the abort was OUR doing. If the SDK throws AbortError without `internalTimeoutFired` being true, the caller's signal aborted upstream — we don't fallback, we throw through. This is the precision point that prevents "timeout → instant abort → throw" when an upstream cancellation arrives mid-flight.

Note: `router.generate` does NOT currently take an external `AbortSignal`. PR2 does not introduce one — there's no caller threading a signal in. This means `internalTimeoutFired` is the only abort source today. The classifier still distinguishes for correctness because future callers (e.g., a streaming endpoint that observes client disconnect) WILL want to thread their signal through, and the classifier then handles it correctly. Defense in depth.

### D — V3 turn-claim and appendMessage retry-once

**1. Route-level claim for all V3 paths.**

Three V3 entry paths in `route.ts`. Each gains a `claimTurn(... runtimeMode: 'v3')` call before `runV3WithSSE`:

| Path | Current line | Claim site |
|---|---|---|
| Managed enabled, auth setup throws | `route.ts:258` | Insert before `return runV3WithSSE(...)` at line 258 |
| Managed enabled, breaker open | `route.ts:294-305` | Insert before the `runV3WithSSE` fallback after the `MANAGED_UNAVAILABLE` 503 short-circuit |
| Managed disabled / structured action / final fallthrough | `route.ts:328` | Insert before `return runV3WithSSE(...)` at line 328 |

A small helper avoids triplicating the claim+conflict-handling code:

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
          messageRo: 'Cerere deja înregistrată. Dacă ai reîncercat, operațiunea a fost deja salvată.',
          messageEn: 'Request already recorded. If this was a retry, the operation has already been saved.',
        },
      }, { status: 409 }),
    }
  }
  return { kind: 'claimed', turnId: claim.turnId }
}
```

The error envelope is byte-identical to managed's existing 409 (`route.ts:272-285`). Clients see the same shape regardless of which runtime served the request.

**2. `runV3WithSSE` accepts `turnId` and marks completion on success.**

Signature change:

```ts
function runV3WithSSE(
  session: AgentSession,
  sections: AgentSection[],
  body: AgentRequest,
  user: { id: string },
  turnId: string,  // NEW
): Response
```

Threaded into `runAgentTurn` via `RuntimeOptions.turnId`.

**Completion marker — must be called BEFORE the `done` event is emitted.**

V3 currently has no `markTurnCompleted` call. With PR2 creating `agent_turns` rows for V3 paths, every successful V3 turn would leave `completed_at = null`, polluting the abandoned-turn reconciliation queries.

**Critical ordering constraint:** `runAgentTurn` emits the `done` event from INSIDE the function (`runtime.ts:402-404` and `runtime.ts:111-114` for the `skipLLM=true` terminal action path) before returning to the caller. Calling `markTurnCompleted` from `runV3WithSSE` AFTER `runAgentTurn` resolves is too late — the client has already received `done` and considers the turn complete. If `markTurnCompleted` then fails, the turn shows complete to the client but has `completedAt = null` in DB, which the reconciliation cron cannot distinguish from an abandoned/in-flight turn.

**Fix:** move the `markTurnCompleted` call INTO `runAgentTurn`, immediately before each `done` emit site. This matches managed's pattern (`managed/runtime.ts:393-401, 418` — markTurnCompleted runs at line 394, done is emitted at line 418).

Two `done` emit sites exist in `runAgentTurn`. Both need a `markTurnCompleted` call immediately preceding them:

```ts
// Site 1 — terminal action path (runtime.ts:111-114)
if (actionResult.skipLLM) {
  await markTurnCompleted(opts.turnId, EMPTY_TELEMETRY)  // NEW
  emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
  emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
  return { session, sections }
}

// Site 2 — end-of-turn path (runtime.ts:402-404)
// after compactIfNeeded
await markTurnCompleted(opts.turnId, EMPTY_TELEMETRY)  // NEW
emit({ type: 'state_update', patch: buildStatePatch(session, sections) })
emit({ type: 'done', finalState: buildUISnapshot(session, sections) })
```

Where `EMPTY_TELEMETRY` is:

```ts
const EMPTY_TELEMETRY = {
  // V3 doesn't track per-turn token usage or cost the way managed does.
  // Pass empty telemetry — completedAt is the only field that matters.
  model: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  costUsdMicros: null,
} as const
```

If `markTurnCompleted` throws, the existing `runAgentTurn` `try/catch` (line 407-414) catches it, emits an `error` event, and re-throws — the client sees an error event instead of `done`, and `completedAt` stays null. That's the correct semantic: no done means "we don't claim this turn is complete". `runV3WithSSE` does NOT need its own `markTurnCompleted` call — the runtime owns it.

The V3 catch branch (existing) does NOT call `markTurnCompleted` — failed turns leave `completed_at = null`, which is what the reconciliation cron expects to see for abandoned/failed turns.

**3. `runAgentTurn` threads `turnId` to all `appendMessage` calls.**

`RuntimeOptions` gains `turnId: string`. Every call site in `runtime.ts` that calls `appendMessage` passes the turn id:
- User message append at line 65-77 (text or structured_action)
- Assistant text append at line 222-226
- Assistant tool_call append at line 302-308
- Tool result append at line 309-315

**4. `appendMessage` accepts `turnId?` and retries-once on PG 23505.**

Updated signature in `history.ts:59`:

```ts
export async function appendMessage(
  sessionId: string,
  message: {
    role: string
    messageType: string
    content: unknown
    toolName?: string
    toolCallId?: string
    turnId?: string | null  // NEW — required from route-driven path, optional/null from tests
  },
): Promise<number>
```

Body wrapped in retry-once-on-23505 mirroring `managed/history.ts:199-232`:

```ts
for (let attempt = 0; attempt < 2; attempt++) {
  const [last] = await db.select().from(agentMessages)
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
      turnId: message.turnId ?? null,  // NEW
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
```

Existing callers that don't pass `turnId` get `null` persisted — current behavior preserved for tests and any internal caller not yet updated.

**5. No DB migration.**

Existing constraints sufficient:
- `agent_turns.UNIQUE(session_id, request_id)` (`schema.ts:920`) covers request-id dedupe via claim.
- `agent_messages.UNIQUE(session_id, sequence_number)` (`schema.ts:988`) covers the sequence-number race that the retry handles.
- `agent_messages.turn_id` column already exists (`schema.ts:986`) with FK to `agent_turns.id`.

## Data flow

No SSE event shape changes. Per-item:

**A flow:**
```
[preselect /api/v1/projects/preselect]
  - rankCandidates → searchCalls (Qdrant call #1, unchanged)
  - selected → initializeSession
    - lookupBlueprint(callId) → cache miss → searchCalls (Qdrant call #2, unchanged)
    - rawEvidence stashed (top-15 sliced) into planningArtifact.preselect.rawEvidence
    - session created with phase='research', selectedCallId, blueprint=null

[/api/ai/agent (managed runtime, first turn)]
  - prompt branch 3a active: "evidence already in history, do NOT call get_call_blueprint or retrieve_evidence"
  - load history (no prior messages)
  - inject synthetic retrieve_evidence tool_use + tool_result into history (before user message push)
  - Anthropic stream begins; model sees evidence as if it had called retrieve_evidence
  - model produces blueprint text + calls save_call_blueprint(structured payload, structureConfidence ≥ 0.4)
  - executor.dispatchTool('save_call_blueprint'):
      a. buildCallBlueprintFromArgs(args, ctx) → full normalized CallBlueprint
      b. saveCallBlueprint service → callKnowledge row upserted
      c. UPDATE agent_sessions SET blueprint=full, currentPhase='structuring',
         stateVersion=stateVersion+1 WHERE phase='research' AND selectedCallId=args.callId
  - PR1's reload-after-write (B) picks up the updated session row (blueprint+phase+stateVersion)
  - done.finalState carries phase='structuring', new stateVersion, blueprint=full
  - subsequent turns: !session.blueprint is false → no injection; phase='structuring' → prompt
    branch 3a inactive; existing structuring-phase prompt applies

[/api/ai/agent (subsequent session for same callId)]
  - preselect → searchCalls (Qdrant call #1, rank only)
  - lookupBlueprint(callId) → cache HIT (structureConfidence ≥ 0.4) → returns structured blueprint
    → no Qdrant evidence search
  - phase='structuring' from preselect (cache hit branch unchanged)
```

Net Qdrant calls per cold preselect cold session: **2 instead of 4** (rank + lookupBlueprint cache-miss search). Net Qdrant calls for second cold session of the same callId: **1 instead of 4** (only the rank query; blueprint comes from cache, no lookupBlueprint evidence search).

**E flow:**
```
[router.generate(req)]
  - withRetry(primaryFn, config, providers, req)
    - new AbortController + setTimeout(timeout)
    - try primaryFn(controller.signal) → SDK call with signal threaded
    - error path:
      - classifier(err, internalTimeoutFired)
      - if non-retryable: throw err
      - if no fallback configured: throw err
      - else: new AbortController + new setTimeout for fallback
        - fallbackProvider.generate(req, fallbackSignal)
        - return result OR throw whatever fallback threw
```

**D flow:**
```
[POST /api/ai/agent]
  - load session
  - decide runtime
  - if managed eligible:
    - claimTurn(runtimeMode='managed')
    - on conflict: return JSON 409 conflict_request_id
    - on success: runManagedWithSSE(..., turnId)
  - if V3 path (any of the three):
    - claimV3OrConflict()
    - on conflict: return JSON 409 conflict_request_id
    - on success: runV3WithSSE(..., turnId)
  - runAgentTurn threads turnId into every appendMessage call
  - appendMessage on PG 23505: recompute seq, retry once
```

## Error handling

| Failure | Behavior |
|---|---|
| `lookupBlueprint` throws on preselect | Existing behavior preserved — `blueprintLookupFailed = true`, `blueprintKind = 'none'`, no `rawEvidence` stashed. Session created without injection capability. Model falls back to its current research-phase behavior (calling tools), which may also fail — but no regression. |
| `save_call_blueprint` fails (rare DB error) | Tool returns isError; model sees the error in tool_result; can retry or proceed without persisting. Not a regression — current cache state unchanged. |
| Synthetic injection malformed (rawEvidence is corrupted JSON) | Caught by JSON.stringify wrapping; if rawEvidence is invalid the synthetic blocks are skipped (defensive try/catch around the injection block). Model proceeds with empty history; no crash. |
| Caller external abort during E primary attempt | `internalTimeoutFired === false`, classifier returns false, throw original AbortError. No fallback attempted. Caller (e.g., user closing tab) gets the cancellation they asked for. |
| Internal timeout during E primary attempt | `internalTimeoutFired === true`, classifier returns true, fallback called with fresh controller. |
| Both primary AND fallback timeout | Fallback's controller fires its own timer, throws AbortError. No second fallback (fallback chain is depth 1). Outer caller sees the failure. |
| V3 claim conflict (concurrent identical request) | JSON 409 with `conflict_request_id`. Identical envelope to managed. Client shows the appropriate retry message. |
| `appendMessage` PG 23505 first attempt | Retry: recompute sequence number, re-insert. Common case for intra-session race. |
| `appendMessage` PG 23505 second attempt | Throw. Indicates sustained contention; turn fails; route's V3 SSE catch path emits error event. |
| V3 throws after appendMessage but before completion | Existing behavior. Claim row stays uncompleted; reconciliation cron sweeps. (PR2 does not add a V3 cleanup path.) |

## Testing

### A — preselect bootstrap and blueprint persistence

**Unit (`preselect.ts`):**
- `initializeSession` cache-miss path: `rawEvidence` from `lookupBlueprint` is stashed in `planningArtifact.preselect.rawEvidence`, sliced to ≤ 15 chunks.
- `initializeSession` cache-hit path: `rawEvidence` is NOT stashed (blueprintKind === 'structured', no rawEvidence field set).
- `lookupBlueprint` throws: artifact has no `rawEvidence` field, `blueprintKind === 'none'`, audit logs `blueprintLookupFailed: true`.

**Unit (`runManagedTurn`):**
- Research-phase preselected session with `rawEvidence` and `!session.blueprint` → assert `runningMessages` contains, in order, a synthetic assistant `tool_use` block (id `preselect_evidence_${turnId}`, name `retrieve_evidence`) followed by its matching user `tool_result` block, both appearing BEFORE the current user message. Chunk content matches the stashed `rawEvidence`. Test asserts ordered presence (find indices, assert relative order), not specific positions, so the assertion stays valid if `loadManagedHistory` ever returns prior messages on a research-phase session.
- Same setup but `session.blueprint` already set → assert no synthetic injection.
- `phase === 'structuring'` (cache hit branch) → no synthetic injection.
- Synthetic blocks are NOT in `agent_messages` after the turn (verify via DB query).

**Integration:**
- End-to-end: cold session → model sees evidence → calls `save_call_blueprint` with `structureConfidence ≥ 0.4` → `callKnowledge` row exists with `structureConfidence ≥ 0.4`. Then create a second session for the same callId → `lookupBlueprint` returns cache hit. **Qdrant `store.search` is called exactly once** for the second session — for the rank query in `searchCalls`. Assert `lookupBlueprint` does NOT issue an additional evidence search (count store.search invocations from inside `lookupBlueprint` specifically). Acceptance criterion 2 measures total Qdrant calls; this test bullet measures the specific lookupBlueprint path that PR2 is closing.
- `save_call_blueprint` invoked when `managed_agent_writes_enabled === false` → executor returns the rollout-block error message; no DB write.

### E — retry/fallback and signal cancellation

**Unit (`providers/retry.ts`):**
- 503 from primary, fallback configured, classifier says retryable → fallback called → returns success.
- 400 from primary → classifier says non-retryable → fallback NOT called → throws original error (assert via spy that fallback's `generate` was never invoked).
- 401/403 from primary → classifier says non-retryable → fallback NOT called → throws original error.
- 408 from primary → classifier says retryable → fallback called.
- 429 from primary → classifier says retryable → fallback called.
- Timeout fires (mock the timer) → `internalTimeoutFired` is true → fallback called with a fresh `AbortSignal` (assert the signal passed to fallback's `generate` is NOT pre-aborted).
- Primary `fn` throws AbortError before the internal timeout fires (simulates an external abort or an SDK-internal cancellation that surfaces as AbortError) → `internalTimeoutFired` is false → throw, no fallback. (PR2 does not introduce caller-provided signal threading; this guards the classifier behavior for any future caller that does.)
- Both primary and fallback timeout → both timers fire, fallback's AbortError thrown.

**Unit (`client.ts`):**
- `aiGenerate` no longer wraps `generate` in `@/lib/errors`'s `withRetry` — assert the breaker is the only outer wrapper. (Verifiable via stack trace or by counting calls in a mock.)
- Provider error with `status: 400` propagates as the original error type, NOT `Errors.serviceUnavailable(...)`.

**Provider adapter unit tests:**
- Each adapter (`openai.ts`, `anthropic.ts`, `google.ts`, `perplexity.ts`): when called with a signal, the signal is passed to the SDK request options. Mock the SDK, assert `signal` argument equality.

### D — V3 turn-claim and appendMessage retry

**Integration (`/api/ai/agent`):**
- Two concurrent identical requests on V3 path (same sessionId + requestId, no managed enrolment for the test user) → first wins claim, second receives JSON 409 with body `{ error: { code: 'conflict_request_id', messageRo, messageEn } }`. Assert no duplicate user message in `agent_messages`.
- Structured action submitted twice rapidly → second 409s; first executes normally.
- All three V3 entry paths (auth setup throw, breaker open, direct V3) reach the claim and 409 on duplicates. Three separate test cases.
- **Successful V3 turn marks completion before emitting done.** Single V3 request runs to completion → assert `agent_turns.completedAt IS NOT NULL` for the request's `turnId`. Mirrors the analogous managed assertion. Critical because V3 didn't previously create `agent_turns` rows; abandoned-turn reconciliation queries depend on `completedAt` correctly distinguishing live vs. completed vs. abandoned turns.
- **Ordering invariant: `markTurnCompleted` runs BEFORE `done` is emitted.** Unit test on `runAgentTurn`: spy on both `markTurnCompleted` and the `emit` callback. Drive a successful turn through. Assert that the `markTurnCompleted` spy was invoked before the `emit({type:'done',...})` call. Same assertion for the `skipLLM=true` terminal-action path. This prevents future refactors from re-introducing the late-completion bug.
- **markTurnCompleted failure surfaces as error event.** Stub `markTurnCompleted` to throw inside `runAgentTurn` → assert no `done` event was emitted, an `error` event WAS emitted, and `agent_turns.completedAt IS NULL` (the throw bubbles to the catch path).
- **Failed V3 turn leaves completedAt null.** V3 turn where the LLM provider call throws → assert `agent_turns.completedAt IS NULL`. The reconciliation cron handles cleanup of unfinished turns; V3's catch path must NOT mark them complete.

**Unit (`history.ts:appendMessage`):**
- Simulate PG 23505 on first insert (mock the insert to throw with `code: '23505'` once, succeed on retry) → assert single row created, `sequenceNumber` recomputed.
- Simulate PG 23505 twice → throws `appendMessage: sequence number conflict after retry`.
- `turnId` parameter passed → row's `turn_id` column populated.
- `turnId` parameter omitted → row's `turn_id` is null (regression guard for existing callers).

## Acceptance criteria

PR2 is complete when:

1. A cold preselect session that resulted in cache-miss results in **2 Qdrant calls** total (rank + lookupBlueprint), not 4. Verified by Qdrant client mock assertion in integration test.
2. The second cold session for the same callId after the first session persisted a blueprint results in **1 Qdrant call** total (rank only). Verified by mock.
3. A non-retryable 4xx provider error from the primary (e.g., 400, 401, 403) returns the original error to the caller — no fallback, no retry. Retryable 4xx codes (408, 429) DO fallback per the classifier. Verified by adapter-level test covering both branches.
4. A primary timeout triggers fallback with a fresh, non-aborted `AbortSignal`. Verified by spy.
5. Two concurrent identical V3 requests: one succeeds, the other gets JSON 409 with `conflict_request_id` envelope identical to managed's.
6. Concurrent intra-turn appends in V3 don't fail unrecoverably; the retry resolves sequence-number races.
7. A successful V3 turn marks `agent_turns.completedAt` non-null. A failed V3 turn leaves it null. Verified by integration tests on both paths.
8. After `save_call_blueprint` succeeds in a research-phase preselected session: `agent_sessions.blueprint` is the full normalized `CallBlueprint`, `currentPhase = 'structuring'`, `stateVersion` bumped by 1. Verified by integration test asserting all three fields on the row.
9. All new tests pass; existing tests continue to pass (in particular: existing managed `claimTurn` tests, existing `lookupBlueprint` tests, existing `withRetry` tests adapted to the new shape).
