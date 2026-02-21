// ─── EC Funding & Tenders Portal Client ─────────────────────────
// Live funding calls from EU Funding & Tenders Portal REST API

import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { withCache } from '../common/cache';

const EC_SEARCH_API = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const RATE_KEY = 'ec-portal';
const CACHE_TTL = 4 * 60 * 60 * 1000; // 4h

export interface ECFundingCall {
  identifier: string;
  title: string;
  description: string;
  programme: string;
  status: 'open' | 'forthcoming' | 'closed';
  openingDate: string;
  deadlineDate: string;
  budget: number | null;
  currency: string;
  topics: string[];
  url: string;
}

export interface ECSearchOptions {
  programme?: ECProgramme;
  status?: 'open' | 'forthcoming' | 'closed';
  query?: string;
  limit?: number;
  offset?: number;
}

export type ECProgramme =
  | 'HORIZON'
  | 'LIFE'
  | 'CEF'
  | 'DIGITAL'
  | 'ERASMUS'
  | 'CERV'
  | 'CREATIVE_EUROPE'
  | 'INTERREG';

const PROGRAMME_IDS: Record<ECProgramme, string> = {
  HORIZON: '43108390',
  LIFE: '43252405',
  CEF: '43251567',
  DIGITAL: '43152860',
  ERASMUS: '43353764',
  CERV: '43251589',
  CREATIVE_EUROPE: '43251601',
  INTERREG: '43393006',
};

/**
 * Search EC Funding & Tenders Portal for active calls
 */
export async function searchFundingCalls(options: ECSearchOptions = {}): Promise<ECFundingCall[]> {
  const { programme, status = 'open', query, limit = 50, offset = 0 } = options;

  const cacheKey = `ec:calls:${programme}:${status}:${query}:${limit}:${offset}`;

  return withCache(cacheKey, CACHE_TTL, () =>
    withCircuitBreaker(RATE_KEY, () =>
      withRateLimit(RATE_KEY, async () => {
        // EC API frequently returns closed calls first. When the UI asks for open/forthcoming,
        // scan several pages and then filter status client-side to avoid empty results.
        const basePage = Math.floor(offset / limit) + 1;
        const pagesToScan = !query && (status === 'open' || status === 'forthcoming') ? 5 : 1;
        const allCalls: ECFundingCall[] = [];
        const seen = new Set<string>();

        for (let i = 0; i < pagesToScan; i += 1) {
          const calls = await fetchECPage({
            programme,
            status,
            query,
            limit,
            pageNumber: basePage + i,
          });
          if (calls.length === 0) break;

          for (const call of calls) {
            if (seen.has(call.identifier)) continue;
            seen.add(call.identifier);
            allCalls.push(call);
          }

          if (allCalls.length >= limit * pagesToScan) break;
        }

        let filtered = allCalls;
        if (status === 'open') {
          filtered = allCalls.filter((c) => c.status === 'open' || c.status === 'forthcoming');
        } else if (status === 'forthcoming' || status === 'closed') {
          filtered = allCalls.filter((c) => c.status === status);
        }

        if (filtered.length === 0 && allCalls.length > 0 && (status === 'open' || status === 'forthcoming')) {
          filtered = allCalls;
        }

        return filtered.slice(0, limit);
      }, { maxRequests: 10, windowMs: 60_000 }),
    ),
  );
}

async function fetchECPage({
  programme,
  status,
  query,
  limit,
  pageNumber,
}: {
  programme?: ECProgramme;
  status?: 'open' | 'forthcoming' | 'closed';
  query?: string;
  limit: number;
  pageNumber: number;
}): Promise<ECFundingCall[]> {
  const defaultText = status === 'open' ? 'open' : status === 'forthcoming' ? 'forthcoming' : '*';
  const params = new URLSearchParams({
    apiKey: process.env.EC_PORTAL_API_KEY ?? 'SEDIA',
    text: query ?? defaultText,
    pageSize: String(limit),
    pageNumber: String(pageNumber),
  });

  if (programme && PROGRAMME_IDS[programme]) {
    params.set('query', `programmePeriod:"2021-2027"`);
  }

  const apiUrl = `${EC_SEARCH_API}?${params.toString()}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`EC Portal API error: ${response.status}`);
  }

  const data = await response.json();
  return parseECResults(data);
}

// Helper to extract first value from EC metadata field (arrays of strings)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
function metaVal(field: any): string {
  if (!field) return '';
  if (Array.isArray(field)) return field[0] ?? '';
  if (typeof field === 'object' && field.value) return field.value;
  return String(field);
}

function parseECResults(data: any): ECFundingCall[] {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = data?.results ?? [];
  return results.map((r: any) => {
    const m = r.metadata ?? {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const identifier = metaVal(m.identifier) || r.reference || '';
    const title = metaVal(m.title) || r.content || r.summary || '';
    const rawStatus = metaVal(m.status) || metaVal(m.sortStatus);
    return {
      identifier,
      title,
      description: metaVal(m.descriptionByte)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 500) || r.summary || '',
      programme: metaVal(m.frameworkProgramme) || metaVal(m.programmePeriod) || '',
      status: parseStatus(rawStatus),
      openingDate: metaVal(m.startDate),
      deadlineDate: metaVal(m.deadlineDate),
      budget: null, // Budget is nested in budgetOverview, not a simple field
      currency: 'EUR',
      topics: Array.isArray(m.keywords) ? m.keywords.slice(0, 10) : [],
      url: metaVal(m.url) || `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${identifier}`,
    };
  });
}

function parseStatus(status: string): ECFundingCall['status'] {
  // EC API uses numeric IDs: 31094501=Open, 31094502=Forthcoming, 31094503=Closed
  if (status === '31094501' || status === '1' || status.toLowerCase().includes('open')) return 'open';
  if (status === '31094502' || status === '2' || status.toLowerCase().includes('forthcoming')) return 'forthcoming';
  return 'closed';
}

/**
 * Get details for a specific funding call
 */
export async function getFundingCallDetails(identifier: string): Promise<ECFundingCall | null> {
  const results = await searchFundingCalls({ query: identifier, limit: 1 });
  return results[0] ?? null;
}

/**
 * Get all open calls across all major programmes
 */
export async function getAllOpenCalls(): Promise<ECFundingCall[]> {
  return searchFundingCalls({ status: 'open', limit: 100 });
}

/**
 * Parse eligibility criteria from call description (simplified)
 */
export function parseEligibilityCriteria(call: ECFundingCall): {
  countries: string[];
  entityTypes: string[];
  minPartners?: number;
  maxBudget?: number;
} {
  const desc = (call.description ?? '').toLowerCase();
  const criteria: ReturnType<typeof parseEligibilityCriteria> = {
    countries: [],
    entityTypes: [],
  };

  // Detect country eligibility
  if (desc.includes('eu member state') || desc.includes('member states')) {
    criteria.countries.push('EU-27');
  }
  if (desc.includes('associated countries') || desc.includes('third countries')) {
    criteria.countries.push('ASSOCIATED');
  }

  // Detect entity types
  if (desc.includes('sme') || desc.includes('small and medium')) {
    criteria.entityTypes.push('SME');
  }
  if (desc.includes('research') || desc.includes('university')) {
    criteria.entityTypes.push('RESEARCH');
  }
  if (desc.includes('public bod') || desc.includes('public authorit')) {
    criteria.entityTypes.push('PUBLIC_BODY');
  }
  if (desc.includes('ngo') || desc.includes('civil society')) {
    criteria.entityTypes.push('NGO');
  }

  if (call.budget) criteria.maxBudget = call.budget;

  return criteria;
}
