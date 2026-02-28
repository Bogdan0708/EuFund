import { db } from '@/lib/db';
import { sourceRuns, fundingDocumentsRaw, fundingReviewQueue } from '@/lib/db/schema';
import { ConnectorSyncFn } from './types';
import { normalizeAndUpsertCall } from './normalize';
import { parseMIPEListing } from './mipe-html-parser';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'mipe-sync' });

const MIPE_CALLS_URL = 'https://mfe.gov.ro/programe-2021-2027/apeluri-lansate-2021-2027/';

export const mipeSync: ConnectorSyncFn = async (connector, options) => {
  log.info({ connector: connector.slug }, 'Starting MIPE sync');
  
  const [run] = await db.insert(sourceRuns).values({
    connectorId: connector.id,
    status: 'running',
    startedAt: new Date(),
    metadata: { options },
  }).returning();

  try {
    const response = await fetch(MIPE_CALLS_URL, {
      headers: { 'User-Agent': 'EuFund-Sync-Bot/1.0' }
    });

    if (!response.ok) {
      throw new Error(`MIPE page fetch failed: ${response.status}`);
    }

    const html = await response.text();
    const sha256 = createHash('sha256').update(html).digest('hex');

    // Store raw document
    await db.insert(fundingDocumentsRaw).values({
      connectorId: connector.id,
      runId: run.id,
      externalKey: 'listing-page',
      sourceUrl: MIPE_CALLS_URL,
      documentType: 'listing_page',
      fileType: 'html',
      sha256,
      storagePath: `raw/mipe/listing-${new Date().toISOString().split('T')[0]}.html`,
      textContent: html,
    }).onConflictDoNothing();

    const items = parseMIPEListing(html);
    let changed = 0;

    if (items.length === 0) {
      // Potentially broken parser - queue for review
      await db.insert(fundingReviewQueue).values({
        callExternalKey: 'mipe-listing',
        reason: 'MIPE parser returned zero items. Page structure might have changed.',
        severity: 'high',
        status: 'pending',
        createdAt: new Date(),
      });
    }

    for (const item of items) {
      const { changed: callChanged } = await normalizeAndUpsertCall(connector.id, {
        externalId: item.externalId,
        callCode: item.externalId,
        titleRo: item.title,
        programmeCode: item.programme,
        status: 'deschis', // Default for this listing
        guideUrl: item.guideUrl,
        metadata: { mipeRaw: item },
      });

      if (callChanged) changed++;
    }

    await db.update(sourceRuns)
      .set({
        status: 'success',
        finishedAt: new Date(),
        itemsDiscovered: items.length,
        itemsChanged: changed,
      })
      .where(eq(sourceRuns.id, run.id));

    return { runId: run.id, itemsDiscovered: items.length, itemsChanged: changed, status: 'success' };

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, runId: run.id }, 'MIPE sync failed');
    await db.update(sourceRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        error: message,
      })
      .where(eq(sourceRuns.id, run.id));
    
    return { runId: run.id, itemsDiscovered: 0, itemsChanged: 0, status: 'failed', error: message };
  }
};
