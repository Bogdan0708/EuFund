// ─── EUR-Lex Content Ingestion ───────────────────────────────────
// Fetch and process EU legislation from EUR-Lex

import { ingestLegislation } from './pipeline';
import { normalizeDiacritics } from '@/lib/utils/romanian';

const EURLEX_SEARCH_API = 'https://eur-lex.europa.eu/search.html';
const EURLEX_CELLAR_API = 'https://publications.europa.eu/resource/cellar';

export interface EURLexDocument {
  celex: string;
  title: string;
  type: string;
  date: string;
  text?: string;
  url: string;
}

/**
 * Fetch document metadata from EUR-Lex REST API
 * Uses the SPARQL endpoint for structured queries
 */
export async function fetchEURLexDocument(celex: string): Promise<EURLexDocument | null> {
  try {
    const url = `https://eur-lex.europa.eu/legal-content/RO/TXT/?uri=CELEX:${celex}`;
    const response = await fetch(url, {
      headers: { 'Accept': 'text/html' },
    });

    if (!response.ok) return null;

    const html = await response.text();
    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? normalizeDiacritics(titleMatch[1].trim()) : celex;

    // Extract main text content (simplified extraction)
    const textMatch = html.match(/<div[^>]*id="TexteOnly"[^>]*>([\s\S]*?)<\/div>/i);
    const text = textMatch
      ? normalizeDiacritics(textMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      : undefined;

    return {
      celex,
      title,
      type: inferTypeFromCelex(celex),
      date: '',
      text,
      url,
    };
  } catch {
    return null;
  }
}

/**
 * Infer document type from CELEX number
 */
function inferTypeFromCelex(celex: string): string {
  if (celex.startsWith('3') && celex.includes('R')) return 'regulament_eu';
  if (celex.startsWith('3') && celex.includes('L')) return 'directiva_eu';
  if (celex.startsWith('3') && celex.includes('D')) return 'decizie_eu';
  return 'altul';
}

/**
 * Ingest a EUR-Lex document into the vector store
 */
export async function ingestEURLexDocument(celex: string): Promise<{
  success: boolean;
  chunksCreated?: number;
  error?: string;
}> {
  const doc = await fetchEURLexDocument(celex);
  if (!doc || !doc.text) {
    return { success: false, error: `Could not fetch document ${celex}` };
  }

  const result = await ingestLegislation({
    id: `eurlex-${celex}`,
    title: doc.title,
    fullText: doc.text,
    type: doc.type,
    metadata: {
      source: 'eur-lex',
      celex,
      url: doc.url,
      fetchedAt: new Date().toISOString(),
    },
  });

  return { success: true, chunksCreated: result.chunksCreated };
}

/**
 * Key EU legislation CELEX numbers for Romanian EU funding
 */
export const KEY_LEGISLATION = [
  '32021R1060', // CPR - Common Provisions Regulation 2021-2027
  '32021R1058', // ERDF/CF Regulation
  '32021R1057', // ESF+ Regulation
  '32021R0241', // RRF Regulation (Recovery and Resilience)
  '32021R0695', // Horizon Europe Regulation
  '32021R0783', // LIFE Programme Regulation
  '32021R1059', // Interreg Regulation
  '32016R0679', // GDPR
] as const;
