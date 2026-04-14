import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace } from '@/lib/workspace';
import { generateDocx } from '@/lib/export/docx';
import { logAudit } from '@/lib/legal/audit';
import { Errors, FondEUError } from '@/lib/errors';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const projectId = params.id;
    const format = req.nextUrl.searchParams.get('format') || 'docx';

    if (format !== 'docx') {
      return NextResponse.json(
        Errors.validation('format', 'Only DOCX export is currently supported', 'Doar export DOCX este disponibil momentan').toResponse('ro'),
        { status: 400 },
      );
    }

    const workspace = await resolveProjectWorkspace(projectId, user.id);
    if (!workspace) {
      return NextResponse.json(Errors.notFound('project', projectId).toResponse('ro'), { status: 404 });
    }

    if (workspace.sections.length === 0) {
      return NextResponse.json(
        Errors.validation('sections', 'No project sections found for export', 'Nu există secțiuni de proiect pentru export').toResponse('ro'),
        { status: 400 },
      );
    }

    const buffer = await generateDocx(workspace.sections, {
      projectTitle: workspace.project.title,
      program: undefined,
    });

    const safeName = encodeURIComponent(workspace.project.title.slice(0, 100));

    await logAudit({
      userId: user.id,
      action: 'project.export',
      resourceType: 'project',
      resourceId: projectId,
      metadata: { format: 'docx', sectionCount: workspace.sections.length },
    });

    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${safeName}.docx"`,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
