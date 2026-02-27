// ─── Document Detail API ─────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { documents, projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { resolve, sep } from 'path';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'documents-api' });

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

type Params = { params: { id: string } };

async function resolveDocumentAccess(
  userId: string,
  doc: typeof documents.$inferSelect,
  minRole: Parameters<typeof requireOrgRole>[2] = 'viewer',
): Promise<void> {
  if (doc.orgId) {
    await requireOrgRole(userId, doc.orgId, minRole);
    return;
  }

  if (doc.projectId) {
    const projectId = doc.projectId;
    const project = await withUserRLS(userId, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
        columns: { orgId: true },
      });
    });

    if (!project) {
      throw Errors.notFound('project', projectId);
    }

    await requireOrgRole(userId, project.orgId, minRole);
    return;
  }

  // Personal documents can be accessed only by uploader.
  if (doc.uploadedBy !== userId) {
    throw Errors.forbidden();
  }
}

function resolveStoragePath(storagePath: string): string {
  const baseDir = resolve(UPLOAD_DIR);
  const targetPath = resolve(baseDir, storagePath);
  if (targetPath !== baseDir && !targetPath.startsWith(`${baseDir}${sep}`)) {
    throw Errors.forbidden();
  }
  return targetPath;
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;
    const url = new URL(req.url);
    const download = url.searchParams.get('download') === 'true';

    const doc = await withUserRLS(user.id, async (tx) => {
      return tx.query.documents.findFirst({
        where: and(eq(documents.id, id), isNull(documents.deletedAt)),
      });
    });

    if (!doc) {
      throw Errors.notFound('document', id);
    }
    await resolveDocumentAccess(user.id, doc, 'viewer');

    if (download) {
      const filePath = resolveStoragePath(doc.storagePath);
      const fileBuffer = await readFile(filePath);

      await logAudit({
        userId: user.id,
        action: 'document.download',
        resourceType: 'document',
        resourceId: id,
      });

      return new NextResponse(fileBuffer, {
        headers: {
          'Content-Type': doc.mimeType || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${doc.filename}"`,
          'Content-Length': String(doc.fileSize || fileBuffer.length),
        },
      });
    }

    // Return metadata only
    return NextResponse.json({
      success: true,
      data: {
        id: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        docType: doc.docType,
        aiSummary: doc.aiSummary,
        extractedData: doc.extractedData,
        createdAt: doc.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[documents:get]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const doc = await withUserRLS(user.id, async (tx) => {
      return tx.query.documents.findFirst({
        where: and(eq(documents.id, id), isNull(documents.deletedAt)),
      });
    });

    if (!doc) {
      throw Errors.notFound('document', id);
    }
    await resolveDocumentAccess(user.id, doc, 'project_manager');

    await withUserRLS(user.id, async (tx) => {
      await tx
        .update(documents)
        .set({ deletedAt: new Date() })
        .where(eq(documents.id, id));
    });

    await logAudit({
      userId: user.id,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: id,
    });

    return NextResponse.json({ success: true, message: 'Documentul a fost șters.' });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
