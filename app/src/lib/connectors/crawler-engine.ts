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

/**
 * Validate that a URL is safe to fetch — reject internal/private IPs,
 * metadata endpoints, and non-HTTPS schemes in production.
 */
function validateCrawlerUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid crawler URL: ${url}`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Disallowed protocol in crawler URL: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block cloud metadata endpoints
  const blockedHostnames = [
    'metadata.google.internal',
    'metadata.goog',
    '169.254.169.254',
    'metadata.azure.com',
  ];
  if (blockedHostnames.includes(hostname)) {
    throw new Error(`Blocked metadata endpoint: ${hostname}`);
  }

  // Block RFC1918 private ranges, loopback, and link-local
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    const isPrivate =
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0;
    if (isPrivate) {
      throw new Error(`Blocked private/internal IP in crawler URL: ${hostname}`);
    }
  }

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error(`Blocked internal hostname in crawler URL: ${hostname}`);
  }
}

export async function runCrawler(config: CrawlerSourceConfig, connectorId: string) {
  log.info({ source: config.slug }, 'Starting crawler run');
  
  const [run] = await db.insert(sourceRuns).values({
    connectorId,
    status: 'running',
    startedAt: new Date(),
  }).returning();

  try {
    validateCrawlerUrl(config.listingUrl);

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
