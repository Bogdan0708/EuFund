import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace, syncProjectDocumentSnapshot } from '@/lib/ai/orchestrator/workspace';
import { transitionSectionState, SectionVersionError } from '@/lib/ai/orchestrator/section-versions';
import { transitionSectionStateSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import type { SectionResult } from '@/lib/ai/orchestrator/types';

type Params = { params: { id: string; sectionId: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const { id, sectionId } = params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace || !workspace.session) {
      return NextResponse.json(
        Errors.validation('session', 'Nu se poate modifica fără o sesiune activă', 'Cannot modify without an active session').toResponse('ro'),
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
      const { db } = await import('@/lib/db');
      const { workflowSessions } = await import('@/lib/db/schema');
      const { eq } = await import('drizzle-orm');
      const [freshSession] = await db
        .select({ context: workflowSessions.context })
        .from(workflowSessions)
        .where(eq(workflowSessions.id, workspace.session!.id))
        .limit(1);
      const freshCtx = freshSession?.context as { projectSections?: SectionResult[] } | null;
      if (freshCtx?.projectSections) {
        await syncProjectDocumentSnapshot(id, freshCtx.projectSections);
      }
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
