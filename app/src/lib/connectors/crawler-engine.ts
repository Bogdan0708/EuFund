import * as cheerio from 'cheerio';
import { CrawlerSourceConfig } from './sources/config';
import { normalizeAndUpsertCall } from './normalize';
import { db } from '@/lib/db';
import { sourceRuns, fundingDocumentsRaw } from '@/lib/db/schema';
import { createHash } from 'crypto';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'crawler-engine' });

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
];

export async function runCrawler(config: CrawlerSourceConfig, connectorId: string) {
  log.info({ source: config.slug }, 'Starting crawler run');
  
  const [run] = await db.insert(sourceRuns).values({
    connectorId,
    status: 'running',
    startedAt: new Date(),
  }).returning();

  try {
    const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const response = await fetch(config.listingUrl, {
      headers: { 'User-Agent': userAgent }
    });

    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    
    const html = await response.text();
    const $ = cheerio.load(html);
    const items = $(config.itemSelector);
    
    log.info({ found: items.length }, 'Discovered potential items');

    let changed = 0;
    let discovered = 0;

    for (const el of items.toArray()) {
      const $el = $(el);
      const title = $el.find(config.titleSelector).text().trim();
      const relativeLink = $el.find(config.linkSelector).attr('href');
      
      if (!title || !relativeLink) continue;
      discovered++;

      const absoluteLink = relativeLink.startsWith('http') 
        ? relativeLink 
        : new URL(relativeLink, config.baseUrl).toString();

      // Detection
      const programme = detectProgramme(title, config.programmeDetectionKeywords);
      const externalId = createHash('md5').update(absoluteLink).digest('hex').slice(0, 12);

      const { changed: callChanged } = await normalizeAndUpsertCall(connectorId, {
        externalId,
        callCode: externalId,
        titleRo: title,
        programmeCode: programme,
        status: 'deschis',
        guideUrl: absoluteLink,
        metadata: { crawlerSource: config.slug }
      });

      if (callChanged) changed++;
    }

    await db.insert(fundingDocumentsRaw).values({
      connectorId,
      runId: run.id,
      externalKey: 'listing-page',
      sourceUrl: config.listingUrl,
      documentType: 'listing',
      fileType: 'html',
      sha256: createHash('sha256').update(html).digest('hex'),
      storagePath: `raw/${config.slug}/listing.html`,
      textContent: html,
    }).onConflictDoNothing();

    await db.update(sourceRuns)
      .set({
        status: 'success',
        finishedAt: new Date(),
        itemsDiscovered: discovered,
        itemsChanged: changed,
      })
      .where(eq(sourceRuns.id, run.id));

    return { discovered, changed };

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ error, source: config.slug }, 'Crawler failed');
    await db.update(sourceRuns)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(eq(sourceRuns.id, run.id));
    throw error;
  }
}

function detectProgramme(title: string, keywords: Record<string, string[]>): string {
  const upper = title.toUpperCase();
  for (const [prog, keys] of Object.entries(keywords)) {
    if (keys.some(k => upper.includes(k.toUpperCase()))) return prog;
  }
  return 'RO-GRANT';
}

import { eq } from 'drizzle-orm';
