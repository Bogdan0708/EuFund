import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { parseKnowledgeFile } from '@/lib/ai/knowledge/parser';
import { ingestToKnowledgeBase } from '@/lib/ai/knowledge/ingestor';
import { db } from '@/lib/db';
import { fundingDocumentsRaw } from '@/lib/db/schema';
import { createHash } from 'crypto';
import { logAudit } from '@/lib/legal/audit';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'knowledge-ingest-api' });

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();
    const formData = await req.formData();
    
    const file = formData.get('file') as File;
    const callId = formData.get('callId') as string;
    const programId = formData.get('programId') as string;

    if (!file) throw Errors.validation('file', 'Niciun fișier încărcat');

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // 1. Parse File
    const parsed = await parseKnowledgeFile(buffer, file.name, file.type);

    // 2. Vector Ingest
    const { chunks } = await ingestToKnowledgeBase({
      text: parsed.text,
      filename: file.name,
      callId,
      programId,
      metadata: parsed.metadata
    });

    // 3. Store in DB for tracking
    const [doc] = await db.insert(fundingDocumentsRaw).values({
      externalKey: `manual-${sha256.slice(0, 12)}`,
      documentType: 'knowledge_upload',
      fileType: parsed.metadata.format,
      title: file.name,
      sha256,
      textContent: parsed.text,
      metadata: { ...parsed.metadata, callId, programId, uploadedBy: user.id },
    }).onConflictDoNothing().returning();

    await logAudit({
      userId: user.id,
      action: 'system.program_change', // Using closest existing or add new
      resourceType: 'funding_document',
      resourceId: doc?.id,
      metadata: { filename: file.name, chunks, callId }
    });

    return NextResponse.json({
      success: true,
      data: {
        id: doc?.id,
        filename: file.name,
        chunks,
        format: parsed.metadata.format
      }
    });

  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }
    log.error({ error }, '[knowledge:ingest] failure');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
}
