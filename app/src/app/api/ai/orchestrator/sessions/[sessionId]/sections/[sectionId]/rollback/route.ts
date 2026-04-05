import { NextRequest, NextResponse } from 'next/server';
import { FondEUError } from '@/lib/errors';
import { requireOwnedSession } from '@/lib/ai/orchestrator/require-owned-session';
import { rollbackSection, verifySectionIntegrity, SectionVersionError } from '@/lib/ai/orchestrator/section-versions';
import { publishEvent } from '@/lib/ai/orchestrator/pubsub';
import type { SectionResult } from '@/lib/ai/orchestrator/types';
import { logger } from '@/lib/logger';

const log = logger.child({ route: 'section-rollback' });

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

    // Auth + UUID validation + ownership BEFORE body parsing.
    // Unauthenticated or wrong-owner requests should return 401/404 even
    // if the body is malformed, matching the codebase convention.
    const { user, session } = await requireOwnedSession(sessionId);

    const body = await req.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      typeof body.targetVersion !== 'number' ||
      !Number.isInteger(body.targetVersion) ||
      body.targetVersion < 1 ||
      typeof body.expectedCurrentVersion !== 'number' ||
      !Number.isInteger(body.expectedCurrentVersion) ||
      body.expectedCurrentVersion < 1
    ) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    // Integrity check: verify JSONB contentHash matches the latest version
    // row's contentHash. Catches DB drift before we mutate.
    const sessionCtx = session.context as { projectSections?: SectionResult[] } | null;
    const targetSection = sessionCtx?.projectSections?.find((s) => s.id === sectionId);
    if (targetSection) {
      await verifySectionIntegrity(sessionId, targetSection);
    }

    const section = await rollbackSection({
      sessionId,
      sectionId,
      targetVersion: body.targetVersion,
      expectedCurrentVersion: body.expectedCurrentVersion,
      userId: user.id,
      reason: typeof body.reason === 'string' && body.reason.trim().length > 0
        ? body.reason
        : `Rollback to v${body.targetVersion} (no reason provided)`,
    });

    // TODO(task-16): when the client handler lands, it must skip
    // lastEventIdRef updates for section_updated events. Using Date.now()
    // here is a placeholder — it's out-of-band relative to the orchestrator's
    // monotonic per-session counter and would poison the replay cursor
    // (workflow_messages.eventId is int4) if the client tracked it.
    // See plan task 16.
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
    log.error({ error: err instanceof Error ? err.message : String(err) }, 'POST rollback failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
