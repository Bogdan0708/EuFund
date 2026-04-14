import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workflowMessages, workflowSessions } from '@/lib/db/schema'
import type { SectionResult } from '@/lib/ai/agent/types'

// ─── Inlined SSE types ──────────────────────────────────────────
// Originally lived in lib/ai/orchestrator/types.ts. Inlined here so
// pubsub.ts stands alone after the orchestrator folder is deleted.
// The rich variants reference orchestrator-era shapes (CheckpointData,
// WorkflowContext, ProjectCompletionStatus); kept structurally as
// loose objects since the only keeper consumer (lib/workspace.ts) only
// publishes 'section_updated' events.

export interface CheckpointData {
  question: string
  options?: { id: string; label: string; description?: string }[]
  type: 'select' | 'confirm' | 'freetext'
}

export type ProjectCompletionStatus = 'complete' | 'complete_with_gaps' | 'needs_review' | 'blocked'

export type SSEEvent = {
  eventId: number
} & (
  | { type: 'step_start'; step: number; label: string }
  | { type: 'step_progress'; step: number; message: string }
  | { type: 'ai_chunk'; step: number; content: string }
  | { type: 'checkpoint'; step: number; data: CheckpointData; context?: Record<string, unknown>; autoApprove?: boolean }
  | { type: 'step_complete'; step: number; summary: string; context?: Record<string, unknown> }
  | { type: 'discovery'; items: unknown[] }
  | { type: 'error'; step: number; message: string; retryable: boolean }
  | { type: 'done'; projectId?: string; completionStatus?: ProjectCompletionStatus }
  | { type: 'section_updated'; sectionId: string; section: SectionResult }
)

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never
export type SSEEventPayload = DistributiveOmit<SSEEvent, 'eventId'>

export interface SSEStream {
  send(event: SSEEventPayload): void
  close(): void
}

export function getChannelName(sessionId: string): string {
  return `orchestrator:${sessionId}`
}

export async function publishEvent(sessionId: string, event: SSEEvent): Promise<void> {
  try {
    const { getRedis } = await import('@/lib/redis/client')
    const redis = getRedis()
    if (!redis) return
    await redis.publish(getChannelName(sessionId), JSON.stringify(event))
  } catch {
    // Non-fatal — SSE event lost but workflow continues
  }
}

async function nextReplayEventId(tx: { select: typeof db.select }, sessionId: string): Promise<number> {
  const [lastEvent] = await tx
    .select({ eventId: workflowMessages.eventId })
    .from(workflowMessages)
    .where(eq(workflowMessages.sessionId, sessionId))
    .orderBy(desc(workflowMessages.eventId), desc(workflowMessages.createdAt))
    .limit(1);

  return (lastEvent?.eventId ?? 0) + 1;
}

export async function persistAndPublishReplayableEvent(
  sessionId: string,
  event: SSEEventPayload,
): Promise<SSEEvent> {
  const eventId = await db.transaction(async (tx) => {
    await tx
      .select({ id: workflowSessions.id })
      .from(workflowSessions)
      .where(eq(workflowSessions.id, sessionId))
      .for('update');

    const nextEventId = await nextReplayEventId(tx, sessionId);
    const fullEvent = { ...event, eventId: nextEventId } as SSEEvent;
    const step = 'step' in fullEvent && typeof fullEvent.step === 'number' ? fullEvent.step : null;

    await tx.insert(workflowMessages).values({
      sessionId,
      eventId: nextEventId,
      role: 'system',
      content: JSON.stringify(fullEvent),
      eventType: fullEvent.type,
      step,
      metadata: null,
    });

    return nextEventId;
  });

  const fullEvent: SSEEvent = { ...event, eventId } as SSEEvent;

  await publishEvent(sessionId, fullEvent);
  return fullEvent;
}

export async function persistAndPublishSectionUpdatedEvent(
  sessionId: string,
  sectionId: string,
  section: SectionResult,
): Promise<SSEEvent> {
  return persistAndPublishReplayableEvent(sessionId, {
    type: 'section_updated',
    sectionId,
    section,
  });
}

export function createPubSubStream(sessionId: string): SSEStream {
  let queue: Promise<void> = Promise.resolve()

  return {
    send(event) {
      queue = queue
        .then(async () => {
          await persistAndPublishReplayableEvent(sessionId, event)
        })
        .catch(() => undefined)
    },
    close() {
      queue = queue
        .then(async () => {
          await persistAndPublishReplayableEvent(sessionId, { type: 'done' })
        })
        .catch(() => undefined)
    },
  }
}
