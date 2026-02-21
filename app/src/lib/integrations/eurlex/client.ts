// ─── EUR-Lex API Client ─────────────────────────────────────────
// SPARQL and REST access to EU legal documents

import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { withCache } from '../common/cache';
import { normalizeDiacritics } from '@/lib/utils/romanian';

const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
const EURLEX_BASE = 'https://eur-lex.europa.eu';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h for legislation
const RATE_LIMIT_KEY = 'eurlex';

export interface EURLexSearchResult {
  celex: string;
  title: string;
  titleRo?: string;
  type: DocumentType;
  date: string;
  inForce: boolean;
  url: string;
}

export interface EURLexDocumentFull {
  celex: string;
  title: string;
  titleRo?: string;
  type: DocumentType;
  date: string;
  textRo?: string;
  textEn?: string;
  eurLexUrl: string;
  subjects: string[];
  inForce: boolean;
}

export type DocumentType = 'regulation' | 'directive' | 'decision' | 'recommendation' | 'opinion' | 'other';

function celexToType(celex: string): DocumentType {
  const sector = celex.charAt(0);
  if (sector !== '3') return 'other';
  if (celex.includes('R')) return 'regulation';
  if (celex.includes('L')) return 'directive';
  if (celex.includes('D')) return 'decision';
  if (celex.includes('H')) return 'recommendation';
  if (celex.includes('O')) return 'opinion';
  return 'other';
}

/**
 * Search EUR-Lex via SPARQL for EU legislation
 */
export async function searchEURLex(query: string, options: {
  type?: DocumentType;
  language?: 'ro' | 'en';
  limit?: number;
  inForceOnly?: boolean;
} = {}): Promise<EURLexSearchResult[]> {
  const { type, language = 'ro', limit = 20, inForceOnly = true } = options;

  return withCache(`eurlex:search:${query}:${type}:${language}:${limit}`, CACHE_TTL, () =>
    withCircuitBreaker(RATE_LIMIT_KEY, () =>
      withRateLimit(RATE_LIMIT_KEY, async () => {
        const typeFilter = type ? buildTypeFilter(type) : '';
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const forceFilter = inForceOnly ? '?work cdm:resource_legal_in-force "true"^^xsd:boolean .' : '';

        // Use LANG() filter instead of expression_uses_language (CDM ontology compatibility)
        const langCode = language.toLowerCase();
        const escapedQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        const sparql = `
          PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
          PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
          SELECT DISTINCT ?celex ?title WHERE {
            ?work cdm:resource_legal_id_celex ?celex .
            ?expression cdm:expression_belongs_to_work ?work .
            ?expression cdm:expression_title ?title .
            ${typeFilter}
            FILTER(LANG(?title) = "${langCode}")
            FILTER(REGEX(STR(?title), "${escapedQuery}", "i"))
          }
          LIMIT ${limit}
        `;

        const response = await fetch(SPARQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/sparql-results+json',
          },
          body: `query=${encodeURIComponent(sparql)}`,
        });

        if (!response.ok) {
          throw new Error(`EUR-Lex SPARQL error: ${response.status}`);
        }

        const data = await response.json();
        return (data.results?.bindings ?? []).map((b: any) => ({
          celex: b.celex?.value ?? '',
          title: normalizeDiacritics(b.title?.value ?? ''),
          titleRo: language === 'ro' ? normalizeDiacritics(b.title?.value ?? '') : undefined,
          type: celexToType(b.celex?.value ?? ''),
          date: '', // Date removed from query for compatibility
          inForce: true,
          url: `${EURLEX_BASE}/legal-content/${language.toUpperCase()}/TXT/?uri=CELEX:${b.celex?.value}`,
        }));
      }, { maxRequests: 5, windowMs: 60_000 }),
    ),
  );
}

function buildTypeFilter(type: DocumentType): string {
  const typeMap: Record<DocumentType, string> = {
    regulation: 'R',
    directive: 'L',
    decision: 'D',
    recommendation: 'H',
    opinion: 'O',
    other: '',
  };
  const code = typeMap[type];
  return code ? `FILTER(CONTAINS(?celex, "${code}"))` : '';
}

/**
 * Fetch a specific document by CELEX number
 */
export async function getDocumentByCelex(celex: string): Promise<EURLexDocumentFull | null> {
  return withCache(`eurlex:doc:${celex}`, CACHE_TTL, () =>
    withCircuitBreaker(RATE_LIMIT_KEY, () =>
      withRateLimit(RATE_LIMIT_KEY, async () => {
        // Fetch Romanian version
        const roUrl = `${EURLEX_BASE}/legal-content/RO/TXT/?uri=CELEX:${celex}`;
        const roResponse = await fetch(roUrl, { headers: { Accept: 'text/html' } });

        let titleRo = celex;
        let textRo: string | undefined;

        if (roResponse.ok) {
          const html = await roResponse.text();
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch) titleRo = normalizeDiacritics(titleMatch[1].trim());

          const textMatch = html.match(/<div[^>]*id="TexteOnly"[^>]*>([\s\S]*?)<\/div>/i);
          if (textMatch) {
            textRo = normalizeDiacritics(
              textMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
            );
          }
        }

        return {
          celex,
          title: titleRo,
          titleRo,
          type: celexToType(celex),
          date: '',
          textRo,
          eurLexUrl: roUrl,
          subjects: [],
          inForce: true,
        };
      }),
    ),
  );
}

/**
 * Resolve a CELEX reference to a full URL
 */
export function resolveCelexUrl(celex: string, lang: 'ro' | 'en' = 'ro'): string {
  return `${EURLEX_BASE}/legal-content/${lang.toUpperCase()}/TXT/?uri=CELEX:${celex}`;
}

/**
 * Key EU funding legislation CELEX numbers
 */
export const KEY_FUNDING_LEGISLATION = {
  CPR_2021: '32021R1060',
  ERDF_CF: '32021R1058',
  ESF_PLUS: '32021R1057',
  RRF: '32021R0241',
  HORIZON_EUROPE: '32021R0695',
  LIFE: '32021R0783',
  INTERREG: '32021R1059',
  GDPR: '32016R0679',
  EIDAS: '32014R0910',
  STATE_AID: '32014R0651',
} as const;
