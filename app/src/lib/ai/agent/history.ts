// app/src/lib/ai/agent/history.ts
import type { Phase } from './types'
import { db } from '@/lib/db'
import { agentMessages, agentSessions } from '@/lib/db/schema'
import { eq, and, isNull, asc, desc } from 'drizzle-orm'
import { logger } from '@/lib/logger'

const log = logger.child({ component: 'agent-history' })

const COMPACTION_THRESHOLD = 40
const PRESERVE_RECENT = 10

export interface MessageForLLM {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  toolCallId?: string
  toolName?: string
}

/**
 * Router-shape message accepted by the Anthropic adapter via providers/router.ts.
 * Mirrors the inline type at runtime.ts:179-184 — exported here so the V3 pairing
 * invariant can operate on the same shape the LLM call consumes.
 */
export interface RouterMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
}

/**
 * Strip orphan tool_use / tool_result pairs from a V3 llmMessages array so the
 * conversation satisfies Anthropic's pairing requirement before reaching the
 * provider. Mirrors managed/history.ts:ensurePairingInvariant but operates on
 * router-shape messages (not Anthropic content-block arrays).
 *
 * Failure mode this guards: a previous V3 turn persisted an `assistant`
 * tool_call row but crashed before persisting the matching tool_result row.
 * On the next turn's replay (runtime.ts:211-248), the assistant message rebuilds
 * with `tool_calls: [...]` and the tool message is absent, so the LLM call
 * upstream 400s on "tool_use blocks must be followed by tool_result blocks".
 *
 * Trim rules (no synthetic insertion, no input mutation):
 *  - assistant.tool_calls: keep only those whose id has a matching subsequent
 *    role:'tool' message with the same tool_call_id. If tool_calls becomes
 *    empty AND content is empty, drop the assistant message entirely.
 *  - role:'tool': keep only if its tool_call_id matches a preceding (in OUTPUT,
 *    so repairs compound) assistant.tool_calls id.
 *  - Other roles and assistants with no tool_calls pass through untouched.
 */
export function ensureV3PairingInvariant(messages: RouterMessage[]): RouterMessage[] {
  const out: RouterMessage[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]

    if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
      // Collect every tool_call_id that appears in a subsequent 'tool' message
      // until the next non-tool message — that's the response window for this
      // assistant turn. We don't restrict to "immediately next" because the
      // V3 replay flattens each tool_result as its own message; multiple
      // tool_result messages may follow a single assistant turn.
      const matchedIds = new Set<string>()
      for (let j = i + 1; j < messages.length; j++) {
        const next = messages[j]
        if (next.role !== 'tool') break
        if (next.tool_call_id) matchedIds.add(next.tool_call_id)
      }

      const keptCalls = msg.tool_calls.filter(tc => matchedIds.has(tc.id))
      if (keptCalls.length === msg.tool_calls.length) {
        out.push(msg)
        continue
      }

      // Some tool_calls had no matching result — orphans. Trim them.
      if (keptCalls.length === 0 && (!msg.content || msg.content.length === 0)) {
        // Empty assistant turn after trim — drop entirely.
        continue
      }
      const rebuilt: RouterMessage = { role: 'assistant', content: msg.content }
      if (keptCalls.length > 0) rebuilt.tool_calls = keptCalls
      out.push(rebuilt)
      continue
    }

    if (msg.role === 'tool') {
      // Match against the most recent assistant in OUTPUT (post-repair), so a
      // dropped/trimmed assistant cascades correctly.
      const tcid = msg.tool_call_id
      if (!tcid) {
        // Defensive: route should never produce a tool message without an id;
        // if it does, drop it rather than 400 upstream.
        continue
      }
      // Walk backward through `out` looking for the closest assistant with
      // tool_calls. We stop at the first non-tool message — that's the boundary
      // of this tool-result window.
      let matched = false
      for (let k = out.length - 1; k >= 0; k--) {
        const prev = out[k]
        if (prev.role === 'tool') continue
        if (prev.role === 'assistant' && prev.tool_calls?.some(tc => tc.id === tcid)) {
          matched = true
        }
        break
      }
      if (matched) out.push(msg)
      // else: orphan tool_result, drop
      continue
    }

    out.push(msg)
  }

  return out
}

/**
 * Load conversation context for the LLM — uncompacted messages + optional summary.
 */
export async function loadContext(sessionId: string): Promise<{
  messages: MessageForLLM[]
  summary: string | null
  totalCount: number
}> {
  // Issue #81: filter on runtimeMode='v3' so V3 replay never consumes
  // managed-runtime rows after a managed→V3 degradation. Managed
  // assistant rows persist content as AnthropicContentBlock[] with the
  // tool-use id INSIDE content[] (toolCallId column stays null), and
  // managed tool_result rows have role='user' (not 'tool'). Without
  // this filter, the V3 replay loop in runtime.ts hands the model
  // stringified-JSON-as-text blocks it cannot interpret.
  const rows = await db.select()
    .from(agentMessages)
    .where(and(
      eq(agentMessages.sessionId, sessionId),
      isNull(agentMessages.compactedAt),
      eq(agentMessages.runtimeMode, 'v3'),
    ))
    .orderBy(asc(agentMessages.sequenceNumber))

  const messages: MessageForLLM[] = rows.map(row => ({
    role: row.role as MessageForLLM['role'],
    content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content),
    ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
    ...(row.toolName ? { toolName: row.toolName } : {}),
  }))

  // Unfiltered fetch covers the summary lookup AND the V3 depth gauge.
  // Split decision: `totalCount` is meant to gauge V3 history depth for
  // the compaction-threshold check, so it counts V3 rows only.
  //
  // The `summaryRow` lookup stays runtime-agnostic, but note: today every
  // summary persisted via `appendMessage` below picks up the column default
  // ('v3') because we do not forward `runtimeMode`, so this is effectively
  // a no-op in current code. Kept unfiltered as forward-compat in case a
  // future writer tags summaries by their producing runtime — at which
  // point the question of whether a managed summary should apply to a V3
  // replay becomes a real call. Until then, treat this as defensive.
  const allRows = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.sequenceNumber))

  // Check for an existing summary (system_summary type) regardless of runtimeMode.
  const summaryRow = allRows.find(r => r.messageType === 'system_summary')
  const summary = summaryRow ? (typeof summaryRow.content === 'string' ? summaryRow.content : JSON.stringify(summaryRow.content)) : null

  // V3-only depth — managed rows would otherwise inflate the count and
  // trip compaction prematurely on a session that just degraded.
  const totalCount = allRows.filter(r => (r.runtimeMode ?? 'v3') === 'v3').length

  return { messages, summary, totalCount }
}

/**
 * Append a message to the session history.
 *
 * Retries once on PG 23505 (UNIQUE(session_id, sequence_number) violation)
 * to handle intra-session sequence-number races. Mirrors
 * appendManagedMessage's pattern in managed/history.ts.
 */
export async function appendMessage(
  sessionId: string,
  message: {
    role: string
    messageType: string
    content: unknown
    toolName?: string
    toolCallId?: string
    turnId?: string | null
  },
): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [last] = await db.select()
      .from(agentMessages)
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
        turnId: message.turnId ?? null,
        sequenceNumber,
      })
      return sequenceNumber
    } catch (err) {
      const pgCode = (err as { code?: string } | null)?.code
      if (pgCode === '23505') {
        if (attempt === 0) continue
        throw new Error('appendMessage: sequence number conflict after retry')
      }
      throw err
    }
  }
  throw new Error('appendMessage: sequence number conflict after retry')
}

/**
 * Compact old messages when threshold is exceeded.
 * Preserves the most recent PRESERVE_RECENT messages and any tool call/result pairs.
 */
export async function compactIfNeeded(
  sessionId: string,
  currentPhase: Phase,
): Promise<{ compacted: boolean; summary?: string }> {
  void currentPhase

  const allRows = await db.select()
    .from(agentMessages)
    .where(and(
      eq(agentMessages.sessionId, sessionId),
      isNull(agentMessages.compactedAt),
    ))
    .orderBy(asc(agentMessages.sequenceNumber))

  if (allRows.length < COMPACTION_THRESHOLD) {
    return { compacted: false }
  }

  // Start with preserving the last PRESERVE_RECENT messages
  const candidateToKeep = new Set(
    allRows.slice(-PRESERVE_RECENT).map(r => r.id)
  )

  // Protect tool pairs: if one half is kept, keep the other.
  //
  // Two persistence shapes coexist in agent_messages:
  //   - V3 legacy: one row per tool call with messageType='tool_call' +
  //     row.toolCallId; paired tool_result rows also carry row.toolCallId.
  //   - Managed runtime: assistant rows carry messageType='text' with the
  //     tool_use block nested in content[] (see managed/runtime.ts:289);
  //     paired tool_result rows are standard messageType='tool_result'
  //     with row.toolCallId set to the block.id.
  //
  // Without scanning content[] for managed rows, the pairing map stays
  // empty for managed sessions and a tool_result kept inside the
  // preserve-recent window can lose its tool_use on compaction. On
  // replay, ensurePairingInvariant then strips the orphan tool_result.
  const toolCallIds = new Map<string, string>() // tool-use id -> message.id for call-side rows
  const toolResultIds = new Map<string, string>() // tool-use id -> message.id for result-side rows

  for (const row of allRows) {
    if (row.messageType === 'tool_call' && row.toolCallId) {
      toolCallIds.set(row.toolCallId, row.id)
    }
    if (row.messageType === 'tool_result' && row.toolCallId) {
      toolResultIds.set(row.toolCallId, row.id)
    }
    // Managed-runtime shape: tool_use blocks nested in assistant content[].
    if (row.role === 'assistant' && Array.isArray(row.content)) {
      for (const block of row.content as Array<{ type?: string; id?: string }>) {
        if (block?.type === 'tool_use' && typeof block.id === 'string') {
          toolCallIds.set(block.id, row.id)
        }
      }
    }
  }

  // If a tool_call is kept, keep its result too (and vice versa)
  for (const [tcId, callMsgId] of toolCallIds) {
    const resultMsgId = toolResultIds.get(tcId)
    if (resultMsgId) {
      if (candidateToKeep.has(callMsgId) || candidateToKeep.has(resultMsgId)) {
        candidateToKeep.add(callMsgId)
        candidateToKeep.add(resultMsgId)
      }
    }
  }

  const toCompact = allRows.filter(r => !candidateToKeep.has(r.id))

  if (toCompact.length === 0) {
    return { compacted: false }
  }

  // Build summary from messages being compacted
  const summaryParts: string[] = []
  for (const msg of toCompact) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    if (msg.messageType === 'tool_result' && msg.toolName) {
      summaryParts.push(`[Tool: ${msg.toolName}] ${content.slice(0, 100)}`)
    } else if (msg.role === 'user') {
      summaryParts.push(`[User] ${content.slice(0, 150)}`)
    } else if (msg.role === 'assistant' && msg.messageType === 'text') {
      summaryParts.push(`[Assistant] ${content.slice(0, 150)}`)
    }
  }

  const summary = `Conversation history summary (${toCompact.length} messages compacted):\n${summaryParts.join('\n')}`

  // Mark messages as compacted
  const now = new Date()
  for (const msg of toCompact) {
    await db.update(agentMessages)
      .set({ compactedAt: now })
      .where(eq(agentMessages.id, msg.id))
  }

  // Insert summary message
  await appendMessage(sessionId, {
    role: 'system',
    messageType: 'system_summary',
    content: summary,
  })

  // Persist summary to the durable messageSummary field on the session
  await db.update(agentSessions)
    .set({ messageSummary: summary })
    .where(eq(agentSessions.id, sessionId))

  log.info({ sessionId, compacted: toCompact.length, remaining: PRESERVE_RECENT }, 'History compacted')

  return { compacted: true, summary }
}
