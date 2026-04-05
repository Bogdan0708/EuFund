import { NextRequest, NextResponse } from 'next/server';
import { FondEUError } from '@/lib/errors';
import { requireOwnedSession } from '@/lib/ai/orchestrator/require-owned-session';
import { transitionSectionState, SectionVersionError } from '@/lib/ai/orchestrator/section-versions';
import { publishEvent } from '@/lib/ai/orchestrator/pubsub';
import { logger } from '@/lib/logger';

const log = logger.child({ route: 'section-state' });

const ALLOWED_STATES = new Set(['draft', 'reviewed', 'approved']);

const ERROR_STATUS: Record<string, number> = {
  SectionNotFound: 404,
  VersionNotFound: 404,
  InvalidStateTransition: 400,
  FailedSectionCannotBeApproved: 400,
  ConcurrentModification: 409,
  VersionIntegrityMismatch: 500,
};

export async function POST(
  req: NextRequest,
  ctx: { params: { sessionId: string; sectionId: string } },
) {
  try {
    const { sessionId, sectionId } = ctx.params;
    const body = await req.json().catch(() => null);

    if (
      !body ||
      typeof body !== 'object' ||
      !ALLOWED_STATES.has(body.state) ||
      typeof body.expectedCurrentVersion !== 'number'
    ) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { user } = await requireOwnedSession(sessionId);

    const section = await transitionSectionState({
      sessionId,
      sectionId,
      toState: body.state,
      expectedCurrentVersion: body.expectedCurrentVersion,
      userId: user.id,
      reason: body.reason,
    });

    // Broadcast to SSE subscribers so open client canvases refresh
    await publishEvent(sessionId, {
      eventId: Date.now(),
      type: 'section_updated',
      sectionId,
      section,
    });

    return NextResponse.json({ section });
  } catch (err) {
    if (err instanceof SectionVersionError) {
      const status = ERROR_STATUS[err.code] ?? 500;
      return NextResponse.json(
        { code: err.code, message: err.message, ...(err.details ?? {}) },
        { status },
      );
    }
    if (err instanceof FondEUError) {
      return NextResponse.json(err.toResponse('ro'), { status: err.statusCode });
    }
    log.error({ error: err instanceof Error ? err.message : String(err) }, 'POST state failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
