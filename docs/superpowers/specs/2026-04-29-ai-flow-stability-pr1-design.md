# AI Flow Stability — PR1 Design

**Date:** 2026-04-29
**Scope:** Managed runtime + agent UI hooks. No DB migrations, no feature flags, no executor contract changes.
**Sibling spec:** PR2 (cost/flow cleanup — `2026-04-29-ai-flow-cost-flow-pr2-design.md`, written separately).

## Problem

The AI flow audit (conversation 2026-04-29) found three user-visible defects in the managed agent runtime that compound:

1. **Stale `done.finalState` after writes.** `runManagedTurn` builds the final UI snapshot from the pre-turn `session` and `sections` locals, never reloading after write tools mutate the DB. The next request from the client carries the stale `stateVersion` and the route's CAS check returns 409 `stale_state_version` — even though the prior turn's writes succeeded.

2. **Workspace action buttons race the streaming turn.** `AgentWorkspace` accepts `onAction` but no busy state. While a turn streams, the user can click Approve / Accept / Reject / Mark complete. `useAgent.sendRequest` aborts the in-flight fetch on the client, but the server-side SSE keeps running and bumps `stateVersion`. The new action request arrives with the pre-turn `stateVersion` and 409s. UI looks stuck after a successful prior turn.

3. **Iteration-cap synthetic text and raw tool errors leak.** When the managed loop hits `ITERATION_CAP=8`, runtime emits a synthetic `text_delta` ("Reached tool iteration limit") that is never persisted to `agent_messages`. UI shows it; DB doesn't; next turn's history is missing the bail-out signal. Separately, `useAgent` renders tool failures as `${event.tool}: ${event.summary}`, leaking raw English error strings (`PARALLEL_WRITE_BLOCKED: ...`) into Romanian conversations.

PR1 is the stability patch: fix all three without touching the executor contract, the SSE event shape, or the DB schema.

## Non-goals

- Anything in PR2: deduping the cache-miss research dance, deleting the outer retry layer, extending turn-claim to V3.
- Mid-turn UI updates (per-write `state_update` events) — out of scope; `done.finalState` reload-once is sufficient to fix the 409.
- Bilingual error envelopes for tool results — out of scope; we localize client-side from stable error codes instead.
- Refactoring `AgentEvent` shape or any SSE protocol change.

## Architecture

Four discrete changes, each isolated to one or two files:

| Change | Files touched |
|---|---|
| B — Reload state after managed writes | `app/src/lib/ai/agent/managed/runtime.ts`, `app/src/hooks/useAgent.ts` |
| C — Disable workspace actions while busy | `app/src/components/agent/AgentWorkspace.tsx`, `app/src/app/[locale]/(dashboard)/proiecte/nou/NewProjectView.tsx`, `app/src/app/[locale]/(dashboard)/asistent-ai/page.tsx` |
| F1 — Persist iteration-cap text | `app/src/lib/ai/agent/managed/runtime.ts` |
| F2 — Localize tool error UI | `app/src/messages/ro.json`, `app/src/messages/en.json`, `app/src/hooks/useAgent.ts` (new helper module optional) |

### B — Reload state after managed writes

**Runtime change** (`managed/runtime.ts`):

1. Track `writesSucceeded: boolean` across the tool loop. Flip true when any tool dispatch returns `result.isError === false` AND the tool name is in `WRITE_TOOL_NAMES`. Read-only and rules tools never flip the flag.
2. **Reload happens AFTER `markTurnCompleted`**, not before. Ordering matters: a turn that produced durable messages must record `agent_turns.completedAt` regardless of whether the post-write reload succeeds. If we placed the reload-failure return before completion, the turn would have durable history but no completion marker, polluting the reconciliation cron.
3. New ordering at the end of `runManagedTurn`:
   - Run `markTurnCompleted` (existing block, unchanged).
   - Run `compactIfNeeded` (existing block, unchanged).
   - Then perform the post-write reload:
     - If `writesSucceeded === false`, build `finalState` from the pre-turn `session` / `sections` (current behavior). Skip the DB read.
     - If `writesSucceeded === true`, re-query `agent_sessions` and `agent_sections` from DB. Build `finalState` from the fresh rows.
4. On reload failure (DB error, missing row): emit a localized non-retryable error event and **skip** the `done` event. Because `markTurnCompleted` already ran, the turn is correctly recorded as completed with durable output.

```ts
// Pseudocode — runs AFTER markTurnCompleted + compactIfNeeded
let freshSession = session
let freshSections = sections
if (writesSucceeded) {
  try {
    const reloaded = await reloadSessionAndSections(session.id, session.userId)
    if (!reloaded) throw new Error('session row missing after write')
    freshSession = reloaded.session
    freshSections = reloaded.sections
  } catch (err) {
    log.error({ sessionId: session.id, err }, 'post-write reload failed')
    const msg = session.locale === 'ro'
      ? 'Sesiunea s-a actualizat parțial. Reîncarcă pagina pentru a continua.'
      : 'Session partially updated. Reload to continue.'
    emit({ type: 'error', message: msg, retryable: false })
    // Do NOT emit `done`. Client's terminalErrorRef (see hook change below)
    // prevents post-stream status=idle from masking this. The turn IS marked
    // completed in agent_turns by the markTurnCompleted call above.
    return { toolCount, iterationCount, model: tctx.messageModel, latencyMs: Date.now() - start, firstOutputPersisted }
  }
}
const finalState = buildUISnapshot(freshSession, freshSections)
emit({ type: 'done', finalState })
```

**Reload helper:** lives in `managed/runtime.ts` next to `buildUISnapshot`. Thin wrapper around the Drizzle queries from `app/src/app/api/ai/agent/route.ts:46-64`. Because the existing `mapSessionRow` and `mapSectionRow` are private to `route.ts` (`route.ts:571,593`) and the spec rules out extracting a shared service in PR1, **the mapping functions are duplicated locally in `managed/runtime.ts`**. Duplication is acceptable because the row shapes are stable Drizzle inferred types; the duplicates can be unified in a follow-up cleanup PR. The duplication is explicitly noted in a comment above the local copies so future readers see the intent.

**Hook change** (`useAgent.ts`):

`status='error'` from a non-retryable error event is currently overwritten by the unconditional `setStatus('idle')` at the end of `sendRequest`'s reader loop. Fix with a ref:

1. Add `terminalErrorRef = useRef(false)` alongside `abortRef`.
2. In the `error` event handler: when `event.retryable === false`, set `terminalErrorRef.current = true` in addition to the existing `setStatus('error')`.
3. Replace `setStatus('idle')` after the reader loop with `if (!terminalErrorRef.current) setStatus('idle')`.
4. At the start of `sendRequest`, reset `terminalErrorRef.current = false` so retries clear the latch.

This fix applies to ALL non-retryable errors, not just reload failures — it closes a latent bug independent of B.

### C — Disable workspace actions while busy

**Component change** (`AgentWorkspace.tsx`):

Add `isBusy: boolean` to `Props`. Pass it as `disabled` to the four mutating buttons:
- Approve outline (in `OutlineView`'s `onApprove` button)
- Accept (`SectionCard`'s accept button)
- Reject (`SectionCard`'s reject button)
- Mark complete (`ValidationSummary`'s complete button)

Phase-based show conditions stay as-is. The button child components (`OutlineView`, `SectionCard`, `ValidationSummary`) accept a `disabled?: boolean` prop and forward it to their `<button>` element. Default `false` so unrelated callers don't break.

**Caller changes:**

Both callers compute `isBusy` and pass it down:

```ts
// NewProjectView.tsx (line ~280) and asistent-ai/page.tsx (line ~42)
const isBusy = agent.status === 'streaming' || agent.status === 'connecting'
<AgentWorkspace
  phase={agent.phase}
  sections={agent.sections}
  blueprint={agent.blueprint}
  eligibility={agent.eligibility}
  warnings={agent.warnings}
  onAction={agent.sendAction}
  isBusy={isBusy}
/>
```

### F1 — Persist iteration-cap text

In `runManagedTurn`, the existing block at `runtime.ts:370-382` that emits the synthetic `text_delta` on `iterationCount >= ITERATION_CAP`:

After `emit({ type: 'text_delta', content: ... })` and before `markTurnCompleted`, persist the same locale string as an assistant `text` row:

```ts
if (iterationCount >= ITERATION_CAP) {
  const capMessage = session.locale === 'ro'
    ? '\n\n(Limita de iterații atinsă. Vă rog, clarificați întrebarea.)'
    : '\n\n(Reached tool iteration limit. Please clarify your request.)'
  emit({ type: 'text_delta', content: capMessage })
  if (firstOutputPersisted) {
    // Best-effort: cap text persistence MUST NOT crash the runtime. If it
    // throws, runtime would exit before markTurnCompleted, leaving the turn
    // in an incomplete state — exactly the bug PR1 is closing on the
    // reload-failure path. Log and continue.
    try {
      await appendManagedMessage(
        session.id,
        { role: 'assistant', messageType: 'text', content: capMessage, turnId },
        { runtimeMode: 'managed', provider: 'anthropic', model: tctx.messageModel },
      )
    } catch (err) {
      log.warn(
        { sessionId: session.id, turnId, err: err instanceof Error ? err.message : String(err) },
        'iteration-cap text persistence failed (non-fatal)',
      )
    }
  }
}
```

Guard on `firstOutputPersisted` because `appendManagedMessage` requires the user message to already be in `agent_messages` for sequence numbering to make sense. If `firstOutputPersisted === false` the turn is empty and the route's catch branch will delete the claim row anyway.

If the persistence write fails: the warn is logged and the runtime proceeds normally to `markTurnCompleted` and the post-write reload. The user has already seen the cap text via the SSE `text_delta`; the divergence is that the next turn's `loadManagedHistory` won't include the cap text — acceptable because the model's prior message and tool history fully describe what happened, and the cap text is advisory rather than load-bearing.

### F2 — Localize tool error UI

**Source of truth — actual executor error strings:**

Verified against `app/src/lib/ai/agent/managed/executor.ts:166-203` and `app/src/lib/ai/agent/managed/runtime.ts:29`:

| Trigger | Emitted summary string |
|---|---|
| `PARALLEL_WRITE_BLOCKED` (runtime cap) | `PARALLEL_WRITE_BLOCKED: Only one write tool call is allowed per assistant message. ...` |
| Tool dispatch race timeout | `Tool timed out after 15s` (literal, not `tool_timeout`) |
| `NotFoundError` from a service | `NOT_FOUND: <message>` |
| `AuthorizationError` from a service | `AUTHORIZATION: Access denied to requested session` |
| `ValidationError` with `policyCode` | `POLICY_*: <message>` (variable suffix) |
| `ValidationError` without `policyCode` | `VALIDATION:<field>: <message>` |
| `ConcurrencyError` | `CONCURRENCY: <message>` (note: NO underscore) |
| `ExternalDependencyError` | `EXTERNAL_DEPENDENCY: <service> unavailable` |
| Other `ServiceError` | `<err.code>: <err.message>` |
| Unhandled exception | `Internal tool error` (literal) |

**Locale dictionary** (`messages/{ro,en}.json`):

Add an `agent.toolErrors` namespace keyed by stable prefixes the executor actually emits:

```json
// en.json
{
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

```json
// ro.json
{
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

**Helper** (`useAgent.ts` inline or a new `lib/agent/format-tool-error.ts`):

```ts
function formatToolError(tool: string, summary: string, t: TranslateFn): string {
  // Order matters: most specific prefixes first.
  if (summary.startsWith('PARALLEL_WRITE_BLOCKED')) return t('PARALLEL_WRITE_BLOCKED', { tool })
  if (summary === 'Tool timed out after 15s') return t('TOOL_TIMEOUT', { tool })
  if (summary.startsWith('NOT_FOUND')) return t('NOT_FOUND', { tool })
  if (summary.startsWith('AUTHORIZATION')) return t('AUTHORIZATION', { tool })
  if (summary.startsWith('POLICY_')) {
    // Extract ONLY the stable code (text up to the first ':') — never pass
    // the full raw summary as detail. Otherwise a Romanian render of
    // "POLICY_OUTLINE_NOT_FROZEN: outline must be frozen" would leak the
    // English service prose ("outline must be frozen") into the localized
    // string. The code itself ("POLICY_OUTLINE_NOT_FROZEN") is a stable
    // identifier, not user-facing English prose.
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

In `useAgent.ts`'s `tool_result` handler (line ~98-108), replace the inline `${event.tool}: ${event.summary}` content with `formatToolError(event.tool, event.summary, ...)`. The hook already takes `locale` — read translations via `next-intl`'s `useTranslations` in the consumer or thread a small translator function down. Implementation choice deferred to writing-plans phase.

The `{tool}` interpolation uses the raw tool id (e.g., `save_section_draft`). Acceptable per audit conversation: stable, identifying, much better than leaking raw English executor prose.

## Data flow

No SSE event shape changes. The flow is:

```
[managed runtime]
  - tool loop runs; flips writesSucceeded on any successful WRITE_TOOL_NAMES result
  - loop exits
  - if iterationCap hit AND firstOutputPersisted:
      - emit text_delta(capMessage)
      - try { appendManagedMessage(capMessage) } catch { log.warn — non-fatal }
  - markTurnCompleted (existing)
  - compactIfNeeded (existing)
  - if writesSucceeded:
      - try { reload session/sections from DB → freshSnapshot } emit done{finalState=freshSnapshot}
      - on reload failure: emit error{retryable:false, localized message}, skip done
  - if !writesSucceeded: emit done{finalState from pre-turn locals} (current behavior)

[useAgent]
  - on error event with retryable=false: setStatus('error'), terminalErrorRef.current=true
  - reader loop ends naturally
  - if !terminalErrorRef.current: setStatus('idle')
  - tool_result events render via formatToolError

[AgentWorkspace + callers]
  - isBusy prop derived from agent.status; disables 4 mutating buttons when streaming/connecting
```

## Error handling

| Failure | Behavior |
|---|---|
| Write tool returns isError | `writesSucceeded` stays whatever it was; tool result fed back to model; loop continues |
| All writes errored | `writesSucceeded === false` → no reload, current behavior preserved |
| Post-write reload throws | Emit terminal error, skip `done`. Client's `terminalErrorRef` prevents `idle` from masking it. `agent_turns.completedAt` IS set (markTurnCompleted ran before the reload). User reload via `agent.reconnect()` or page refresh reconciles. |
| Iteration cap hit, `firstOutputPersisted === false` | Cap text emitted to UI but NOT persisted (consistent with route's empty-turn cleanup) |
| `appendManagedMessage` for cap text fails | Log warn, do not abort — non-critical. The user has already seen the cap text via SSE `text_delta`; the next turn's `loadManagedHistory` simply won't replay the cap text, but the prior assistant + tool messages fully describe the conversation state. (`ensurePairingInvariant` does NOT cover this — it repairs orphan tool_use/tool_result blocks, not missing assistant text rows.) |
| Unknown tool error code | `formatToolError` falls back to `GENERIC` template; raw summary logged in dev only |

## Testing

Each change ships with at least one test:

**B reload + terminal error:**
- Unit test on `runManagedTurn`: stub Anthropic to emit one `set_selected_call` (or any write) tool_use → executor returns success → DB stateVersion bumps → assert `done.finalState.stateVersion` matches the post-write DB row.
- Unit test on `runManagedTurn`: same as above but stub the reload helper to throw → assert no `done` event emitted, exactly one `error` event with `retryable: false` and a non-empty localized message. **AND** assert `agent_turns.completedAt` is non-null for `turnId` (proves `markTurnCompleted` ran before the reload-failure return).
- Unit test on `useAgent`: feed an SSE stream ending with `data: {"type":"error","retryable":false,"message":"..."}\n\n` then natural close → assert final `status === 'error'`, `error` is set, `terminalErrorRef` was honored (status not overwritten by `idle`).

**C disabled buttons:**
- React Testing Library: render `AgentWorkspace` with `phase='structuring'`, sections present, `isBusy={true}` → assert the Approve outline button has `disabled` attribute.
- Same render with `phase='drafting'`, sections present, `isBusy={true}` → assert Accept and Reject buttons disabled on each `SectionCard`.
- Render with `phase='review'`, `isBusy={true}` → Mark complete disabled.
- Render with `isBusy={false}` (default) → buttons enabled (regression guard).

**F1 cap text persistence:**
- Unit test on `runManagedTurn`: stub Anthropic to always emit `tool_use` (never reaches text-only stop) → drive 8 iterations → assert `appendManagedMessage` was called with content matching the locale cap text and `turnId` matches the turn's id.

**F2 formatter:**
- Pure-function unit test on `formatToolError`. Each input must match a real executor output string — fixtures sourced from `executor.ts:166-203`:
  - `'PARALLEL_WRITE_BLOCKED: Only one write...'` → `PARALLEL_WRITE_BLOCKED` template
  - `'Tool timed out after 15s'` → `TOOL_TIMEOUT` template
  - `'NOT_FOUND: section foo'` → `NOT_FOUND` template
  - `'AUTHORIZATION: Access denied to requested session'` → `AUTHORIZATION` template
  - `'POLICY_OUTLINE_NOT_FROZEN: outline must be frozen'` → `POLICY_PREFIX` template with `{code}` populated as `'POLICY_OUTLINE_NOT_FROZEN'`. **Romanian-locale assertion: rendered string MUST NOT contain `'outline must be frozen'`** (regression guard against passing raw service prose into the localized template).
  - `'VALIDATION:sectionKey: invalid'` → `VALIDATION_PREFIX` template
  - `'CONCURRENCY: state version mismatch'` → `CONCURRENCY` template
  - `'EXTERNAL_DEPENDENCY: VectorStore unavailable'` → `EXTERNAL_DEPENDENCY` template
  - `'Internal tool error'` → `INTERNAL` template
  - `'completely unknown error string'` → `GENERIC` template, `console.warn` called in dev only
- Run each fixture twice with `locale='ro'` and `locale='en'` to confirm both maps are wired.
- Regression guard: success result (`event.success === true`) still renders `'completed'` via the existing `useAgent` branch, not via `formatToolError`.

E2E tests are not required for PR1; the failure modes are reproducible at unit level.

## Out of scope (PR2)

These are tracked in the sibling spec and explicitly NOT addressed here:

- Triple Qdrant retrieval on cold preselect sessions (Finding 1 / item A).
- Stacked retry layers and uncancelled SDK calls in `lib/ai/client.ts` + `lib/ai/providers/retry.ts` (Finding 5 / item E).
- V3 turn-claim and `appendMessage` race protection (Finding 4 / item D).

## Acceptance criteria

PR1 is complete when:

1. A managed write turn followed by an immediate UI action does NOT 409. Verified by running through the local managed flow with `set_selected_call`, then clicking a workspace button.
2. Clicking workspace buttons during a streaming turn is blocked by `disabled` attribute.
3. Iteration-cap text is visible in `agent_messages` after a forced 8-iteration run.
4. A failed tool result in chat shows a Romanian or English string (depending on locale), never raw `PARALLEL_WRITE_BLOCKED:`-style English.
5. All new tests pass; existing managed-runtime tests continue to pass.
