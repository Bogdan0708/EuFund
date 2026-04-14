import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { resolveProjectWorkspace } from '@/lib/ai/orchestrator/workspace';
import { generateSectionDocx } from '@/lib/export/section-docx';
import { logAudit } from '@/lib/legal/audit';
import { Errors, FondEUError } from '@/lib/errors';
import { UUID_RE, SLUG_RE } from '@/lib/validators/patterns';

type Params = { params: { id: string; sectionId: string } };

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

    const buffer = generateSectionDocx({
      title: section.title,
      content: section.content,
      order: section.order,
    });

    const safeName = encodeURIComponent(`${section.order}-${section.title}`.slice(0, 100));

    await logAudit({
      userId: user.id,
      action: 'section.export',
      resourceType: 'section',
      resourceId: sectionId,
      metadata: { format: 'docx', projectId: id },
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
