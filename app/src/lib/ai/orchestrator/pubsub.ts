import { desc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { workflowMessages, workflowSessions } from '@/lib/db/schema'
import type { SectionResult, SSEEvent, SSEEventPayload, SSEStream } from './types'

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
