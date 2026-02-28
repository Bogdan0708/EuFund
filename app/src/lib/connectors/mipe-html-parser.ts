import * as cheerio from 'cheerio';

export interface MIPEPageData {
  title: string;
  programme: string;
  deadline?: string;
  guideUrl?: string;
  externalId: string;
}

/**
 * Parses MIPE calls listing page
 * Handles structural variations with defensive selectors
 */
export function parseMIPEListing(html: string): MIPEPageData[] {
  const $ = cheerio.load(html);
  const items: MIPEPageData[] = [];

  // Attempt to find call containers (typically articles or specific list items)
  // These selectors are based on common Romanian gov site patterns
  const selectors = ['.post-content', 'article', '.list-item', 'tr'];
  
  let container: ReturnType<typeof $> | null = null;
  for (const s of selectors) {
    const found = $(s);
    if (found.length > 5) { // Heuristic: listing should have many items
      container = found;
      break;
    }
  }

  if (!container) return [];

  container.each((_, el) => {
    const $el = $(el);
    const title = $el.find('h2, h3, .title').text().trim();
    const link = $el.find('a').attr('href');
    
    if (title && title.length > 10) {
      // Extract ID from URL or title slug
      const externalId = link 
        ? link.split('/').filter(Boolean).pop() || Buffer.from(title).toString('base64').slice(0, 20)
        : Buffer.from(title).toString('base64').slice(0, 20);

      items.push({
        title,
        programme: detectProgramme(title),
        guideUrl: link,
        externalId,
      });
    }
  });

  return items;
}

function detectProgramme(text: string): string {
  const t = text.toUpperCase();
  if (t.includes('PNRR')) return 'PNRR';
  if (t.includes('POCIDIF')) return 'POCIDIF';
  if (t.includes('ADR')) return 'REGIONAL';
  if (t.includes('PEO')) return 'PEO';
  if (t.includes('PIDS')) return 'PIDS';
  return 'NATIONAL-OTHER';
}
