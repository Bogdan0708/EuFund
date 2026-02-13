/**
 * Multi-Layer Caching Strategy
 * Layer 1: CDN (CloudFront) - static assets, public pages
 * Layer 2: Redis - API responses, session data, rate limiting
 * Layer 3: In-memory - hot data, configuration
 */

// In-memory LRU cache for hot data
const memoryCache = new Map<string, { value: unknown; expiresAt: number }>();
const MAX_MEMORY_CACHE_SIZE = 1000;

// TTL defaults (seconds)
export const CACHE_TTL = {
  // Static/rarely changing
  FUNDING_PROGRAMS: 3600,        // 1 hour - funding programs list
  ORGANIZATION_PROFILE: 300,     // 5 min - org details
  ELIGIBILITY_CRITERIA: 1800,    // 30 min - funding criteria

  // Dynamic data
  PROPOSAL_DRAFT: 60,            // 1 min - draft proposal
  USER_SESSION: 86400,           // 24 hours - session data
  DASHBOARD_STATS: 120,          // 2 min - dashboard statistics

  // External API responses
  ONRC_COMPANY_DATA: 86400,      // 24 hours - company registration (rarely changes)
  ANAF_FISCAL_DATA: 3600,        // 1 hour - fiscal data
  EXCHANGE_RATES: 3600,          // 1 hour - EUR/RON rates

  // Rate limiting
  RATE_LIMIT_WINDOW: 60,         // 1 min sliding window
} as const;

/**
 * Cache key builder with namespace
 */
export function cacheKey(namespace: string, ...parts: string[]): string {
  return `eufunds:${namespace}:${parts.join(':')}`;
}

/**
 * In-memory cache (Layer 3)
 */
export function getFromMemory<T>(key: string): T | null {
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value as T;
}

export function setInMemory(key: string, value: unknown, ttlSeconds: number): void {
  if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE) {
    // Evict oldest entry
    const firstKey = memoryCache.keys().next().value;
    if (firstKey) memoryCache.delete(firstKey);
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

/**
 * Redis cache operations (Layer 2)
 * Uses the Redis client from the app's connection
 */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<void>;
  del(key: string): Promise<void>;
}

export async function getCached<T>(
  client: CacheClient,
  key: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number
): Promise<T> {
  // Layer 3: Check memory first
  const memResult = getFromMemory<T>(key);
  if (memResult !== null) return memResult;

  // Layer 2: Check Redis
  const cached = await client.get(key);
  if (cached) {
    const parsed = JSON.parse(cached) as T;
    // Promote to memory cache (shorter TTL)
    setInMemory(key, parsed, Math.min(ttlSeconds, 60));
    return parsed;
  }

  // Cache miss: fetch and store
  const fresh = await fetcher();
  const serialized = JSON.stringify(fresh);

  // Store in Redis
  await client.set(key, serialized, { EX: ttlSeconds });
  // Store in memory
  setInMemory(key, fresh, Math.min(ttlSeconds, 60));

  return fresh;
}

/**
 * Cache invalidation patterns
 */
export async function invalidatePattern(client: CacheClient, pattern: string): Promise<void> {
  // In production, use Redis SCAN + UNLINK for pattern invalidation
  // For now, delete specific keys
  await client.del(pattern);

  // Clear memory cache entries matching pattern
  for (const key of memoryCache.keys()) {
    if (key.startsWith(pattern.replace('*', ''))) {
      memoryCache.delete(key);
    }
  }
}

/**
 * Pre-defined cache helpers
 */
export const cache = {
  organizationProfile: (client: CacheClient, orgId: string, fetcher: () => Promise<unknown>) =>
    getCached(client, cacheKey('org', orgId), fetcher, CACHE_TTL.ORGANIZATION_PROFILE),

  fundingPrograms: (client: CacheClient, fetcher: () => Promise<unknown>) =>
    getCached(client, cacheKey('programs', 'all'), fetcher, CACHE_TTL.FUNDING_PROGRAMS),

  onrcCompanyData: (client: CacheClient, cui: string, fetcher: () => Promise<unknown>) =>
    getCached(client, cacheKey('onrc', cui), fetcher, CACHE_TTL.ONRC_COMPANY_DATA),

  anafFiscalData: (client: CacheClient, cui: string, fetcher: () => Promise<unknown>) =>
    getCached(client, cacheKey('anaf', cui), fetcher, CACHE_TTL.ANAF_FISCAL_DATA),

  dashboardStats: (client: CacheClient, orgId: string, fetcher: () => Promise<unknown>) =>
    getCached(client, cacheKey('dashboard', orgId), fetcher, CACHE_TTL.DASHBOARD_STATS),
};
