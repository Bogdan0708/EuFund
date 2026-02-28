import { db } from '@/lib/db';
import { fundingPrograms, callsForProposals } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'connector-normalize' });

export interface ExtractionData {
  externalId: string;
  callCode: string;
  titleRo: string;
  titleEn?: string;
  descriptionRo?: string;
  objective?: string;
  programmeCode: string;
  status: 'deschis' | 'previzionat' | 'inchis' | 'anulat';
  submissionStart?: Date;
  submissionEnd?: Date;
  budgetTotal?: string;
  budgetMin?: string;
  budgetMax?: string;
  cofinancingRate?: string;
  guideUrl?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Normalizes extracted data to DB call format and ensures programme exists
 */
export async function normalizeAndUpsertCall(
  connectorId: string,
  data: ExtractionData
) {
  // 1. Ensure programme exists
  let programme = await db.query.fundingPrograms.findFirst({
    where: eq(fundingPrograms.code, data.programmeCode),
  });

  if (!programme) {
    log.info({ programmeCode: data.programmeCode }, 'Auto-creating funding programme');
    const [newProg] = await db.insert(fundingPrograms).values({
      code: data.programmeCode,
      nameRo: data.programmeCode, // Fallback
      status: 'inactiv', // Governance: default to inactive for review
      metadata: { autoCreated: true, sourceConnectorId: connectorId },
    }).returning();
    programme = newProg;
  }

  // 2. Upsert the call
  // Using sourceConnectorId + externalId for uniqueness
  const values = {
    programId: programme.id,
    sourceConnectorId: connectorId,
    externalId: data.externalId,
    callCode: data.callCode,
    titleRo: data.titleRo,
    titleEn: data.titleEn,
    descriptionRo: data.descriptionRo,
    objective: data.objective,
    status: data.status,
    submissionStart: data.submissionStart,
    submissionEnd: data.submissionEnd,
    budgetTotal: data.budgetTotal,
    budgetMin: data.budgetMin,
    budgetMax: data.budgetMax,
    cofinancingRate: data.cofinancingRate,
    guideUrl: data.guideUrl,
    metadata: data.metadata || {},
    lastSyncedAt: new Date(),
  };

  const existing = await db.query.callsForProposals.findFirst({
    where: (calls, { and, eq }) => and(
      eq(calls.sourceConnectorId, connectorId),
      eq(calls.externalId, data.externalId)
    )
  });

  if (existing) {
    // Check if changed (simplified check on key fields)
    const hasChanged = 
      existing.status !== values.status || 
      existing.titleRo !== values.titleRo ||
      existing.submissionEnd?.getTime() !== values.submissionEnd?.getTime();

    await db.update(callsForProposals)
      .set(values)
      .where(eq(callsForProposals.id, existing.id));
    
    return { id: existing.id, changed: hasChanged };
  } else {
    const [inserted] = await db.insert(callsForProposals).values(values).returning();
    return { id: inserted.id, changed: true };
  }
}
