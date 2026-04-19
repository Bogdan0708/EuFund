// ─── Document Upload API ─────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { documents, docTypeEnum, projects } from '@/lib/db/schema';
import { parseKnowledgeFile } from '@/lib/ai/knowledge/parser';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { basename } from 'path';
import { buildObjectPath, computeSha256, deleteObject, putObject } from '@/lib/storage/gcs';
import { logger } from '@/lib/logger';
import { and, eq, isNull } from 'drizzle-orm';

const log = logger.child({ component: 'documents-upload-api' });

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/msword',
];

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const formData = await req.formData();

    const file = formData.get('file') as File | null;
    const orgId = formData.get('orgId') as string | null;
    const projectId = formData.get('projectId') as string | null;
    const rawDocType = (formData.get('docType') as string) || 'altul';
    type DocumentType = (typeof docTypeEnum.enumValues)[number];
    const docType: DocumentType = docTypeEnum.enumValues.includes(rawDocType as DocumentType)
      ? (rawDocType as DocumentType)
      : 'altul';

    if (!file) {
      return NextResponse.json(
        Errors.validation('file', 'Fișierul este obligatoriu.', 'File is required.').toResponse('ro'),
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        Errors.validation('file', 'Fișierul depășește limita de 50MB.', 'File exceeds 50MB limit.').toResponse('ro'),
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        Errors.validation('file', 'Tip de fișier neacceptat. Acceptăm PDF, DOCX, TXT.', 'Unsupported file type.').toResponse('ro'),
        { status: 400 },
      );
    }

    let resolvedOrgId = orgId || undefined;

    if (projectId) {
      const project = await withUserRLS(user.id, async (tx) => {
        return tx.query.projects.findFirst({
          where: and(eq(projects.id, projectId), isNull(projects.deletedAt)),
          columns: { id: true, orgId: true },
        });
      });

      if (!project) {
        return NextResponse.json(
          Errors.notFound('project', projectId).toResponse('ro'),
          { status: 404 },
        );
      }

      if (orgId && orgId !== project.orgId) {
        return NextResponse.json(
          Errors.validation('orgId', 'Proiectul nu aparține organizației selectate.', 'Project does not belong to selected organization.').toResponse('ro'),
          { status: 400 },
        );
      }

      resolvedOrgId = project.orgId;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Validate file type by magic bytes (don't trust client MIME)
    const magicHex = Buffer.from(buffer).subarray(0, 4).toString('hex');
    const MAGIC_BYTES: Record<string, string[]> = {
      '25504446': ['application/pdf'],           // %PDF
      '504b0304': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], // PK (DOCX/ZIP)
      'd0cf11e0': ['application/msword'],       // OLE2 Compound Document (.doc)
    };
    const detectedTypes = Object.entries(MAGIC_BYTES).find(([magic]) => magicHex.startsWith(magic));
    if (file.type === 'text/plain') {
      // Reject obvious binary payloads masquerading as text.
      const probe = buffer.subarray(0, Math.min(buffer.length, 2048));
      if (probe.includes(0x00)) {
        return NextResponse.json(
          Errors.validation('file', 'Fișierul text conține bytes binari invalizi.', 'Text file contains invalid binary bytes.').toResponse('ro'),
          { status: 400 },
        );
      }
    } else if (!detectedTypes || !detectedTypes[1].includes(file.type)) {
      return NextResponse.json(
        Errors.validation('file', 'Conținutul fișierului nu corespunde tipului declarat', 'File content does not match declared type').toResponse('ro'),
        { status: 400 },
      );
    }

    const safeName = basename(file.name).replace(/[^a-zA-Z0-9._-]/g, '_');
    const checksum = computeSha256(buffer);

    // Store file + DB insert in one transactional flow; on DB failure remove blob.
    const fileId = crypto.randomUUID();
    const storagePath = buildObjectPath(fileId, safeName);
    const persistedPath = await putObject(storagePath, buffer, file.type);

    let doc: typeof documents.$inferSelect | undefined;
    try {
      await withUserRLS(user.id, async (tx) => {
        const [inserted] = await tx.insert(documents).values({
          orgId: resolvedOrgId,
          projectId: projectId || undefined,
          uploadedBy: user.id,
          docType,
          filename: safeName,
          mimeType: file.type,
          fileSize: file.size,
          storagePath: persistedPath,
          checksumSha256: checksum,
        }).returning();

        doc = inserted;
      });
    } catch (txError) {
      await deleteObject(persistedPath);
      throw txError;
    }

    if (!doc) {
      throw Errors.internal('Nu s-a putut salva documentul.');
    }

    const EXTRACT_CAP = 50_000 // matches /api/documents/[id]/analyze cap (route.ts:106)
    let hasText = false
    try {
      // Best-effort post-insert enrichment. Not part of the insert transaction.
      // Upload success does not depend on extraction success.
      const parsed = await parseKnowledgeFile(buffer, safeName, file.type)
      const truncated = parsed.text.slice(0, EXTRACT_CAP)
      if (truncated.length > 0) {
        await withUserRLS(user.id, async (tx) => {
          await tx
            .update(documents)
            .set({ ocrText: truncated })
            .where(eq(documents.id, doc!.id))
        })
        hasText = true
      }
    } catch (extractError) {
      log.warn(
        { documentId: doc.id, filename: safeName, mimeType: file.type, error: extractError },
        '[documents:upload] extraction skipped (unsupported format or parse error)',
      )
    }

    await logAudit({
      userId: user.id,
      action: 'document.upload',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { filename: safeName, originalName: file.name, mimeType: file.type, fileSize: file.size },
    });

    return NextResponse.json({
      success: true,
      data: {
        id: doc.id,
        filename: doc.filename,
        mimeType: doc.mimeType,
        fileSize: doc.fileSize,
        docType: doc.docType,
        createdAt: doc.createdAt,
        hasText,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[documents:upload]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
