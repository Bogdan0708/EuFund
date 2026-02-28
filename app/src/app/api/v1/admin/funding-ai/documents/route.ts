import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { fundingDocumentsRaw } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-funding-ai-documents-route' });
export const dynamic = 'force-dynamic';

const upsertDocumentSchema = z.object({
  connectorId: z.string().uuid(),
  runId: z.string().uuid().optional(),
  externalKey: z.string().min(1).max(255),
  sourceUrl: z.string().url().max(1000),
  documentType: z.string().min(1).max(100),
  language: z.string().min(2).max(10).optional(),
  fileType: z.string().min(2).max(20),
  title: z.string().max(5000).optional(),
  publishedAt: z.string().datetime().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  storagePath: z.string().min(1).max(500),
  textContent: z.string().optional(),
  structureJson: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin();
    const connectorId = req.nextUrl.searchParams.get('connectorId');
    const externalKey = req.nextUrl.searchParams.get('externalKey');
    const limitRaw = Number(req.nextUrl.searchParams.get('limit') || '50');
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

    const conditions = [];
    if (connectorId) conditions.push(eq(fundingDocumentsRaw.connectorId, connectorId));
    if (externalKey) conditions.push(eq(fundingDocumentsRaw.externalKey, externalKey));

    const items = await db.query.fundingDocumentsRaw.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: (rows, { desc: d }) => [d(rows.fetchedAt)],
      limit,
    });

    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-documents] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();
    const body = await req.json();
    const parsed = upsertDocumentSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const payload = parsed.data;
    const [inserted] = await db.insert(fundingDocumentsRaw).values({
      connectorId: payload.connectorId,
      runId: payload.runId,
      externalKey: payload.externalKey,
      sourceUrl: payload.sourceUrl,
      documentType: payload.documentType,
      language: payload.language ?? 'ro',
      fileType: payload.fileType,
      title: payload.title,
      publishedAt: payload.publishedAt ? new Date(payload.publishedAt) : null,
      sha256: payload.sha256,
      storagePath: payload.storagePath,
      textContent: payload.textContent,
      structureJson: payload.structureJson,
      metadata: payload.metadata ?? {},
    }).onConflictDoNothing({
      target: [
        fundingDocumentsRaw.connectorId,
        fundingDocumentsRaw.externalKey,
        fundingDocumentsRaw.sha256,
      ],
    }).returning();

    const created = inserted ?? await db.query.fundingDocumentsRaw.findFirst({
      where: and(
        eq(fundingDocumentsRaw.connectorId, payload.connectorId),
        eq(fundingDocumentsRaw.externalKey, payload.externalKey),
        eq(fundingDocumentsRaw.sha256, payload.sha256),
      ),
      orderBy: [desc(fundingDocumentsRaw.fetchedAt)],
    });

    if (!created) throw Errors.internal('Failed to upsert funding document');

    await logAudit({
      userId: user.id,
      action: 'funding_ai.document_upsert',
      resourceType: 'funding_document_raw',
      resourceId: created.id,
      metadata: {
        connectorId: payload.connectorId,
        externalKey: payload.externalKey,
        sha256: payload.sha256,
      },
    });

    return NextResponse.json({ success: true, data: created }, { status: inserted ? 201 : 200 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-documents] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
