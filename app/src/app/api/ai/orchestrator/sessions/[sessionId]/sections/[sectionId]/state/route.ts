import { NextRequest, NextResponse } from 'next/server';
import { FondEUError } from '@/lib/errors';
import { requireOwnedSession } from '@/lib/ai/orchestrator/require-owned-session';
import { transitionSectionState, verifySectionIntegrity, SectionVersionError } from '@/lib/ai/orchestrator/section-versions';
import { persistAndPublishSectionUpdatedEvent } from '@/lib/ai/orchestrator/pubsub';
import type { SectionResult } from '@/lib/ai/orchestrator/types';
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

function isNoopMutation(previous: SectionResult | undefined, next: SectionResult): boolean {
  if (!previous) return false;

  return (
    previous.state === next.state &&
    previous.currentVersion === next.currentVersion &&
    previous.versionCount === next.versionCount &&
    previous.contentHash === next.contentHash &&
    previous.lastStateChangeAt === next.lastStateChangeAt &&
    previous.lastStateChangeBy === next.lastStateChangeBy &&
    previous.title === next.title &&
    previous.content === next.content
  );
}

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

    // Phase 1 feature flag: return 404 if disabled so the endpoint behaves
    // as if it doesn't exist from the client's perspective.
    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    const enabled = await isFeatureEnabled('section_versioning', { userId: user.id });
    if (!enabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json().catch(() => null);
    if (
      !body ||
      typeof body !== 'object' ||
      !ALLOWED_STATES.has(body.state) ||
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
      await verifySectionIntegrity(sessionId, targetSection, user.id);
    }

    const section = await transitionSectionState({
      sessionId,
      sectionId,
      toState: body.state,
      expectedCurrentVersion: body.expectedCurrentVersion,
      userId: user.id,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    });

    if (!isNoopMutation(targetSection, section)) {
      await persistAndPublishSectionUpdatedEvent(sessionId, sectionId, section);
    }

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
