// app/src/lib/ai/agent/history.ts
import type { Phase } from './types'
import { db } from '@/lib/db'
import { agentMessages } from '@/lib/db/schema'
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
  _currentPhase: Phase,
): Promise<{ compacted: boolean; summary?: string }> {
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

  // Keep the last PRESERVE_RECENT messages
  const toCompact = allRows.slice(0, allRows.length - PRESERVE_RECENT)

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

  log.info({ sessionId, compacted: toCompact.length, remaining: PRESERVE_RECENT }, 'History compacted')

  return { compacted: true, summary }
}
