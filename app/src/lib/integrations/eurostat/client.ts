import { withRateLimit } from '../common/rate-limiter';
import { withCircuitBreaker } from '../common/circuit-breaker';
import { withCache } from '../common/cache';

const EUROSTAT_BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
const EUROSTAT_TOC = 'https://ec.europa.eu/eurostat/api/dissemination/catalogue/toc';
const RATE_KEY = 'eurostat';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

export interface EurostatDataPoint {
  label: string;
  value: number | null;
  year: number;
  unit: string;
}

export interface EurostatRegionalData {
  nutsCode: string;
  nutsName: string;
  indicators: EurostatDataPoint[];
  source: string;
  retrievedAt: string;
}

interface EurostatDatasetResponse {
  label?: string;
  id?: string[];
  size?: number[];
  value?: Record<string, number | null>;
  dimension?: {
    geo?: EurostatDimension;
    unit?: EurostatDimension;
    time?: EurostatDimension;
  };
}

interface EurostatDimension {
  category?: {
    index?: string[] | Record<string, number>;
    label?: Record<string, string>;
  };
}

export interface EurostatIndicator {
  code: string;
  title: string;
  url?: string;
}

export async function getRegionalGDP(nutsCode: string, years?: number[]): Promise<EurostatRegionalData> {
  return fetchRegionalDataset({
    nutsCode,
    datasetCode: 'nama_10r_2gdp',
    years,
    staticParams: {
      na_item: 'B1GQ',
      unit: 'MIO_EUR',
      lang: 'EN',
    },
    labelPrefix: 'GDP',
  });
}

export async function getRegionalUnemployment(nutsCode: string, years?: number[]): Promise<EurostatRegionalData> {
  return fetchRegionalDataset({
    nutsCode,
    datasetCode: 'lfst_r_lfu3rt',
    years,
    staticParams: {
      sex: 'T',
      age: 'Y15-74',
      unit: 'PC_ACT',
      lang: 'EN',
    },
    labelPrefix: 'Unemployment rate',
  });
}

export async function getRegionalPopulation(nutsCode: string, years?: number[]): Promise<EurostatRegionalData> {
  return fetchRegionalDataset({
    nutsCode,
    datasetCode: 'demo_r_d2jan',
    years,
    staticParams: {
      sex: 'T',
      age: 'TOTAL',
      unit: 'NR',
      lang: 'EN',
    },
    labelPrefix: 'Population',
  });
}

export async function searchIndicators(query: string): Promise<EurostatIndicator[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const cacheKey = `eurostat:indicators:${normalizedQuery}`;

  return withCache(cacheKey, CACHE_TTL, () =>
    withCircuitBreaker(RATE_KEY, () =>
      withRateLimit(RATE_KEY, async () => {
        const response = await fetch(`${EUROSTAT_TOC}?lang=en`);
        if (!response.ok) {
          throw new Error(`Eurostat TOC API error: ${response.status}`);
        }

        const data = (await response.json()) as {
          link?: Array<{ code?: string; title?: string; href?: string }>;
          dataset?: Array<{ code?: string; title?: string; href?: string }>;
        };

        const entries = [...(data.link ?? []), ...(data.dataset ?? [])];
        const deduped = new Map<string, EurostatIndicator>();

        for (const entry of entries) {
          const code = entry.code?.trim();
          const title = entry.title?.trim() ?? '';
          if (!code) continue;

          const haystack = `${code} ${title}`.toLowerCase();
          if (!haystack.includes(normalizedQuery)) continue;

          deduped.set(code, {
            code,
            title: title || code,
            url: entry.href,
          });
        }

        return Array.from(deduped.values()).slice(0, 100);
      }, { maxRequests: 10, windowMs: 60_000 }),
    ),
  );
}

async function fetchRegionalDataset({
  nutsCode,
  datasetCode,
  years,
  staticParams,
  labelPrefix,
}: {
  nutsCode: string;
  datasetCode: string;
  years?: number[];
  staticParams: Record<string, string>;
  labelPrefix: string;
}): Promise<EurostatRegionalData> {
  const sortedYears = normalizeYears(years);
  const yearsKey = sortedYears.length > 0 ? sortedYears.join(',') : 'all';
  const cacheKey = `eurostat:${datasetCode}:${nutsCode}:${yearsKey}`;

  return withCache(cacheKey, CACHE_TTL, () =>
    withCircuitBreaker(RATE_KEY, () =>
      withRateLimit(RATE_KEY, async () => {
        const params = new URLSearchParams({
          ...staticParams,
          geo: nutsCode,
        });

        for (const year of sortedYears) {
          params.append('time', String(year));
        }

        const response = await fetch(`${EUROSTAT_BASE}/${datasetCode}?${params.toString()}`);
        if (!response.ok) {
          throw new Error(`Eurostat API error (${datasetCode}): ${response.status}`);
        }

        const payload = (await response.json()) as EurostatDatasetResponse;
        const parsed = parseDataset(payload, labelPrefix);

        return {
          nutsCode,
          nutsName: parsed.nutsName,
          indicators: parsed.indicators,
          source: `Eurostat (${datasetCode})`,
          retrievedAt: new Date().toISOString(),
        };
      }, { maxRequests: 10, windowMs: 60_000 }),
    ),
  );
}

function parseDataset(
  payload: EurostatDatasetResponse,
  labelPrefix: string,
): { nutsName: string; indicators: EurostatDataPoint[] } {
  const ids = payload.id ?? [];
  const sizes = payload.size ?? [];

  const geoDimension = payload.dimension?.geo;
  const geoLabel = extractSingleDimensionLabel(geoDimension);

  const unitDimension = payload.dimension?.unit;
  const unitLabel = extractSingleDimensionLabel(unitDimension);

  const timeDimension = payload.dimension?.time;
  const timeCodes = dimensionIndexToArray(timeDimension?.category?.index);

  const timeIndex = ids.indexOf('time');
  const timeSize = timeIndex >= 0 ? sizes[timeIndex] ?? timeCodes.length : timeCodes.length;

  const indicators: EurostatDataPoint[] = [];
  const values = payload.value ?? {};

  for (let i = 0; i < timeSize; i += 1) {
    const yearCode = timeCodes[i] ?? '';
    const year = Number.parseInt(yearCode, 10);
    if (!Number.isFinite(year)) continue;

    const rawValue = values[String(i)];
    indicators.push({
      label: `${labelPrefix} ${year}`,
      value: typeof rawValue === 'number' ? rawValue : null,
      year,
      unit: unitLabel || '',
    });
  }

  indicators.sort((a, b) => a.year - b.year);

  return {
    nutsName: geoLabel || '',
    indicators,
  };
}

function normalizeYears(years?: number[]): number[] {
  if (!years || years.length === 0) return [];
  const unique = new Set<number>();
  for (const year of years) {
    if (Number.isFinite(year)) unique.add(Math.trunc(year));
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function dimensionIndexToArray(index: string[] | Record<string, number> | undefined): string[] {
  if (!index) return [];
  if (Array.isArray(index)) return index;
  return Object.entries(index)
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => key);
}

function extractSingleDimensionLabel(dimension: EurostatDimension | undefined): string {
  if (!dimension?.category) return '';
  const keys = dimensionIndexToArray(dimension.category.index);
  if (keys.length === 0) return '';

  const firstKey = keys[0];
  return dimension.category.label?.[firstKey] ?? firstKey;
}
