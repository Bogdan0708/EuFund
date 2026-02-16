// ─── Document Upload API ─────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { documents } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { createHash } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'documents-upload-api' });

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
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
    const docType = (formData.get('docType') as string) || 'altul';

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

    // Verify org access if orgId provided
    if (orgId) {
      await requireOrgRole(user.id, orgId, 'project_manager');
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = createHash('sha256').update(buffer).digest('hex');

    // Store file
    const dateDir = new Date().toISOString().split('T')[0];
    const fileId = crypto.randomUUID();
    const ext = file.name.split('.').pop() || 'bin';
    const storagePath = join(dateDir, `${fileId}.${ext}`);
    const fullPath = join(UPLOAD_DIR, storagePath);

    await mkdir(join(UPLOAD_DIR, dateDir), { recursive: true });
    await writeFile(fullPath, buffer);

    // Insert document record
    const [doc] = await db.insert(documents).values({
      orgId: orgId || undefined,
      projectId: projectId || undefined,
      uploadedBy: user.id,
      docType: docType as any,
      filename: file.name,
      mimeType: file.type,
      fileSize: file.size,
      storagePath,
      checksumSha256: checksum,
    }).returning();

    await logAudit({
      userId: user.id,
      action: 'document.upload',
      resourceType: 'document',
      resourceId: doc.id,
      metadata: { filename: file.name, mimeType: file.type, fileSize: file.size },
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
