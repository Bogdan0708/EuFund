// ── Managed runtime message history helpers ─────────────────────
// Read/write agent_messages rows as Anthropic MessageParam shapes.
// Tags each appended message with runtime_mode, provider, model
// for observability.

import type { MessageParam, ContentBlock, ContentBlockParam, ToolResultBlockParam } from '@anthropic-ai/sdk/resources/messages'
import { db } from '@/lib/db'
import { agentMessages, agentSessions, agentTurns } from '@/lib/db/schema'
import { eq, asc, desc, count as sqlCount } from 'drizzle-orm'

export interface ManagedMessageMeta {
  runtimeMode: 'v3' | 'managed'
  provider?: string | null
  model?: string | null
}

// Near-copy of V3 summary semantics (see lib/ai/agent/history.ts for the
// V3 compaction writer — the only path that currently creates
// system_summary rows). EXTRACTION SEAM: this logic is a candidate for a
// shared history helper in a post-pilot cleanup. Keep it local for now to
// minimize blast radius.
export interface ManagedHistoryResult {
  messages: MessageParam[]
  systemSummary: string | null
}

/**
 * Load all non-compacted messages for a session and convert to
 * Anthropic MessageParam[] for replay in a managed turn.
 *
 * Phase 3b Task 3 rewrite: uses classifyRow + FIFO pairing for V3 legacy
 * tool_call/tool_result rows. Reads session.messageSummary as a fallback
 * summary source when no system_summary row exists in the message history.
 *
 * Returns { messages, systemSummary }. Task 7 wires systemSummary through
 * to buildManagedSystemPrompt; this loader just extracts it.
 *
 * Messages are repaired via ensurePairingInvariant before return, trimming
 * orphan tool_use/tool_result blocks from crashed V3 sessions so Anthropic's
 * API accepts the replay.
 */
export async function loadManagedHistory(
  sessionId: string,
): Promise<ManagedHistoryResult> {
  // Fetch rows + session in parallel. The session lookup gives us the
  // messageSummary fallback when no system_summary row exists in history.
  const [rows, sessionRow] = await Promise.all([
    db.select()
      .from(agentMessages)
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

  // Flush pending assistant tool_use blocks to a message.
  // clearQueue=true: also clear the FIFO pendingToolUseIds queue (used when
  //   a non-tool-call row interrupts the assistant turn — any remaining queue
  //   entries become orphan tool_use blocks for Task 4's ensurePairingInvariant).
  // clearQueue=false: preserve the FIFO queue for the upcoming tool_result rows
  //   that are about to consume it (used when flushing prior to processing
  //   user_tool_result_legacy_v3 rows).
  const flushAssistant = (clearQueue = true) => {
    if (pendingAssistantBlocks && pendingAssistantBlocks.length > 0) {
      messages.push({ role: 'assistant', content: pendingAssistantBlocks })
    }
    pendingAssistantBlocks = null
    if (clearQueue) {
      pendingToolUseIds.length = 0
    }
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
        flushAssistant(true)
        messages.push({ role: 'user', content: c.text })
        break

      case 'user_text_blocks':
        flushUserToolResults()
        flushAssistant(true)
        messages.push({ role: 'user', content: c.blocks as MessageParam['content'] })
        break

      case 'user_tool_result_native':
        // Flush pending assistant blocks but PRESERVE the FIFO queue —
        // native tool_result rows that follow V3 tool_call rows still need it.
        flushAssistant(false)
        if (!pendingUserToolResults) pendingUserToolResults = []
        pendingUserToolResults.push(...(c.blocks as ToolResultBlockParam[]))
        break

      case 'user_tool_result_legacy_v3': {
        // Flush pending assistant blocks but PRESERVE the FIFO queue so we can
        // shift the matching toolUseId for this result.
        flushAssistant(false)
        const toolUseId = pendingToolUseIds.shift() ?? c.toolUseId
        if (!pendingUserToolResults) pendingUserToolResults = []
        pendingUserToolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: c.contentString,
          is_error: c.isError,
        })
        break
      }

      case 'assistant_text':
        flushUserToolResults()
        flushAssistant(true)
        messages.push({ role: 'assistant', content: c.text })
        break

      case 'assistant_blocks_native':
        flushUserToolResults()
        flushAssistant(true)
        messages.push({ role: 'assistant', content: c.blocks as MessageParam['content'] })
        break

      case 'assistant_tool_call_legacy_v3':
        flushUserToolResults()
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

  // Fallback summary source: session.messageSummary if no system_summary row.
  if (systemSummary === null && sessionRow[0]?.messageSummary) {
    systemSummary = sessionRow[0].messageSummary
  }

  // Trim orphan tool_use/tool_result blocks before returning. Crashed V3
  // sessions may leave unpaired blocks that Anthropic's API would reject.
  const repaired = ensurePairingInvariant(messages)
  return { messages: repaired, systemSummary }
}

/**
 * Append a new message to agent_messages with Phase 2 observability
 * tags (runtime_mode, provider, model).
 */
export async function appendManagedMessage(
  sessionId: string,
  message: {
    role: 'user' | 'assistant'
    messageType: 'text' | 'tool_use' | 'tool_result'
    content: unknown
    toolName?: string
    toolCallId?: string
    turnId?: string | null
  },
  meta: ManagedMessageMeta,
): Promise<number> {
  // Storage-layer safety net for sequence-number races. Two concurrent
  // appends can compute the same sequenceNumber before either insert
  // commits; the UNIQUE (session_id, sequence_number) constraint then
  // raises PG error 23505 on the loser. Retry once recomputes the
  // sequence and tries again. Real per-turn dedupe lives in the
  // agent_turns claim (see route — Task 7); this is a backstop.
  for (let attempt = 0; attempt < 2; attempt++) {
    const [last] = await db.select()
      .from(agentMessages)
      .where(eq(agentMessages.sessionId, sessionId))
      .orderBy(desc(agentMessages.sequenceNumber))
      .limit(1)

    const sequenceNumber = last ? (last.sequenceNumber as number) + 1 : 0

    try {
      // content can be a string, an array of content blocks, or an object.
      // The jsonb column accepts any JSON shape; the `as never` cast
      // satisfies Drizzle's typed insert signature.
      await db.insert(agentMessages).values({
        sessionId,
        role: message.role,
        messageType: message.messageType,
        content: message.content as never,
        toolName: message.toolName ?? null,
        toolCallId: message.toolCallId ?? null,
        turnId: message.turnId ?? null,
        sequenceNumber,
        runtimeMode: meta.runtimeMode,
        provider: meta.provider ?? null,
        model: meta.model ?? null,
      })
      return sequenceNumber
    } catch (err) {
      const pgCode = (err as { code?: string } | null)?.code
      if (pgCode === '23505' && attempt === 0) continue
      throw err
    }
  }
  throw new Error('appendManagedMessage: sequence number conflict after retry')
}

export type ClaimResult =
  | { kind: 'claimed'; turnId: string }
  // Any UNIQUE(session_id, request_id) violation. Route returns HTTP 409.
  | { kind: 'conflict' }

/**
 * Pre-stream turn-claim. Inserts a new agent_turns row atomically and
 * returns the new turn id, or `{kind:'conflict'}` on PG 23505.
 *
 * **No inline reclaim.** "No child messages" is the normal state of a
 * live turn during stream startup (the window between claim insert and
 * first durable output can be tens of seconds). An inline
 * "no-children → reclaim" rule would race with active streams and
 * delete legitimate in-flight turns. Pre-output stream failures are
 * cleaned up by the runtime's catch branch via `deleteEmptyTurn`;
 * orphan claims from failed cleanup are swept by the daily cron.
 *
 * Ownership is verified inside the transaction. The route has already
 * verified ownership when loading the session row — this is defence in
 * depth for any future direct caller.
 */
export async function claimTurn(input: {
  sessionId: string
  userId: string
  requestId: string
  runtimeMode: 'v3' | 'managed'
}): Promise<ClaimResult> {
  try {
    return await db.transaction(async (tx) => {
      const [sess] = await tx
        .select({ userId: agentSessions.userId })
        .from(agentSessions)
        .where(eq(agentSessions.id, input.sessionId))
        .limit(1)
      if (!sess || sess.userId !== input.userId) {
        throw new Error('session ownership denied')
      }
      const [row] = await tx
        .insert(agentTurns)
        .values({
          sessionId: input.sessionId,
          requestId: input.requestId,
          runtimeMode: input.runtimeMode,
        })
        .returning({ id: agentTurns.id })
      return { kind: 'claimed', turnId: row.id } as const
    })
  } catch (err) {
    const pgCode = (err as { code?: string } | null)?.code
    if (pgCode === '23505') return { kind: 'conflict' }
    throw err
  }
}

/**
 * Delete an empty turn-claim row after a pre-output stream failure.
 * Safety net: if the turn has any child agent_messages rows, this is a
 * no-op. Callers must only invoke this before any first durable output
 * has been persisted.
 */
export async function deleteEmptyTurn(turnId: string): Promise<void> {
  const [row] = await db
    .select({ c: sqlCount() })
    .from(agentMessages)
    .where(eq(agentMessages.turnId, turnId))
  const childCount = (row?.c ?? 0) as number
  if (childCount > 0) return
  await db.delete(agentTurns).where(eq(agentTurns.id, turnId))
}

/**
 * Single transaction that persists the user message and the first
 * durable assistant/tool_use output, both tagged with `turnId`. Uses
 * retry-once on PG 23505 against the unique
 * (session_id, sequence_number) index. Second conflict rolls back the
 * whole transaction — caller sees a thrown error, not a partial write.
 */
export async function persistFirstDurableOutput(input: {
  turnId: string
  sessionId: string
  userMessage: string
  firstOutput: {
    role: 'assistant'
    messageType: 'text' | 'tool_use'
    content: unknown
    toolName?: string
    toolCallId?: string
  }
  meta: ManagedMessageMeta
}): Promise<void> {
  // Retry wraps the WHOLE transaction, not the inserts inside it. On PG,
  // a constraint violation aborts the current transaction — subsequent
  // statements in the same tx raise "current transaction is aborted".
  // Each retry must therefore open a fresh transaction.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.transaction(async (tx) => {
        const [last] = await tx
          .select()
          .from(agentMessages)
          .where(eq(agentMessages.sessionId, input.sessionId))
          .orderBy(desc(agentMessages.sequenceNumber))
          .limit(1)
        const userSeq = last ? (last.sequenceNumber as number) + 1 : 0

        await tx.insert(agentMessages).values({
          sessionId: input.sessionId,
          role: 'user',
          messageType: 'text',
          content: input.userMessage as never,
          turnId: input.turnId,
          sequenceNumber: userSeq,
          runtimeMode: input.meta.runtimeMode,
          provider: input.meta.provider ?? null,
          model: input.meta.model ?? null,
        })
        await tx.insert(agentMessages).values({
          sessionId: input.sessionId,
          role: 'assistant',
          messageType: input.firstOutput.messageType,
          content: input.firstOutput.content as never,
          toolName: input.firstOutput.toolName ?? null,
          toolCallId: input.firstOutput.toolCallId ?? null,
          turnId: input.turnId,
          sequenceNumber: userSeq + 1,
          runtimeMode: input.meta.runtimeMode,
          provider: input.meta.provider ?? null,
          model: input.meta.model ?? null,
        })
      })
      return
    } catch (err) {
      const pgCode = (err as { code?: string } | null)?.code
      if (pgCode === '23505' && attempt === 0) continue
      throw err
    }
  }
  throw new Error('persistFirstDurableOutput: sequence conflict after retry')
}

// ── ensurePairingInvariant ───────────────────────────────────────
// Trims orphan tool_use and tool_result blocks from a MessageParam[]
// so the array satisfies Anthropic's pairing requirement:
//   every tool_use in an assistant message must have a matching
//   tool_result in the *immediately following* user message.
//
// Repair rule (trim-only, no synthetic insertion):
//   Assistant direction: remove tool_use blocks whose id is NOT in the
//     next user message's tool_result set. Drop the assistant message
//     entirely if trimming empties its content array.
//   User direction: remove tool_result blocks whose tool_use_id is NOT
//     in the *output*-previous assistant message's tool_use set
//     (uses `out[last]`, not `messages[i-1]`, so repairs compound).
//     Drop the user message entirely if trimming empties its content array.
//   String content passes through untouched (non-array = no tool blocks).
//
// Single pass, O(n). Does not mutate the input array.

export function ensurePairingInvariant(messages: MessageParam[]): MessageParam[] {
  const out: MessageParam[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolUseBlocks = (msg.content as ContentBlock[]).filter(b => b.type === 'tool_use')

      if (toolUseBlocks.length === 0) {
        out.push(msg)
        continue
      }

      // Look at the next message to find matching tool_result ids.
      // Next is a user message: its content is ContentBlockParam[].
      const next = messages[i + 1]
      const matchedIds = new Set<string>()
      if (next && next.role === 'user' && Array.isArray(next.content)) {
        for (const block of next.content as ContentBlockParam[]) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            matchedIds.add(block.tool_use_id)
          }
        }
      }

      // Trim orphan tool_use blocks; keep all non-tool_use blocks and
      // tool_use blocks whose id has a matching tool_result.
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
      // User-message content is ContentBlockParam[] (includes ToolResultBlockParam,
      // ImageBlockParam, etc. — not in the narrower ContentBlock union used for
      // assistant response blocks).
      const toolResultBlocks = (msg.content as ContentBlockParam[]).filter(b => b.type === 'tool_result')

      if (toolResultBlocks.length === 0) {
        out.push(msg)
        continue
      }

      // Look at the previous message in `out` (not messages[i-1]) so that
      // repairs compound correctly when an assistant message was dropped.
      const prev = out[out.length - 1]
      const matchedIds = new Set<string>()
      if (prev && prev.role === 'assistant' && Array.isArray(prev.content)) {
        for (const block of prev.content as ContentBlock[]) {
          if (block.type === 'tool_use' && typeof block.id === 'string') {
            matchedIds.add(block.id)
          }
        }
      }

      // Trim orphan tool_result blocks; keep all non-tool_result blocks and
      // tool_result blocks whose tool_use_id has a matching tool_use.
      const trimmed = (msg.content as ContentBlockParam[]).filter(b => {
        if (b.type !== 'tool_result') return true
        return matchedIds.has(b.tool_use_id)
      })

      if (trimmed.length > 0) {
        out.push({ role: 'user', content: trimmed as MessageParam['content'] })
      }
      // else: drop the now-empty user message
      continue
    }

    out.push(msg)
  }

  return out
}

// ── classifyRow ──────────────────────────────────────────────────
// Pure helper: tags each agent_messages row with a discriminated
// union describing how the Phase 3b loader should convert it to an
// Anthropic MessageParam content-block shape.
//
// Consumed by loadManagedHistory (wired in as of Task 3).

export type RowClassification =
  // --- Keep variants (produce Anthropic MessageParam output) ---
  | { kind: 'user_text'; text: string }
  | { kind: 'user_text_blocks'; blocks: unknown[] }
  | { kind: 'user_tool_result_native'; blocks: unknown[] }
  | { kind: 'user_tool_result_legacy_v3'; toolUseId: string; toolName: string; contentString: string; isError: boolean }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'assistant_blocks_native'; blocks: unknown[] }
  | { kind: 'assistant_tool_call_legacy_v3'; toolUseId: string; name: string; input: unknown }
  | { kind: 'system_summary'; text: string }
  // --- Known legacy drop variants (explicitly classified, no output) ---
  | { kind: 'system_drop' }
  // --- Unknown fallback (last resort; telemetry-visible via reason) ---
  | { kind: 'unknown_drop'; reason: string }

export function classifyRow(row: typeof agentMessages.$inferSelect): RowClassification {
  // Synthetic ID for rows where toolCallId was not persisted (V3 era)
  const synthId = (id: string) => `tu_legacy_${id}`

  // --- Keep variants (produce Anthropic MessageParam output) ---

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
      // V3 runtime persists toolCall.arguments as a JSON-encoded STRING
      // (see lib/ai/agent/runtime.ts:257 — the raw string from the model's
      // tool_call is stored unchanged; runtime.ts:211 JSON.parses it at
      // execution time, which proves the persisted shape is string).
      // Anthropic's tool_use.input requires an object, so parse strings
      // here. Tolerate object shapes too — test fixtures and any non-V3
      // writer that stored a parsed object still work.
      const rawArgs = content.arguments
      let input: unknown = {}
      if (typeof rawArgs === 'string') {
        try {
          input = JSON.parse(rawArgs)
        } catch {
          input = {}
        }
      } else if (rawArgs && typeof rawArgs === 'object') {
        input = rawArgs
      }
      return {
        kind: 'assistant_tool_call_legacy_v3',
        toolUseId: row.toolCallId ?? synthId(row.id),
        name: content.name,
        input,
      }
    }
    return { kind: 'unknown_drop', reason: 'V3 assistant tool_call content missing name field' }
  }

  // V3 legacy tool_result row (role='tool', written by V3 runtime)
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

  // --- Known legacy drop variants (explicitly classified, no output) ---

  // Known legacy V3 control-plane rows — intentionally dropped with a
  // distinctive reason so ops telemetry can distinguish them from
  // genuinely unknown rows reaching the final fallback.
  if (row.role === 'user' && row.messageType === 'structured_action') {
    return { kind: 'unknown_drop', reason: 'legacy_v3_user_structured_action_control_plane' }
  }

  if (row.role === 'system') return { kind: 'system_drop' }

  // --- Unknown fallback (last resort; telemetry-visible via reason) ---
  return { kind: 'unknown_drop', reason: `unhandled role=${row.role} messageType=${row.messageType}` }
}

export interface TurnTelemetry {
  model?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  cacheReadInputTokens?: number | null
  cacheCreationInputTokens?: number | null
  costUsdMicros?: number | null
}

export async function markTurnCompleted(
  turnId: string,
  telemetry: TurnTelemetry = {},
): Promise<void> {
  await db
    .update(agentTurns)
    .set({
      completedAt: new Date(),
      model: telemetry.model ?? null,
      inputTokens: telemetry.inputTokens ?? null,
      outputTokens: telemetry.outputTokens ?? null,
      cacheReadInputTokens: telemetry.cacheReadInputTokens ?? null,
      cacheCreationInputTokens: telemetry.cacheCreationInputTokens ?? null,
      costUsdMicros: telemetry.costUsdMicros ?? null,
    })
    .where(eq(agentTurns.id, turnId))
}
