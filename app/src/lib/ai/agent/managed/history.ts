// ── Managed runtime message history helpers ─────────────────────
// Read/write agent_messages rows as Anthropic MessageParam shapes.
// Tags each appended message with runtime_mode, provider, model
// for observability.

import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { db } from '@/lib/db'
import { agentMessages } from '@/lib/db/schema'
import { eq, asc, desc } from 'drizzle-orm'

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
export interface ManagedHistory {
  summary: string | null
  messages: MessageParam[]
}

/**
 * Load all non-compacted messages for a session and convert to
 * Anthropic MessageParam[] for replay in a managed turn. Any
 * `system_summary` rows encountered are extracted into the returned
 * `summary` field rather than streamed as messages.
 */
export async function loadManagedHistory(
  sessionId: string,
  opts: { fallbackSummary?: string | null } = {},
): Promise<ManagedHistory> {
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

  return { summary, messages }
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
