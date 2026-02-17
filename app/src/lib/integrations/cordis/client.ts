import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { withCache } from '../common/cache';

const EC_SEARCH_API = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const RATE_KEY = 'cordis';
const CACHE_TTL = 12 * 60 * 60 * 1000; // 12h

export interface CORDISProject {
  id: string;
  acronym: string;
  title: string;
  description: string;
  programme: string;
  totalCost: number;
  ecContribution: number;
  startDate: string;
  endDate: string;
  coordinator: string;
  country: string;
  participants: string[];
  status: string;
  url: string;
}

export interface CORDISSearchOptions {
  query?: string;
  programme?: string;
  country?: string;
  limit?: number;
  offset?: number;
}

export async function searchFundedProjects(options: CORDISSearchOptions = {}): Promise<CORDISProject[]> {
  const { query, programme, country, limit = 20, offset = 0 } = options;
  const cacheKey = `cordis:search:${query}:${programme}:${country}:${limit}:${offset}`;

  return withCache(cacheKey, CACHE_TTL, () =>
    withCircuitBreaker(RATE_KEY, () =>
      withRateLimit(RATE_KEY, async () => {
        const pageNumber = Math.floor(offset / Math.max(1, limit)) + 1;
        const params = buildSearchParams({ query, programme, country, limit, pageNumber });

        const response = await fetch(`${EC_SEARCH_API}?${params.toString()}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`CORDIS API error: ${response.status}`);
        }

        const data = (await response.json()) as { results?: unknown[] };
        return (data.results ?? []).map((item) => toCordisProject(item));
      }, { maxRequests: 10, windowMs: 60_000 }),
    ),
  );
}

export async function getProjectDetails(projectId: string): Promise<CORDISProject | null> {
  const normalizedId = projectId.trim();
  if (!normalizedId) return null;

  const cacheKey = `cordis:project:${normalizedId}`;

  return withCache(cacheKey, CACHE_TTL, () =>
    withCircuitBreaker(RATE_KEY, () =>
      withRateLimit(RATE_KEY, async () => {
        const results = await searchFundedProjects({ query: normalizedId, limit: 20, offset: 0 });
        const exact = results.find((project) => {
          const haystack = [project.id, project.acronym, project.url].map((value) => value.toLowerCase());
          const needle = normalizedId.toLowerCase();
          return haystack.some((value) => value === needle || value.includes(needle));
        });

        return exact ?? results[0] ?? null;
      }, { maxRequests: 10, windowMs: 60_000 }),
    ),
  );
}

export async function findSimilarProjects(title: string, programme?: string): Promise<CORDISProject[]> {
  const query = title.trim();
  if (!query) return [];

  return searchFundedProjects({
    query,
    programme,
    limit: 10,
    offset: 0,
  });
}

function buildSearchParams({
  query,
  programme,
  country,
  limit,
  pageNumber,
}: {
  query?: string;
  programme?: string;
  country?: string;
  limit: number;
  pageNumber: number;
}): URLSearchParams {
  const textTerms = [query, programme, country].filter((term): term is string => Boolean(term && term.trim()));
  const text = textTerms.length > 0 ? textTerms.join(' ') : '*';

  const params = new URLSearchParams({
    apiKey: process.env.EC_PORTAL_API_KEY ?? 'SEDIA',
    text,
    pageSize: String(limit),
    pageNumber: String(pageNumber),
    type: 'project',
  });

  const filters: string[] = [];
  if (programme?.trim()) {
    filters.push(`frameworkProgramme:"${escapeQueryValue(programme.trim())}"`);
  }
  if (country?.trim()) {
    filters.push(`coordinatorCountry:"${escapeQueryValue(country.trim())}"`);
  }
  if (filters.length > 0) {
    params.set('query', filters.join(' AND '));
  }

  return params;
}

function escapeQueryValue(value: string): string {
  return value.replace(/"/g, '\\"');
}

function toCordisProject(result: unknown): CORDISProject {
  const record = (result ?? {}) as {
    metadata?: Record<string, unknown>;
    reference?: string;
    summary?: string;
    content?: string;
    url?: string;
  };

  const metadata = record.metadata ?? {};

  const id = metaVal(metadata.identifier) || record.reference || '';
  const acronym = metaVal(metadata.acronym);
  const title = metaVal(metadata.title) || record.content || acronym || id;
  const description =
    sanitizeDescription(metaVal(metadata.descriptionByte)) || record.summary || title;

  const participants = toStringArray(
    metadata.participantOrganisation,
    metadata.participants,
    metadata.beneficiary,
  );

  const defaultUrl = id ? `https://cordis.europa.eu/project/id/${encodeURIComponent(id)}` : 'https://cordis.europa.eu';

  return {
    id,
    acronym,
    title,
    description,
    programme: metaVal(metadata.frameworkProgramme) || metaVal(metadata.programmePeriod),
    totalCost: toNumber(metadata.totalCost),
    ecContribution: toNumber(metadata.ecMaxContribution),
    startDate: metaVal(metadata.startDate),
    endDate: metaVal(metadata.endDate),
    coordinator: metaVal(metadata.coordinator),
    country: metaVal(metadata.coordinatorCountry),
    participants,
    status: metaVal(metadata.status) || metaVal(metadata.projectStatus),
    url: metaVal(metadata.url) || record.url || defaultUrl,
  };
}

function sanitizeDescription(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
}

function metaVal(field: unknown): string {
  if (!field) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'number') return String(field);
  if (Array.isArray(field)) {
    const first = field[0];
    return typeof first === 'string' ? first : typeof first === 'number' ? String(first) : '';
  }
  if (typeof field === 'object') {
    const objectField = field as { value?: unknown };
    if (typeof objectField.value === 'string') return objectField.value;
    if (typeof objectField.value === 'number') return String(objectField.value);
  }
  return '';
}

function toNumber(field: unknown): number {
  const value = metaVal(field).replace(/,/g, '');
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringArray(...fields: unknown[]): string[] {
  const result: string[] = [];
  for (const field of fields) {
    if (!field) continue;

    if (Array.isArray(field)) {
      for (const item of field) {
        if (typeof item === 'string' && item.trim()) result.push(item.trim());
      }
      continue;
    }

    const value = metaVal(field).trim();
    if (value) result.push(value);
  }

  return Array.from(new Set(result));
}
