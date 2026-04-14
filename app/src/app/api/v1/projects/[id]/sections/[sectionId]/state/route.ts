import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace, syncProjectDocumentSnapshot } from '@/lib/workspace';
import { transitionSectionState, SectionVersionError } from '@/lib/section-versions';
import { transitionSectionStateSchema } from '@/lib/validators';
import { enforceRateLimit } from '@/lib/middleware/rate-limit';
import { Errors, FondEUError } from '@/lib/errors';
import { UUID_RE, SLUG_RE } from '@/lib/validators/patterns';

type Params = { params: { id: string; sectionId: string } };

const ERROR_STATUS: Record<string, number> = {
  SectionNotFound: 404,
  InvalidStateTransition: 400,
  FailedSectionCannotBeApproved: 400,
  ConcurrentModification: 409,
  VersionIntegrityMismatch: 500,
};

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();

    const limit = await enforceRateLimit(req, { keyPrefix: 'section:state', maxRequests: 30, windowMs: 60_000, keySuffix: user.id });
    if (!limit.ok) return limit.response;
    const { id, sectionId } = params;

    if (!UUID_RE.test(id) || !SLUG_RE.test(sectionId)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace || !workspace.session) {
      return NextResponse.json(
        Errors.validation('session', 'Nu se poate modifica fără o sesiune activă', 'Cannot modify without an active session').toResponse('ro'),
        { status: 400 },
      );
    }

    if (workspace.session.status === 'completed') {
      return NextResponse.json(
        Errors.validation('session', 'Nu se poate modifica o sesiune finalizată', 'Cannot modify a completed session').toResponse('ro'),
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = transitionSectionStateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const section = await transitionSectionState({
      sessionId: workspace.session.id,
      sectionId,
      toState: parsed.data.state,
      expectedCurrentVersion: parsed.data.expectedCurrentVersion,
      userId: user.id,
      reason: parsed.data.reason,
    });

    // Best-effort snapshot sync after state change
    try {
      await syncProjectDocumentSnapshot(id, user.id, workspace.session!.id);
    } catch {
      // Best-effort — snapshot may be stale until next edit
    }

    return NextResponse.json({ section });
  } catch (error) {
    if (error instanceof SectionVersionError) {
      return NextResponse.json(
        { code: error.code, message: error.message, ...(error.details ?? {}) },
        { status: ERROR_STATUS[error.code] ?? 500 },
      );
    }
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
