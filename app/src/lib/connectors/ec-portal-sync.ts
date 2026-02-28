import { db } from '@/lib/db';
import { sourceRuns, fundingDocumentsRaw, fundingCallVersions } from '@/lib/db/schema';
import { searchFundingCalls } from '@/lib/integrations/ec-portal/client';
import { ConnectorSyncFn } from './types';
import { normalizeAndUpsertCall } from './normalize';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';

const log = logger.child({ component: 'ec-portal-sync' });

export const ecPortalSync: ConnectorSyncFn = async (connector, options) => {
  log.info({ connector: connector.slug }, 'Starting EC Portal sync');
  
  // 1. Create sourceRuns record
  const [run] = await db.insert(sourceRuns).values({
    connectorId: connector.id,
    status: 'running',
    startedAt: new Date(),
    metadata: { options },
  }).returning();

  let discovered = 0;
  let changed = 0;

  try {
    // 2. Fetch all open+forthcoming calls
    const openCalls = await searchFundingCalls({ status: 'open', limit: 100 });
    const forthcomingCalls = await searchFundingCalls({ status: 'forthcoming', limit: 50 });
    const allECItems = [...openCalls, ...forthcomingCalls];
    discovered = allECItems.length;

    for (const ecCall of allECItems) {
      // 3. Compute SHA-256 and upsert raw doc
      const serialized = JSON.stringify(ecCall);
      const sha256 = createHash('sha256').update(serialized).digest('hex');
      
      await db.insert(fundingDocumentsRaw).values({
        connectorId: connector.id,
        runId: run.id,
        externalKey: ecCall.identifier,
        sourceUrl: ecCall.url,
        documentType: 'funding_call',
        fileType: 'json',
        title: ecCall.title,
        sha256,
        storagePath: `raw/ec-portal/${ecCall.identifier}/${sha256}.json`,
        textContent: ecCall.description,
        metadata: { raw: ecCall },
      }).onConflictDoUpdate({
        target: [fundingDocumentsRaw.connectorId, fundingDocumentsRaw.externalKey, fundingDocumentsRaw.sha256],
        set: { fetchedAt: new Date() }
      }).returning();

      // 4. Map and Upsert call
      const { changed: callChanged } = await normalizeAndUpsertCall(connector.id, {
        externalId: ecCall.identifier,
        callCode: ecCall.identifier, // Often same for EC
        titleRo: ecCall.title, // Fallback to EN if RO not available
        titleEn: ecCall.title,
        descriptionRo: ecCall.description,
        programmeCode: mapECProgramme(ecCall.programme),
        status: ecCall.status === 'open' ? 'deschis' : 'previzionat',
        submissionEnd: new Date(ecCall.deadlineDate),
        submissionStart: new Date(ecCall.openingDate),
        guideUrl: ecCall.url,
        metadata: { ecRaw: ecCall },
      });

      if (callChanged) {
        changed++;
        // 5. Create version entry
        await db.insert(fundingCallVersions).values({
          callExternalKey: ecCall.identifier,
          versionNo: 1, // Simplified versioning
          changedFields: { lastSyncedAt: new Date() },
          createdAt: new Date(),
        }).onConflictDoNothing();
      }
    }

    // 6. Update run status
    await db.update(sourceRuns)
      .set({
        status: 'success',
        finishedAt: new Date(),
        itemsDiscovered: discovered,
        itemsChanged: changed,
      })
      .where(eq(sourceRuns.id, run.id));

    return { runId: run.id, itemsDiscovered: discovered, itemsChanged: changed, status: 'success' };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, runId: run.id }, 'EC Portal sync failed');
    await db.update(sourceRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: message,
      })
      .where(eq(sourceRuns.id, run.id));
    
    return { runId: run.id, itemsDiscovered: discovered, itemsChanged: changed, status: 'failed', error: message };
  }
};

function mapECProgramme(ecName: string): string {
  const name = ecName.toLowerCase();
  if (name.includes('horizon')) return 'HORIZON-EUROPE';
  if (name.includes('life')) return 'LIFE-PLUS';
  if (name.includes('interreg')) return 'INTERREG-VI';
  if (name.includes('digital')) return 'DIGITAL-EUROPE';
  if (name.includes('erasmus')) return 'ERASMUS-PLUS';
  return ecName.toUpperCase().replace(/\s+/g, '-');
}
