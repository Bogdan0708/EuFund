// ─── Feature Flag Service ─────────────────────────────────────────
// DB-backed feature flags with LRU cache, tier targeting, and percentage rollout

import { db } from '@/lib/db';
import { featureFlags } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';

interface FlagRow {
  key: string;
  enabled: boolean;
  targeting: FlagTargeting | null;
}

interface FlagTargeting {
  tiers?: string[];
  userIds?: string[];
  percentage?: number;
}

interface CacheEntry {
  flag: FlagRow | null;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX_SIZE = 500;

const cache = new Map<string, CacheEntry>();

function evictIfNeeded(): void {
  if (cache.size >= CACHE_MAX_SIZE) {
    // Evict oldest entry
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

async function fetchFlag(flagKey: string): Promise<FlagRow | null> {
  const cached = cache.get(flagKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.flag;
  }

  try {
    const [row] = await db
      .select({
        key: featureFlags.key,
        enabled: featureFlags.enabled,
        targeting: featureFlags.targeting,
      })
      .from(featureFlags)
      .where(eq(featureFlags.key, flagKey))
      .limit(1);

    const flag = row
      ? { key: row.key, enabled: row.enabled, targeting: row.targeting as FlagTargeting | null }
      : null;

    evictIfNeeded();
    cache.set(flagKey, { flag, fetchedAt: Date.now() });
    return flag;
  } catch {
    // Fail-closed: unknown flag or error → false
    return null;
  }
}

/**
 * Check if a feature flag is enabled for the given context.
 * Fail-closed: returns `false` for unknown flags or errors.
 */
export async function isFeatureEnabled(
  flagKey: string,
  ctx?: { userId?: string; tier?: string },
): Promise<boolean> {
  const flag = await fetchFlag(flagKey);
  if (!flag || !flag.enabled) return false;

  const targeting = flag.targeting;
  if (!targeting || Object.keys(targeting).length === 0) {
    return true; // Enabled globally, no targeting restrictions
  }

  // Tier targeting
  if (targeting.tiers && targeting.tiers.length > 0) {
    if (!ctx?.tier || !targeting.tiers.includes(ctx.tier)) {
      return false;
    }
  }

  // User ID targeting
  if (targeting.userIds && targeting.userIds.length > 0) {
    if (!ctx?.userId || !targeting.userIds.includes(ctx.userId)) {
      return false;
    }
  }

  // Percentage rollout (deterministic based on flagKey + userId)
  if (targeting.percentage !== undefined && targeting.percentage < 100) {
    if (!ctx?.userId) return false;
    const hash = createHash('md5').update(`${flagKey}${ctx.userId}`).digest('hex');
    const bucket = parseInt(hash.substring(0, 8), 16) % 100;
    if (bucket >= targeting.percentage) {
      return false;
    }
  }

  return true;
}

/**
 * Invalidate the flag cache. If a specific key is given, only that entry is removed.
 * Otherwise the entire cache is cleared.
 */
export function invalidateFlagCache(flagKey?: string): void {
  if (flagKey) {
    cache.delete(flagKey);
  } else {
    cache.clear();
  }
}
