// ─── Document Detail API ─────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { documents, projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { computeSha256, deleteObject, getObjectBuffer, getSignedDownloadUrl } from '@/lib/storage/gcs';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'documents-api' });

type Params = { params: { id: string } };

async function resolveDocumentAccess(
  userId: string,
  doc: typeof documents.$inferSelect,
): Promise<void> {
  if (doc.orgId) {
    // Org docs: access is controlled by RLS; just verify the document exists for this user
    return;
  }

  if (doc.projectId) {
    // Project docs: access is controlled by RLS
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

    return;
  }

  // Personal documents can be accessed only by uploader.
  if (doc.uploadedBy !== userId) {
    throw Errors.forbidden();
  }
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
    await resolveDocumentAccess(user.id, doc);

    if (download) {
      const signedUrl = await getSignedDownloadUrl(
        doc.storagePath,
        doc.filename || 'document',
        doc.mimeType || 'application/octet-stream',
      );
      if (signedUrl) {
        await logAudit({
          userId: user.id,
          action: 'document.download',
          resourceType: 'document',
          resourceId: id,
          metadata: { mode: 'signed_url' },
        });
        return NextResponse.redirect(signedUrl);
      }

      const fileBuffer = await getObjectBuffer(doc.storagePath);
      if (doc.checksumSha256 && computeSha256(fileBuffer) !== doc.checksumSha256) {
        throw Errors.internal('Checksum mismatch for stored document');
      }

      await logAudit({
        userId: user.id,
        action: 'document.download',
        resourceType: 'document',
        resourceId: id,
      });

      return new NextResponse(new Uint8Array(fileBuffer), {
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
        hasText: Boolean(doc.ocrText && doc.ocrText.length > 0),
        // API-backed URL works for both GCS (redirects to signed URL) and local FS
        // (streams buffer). Never expose raw storage paths.
        downloadUrl: `/api/documents/${doc.id}?download=true`,
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
    await resolveDocumentAccess(user.id, doc);

    await withUserRLS(user.id, async (tx) => {
      await tx
        .update(documents)
        .set({ deletedAt: new Date() })
        .where(eq(documents.id, id));
    });

    // Best-effort object deletion; DB soft-delete remains source of truth.
    let storageDeleted = true;
    try {
      await deleteObject(doc.storagePath);
    } catch (storageError) {
      storageDeleted = false;
      log.warn({ storageError, documentId: id }, '[documents:delete] storage cleanup failed');
    }

    await logAudit({
      userId: user.id,
      action: 'document.delete',
      resourceType: 'document',
      resourceId: id,
      metadata: { storageDeleted },
    });

    return NextResponse.json({ success: true, message: 'Documentul a fost șters.' });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
