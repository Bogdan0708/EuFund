import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { db } from '@/lib/db';
import { callsForProposals, fundingPrograms } from '@/lib/db/schema';
import { parseKnowledgeFile } from '@/lib/ai/knowledge/parser';
import { extractCallDataFromText } from '@/lib/ai/knowledge/extractor';
import { ingestToKnowledgeBase } from '@/lib/ai/knowledge/ingestor';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';

const log = logger.child({ component: 'admin-ingestion' });

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain'
];

export async function POST(req: NextRequest) {
  try {
    // Security P0: Verified admin check against DB
    await requirePlatformAdmin();

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const programCode = formData.get('programCode') as string;

    if (!file || !programCode) {
      throw Errors.validation('file', 'Fișierul și codul programului sunt obligatorii', 'File and program code are required');
    }

    // Validation P2: File size and type
    if (file.size > MAX_FILE_SIZE) {
      throw Errors.validation('file', 'Fișierul depășește limita de 15MB', 'File exceeds 15MB limit');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      throw Errors.validation('file', 'Tip de fișier neacceptat', 'Unsupported file type');
    }

    // 1. Get Program ID
    const program = await db.query.fundingPrograms.findFirst({
      where: eq(fundingPrograms.code, programCode),
    });

    if (!program) {
      throw Errors.notFound('program', programCode);
    }

    // 2. Parse File to Text
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsedDoc = await parseKnowledgeFile(buffer, file.name, file.type);

    // 3. Extract Structured Data via AI
    const extracted = await extractCallDataFromText(parsedDoc.text);

    // 4. Save to Database (Upsert by callCode)
    const [savedCall] = await db.insert(callsForProposals).values({
      programId: program.id,
      callCode: extracted.callCode,
      titleRo: extracted.titleRo,
      titleEn: extracted.titleEn,
      descriptionRo: extracted.descriptionRo,
      eligibleTypes: extracted.eligibleTypes,
      eligibleRegions: extracted.eligibleRegions,
      eligibleCaen: extracted.eligibleCaen,
      budgetMin: extracted.budgetMin?.toString(),
      budgetMax: extracted.budgetMax?.toString(),
      cofinancingRate: extracted.cofinancingRate?.toString(),
      durationMin: extracted.durationMin,
      durationMax: extracted.durationMax,
      submissionStart: extracted.submissionStart ? new Date(extracted.submissionStart) : undefined,
      submissionEnd: extracted.submissionEnd ? new Date(extracted.submissionEnd) : undefined,
      status: 'deschis',
      isCompetitive: extracted.isCompetitive,
    }).onConflictDoUpdate({
      target: [callsForProposals.callCode],
      set: {
        titleRo: extracted.titleRo,
        descriptionRo: extracted.descriptionRo,
        eligibleTypes: extracted.eligibleTypes,
        eligibleRegions: extracted.eligibleRegions,
        eligibleCaen: extracted.eligibleCaen,
        budgetMax: extracted.budgetMax?.toString(),
        updatedAt: new Date(),
      }
    }).returning();

    // 5. Ingest to RAG (Vector Store) for deep retrieval
    await ingestToKnowledgeBase({
      text: parsedDoc.text,
      filename: file.name,
      callId: savedCall.id,
      programId: program.id,
      metadata: {
        callCode: extracted.callCode,
        type: 'official_guide'
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        callId: savedCall.id,
        callCode: savedCall.callCode,
        extractedFields: Object.keys(extracted)
      }
    });

  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    
    log.error({ error }, 'Admin ingestion failed');
    // Security P1: No internal leakage
    return NextResponse.json(
      Errors.internal().toResponse('ro'),
      { status: 500 }
    );
  }
}
