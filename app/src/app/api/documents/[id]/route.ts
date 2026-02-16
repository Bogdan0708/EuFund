// ─── Document Detail API ─────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'documents-api' });

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;
    const url = new URL(req.url);
    const download = url.searchParams.get('download') === 'true';

    const doc = await db.query.documents.findFirst({
      where: and(eq(documents.id, id), isNull(documents.deletedAt)),
    });

    if (!doc) {
      throw Errors.notFound('document', id);
    }

    if (download) {
      const filePath = join(UPLOAD_DIR, doc.storagePath);
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

    const doc = await db.query.documents.findFirst({
      where: and(eq(documents.id, id), isNull(documents.deletedAt)),
    });

    if (!doc) {
      throw Errors.notFound('document', id);
    }

    await db
      .update(documents)
      .set({ deletedAt: new Date() })
      .where(eq(documents.id, id));

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
