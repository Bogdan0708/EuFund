import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  fundingCallExtractions,
  fundingCallVersions,
  fundingDocumentsRaw,
} from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-funding-ai-extractions-route' });
export const dynamic = 'force-dynamic';

const extractionItemSchema = z.object({
  fieldName: z.string().min(1).max(100),
  fieldValue: z.unknown(),
  confidence: z.number().min(0).max(1).optional(),
  evidenceSnippet: z.string().max(5000).optional(),
  evidencePage: z.number().int().min(1).optional(),
  evidenceLocator: z.string().max(500).optional(),
  method: z.enum(['regex', 'rule', 'llm', 'hybrid']).optional(),
  validated: z.boolean().optional(),
  validationErrors: z.record(z.string(), z.unknown()).optional(),
});

const upsertExtractionsSchema = z.object({
  documentId: z.string().uuid(),
  callExternalKey: z.string().min(1).max(255),
  extractionVersion: z.number().int().min(1).optional(),
  items: z.array(extractionItemSchema).min(1).max(200),
  createVersion: z.boolean().optional(),
  changeType: z.string().min(1).max(50).optional(),
  diffSummary: z.string().max(10000).optional(),
  changedFields: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();
    const body = await req.json();
    const parsed = upsertExtractionsSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const payload = parsed.data;
    const version = payload.extractionVersion ?? 1;

    const document = await db.query.fundingDocumentsRaw.findFirst({
      where: eq(fundingDocumentsRaw.id, payload.documentId),
      columns: { id: true, externalKey: true },
    });
    if (!document) throw Errors.notFound('funding_document_raw', payload.documentId);

    const result = await db.transaction(async (tx) => {
      for (const item of payload.items) {
        await tx.insert(fundingCallExtractions).values({
          documentId: payload.documentId,
          callExternalKey: payload.callExternalKey,
          extractionVersion: version,
          fieldName: item.fieldName,
          fieldValueJson: item.fieldValue as Record<string, unknown>,
          confidence: item.confidence !== undefined ? String(item.confidence) : null,
          evidenceSnippet: item.evidenceSnippet,
          evidencePage: item.evidencePage,
          evidenceLocator: item.evidenceLocator,
          method: item.method ?? 'hybrid',
          validated: item.validated ?? false,
          validationErrors: item.validationErrors ?? {},
          updatedAt: new Date(),
        }).onConflictDoUpdate({
          target: [
            fundingCallExtractions.documentId,
            fundingCallExtractions.callExternalKey,
            fundingCallExtractions.fieldName,
            fundingCallExtractions.extractionVersion,
          ],
          set: {
            fieldValueJson: item.fieldValue as Record<string, unknown>,
            confidence: item.confidence !== undefined ? String(item.confidence) : null,
            evidenceSnippet: item.evidenceSnippet,
            evidencePage: item.evidencePage,
            evidenceLocator: item.evidenceLocator,
            method: item.method ?? 'hybrid',
            validated: item.validated ?? false,
            validationErrors: item.validationErrors ?? {},
            updatedAt: new Date(),
          },
        });
      }

      let createdVersion: { id: string; versionNo: number } | null = null;
      if (payload.createVersion) {
        const latest = await tx.query.fundingCallVersions.findFirst({
          where: eq(fundingCallVersions.callExternalKey, payload.callExternalKey),
          orderBy: (rows, { desc: d }) => [d(rows.versionNo)],
        });
        const nextVersion = (latest?.versionNo ?? 0) + 1;
        const [insertedVersion] = await tx.insert(fundingCallVersions).values({
          callExternalKey: payload.callExternalKey,
          versionNo: nextVersion,
          changeType: payload.changeType ?? 'updated',
          changedFields: payload.changedFields ?? Object.fromEntries(payload.items.map((it) => [it.fieldName, it.fieldValue])),
          diffSummary: payload.diffSummary,
          createdBy: user.id,
        }).returning({ id: fundingCallVersions.id, versionNo: fundingCallVersions.versionNo });
        createdVersion = insertedVersion;
      }

      return {
        upserted: payload.items.length,
        extractionVersion: version,
        createdVersion,
      };
    });

    await logAudit({
      userId: user.id,
      action: 'funding_ai.extractions_upsert',
      resourceType: 'funding_document_raw',
      resourceId: payload.documentId,
      metadata: {
        callExternalKey: payload.callExternalKey,
        extractionVersion: version,
        fieldCount: payload.items.length,
        createdVersionNo: result.createdVersion?.versionNo,
      },
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-extractions] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin();
    const documentId = req.nextUrl.searchParams.get('documentId');
    const callExternalKey = req.nextUrl.searchParams.get('callExternalKey');
    const extractionVersion = Number(req.nextUrl.searchParams.get('extractionVersion') || '1');

    if (!documentId || !callExternalKey) {
      throw Errors.validation('query', 'documentId și callExternalKey sunt obligatorii', 'documentId and callExternalKey are required');
    }

    const rows = await db.query.fundingCallExtractions.findMany({
      where: and(
        eq(fundingCallExtractions.documentId, documentId),
        eq(fundingCallExtractions.callExternalKey, callExternalKey),
        eq(fundingCallExtractions.extractionVersion, extractionVersion),
      ),
      orderBy: (items, { asc }) => [asc(items.fieldName)],
    });

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-extractions] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
