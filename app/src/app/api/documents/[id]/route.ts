// ─── Document Detail API ─────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { documents, projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { withAuthScope, requireOrgRole } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'documents-api' });

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

type Params = { params: { id: string } };

/**
 * Verify the authenticated user has at least `minRole` access to the
 * document's owning organization.
 *
 * Resolution order:
 *  1. doc.orgId set → check membership in that org
 *  2. doc.projectId set → resolve project.orgId, check membership there
 *  3. Neither → personal document; only the uploader may access it
 */
async function requireDocumentAccess(
  userId: string,
  doc: typeof documents.$inferSelect,
  minRole: 'viewer' | 'project_manager' | 'org_admin' = 'viewer',
): Promise<void> {
  if (doc.orgId) {
    await requireOrgRole(userId, doc.orgId, minRole);
  } else if (doc.projectId) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, doc.projectId),
    });
    if (!project) {
      throw Errors.notFound('document', doc.id);
    }
    await requireOrgRole(userId, project.orgId, minRole);
  } else if (doc.uploadedBy !== userId) {
    // Personal document (no org/project context) — only the uploader can access.
    throw Errors.forbidden();
  }
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = params;
    const url = new URL(req.url);
    const download = url.searchParams.get('download') === 'true';
    let auditData: Parameters<typeof logAudit>[0] | undefined;

    const response = await withAuthScope(async (user) => {
      const doc = await db.query.documents.findFirst({
        where: and(eq(documents.id, id), isNull(documents.deletedAt)),
      });

      if (!doc) {
        throw Errors.notFound('document', id);
      }

      // SECURITY FIX (F-002 / previously missing): verify org membership
      // before returning any document data or allowing download.
      await requireDocumentAccess(user.id, doc);

      if (download) {
        const filePath = join(UPLOAD_DIR, doc.storagePath);
        const fileBuffer = await readFile(filePath);

        auditData = {
          userId: user.id,
          action: 'document.download',
          resourceType: 'document',
          resourceId: id,
        };

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
    });

    if (auditData) {
      await logAudit(auditData);
    }

    return response;
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
    const { id } = params;
    let auditData: Parameters<typeof logAudit>[0] | undefined;

    const response = await withAuthScope(async (user) => {
      const doc = await db.query.documents.findFirst({
        where: and(eq(documents.id, id), isNull(documents.deletedAt)),
      });

      if (!doc) {
        throw Errors.notFound('document', id);
      }

      // SECURITY FIX (F-002 / previously missing): require project_manager
      // role to delete documents — not just any authenticated user.
      await requireDocumentAccess(user.id, doc, 'project_manager');

      await db
        .update(documents)
        .set({ deletedAt: new Date() })
        .where(eq(documents.id, id));

      auditData = {
        userId: user.id,
        action: 'document.delete',
        resourceType: 'document',
        resourceId: id,
      };

      return NextResponse.json({ success: true, message: 'Documentul a fost șters.' });
    });

    if (auditData) {
      await logAudit(auditData);
    }

    return response;
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
