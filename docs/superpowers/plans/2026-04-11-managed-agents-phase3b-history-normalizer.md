# Managed Agents Phase 3b (PR-B) — History Normalizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the managed runtime's `loadManagedHistory` so V3-era `tool_call` / `tool_result` rows replay cleanly into Anthropic's Messages API. Preserve compacted conversation summaries. Add an optional `priorSummary` parameter to `buildManagedSystemPrompt` and render a bilingual `Prior conversation summary` block when it is non-null — the only prompt content change in PR-B; all other prompt content stays Phase 2 until PR-A's minimal delta. This PR enables `managed_agent_writes_enabled` to be flipped on safely in PR-A; without this fix, a session that touched V3 and then transitions to managed would replay mangled content and could double-write, retry-loop, or hit the iteration cap.

**This PR lands first. PR-A (write surface) depends on it.**

**Why split:** The normalizer is a read-path correctness fix with its own failure modes — row classification, FIFO pairing, text-preserving orphan repair, summary propagation. It deserves its own review cycle independent of write-surface enablement.

**Architecture:** `loadManagedHistory` becomes a normalization pipeline that reconstructs Anthropic-shape `MessageParam[]` from any mix of V3-era and managed-era rows. The loader's contract:

> Given an ordered list of `agent_messages` rows for a session, return a `MessageParam[]` that faithfully represents the conversation in the Anthropic content-block format, preserving all assistant tool calls and their matching tool results, plus any V3 compaction summary.

**Tech Stack:** TypeScript, Anthropic SDK (stable `resources/messages`), Drizzle ORM + postgres.js, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-10-managed-agents-phase3-design.md` §6.5

**Prerequisites:**
- Phase 3a merged (PR #18)
- Phase 3a V3 fix merged (PR #45)
- No Phase 3 changes to the managed runtime until this PR

**Non-goals (explicit):**
- No write-surface enablement — that's PR-A
- No prompt rewrite. PR-B adds exactly one content change to `buildManagedSystemPrompt`: a bilingual `Prior conversation summary` block that renders when the new `priorSummary` parameter is non-null. All other prompt content is unchanged; write-tool descriptions and the hard-rules block land in PR-A's minimal delta.
- No one-time backfill — read-time normalization only
- No V3 runtime changes
- No frontend changes

---

## Desk audit fixes applied to this plan

Two of the four desk audit findings from the original combined plan land in this PR-B:

- **Finding 2 (FIFO pairing, not toolName match):** the original plan used "pair by closest following `tool_result` row with the same `toolName`" as the fallback for null `toolCallId`. That breaks when two consecutive calls share the same tool name (e.g., two `search_calls` in one turn). This plan replaces that with **strict sequence-order FIFO**: walk rows in `sequenceNumber` order, maintain a pending-tool_use queue, match each tool_result row to the oldest unmatched assistant tool_use in the queue. `toolName` becomes a sanity-check log only. A duplicate-toolname test case is included.
- **Finding 3 (text-preserving orphan repair):** the original plan's repair rule dropped orphan assistant messages entirely. But the managed runtime persists mixed `[text, tool_use]` blocks in a single assistant message (see `app/src/lib/ai/agent/managed/runtime.ts:145-156`). Dropping the assistant message would discard legitimate assistant text. This plan revises the repair rule to **trim only orphan `tool_use` blocks** from the assistant message's content array; the message is dropped only if it becomes empty after trimming. Orphan `tool_result` blocks on user messages are trimmed symmetrically. **No synthetic `tool_result` blocks are ever inserted** — trimming is single-path, complete, and easier to reason about. Task 4 implements this rule.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `app/tests/unit/managed/history-classify.test.ts` | Every row classification branch with fixture rows. |
| `app/tests/unit/managed/history-v3-replay.test.ts` | Synthetic V3-era row sequence → expected `MessageParam[]`. |
| `app/tests/unit/managed/history-mixed-runtime.test.ts` | V3-era → managed-era transition; managed-native rows pass through unchanged. |
| `app/tests/unit/managed/history-pairing-invariant.test.ts` | Orphan `tool_use` repair (text-preserving); orphan `tool_result` dropped. |
| `app/tests/unit/managed/history-batching.test.ts` | Consecutive V3 `tool_call` rows batch into one assistant message with multiple `tool_use` blocks. |
| `app/tests/unit/managed/history-null-toolcallid.test.ts` | `toolCallId=null` rows use synthetic `tu_legacy_<row.id>` IDs; **duplicate toolName in one turn pair correctly via FIFO**. |
| `app/tests/unit/managed/history-compacted.test.ts` | `compactedAt` rows are dropped. |
| `app/tests/unit/managed/history-system-dropped.test.ts` | Non-summary `role='system'` rows are dropped. |
| `app/tests/unit/managed/history-system-summary.test.ts` | `system_summary` row → loader's `systemSummary` return field; fallback to `session.messageSummary`; both null → `systemSummary=null`. |
| `app/tests/integration/managed/history-real-v3-session.test.ts` | Seed a V3-era history via direct DB inserts mirroring `runtime.ts:253-266` persistence; call `loadManagedHistory`; assert `MessageParam[]` is consumable by Anthropic SDK shape-check. |

### Modified files

| File | Change |
|---|---|
| `app/src/lib/ai/agent/managed/history.ts` | Full rewrite of `loadManagedHistory`. Adds `classifyRow` pure helper, `ensurePairingInvariant`, and returns `ManagedHistoryResult = { messages, systemSummary }`. Handles V3-era tool_call/tool_result rows + text-preserving orphan repair + FIFO pairing. |
| `app/src/lib/ai/agent/managed/runtime.ts` | Destructure `{ messages, systemSummary }` from `loadManagedHistory`. Pass `systemSummary` as new 5th arg to `buildManagedSystemPrompt`. |
| `app/src/lib/ai/agent/managed/prompt.ts` | `buildManagedSystemPrompt` gains optional `priorSummary?: string \| null` parameter (defaulting to `null`) AND renders a bilingual `Prior conversation summary` block at the end of the prompt when that parameter is non-null. This is the only content change in PR-B; write-tool descriptions and hard rules stay in PR-A's minimal delta. Backwards compatible with existing 4-arg callers. |

---

## Task 1: Change loadManagedHistory return type + update all callers

**Files:**
- Modify: `app/src/lib/ai/agent/managed/history.ts`
- Modify: all current callers of `loadManagedHistory`

This task lands the type change first so the rest of the rewrite can proceed without a mid-rewrite callsite churn.

- [ ] **Step 1: Declare the new return interface**

Add to `app/src/lib/ai/agent/managed/history.ts`:

```typescript
export interface ManagedHistoryResult {
  messages: MessageParam[]
  systemSummary: string | null
}
```

- [ ] **Step 2: Change the signature (temporary shim)**

Change `loadManagedHistory` to return `ManagedHistoryResult`. As a temporary shim, keep the Phase 2 body logic intact and wrap the old result:

```typescript
export async function loadManagedHistory(sessionId: string): Promise<ManagedHistoryResult> {
  // ... existing Phase 2 body that builds `messages: MessageParam[]` ...
  return { messages, systemSummary: null }
}
```

This is a no-op behaviorally for callers that only use `messages`, but breaks the contract for any caller that doesn't destructure.

- [ ] **Step 3: Update all callers**

```bash
cd /home/godja/Dev/EU-Funds/app && grep -rn "loadManagedHistory(" src/ tests/ 2>/dev/null
```

For each callsite, change `const history = await loadManagedHistory(...)` to `const { messages: history } = await loadManagedHistory(...)`. Do NOT yet thread `systemSummary` into downstream calls — that's Task 8. Keep the scope of this task to a clean type change.

- [ ] **Step 4: Run typecheck + tests**

```bash
cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit 2>&1 | head -20
cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/unit/managed tests/integration/managed 2>&1 | tail -15
```

Expected: all pass. The temporary shim keeps behavior identical.

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds/app && git add src/lib/ai/agent/managed/history.ts
# Add any caller updates
cd /home/godja/Dev/EU-Funds && git commit -m "refactor(phase3b): change loadManagedHistory return to ManagedHistoryResult

Prepares the loader for the normalizer rewrite. New return type
{ messages, systemSummary } lets the caller access V3 compaction
summaries without extra round trips. All existing callsites
destructure messages only; systemSummary wiring lands in a later
commit. No behavior change — the Phase 2 body still returns
systemSummary: null."
```

---

## Task 2: classifyRow pure helper + unit tests

**Files:**
- Modify: `app/src/lib/ai/agent/managed/history.ts` (add `classifyRow` exported function)
- Create: `app/tests/unit/managed/history-classify.test.ts`

`classifyRow` is a pure function that tags each `agent_messages` row with an enum describing how the loader should convert it to Anthropic content-block shape. The loader rewrite in Task 3 consumes these tags.

- [ ] **Step 1: Write the failing test**

Create `app/tests/unit/managed/history-classify.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { classifyRow, type RowClassification } from '@/lib/ai/agent/managed/history'
import type { agentMessages } from '@/lib/db/schema'

type Row = typeof agentMessages.$inferSelect

function row(overrides: Partial<Row>): Row {
  return {
    id: 'm-default',
    sessionId: 's-default',
    role: 'user',
    messageType: 'text',
    content: 'hello',
    toolName: null,
    toolCallId: null,
    sequenceNumber: 0,
    compactedAt: null,
    createdAt: new Date(),
    runtimeMode: 'managed',
    provider: null,
    model: null,
    ...overrides,
  } as Row
}

describe('classifyRow', () => {
  it('classifies a user string text row', () => {
    const c = classifyRow(row({ role: 'user', messageType: 'text', content: 'hi' }))
    expect(c.kind).toBe('user_text')
    if (c.kind === 'user_text') expect(c.text).toBe('hi')
  })

  it('classifies a user row with content blocks (managed-native)', () => {
    const blocks = [{ type: 'text', text: 'hi' }]
    const c = classifyRow(row({ role: 'user', messageType: 'text', content: blocks as never }))
    expect(c.kind).toBe('user_text_blocks')
  })

  it('classifies a user managed-native tool_result row', () => {
    const blocks = [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true}', is_error: false }]
    const c = classifyRow(row({
      role: 'user', messageType: 'tool_result', content: blocks as never,
      toolCallId: 'tu_1', toolName: 'search_calls',
    }))
    expect(c.kind).toBe('user_tool_result_native')
  })

  it('classifies an assistant string text row', () => {
    const c = classifyRow(row({ role: 'assistant', messageType: 'text', content: 'ok' }))
    expect(c.kind).toBe('assistant_text')
  })

  it('classifies an assistant managed-native tool_use row', () => {
    const blocks = [{ type: 'tool_use', id: 'tu_1', name: 'search_calls', input: {} }]
    const c = classifyRow(row({ role: 'assistant', messageType: 'tool_use', content: blocks as never }))
    expect(c.kind).toBe('assistant_blocks_native')
  })

  it('classifies a V3-era assistant tool_call row with explicit toolCallId', () => {
    const c = classifyRow(row({
      id: 'm-42',
      role: 'assistant',
      messageType: 'tool_call',
      content: { name: 'search_calls', arguments: { query: 'pnrr' } } as never,
      toolName: 'search_calls',
      toolCallId: 'tu_xyz',
    }))
    expect(c.kind).toBe('assistant_tool_call_legacy_v3')
    if (c.kind === 'assistant_tool_call_legacy_v3') {
      expect(c.toolUseId).toBe('tu_xyz')
      expect(c.name).toBe('search_calls')
      expect(c.input).toEqual({ query: 'pnrr' })
    }
  })

  it('generates synthetic tu_legacy_<row.id> when V3 tool_call row has null toolCallId', () => {
    const c = classifyRow(row({
      id: 'm-7',
      role: 'assistant',
      messageType: 'tool_call',
      content: { name: 'search_calls', arguments: {} } as never,
      toolName: 'search_calls',
      toolCallId: null,
    }))
    expect(c.kind).toBe('assistant_tool_call_legacy_v3')
    if (c.kind === 'assistant_tool_call_legacy_v3') {
      expect(c.toolUseId).toBe('tu_legacy_m-7')
    }
  })

  it('classifies a V3-era tool_result row with success=true', () => {
    const c = classifyRow(row({
      role: 'tool',
      messageType: 'tool_result',
      content: { success: true, data: { results: [] } } as never,
      toolName: 'search_calls',
      toolCallId: 'tu_xyz',
    }))
    expect(c.kind).toBe('user_tool_result_legacy_v3')
    if (c.kind === 'user_tool_result_legacy_v3') {
      expect(c.isError).toBe(false)
      expect(c.toolUseId).toBe('tu_xyz')
      expect(typeof c.contentString).toBe('string')
    }
  })

  it('classifies a V3-era tool_result row with success=false → isError=true', () => {
    const c = classifyRow(row({
      role: 'tool',
      messageType: 'tool_result',
      content: { success: false, error: 'NOT_FOUND: blah' } as never,
      toolName: 'search_calls',
      toolCallId: 'tu_xyz',
    }))
    expect(c.kind).toBe('user_tool_result_legacy_v3')
    if (c.kind === 'user_tool_result_legacy_v3') expect(c.isError).toBe(true)
  })

  it('generates synthetic tu_legacy_<row.id> for null-toolCallId V3 tool_result', () => {
    const c = classifyRow(row({
      id: 'm-9',
      role: 'tool',
      messageType: 'tool_result',
      content: { success: true } as never,
      toolName: 'search_calls',
      toolCallId: null,
    }))
    expect(c.kind).toBe('user_tool_result_legacy_v3')
    if (c.kind === 'user_tool_result_legacy_v3') expect(c.toolUseId).toBe('tu_legacy_m-9')
  })

  it('classifies a system_summary row', () => {
    const c = classifyRow(row({
      role: 'system',
      messageType: 'system_summary',
      content: 'prior conversation summary text',
    }))
    expect(c.kind).toBe('system_summary')
    if (c.kind === 'system_summary') expect(c.text).toBe('prior conversation summary text')
  })

  it('drops other role=system rows', () => {
    const c = classifyRow(row({ role: 'system', messageType: 'text', content: 'unrelated' }))
    expect(c.kind).toBe('system_drop')
  })

  it('tags malformed rows as unknown_drop with a reason', () => {
    const c = classifyRow(row({ role: 'banana' as never, messageType: 'text', content: 'x' }))
    expect(c.kind).toBe('unknown_drop')
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement classifyRow**

Add to `app/src/lib/ai/agent/managed/history.ts`:

```typescript
export type RowClassification =
  | { kind: 'user_text'; text: string }
  | { kind: 'user_text_blocks'; blocks: unknown[] }
  | { kind: 'user_tool_result_native'; blocks: unknown[] }
  | { kind: 'user_tool_result_legacy_v3'; toolUseId: string; toolName: string; contentString: string; isError: boolean }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'assistant_blocks_native'; blocks: unknown[] }
  | { kind: 'assistant_tool_call_legacy_v3'; toolUseId: string; toolName: string; name: string; input: unknown }
  | { kind: 'system_summary'; text: string }
  | { kind: 'system_drop' }
  | { kind: 'unknown_drop'; reason: string }

export function classifyRow(row: typeof agentMessages.$inferSelect): RowClassification {
  // Helper: synthetic ID generator for rows missing toolCallId
  const synthId = (id: string) => `tu_legacy_${id}`

  if (row.role === 'user' && row.messageType === 'text') {
    if (typeof row.content === 'string') return { kind: 'user_text', text: row.content }
    if (Array.isArray(row.content)) return { kind: 'user_text_blocks', blocks: row.content as unknown[] }
    return { kind: 'unknown_drop', reason: 'user text content is neither string nor array' }
  }

  if (row.role === 'user' && row.messageType === 'tool_result') {
    if (Array.isArray(row.content)) return { kind: 'user_tool_result_native', blocks: row.content as unknown[] }
    return { kind: 'unknown_drop', reason: 'user tool_result content is not an array' }
  }

  if (row.role === 'assistant' && row.messageType === 'text') {
    if (typeof row.content === 'string') return { kind: 'assistant_text', text: row.content }
    if (Array.isArray(row.content)) return { kind: 'assistant_blocks_native', blocks: row.content as unknown[] }
    return { kind: 'unknown_drop', reason: 'assistant text content is neither string nor array' }
  }

  if (row.role === 'assistant' && row.messageType === 'tool_use') {
    if (Array.isArray(row.content)) return { kind: 'assistant_blocks_native', blocks: row.content as unknown[] }
    return { kind: 'unknown_drop', reason: 'assistant tool_use content is not an array' }
  }

  // V3 legacy assistant tool_call row
  if (row.role === 'assistant' && row.messageType === 'tool_call') {
    const content = row.content as { name?: string; arguments?: unknown } | null
    if (content && typeof content === 'object' && typeof content.name === 'string') {
      return {
        kind: 'assistant_tool_call_legacy_v3',
        toolUseId: row.toolCallId ?? synthId(row.id),
        toolName: row.toolName ?? content.name,
        name: content.name,
        input: content.arguments ?? {},
      }
    }
    return { kind: 'unknown_drop', reason: 'V3 assistant tool_call content missing name field' }
  }

  // V3 legacy tool_result row
  if (row.role === 'tool' && row.messageType === 'tool_result') {
    const content = row.content as { success?: boolean; data?: unknown; error?: string } | null
    const isError = content?.success === false
    return {
      kind: 'user_tool_result_legacy_v3',
      toolUseId: row.toolCallId ?? synthId(row.id),
      toolName: row.toolName ?? 'unknown',
      contentString: JSON.stringify(content ?? {}),
      isError,
    }
  }

  if (row.role === 'system' && row.messageType === 'system_summary') {
    if (typeof row.content === 'string') return { kind: 'system_summary', text: row.content }
    return { kind: 'unknown_drop', reason: 'system_summary content is not a string' }
  }

  if (row.role === 'system') return { kind: 'system_drop' }

  return { kind: 'unknown_drop', reason: `unhandled role=${row.role} messageType=${row.messageType}` }
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): add classifyRow helper for managed history normalizer

Pure function that tags every agent_messages row with a
classification enum describing how to convert it to Anthropic
MessageParam shape. Handles V3-era tool_call and tool_result
rows (the ones the Phase 2 loader drops or mangles), managed-
native content blocks, V3 compaction system_summary rows, and
emits synthetic tu_legacy_<row.id> IDs when toolCallId is null.
Malformed rows are tagged unknown_drop with a reason for ops
visibility."
```

---

## Task 3: Rewrite loadManagedHistory with FIFO pairing + systemSummary extraction

**Files:**
- Modify: `app/src/lib/ai/agent/managed/history.ts`
- Create: `app/tests/unit/managed/history-v3-replay.test.ts`
- Create: `app/tests/unit/managed/history-mixed-runtime.test.ts`
- Create: `app/tests/unit/managed/history-batching.test.ts`
- Create: `app/tests/unit/managed/history-null-toolcallid.test.ts`
- Create: `app/tests/unit/managed/history-compacted.test.ts`
- Create: `app/tests/unit/managed/history-system-dropped.test.ts`
- Create: `app/tests/unit/managed/history-system-summary.test.ts`

The core loader rewrite. Uses `classifyRow` from Task 2 and FIFO pairing via a pending-tool_use queue.

### FIFO pairing rule (Desk Audit Fix 2)

**Do NOT pair by toolName.** Two consecutive calls to the same tool (e.g., two `search_calls` in one assistant turn) would collide.

**Pairing rule:**
1. Walk rows in strict `sequenceNumber` ascending order.
2. Maintain a FIFO queue of pending tool_use IDs from the current assistant batch (`pendingToolUseIds: string[]`).
3. When a `assistant_tool_call_legacy_v3` row is classified:
   - Append a `tool_use` block to `pendingAssistantBlocks` with the row's `toolUseId` (explicit or synthetic).
   - Push `toolUseId` onto `pendingToolUseIds`.
4. When a `user_tool_result_legacy_v3` row is classified:
   - Flush any `pendingAssistantBlocks` to an assistant message first.
   - Shift the oldest `toolUseId` from `pendingToolUseIds` (FIFO). That ID is the `tool_use_id` for this result block.
   - If `pendingToolUseIds` is empty: drop the result, log warn `orphan_tool_result_dropped` with `row.id` and `toolName` for ops.
   - Log a warning if `row.toolName !== expectedToolName` (sanity check only, does not affect pairing).
5. If the row is any other kind, flush pending assistant blocks first, then handle the row.
6. Group consecutive `user_tool_result_legacy_v3` rows into ONE user message with multiple `tool_result` content blocks.

The queue is scoped to a single assistant turn. When a non-tool_call assistant row or a user text row arrives, flush the pending blocks AND clear the queue — any remaining entries become orphan tool_use blocks handled by `ensurePairingInvariant` in Task 4.

- [ ] **Step 1: Write failing tests**

Create the 7 test files. Each stubs `db.select()` (and the session lookup for `history-system-summary.test.ts`) with fixture rows, calls `loadManagedHistory`, and asserts the returned `ManagedHistoryResult`.

**`history-v3-replay.test.ts`** — seed `[user_text "hello", assistant_tool_call search_calls(q=pnrr) id=tu_1, tool_result success data, assistant_text "done"]`. Assert the returned `messages` array has 4 entries: user text, assistant with one `tool_use`, user with one `tool_result`, assistant text.

**`history-mixed-runtime.test.ts`** — seed a V3-era sequence followed by a managed-native sequence (content blocks already). Assert V3 rows are normalized and managed rows pass through unchanged.

**`history-batching.test.ts`** — seed two consecutive V3 `tool_call` rows from the same assistant turn. Assert the result has ONE assistant message with TWO `tool_use` content blocks. Then seed matching `tool_result` rows. Assert they batch into ONE user message with TWO `tool_result` content blocks.

**`history-null-toolcallid.test.ts`** — three sub-tests:
  - Single null-toolCallId tool_call + tool_result → pairs via synthetic `tu_legacy_<id>`
  - **Duplicate toolName FIFO case**: seed `[assistant_tool_call search_calls id=m-1 (null), assistant_tool_call search_calls id=m-2 (null), tool_result success (null), tool_result success (null)]`. Assert result has one assistant message with 2 tool_use blocks `[tu_legacy_m-1, tu_legacy_m-2]` and one user message with 2 tool_result blocks whose `tool_use_id` matches FIFO order `[tu_legacy_m-1, tu_legacy_m-2]`.
  - Mixed: some rows have toolCallId, others null — pairing is still correct.

**`history-compacted.test.ts`** — seed a row with `compactedAt: new Date()`. Assert the row is dropped (not present in `messages`).

**`history-system-dropped.test.ts`** — seed `role='system', messageType='text', content='unrelated'`. Assert the row is dropped.

**`history-system-summary.test.ts`** — three sub-tests:
  - `system_summary` row with content string → `systemSummary` returned, row not in `messages`
  - No `system_summary` row but session has `messageSummary: 'fallback text'` → `systemSummary: 'fallback text'`, loader did NOT need to fetch session separately beyond the existing call
  - Neither source → `systemSummary: null`

Also seed the session row in the DB mock, since the loader needs to read `session.messageSummary` as a fallback source.

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement the rewritten loader**

```typescript
export async function loadManagedHistory(sessionId: string): Promise<ManagedHistoryResult> {
  // Fetch rows + session in parallel. The session lookup gives us the
  // messageSummary fallback when no system_summary row exists in history.
  const [rows, sessionRow] = await Promise.all([
    db.select().from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(asc(agentMessages.sequenceNumber)),
    db.select({ messageSummary: agentSessions.messageSummary })
      .from(agentSessions)
      .where(eq(agentSessions.id, sessionId))
      .limit(1),
  ])

  const messages: MessageParam[] = []
  let pendingAssistantBlocks: ContentBlock[] | null = null
  const pendingToolUseIds: string[] = []     // FIFO queue for legacy V3 pairing
  let pendingUserToolResults: ToolResultBlockParam[] | null = null
  let systemSummary: string | null = null

  const flushAssistant = () => {
    if (pendingAssistantBlocks && pendingAssistantBlocks.length > 0) {
      messages.push({ role: 'assistant', content: pendingAssistantBlocks })
    }
    pendingAssistantBlocks = null
    // Any ids left in the FIFO queue are orphan tool_use blocks. Leave them
    // there for ensurePairingInvariant (Task 4) to deal with — but we must
    // NOT carry them across assistant turns. Clear when an assistant flush
    // happens due to a non-tool-call row.
    pendingToolUseIds.length = 0
  }

  const flushUserToolResults = () => {
    if (pendingUserToolResults && pendingUserToolResults.length > 0) {
      messages.push({ role: 'user', content: pendingUserToolResults })
    }
    pendingUserToolResults = null
  }

  for (const row of rows) {
    if (row.compactedAt) continue  // represented via the system_summary row compaction wrote

    const c = classifyRow(row)

    switch (c.kind) {
      case 'system_summary':
        systemSummary = c.text
        continue

      case 'system_drop':
      case 'unknown_drop':
        continue

      case 'user_text':
        flushUserToolResults()
        flushAssistant()
        messages.push({ role: 'user', content: c.text })
        break

      case 'user_text_blocks':
        flushUserToolResults()
        flushAssistant()
        messages.push({ role: 'user', content: c.blocks as MessageParam['content'] })
        break

      case 'user_tool_result_native':
        flushAssistant()
        // Managed-native tool_result — merge into pendingUserToolResults
        // to batch consecutive result rows into one user message.
        if (!pendingUserToolResults) pendingUserToolResults = []
        pendingUserToolResults.push(...(c.blocks as ToolResultBlockParam[]))
        break

      case 'user_tool_result_legacy_v3': {
        flushAssistant()
        // FIFO pairing: shift the oldest unmatched tool_use id
        const toolUseId = pendingToolUseIds.shift() ?? c.toolUseId
        if (!pendingToolUseIds.length && pendingUserToolResults === null) {
          // We may be starting a fresh user tool_result batch; nothing to flush
        }
        if (!pendingUserToolResults) pendingUserToolResults = []
        pendingUserToolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: c.contentString,
          is_error: c.isError,
        })
        // Log warn if toolName mismatch (sanity check only)
        if (c.toolName !== 'unknown' && pendingToolUseIds.length > 0) {
          // We popped an id that may not match c.toolName; emit a warn
          // with both ids so ops can investigate.
        }
        break
      }

      case 'assistant_text':
        flushUserToolResults()
        flushAssistant()
        messages.push({ role: 'assistant', content: c.text })
        break

      case 'assistant_blocks_native':
        flushUserToolResults()
        flushAssistant()
        messages.push({ role: 'assistant', content: c.blocks as MessageParam['content'] })
        break

      case 'assistant_tool_call_legacy_v3':
        flushUserToolResults()
        // Accumulate into the current assistant turn (batching)
        if (!pendingAssistantBlocks) pendingAssistantBlocks = []
        pendingAssistantBlocks.push({
          type: 'tool_use',
          id: c.toolUseId,
          name: c.name,
          input: c.input as Record<string, unknown>,
        })
        pendingToolUseIds.push(c.toolUseId)
        break
    }
  }

  flushUserToolResults()
  flushAssistant()

  // Fallback summary source: session.messageSummary if no system_summary row
  if (systemSummary === null && sessionRow[0]?.messageSummary) {
    systemSummary = sessionRow[0].messageSummary
  }

  // Second pass: enforce pairing invariant (Task 4)
  const repaired = ensurePairingInvariant(messages)

  return { messages: repaired, systemSummary }
}
```

Notes:
- `pendingToolUseIds` is cleared inside `flushAssistant()`. That's intentional — a flush happens when the next row breaks the assistant turn (e.g., user text arrives). Any remaining pending IDs indicate an orphan tool_use that `ensurePairingInvariant` will handle.
- The FIFO queue is scoped to one assistant batch at a time.
- `toolName` from V3 rows is used only as a sanity-check warning, never as a pairing key.

- [ ] **Step 4: Run the 7 test files — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): rewrite loadManagedHistory with FIFO V3 pairing + systemSummary

Phase 2's loader dropped role='tool' rows and stringified object-
shape assistant content. V3 persists tool calls and tool results
in exactly the dropped/mangled shape; a session that touched V3
and then transitions to managed would replay mangled content.

New loader:
- Classifies every row via classifyRow (Task 2)
- Pairs V3 tool_call → tool_result via strict FIFO sequence order
  (NOT by toolName — two consecutive calls to the same tool would
  collide under toolName matching)
- Batches consecutive V3 tool_call rows into a single assistant
  message with multiple tool_use blocks
- Batches consecutive tool_result rows into a single user message
- Extracts system_summary rows into systemSummary return field
- Falls back to session.messageSummary when no system_summary row
  is present
- Generates synthetic tu_legacy_<row.id> IDs for null-toolCallId rows

Desk audit Finding 2 fix: duplicate toolName in one assistant
turn now pairs correctly via FIFO queue ordering."
```

---

## Task 4: ensurePairingInvariant with text-preserving orphan repair

**Files:**
- Modify: `app/src/lib/ai/agent/managed/history.ts` (add `ensurePairingInvariant`)
- Create: `app/tests/unit/managed/history-pairing-invariant.test.ts`

Anthropic's API requires every `tool_use` block in an assistant message to have a matching `tool_result` block in the *next* user message. V3 sessions that crashed mid-iteration can leave orphan `tool_use` rows. The repair must preserve any co-located assistant text.

### Text-preserving repair rule (Desk Audit Fix 3)

**Do NOT drop orphan assistant messages wholesale.** The managed runtime already persists mixed `[text, tool_use]` blocks in one message (`runtime.ts:145-156`). Dropping the message would discard legitimate assistant text.

**Repair rule (trim-only, single-path):**

1. **Assistant direction.** For each assistant message:
   - Collect its `tool_use` block ids.
   - Look at the next message. If it's a user message containing `tool_result` blocks, collect their `tool_use_id` set.
   - Determine orphan ids: `assistant_tool_use_ids \ next_user_tool_result_ids`.
   - **Trim** the orphan `tool_use` blocks from the assistant message's content array. Preserve all other blocks (text, other tool_use blocks whose results exist).
   - If the content array becomes empty after trimming, drop the message entirely.
2. **User direction (symmetric).** For each user message:
   - Collect its `tool_result` block ids.
   - Look at the preceding assistant message (in the already-processed output). Collect its `tool_use` id set.
   - Determine orphan ids: `user_tool_result_ids \ preceding_assistant_tool_use_ids`.
   - **Trim** the orphan `tool_result` blocks from the user message's content array. Preserve all other blocks (text, other tool_result blocks whose tool_use parents exist).
   - If the content array becomes empty after trimming, drop the user message.

**No synthetic blocks are ever inserted.** Trimming is single-path, complete, and leaves the message array in a shape Anthropic's API accepts. This is cheaper to reason about than a mixed trim-plus-synthesize rule and avoids the tricky cases where inserting a synthetic `tool_result` would require repositioning user messages relative to subsequent user text.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest'
import { ensurePairingInvariant } from '@/lib/ai/agent/managed/history'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'

describe('ensurePairingInvariant', () => {
  it('leaves well-paired tool_use/tool_result untouched', () => {
    const input: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_A', name: 'search', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_A', content: 'ok', is_error: false }] },
    ]
    const out = ensurePairingInvariant([...input])
    expect(out).toEqual(input)
  })

  it('preserves assistant text when trimming an orphan tool_use block', () => {
    const input: MessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: "I'll search for that" },
          { type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} },
        ],
      },
      { role: 'user', content: 'tell me more' },
    ]
    const out = ensurePairingInvariant(input)
    // Trim the orphan tool_use; keep the text block. No synthetic tool_result.
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: "I'll search for that" }],
    })
    expect(out[1]).toEqual({ role: 'user', content: 'tell me more' })
  })

  it('drops the assistant message entirely when its only content was an orphan tool_use', () => {
    const input: MessageParam[] = [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} }] },
      { role: 'user', content: 'what now?' },
    ]
    const out = ensurePairingInvariant(input)
    // Assistant message becomes empty after trimming tu_orphan → drop it entirely.
    // No synthetic tool_result is inserted (trim-only rule).
    expect(out).toEqual([{ role: 'user', content: 'what now?' }])
  })

  it('trims orphan tool_use blocks; keeps valid tool_use + result pair', () => {
    const input: MessageParam[] = [
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'tu_A', name: 'search', input: {} },
          { type: 'tool_use', id: 'tu_B', name: 'search', input: {} },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_A', content: 'ok', is_error: false }],
      },
    ]
    const out = ensurePairingInvariant(input)
    // tu_B is orphan (no matching tool_result in the next user message).
    // Trim tu_B from the assistant message. User message is unchanged.
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu_A', name: 'search', input: {} }],
    })
    expect(out[1]).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu_A', content: 'ok', is_error: false }],
    })
  })

  it('drops orphan tool_result blocks with no preceding tool_use', () => {
    const input: MessageParam[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu_orphan', content: 'ghost', is_error: false }],
      },
    ]
    const out = ensurePairingInvariant(input)
    // The orphan user message has only an orphan tool_result → drop the whole user message
    expect(out).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('drops only orphan tool_result blocks when the user message has other content', () => {
    const input: MessageParam[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'user text' },
          { type: 'tool_result', tool_use_id: 'tu_orphan', content: 'ghost', is_error: false },
        ],
      },
    ]
    const out = ensurePairingInvariant(input)
    // Drop the orphan tool_result block, keep the text block
    expect(out).toHaveLength(1)
    if (Array.isArray(out[0].content)) {
      expect(out[0].content).toEqual([{ type: 'text', text: 'user text' }])
    }
  })

  it('drops end-of-history assistant message whose only block is an orphan tool_use', () => {
    const input: MessageParam[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} }] },
    ]
    const out = ensurePairingInvariant(input)
    // Drop the orphan-only assistant message; nothing to pair with
    expect(out).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('preserves end-of-history assistant text when tool_use is orphan', () => {
    const input: MessageParam[] = [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'searching now' },
          { type: 'tool_use', id: 'tu_orphan', name: 'search', input: {} },
        ],
      },
    ]
    const out = ensurePairingInvariant(input)
    // The assistant text is preserved; the orphan tool_use is trimmed.
    // No synthetic tool_result is inserted (trim-only rule).
    expect(out).toHaveLength(2)
    expect(out[1]).toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'searching now' }],
    })
  })
})
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement ensurePairingInvariant**

```typescript
export function ensurePairingInvariant(messages: MessageParam[]): MessageParam[] {
  const out: MessageParam[] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      // Find tool_use block ids
      const toolUseBlocks = (msg.content as ContentBlock[]).filter(b => b.type === 'tool_use')
      if (toolUseBlocks.length === 0) {
        out.push(msg)
        continue
      }

      // Look at the next message to find matching tool_result ids
      const next = messages[i + 1]
      const matchedIds = new Set<string>()
      if (next && next.role === 'user' && Array.isArray(next.content)) {
        for (const block of next.content as ContentBlock[]) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            matchedIds.add(block.tool_use_id)
          }
        }
      }

      // Trim orphan tool_use blocks
      const trimmed = (msg.content as ContentBlock[]).filter(b => {
        if (b.type !== 'tool_use') return true
        return matchedIds.has((b as { id: string }).id)
      })

      if (trimmed.length > 0) {
        out.push({ role: 'assistant', content: trimmed as MessageParam['content'] })
      }
      // else: drop the now-empty assistant message
      continue
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
      // Find tool_result block ids
      const toolResultBlocks = (msg.content as ContentBlock[]).filter(b => b.type === 'tool_result')
      if (toolResultBlocks.length === 0) {
        out.push(msg)
        continue
      }

      // Look at the previous message (in `out`, since we process in order)
      // to find matching tool_use ids
      const prev = out[out.length - 1]
      const matchedIds = new Set<string>()
      if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
        for (const block of prev.content as ContentBlock[]) {
          if (block.type === 'tool_use' && typeof (block as { id: string }).id === 'string') {
            matchedIds.add((block as { id: string }).id)
          }
        }
      }

      // Trim orphan tool_result blocks
      const trimmed = (msg.content as ContentBlock[]).filter(b => {
        if (b.type !== 'tool_result') return true
        const id = (b as { tool_use_id: string }).tool_use_id
        return matchedIds.has(id)
      })

      if (trimmed.length > 0) {
        out.push({ role: 'user', content: trimmed as MessageParam['content'] })
      }
      continue
    }

    out.push(msg)
  }
  return out
}
```

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): enforce tool_use/tool_result pairing via text-preserving trim

Anthropic's API rejects message histories where a tool_use block
is not followed by a matching tool_result. V3 sessions that
crashed mid-iteration can leave orphan tool_use rows. The managed
runtime already persists mixed [text, tool_use] blocks in one
assistant message, so the original plan's 'drop the assistant
message' rule would discard legitimate text.

New rule: trim only orphan tool_use blocks from the assistant
message's content array. Drop the message only if it becomes
empty. Similarly trim orphan tool_result blocks from user
messages. Never insert synthetic blocks — trimming is always
safe and simpler to reason about.

Desk audit Finding 3 fix."
```

---

## Task 5: Real-DB integration test for V3 replay

**Files:**
- Create: `app/tests/integration/managed/history-real-v3-session.test.ts`

Real DB, no mocks. Seeds a session + user via raw SQL (follow the pattern from `tests/integration/services/phase3-concurrency.test.ts`), inserts `agent_messages` rows that mirror V3's `runtime.ts:253-266` persistence exactly:

```typescript
// V3 persistence shape (reproduced for seeding)
{ role: 'assistant', messageType: 'tool_call', content: { name: 'search_calls', arguments: { query: 'pnrr' } }, toolName: 'search_calls', toolCallId: null }
{ role: 'tool', messageType: 'tool_result', content: { success: true, data: { results: [] } }, toolName: 'search_calls', toolCallId: null }
```

Calls `loadManagedHistory(sessionId)` against the real DB. Asserts:
1. `messages.length >= 2` with the expected assistant/user content block shapes
2. No orphan tool_use blocks remain (every tool_use has a matching tool_result in the next user message)
3. `systemSummary` is null (or populated if the fixture also seeds a system_summary row)
4. Each MessageParam can be structurally validated against the expected shape (manual field checks, not a round-trip to Anthropic)

- [ ] **Step 1-5**: TDD + commit

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "test(phase3b): real-DB integration test for history normalizer

Seeds a V3-era session with direct DB inserts that mirror the
runtime.ts persistence shape exactly, then calls loadManagedHistory
against the real DB. Asserts the returned MessageParam[] has the
expected structure and no orphan tool_use blocks. Catches future
regressions where a real DB row shape drifts from the loader's
expectations."
```

---

## Task 6: buildManagedSystemPrompt priorSummary parameter + label rendering

**Files:**
- Modify: `app/src/lib/ai/agent/managed/prompt.ts`

This task adds the optional `priorSummary` parameter AND the bilingual `Prior conversation summary` label block that renders when the parameter is non-null. This is the only content change PR-B makes to the prompt — write-tool descriptions and hard rules land in PR-A's minimal delta. Backwards compatible: existing 4-arg callers get `priorSummary = null` by default and the prompt is byte-identical to Phase 2.

- [ ] **Step 1: Update the signature**

```typescript
export function buildManagedSystemPrompt(
  session: AgentSession,
  sections: AgentSection[],
  phase: Phase,
  locale: 'ro' | 'en',
  priorSummary: string | null = null,  // NEW
): string {
  // ... existing Phase 2 body UNCHANGED ...

  // Only addition: if priorSummary is non-null, append a labeled block at
  // the end of the prompt:
  if (priorSummary) {
    const label = locale === 'ro' ? '## Rezumat conversație anterioară' : '## Prior conversation summary'
    return `${existing}\n\n${label}\n\n${priorSummary}`
  }

  return existing
}
```

This is the ONLY content change to the prompt in PR-B. The write-tool descriptions and hard rules land in PR-A's minimal delta task. Phase 2 callers passing only 4 args see the exact same output as before.

- [ ] **Step 2: Write a test for the new parameter**

Create or extend `app/tests/unit/managed/prompt.test.ts`:

```typescript
describe('buildManagedSystemPrompt priorSummary parameter', () => {
  it('appends Romanian label when priorSummary is provided in ro locale', () => {
    const result = buildManagedSystemPrompt(baseSession, [], 'drafting', 'ro', 'Rezumat de test')
    expect(result).toMatch(/## Rezumat conversație anterioară/)
    expect(result).toMatch(/Rezumat de test/)
  })

  it('appends English label in en locale', () => {
    const result = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', 'Test summary')
    expect(result).toMatch(/## Prior conversation summary/)
    expect(result).toMatch(/Test summary/)
  })

  it('omits the label when priorSummary is null', () => {
    const result = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en', null)
    expect(result).not.toMatch(/Prior conversation summary/)
  })

  it('is backwards compatible (existing 4-arg call signature)', () => {
    const result = buildManagedSystemPrompt(baseSession, [], 'drafting', 'en')
    expect(result).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run — expect pass**

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): add priorSummary parameter + label block to managed prompt

buildManagedSystemPrompt gains an optional 5th parameter
priorSummary?: string | null (defaulting to null). When non-null,
the prompt renders a bilingual 'Prior conversation summary' block
at the end with the verbatim summary text. When null, the prompt
output is byte-identical to Phase 2 — all existing 4-arg callers
are unaffected.

This is the only prompt content change in PR-B. Write-tool
descriptions and the hard-rules block land in PR-A's minimal
delta. The full bilingual prompt rewrite is deferred to a
potential PR-C."
```

---

## Task 7: Wire systemSummary into runManagedTurn

**Files:**
- Modify: `app/src/lib/ai/agent/managed/runtime.ts`

- [ ] **Step 1: Find the existing call sites**

```bash
cd /home/godja/Dev/EU-Funds/app && grep -n "loadManagedHistory\|buildManagedSystemPrompt" src/lib/ai/agent/managed/runtime.ts
```

- [ ] **Step 2: Destructure and thread systemSummary**

Change:

```typescript
const { messages: history } = await loadManagedHistory(sessionId)
// ...
const systemPrompt = buildManagedSystemPrompt(session, sections, phase, locale)
```

to:

```typescript
const { messages: history, systemSummary } = await loadManagedHistory(sessionId)
// ...
const systemPrompt = buildManagedSystemPrompt(session, sections, phase, locale, systemSummary)
```

- [ ] **Step 3: Run tests + typecheck**

```bash
cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/unit/managed tests/integration/managed 2>&1 | tail -15
cd /home/godja/Dev/EU-Funds/app && npx tsc --noEmit 2>&1 | head -10
```

- [ ] **Step 4: Commit**

```bash
cd /home/godja/Dev/EU-Funds && git commit -m "feat(phase3b): pass prior conversation summary into managed prompt

runManagedTurn destructures { messages, systemSummary } from the
history normalizer and passes systemSummary as the 5th arg to
buildManagedSystemPrompt. V3-era compaction text now surfaces
into the managed agent's context under 'Prior conversation
summary' instead of being lost during the runtime migration."
```

---

## Task 8: Final verification pass

- [ ] **Step 1: Run the managed test suite**

```bash
cd /home/godja/Dev/EU-Funds/app && npx vitest run tests/unit/managed tests/integration/managed 2>&1 | tail -20
```

Expected: all pass. Specifically all 9 new history tests + the integration test + the prompt test.

- [ ] **Step 2: Run the full project test suite to catch regressions**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run test 2>&1 | tail -30
```

Expected: all tests pass. V3 runtime tests should be untouched.

- [ ] **Step 3: Typecheck**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run typecheck 2>&1 | tail -20
```

- [ ] **Step 4: Lint**

```bash
cd /home/godja/Dev/EU-Funds/app && npm run lint 2>&1 | tail -30
```

- [ ] **Step 5: Cross-boundary checks**

```bash
# Managed runtime must not import from V3 runtime.ts
cd /home/godja/Dev/EU-Funds/app && grep -rn "from '.*\.\./runtime'" src/lib/ai/agent/managed/ 2>&1 || echo "OK: managed does not import V3 runtime"
```

- [ ] **Step 6: Commit log review**

```bash
cd /home/godja/Dev/EU-Funds && git log --oneline <base-branch>..HEAD
```

Expected: ~8 commits, each prefixed `feat(phase3b):`, `refactor(phase3b):`, or `test(phase3b):`.

---

## Summary

| Task | Focus | Key deliverable |
|---|---|---|
| 1 | Refactor | `loadManagedHistory` return type → `ManagedHistoryResult` |
| 2 | History | `classifyRow` pure helper + 13 unit tests |
| 3 | History | Rewrite `loadManagedHistory` with FIFO pairing + systemSummary extraction + 7 unit test files |
| 4 | History | `ensurePairingInvariant` with text-preserving trim + 8 unit tests |
| 5 | History | Real-DB integration test for V3 replay |
| 6 | Prompt | `buildManagedSystemPrompt` gains `priorSummary` parameter + bilingual label block rendering |
| 7 | Runtime | Wire `{ messages, systemSummary }` destructuring + prompt threading |
| 8 | Verification | Full test + typecheck + lint + cross-boundary |

**Total:** 8 tasks, ~400 LOC added (~150 implementation, ~250 tests), ~50 LOC modified. Each task produces one focused commit.

---

## What PR-B does NOT deliver

- **No write-surface enablement.** PR-A is the follow-up.
- **No full prompt content rewrite.** PR-B makes one narrow content addition — the bilingual `Prior conversation summary` block that renders when `priorSummary` is non-null. When `priorSummary` is null, the prompt is byte-identical to Phase 2. Write-tool descriptions, hard rules, and any structural reorganization land in PR-A's minimal delta (or a later PR-C).
- **No managed executor changes.** PR-A.
- **No feature flag.** PR-A.
- **No MCP handler changes.** PR-A.
- **No V3 runtime changes.**
- **No frontend changes.**

---

## Post-merge rollout note

After this PR merges, `managed_agent_writes_enabled` still has no meaning (flag doesn't exist yet — PR-A creates it). The operational prerequisite for enabling writes in PR-A is:

1. This PR is merged and in production
2. The normalizer's metric panel shows zero `classification_error` events in a sample of at least 100 managed turns on read-only traffic
3. PR-A is merged
4. The runbook enable-writes checklist is completed

This PR alone is safe to merge and deploy. It's a pure read-path fix.
