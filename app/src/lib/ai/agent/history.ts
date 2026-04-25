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
 * Load conversation context for the LLM — uncompacted messages + optional summary.
 */
export async function loadContext(sessionId: string): Promise<{
  messages: MessageForLLM[]
  summary: string | null
  totalCount: number
}> {
  const rows = await db.select()
    .from(agentMessages)
    .where(and(
      eq(agentMessages.sessionId, sessionId),
      isNull(agentMessages.compactedAt),
    ))
    .orderBy(asc(agentMessages.sequenceNumber))

  const messages: MessageForLLM[] = rows.map(row => ({
    role: row.role as MessageForLLM['role'],
    content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content),
    ...(row.toolCallId ? { toolCallId: row.toolCallId } : {}),
    ...(row.toolName ? { toolName: row.toolName } : {}),
  }))

  // Get total count for compaction check
  const allRows = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.sequenceNumber))

  // Check for an existing summary (system_summary type)
  const summaryRow = allRows.find(r => r.messageType === 'system_summary')
  const summary = summaryRow ? (typeof summaryRow.content === 'string' ? summaryRow.content : JSON.stringify(summaryRow.content)) : null

  return { messages, summary, totalCount: allRows.length }
}

/**
 * Append a message to the session history.
 */
export async function appendMessage(
  sessionId: string,
  message: {
    role: string
    messageType: string
    content: unknown
    toolName?: string
    toolCallId?: string
  },
): Promise<number> {
  // Get next sequence number
  const [last] = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.sequenceNumber))
    .limit(1)

  const sequenceNumber = last ? last.sequenceNumber + 1 : 0

  await db.insert(agentMessages).values({
    sessionId,
    role: message.role,
    messageType: message.messageType,
    content: message.content,
    toolName: message.toolName ?? null,
    toolCallId: message.toolCallId ?? null,
    sequenceNumber,
  })

  return sequenceNumber
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
