import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace, editProjectSection } from '@/lib/ai/orchestrator/workspace';
import { SectionVersionError } from '@/lib/ai/orchestrator/section-versions';
import { editSectionContentSchema } from '@/lib/validators';
import { enforceRateLimit } from '@/lib/middleware/rate-limit';
import { Errors, FondEUError } from '@/lib/errors';

type Params = { params: { id: string; sectionId: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z][a-z0-9_]{0,63}$/;

const ERROR_STATUS: Record<string, number> = {
  SectionNotFound: 404,
  ConcurrentModification: 409,
};

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id, sectionId } = params;

    if (!UUID_RE.test(id) || !SLUG_RE.test(sectionId)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace) {
      return NextResponse.json(Errors.notFound('project', id).toResponse('ro'), { status: 404 });
    }

    const section = workspace.sections.find((s) => s.id === sectionId);
    if (!section) {
      return NextResponse.json(Errors.notFound('section', sectionId).toResponse('ro'), { status: 404 });
    }

    return NextResponse.json({
      section,
      sessionId: workspace.session?.id ?? null,
      source: workspace.mode,
      readOnly: workspace.mode === 'snapshot',
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const limit = await enforceRateLimit(req, { keyPrefix: 'section:edit', maxRequests: 60, windowMs: 60_000 });
    if (!limit.ok) return limit.response;

    const user = await requireAuth();
    const { id, sectionId } = params;

    if (!UUID_RE.test(id) || !SLUG_RE.test(sectionId)) {
      return NextResponse.json(Errors.validation('id', 'ID invalid', 'Invalid ID').toResponse('ro'), { status: 400 });
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace) {
      return NextResponse.json(Errors.notFound('project', id).toResponse('ro'), { status: 404 });
    }

    if (workspace.mode === 'snapshot' || !workspace.session) {
      return NextResponse.json(
        Errors.validation('session', 'Nu se poate edita fără o sesiune activă', 'Cannot edit without an active session').toResponse('ro'),
        { status: 400 },
      );
    }

    if (workspace.session.status === 'completed') {
      return NextResponse.json(
        Errors.validation('session', 'Nu se poate edita o sesiune finalizată', 'Cannot edit a completed session').toResponse('ro'),
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = editSectionContentSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 });
    }

    const section = await editProjectSection({
      sessionId: workspace.session.id,
      sectionId,
      content: parsed.data.content,
      title: parsed.data.title,
      expectedCurrentVersion: parsed.data.expectedCurrentVersion,
      userId: user.id,
    });

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
