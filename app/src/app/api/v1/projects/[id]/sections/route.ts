import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace } from '@/lib/ai/orchestrator/workspace';
import { Errors, FondEUError } from '@/lib/errors';

type Params = { params: { id: string } };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        Errors.validation('id', 'ID de proiect invalid', 'Invalid project ID').toResponse('ro'),
        { status: 400 },
      );
    }

    const workspace = await resolveProjectWorkspace(id, user.id);
    if (!workspace) {
      return NextResponse.json(
        Errors.notFound('project', id).toResponse('ro'),
        { status: 404 },
      );
    }

    return NextResponse.json({
      sections: workspace.sections,
      sessionId: workspace.session?.id ?? null,
      source: workspace.mode,
      readOnly: workspace.mode === 'snapshot',
      version: workspace.snapshotDoc?.version ?? 0,
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
