// ─── Document Analysis API ───────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { withUserRLS } from '@/lib/db';
import { documents, projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { analyzeDocument } from '@/lib/ai/document-analyzer';
import { logAudit } from '@/lib/legal/audit';
import { eq, and, isNull } from 'drizzle-orm';
import { computeSha256, getObjectBuffer } from '@/lib/storage/gcs';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'documents-analyze-api' });

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

  if (doc.uploadedBy !== userId) {
    throw Errors.forbidden();
  }
}

export async function POST(req: NextRequest, { params }: Params) {
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

    // Read file content and verify integrity before analysis.
    const buffer = await getObjectBuffer(doc.storagePath);
    if (doc.checksumSha256 && computeSha256(buffer) !== doc.checksumSha256) {
      throw Errors.internal('Checksum mismatch for stored document');
    }

    let content: string;
    if (doc.mimeType === 'text/plain') {
      content = buffer.toString('utf-8');
    } else if (doc.mimeType === 'application/pdf') {
      const pdfParseModule = await import('pdf-parse');
      const pdfParse = ('default' in pdfParseModule ? pdfParseModule.default : pdfParseModule) as (input: Buffer) => Promise<{ text: string }>;
      const pdf = await pdfParse(buffer);
      content = pdf.text;
    } else if (doc.mimeType?.includes('wordprocessingml')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
    } else {
      return NextResponse.json(
        Errors.validation('file', 'Tip de fișier nesuportat pentru analiză.', 'Unsupported file type for analysis.').toResponse('ro'),
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));

    const result = await analyzeDocument({
      content,
      filename: doc.filename,
      mimeType: doc.mimeType || 'application/octet-stream',
      projectContext: body.projectContext,
      callContext: body.callContext,
      locale: body.locale || 'ro',
    });

    // Update document with AI analysis
    await withUserRLS(user.id, async (tx) => {
      await tx
        .update(documents)
        .set({
          aiSummary: result.analysis.summary || null,
          extractedData: result.analysis,
          ocrText: content.substring(0, 50000), // Store first 50k chars
        })
        .where(eq(documents.id, id));
    });

    await logAudit({
      userId: user.id,
      action: 'ai.compliance_check',
      resourceType: 'document',
      resourceId: id,
      metadata: { tokensUsed: result.tokensUsed, piiDetected: result.piiDetections.length > 0 },
    });

    return NextResponse.json({
      success: true,
      data: {
        analysis: result.analysis,
        piiDetections: result.piiDetections,
        gdprCompliant: result.gdprCompliant,
        metadata: { tokensUsed: result.tokensUsed, analyzedAt: new Date().toISOString() },
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[documents:analyze]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
