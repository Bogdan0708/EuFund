// ── Managed runtime message history helpers ─────────────────────
// Read/write agent_messages rows as Anthropic MessageParam shapes.
// Tags each appended message with runtime_mode, provider, model
// for observability.

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
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
 * Returns { messages, systemSummary } where systemSummary is reserved for
 * the Phase 3b normalizer rewrite (Task 7). The current shim always
 * returns systemSummary: null — the Phase 2 body logic is preserved
 * intact and the summary wiring is a no-op until Task 7 lands.
 */
export async function loadManagedHistory(
  sessionId: string,
  opts: { fallbackSummary?: string | null } = {},
): Promise<ManagedHistoryResult> {
  const rows = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.sequenceNumber))

  let summary: string | null = null
  const messages: MessageParam[] = []

  for (const row of rows) {
    if (row.messageType === 'system_summary') {
      if (typeof row.content === 'string') summary = row.content
      continue
    }
    if (row.compactedAt) continue // skip compacted messages

    const role = row.role as 'user' | 'assistant'
    if (role !== 'user' && role !== 'assistant') continue

    // Content normalization: row.content can be a string (V3-style)
    // or an array of content blocks (Anthropic-native).
    const content = row.content
    if (typeof content === 'string') {
      messages.push({ role, content })
    } else if (Array.isArray(content)) {
      messages.push({ role, content: content as MessageParam['content'] })
    } else {
      // Object form (e.g., structured action from V3) — serialize as text
      messages.push({ role, content: JSON.stringify(content) })
    }
  }

  if (summary === null && opts.fallbackSummary) summary = opts.fallbackSummary

  // systemSummary wiring lands in Task 7. Shim: always null.
  void summary
  return { messages, systemSummary: null }
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

export async function markTurnCompleted(turnId: string): Promise<void> {
  await db
    .update(agentTurns)
    .set({ completedAt: new Date() })
    .where(eq(agentTurns.id, turnId))
}
