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

/**
 * Load all non-compacted messages for a session and convert to
 * Anthropic MessageParam[] for replay in a managed turn.
 */
export async function loadManagedHistory(sessionId: string): Promise<MessageParam[]> {
  const rows = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(asc(agentMessages.sequenceNumber))

  const messages: MessageParam[] = []
  for (const row of rows) {
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

  return messages
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
  const [last] = await db.select()
    .from(agentMessages)
    .where(eq(agentMessages.sessionId, sessionId))
    .orderBy(desc(agentMessages.sequenceNumber))
    .limit(1)

  const sequenceNumber = last ? (last.sequenceNumber as number) + 1 : 0

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
}
