// ─── Authentication Middleware for AI Endpoints ───────────────
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit, getRedis, isRedisAvailable } from '@/lib/redis/client';
import { db, schema } from '@/lib/db';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { sanitizeAIResponseDeep } from '@/lib/ai/sanitize';
import { AI_CONFIG } from '@/lib/ai/config';
import { trackRequest, metrics } from '@/lib/monitoring/metrics';

export type UserTier = 'free' | 'pro' | 'enterprise';

// Cache user tiers in memory with automatic LRU eviction and TTL
const tierCache = new LRUCache<string, UserTier>({ max: 10000, ttl: 5 * 60 * 1000 });
const log = logger.child({ component: 'auth' });

/**
 * Invalidate a user's tier cache entry
 */
export function invalidateUserTierCache(userId: string): void {
  tierCache.delete(userId);
}

/**
 * Get user tier from database with in-memory cache
 * Fail-closed: defaults to 'free' if lookup fails
 */
async function getUserTier(userId: string): Promise<UserTier> {
  const cached = tierCache.get(userId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const user = await db.select({ tier: schema.users.tier })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const tier: UserTier = user[0]?.tier || 'free';
    tierCache.set(userId, tier);
    return tier;
  } catch (error) {
    log.error({ error }, '[auth] Failed to get user tier, defaulting to free:');
    return 'free'; // Fail-closed: most restrictive tier
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  tier: UserTier;
}

// Rate limits by tier (requests per hour)
const RATE_LIMITS: Record<UserTier, number> = {
  free: 10,      // 10 AI requests per hour
  pro: 100,      // 100 AI requests per hour
  enterprise: 1000 // 1000 AI requests per hour
};

// Per-feature daily limits (from AI_CONFIG.rateLimits)
export type AIFeature = 'proposal' | 'document' | 'grant' | 'compliance';

const FEATURE_DAILY_LIMITS: Record<AIFeature, number> = {
  proposal: AI_CONFIG.rateLimits.proposalGenerationsPerDay,
  document: AI_CONFIG.rateLimits.documentAnalysesPerDay,
  grant: AI_CONFIG.rateLimits.grantMatchesPerDay,
  compliance: AI_CONFIG.rateLimits.complianceChecksPerDay,
};

const DAY_MS = 24 * 60 * 60 * 1000;

async function checkFeatureDailyLimit(
  userId: string,
  feature: AIFeature,
  limit: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  const redis = getRedis();
  if (!redis) {
    return { allowed: false, remaining: 0, resetTime: Date.now() + DAY_MS };
  }

  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const redisKey = `ai_usage:${userId}:${feature}:${day}`;
  const endOfDayUtc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    23,
    59,
    59,
    999
  ));

  try {
    const current = await redis.incr(redisKey);
    if (current === 1) {
      const ttlSeconds = Math.max(1, Math.ceil((endOfDayUtc.getTime() - Date.now()) / 1000));
      await redis.expire(redisKey, ttlSeconds);
    }

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetTime: endOfDayUtc.getTime(),
    };
  } catch (error) {
    log.error({ error, userId, feature }, '[auth] feature daily rate limit check failed');
    return { allowed: false, remaining: 0, resetTime: endOfDayUtc.getTime() };
  }
}

async function sanitizeAIJsonResponse(response: NextResponse): Promise<NextResponse> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return response;
  }

  try {
    const payload = await response.clone().json();
    const { sanitized } = sanitizeAIResponseDeep(payload);

    const sanitizedResponse = NextResponse.json(sanitized, { status: response.status });
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase() === 'content-length' || key.toLowerCase() === 'content-type') continue;
      sanitizedResponse.headers.set(key, value);
    }
    return sanitizedResponse;
  } catch {
    return response;
  }
}

export async function withAIAuth(
  request: NextRequest,
  handler: (user: AuthenticatedUser) => Promise<NextResponse>,
  options?: { feature?: AIFeature }
): Promise<NextResponse> {
  try {
    // Check authentication
    const session = await auth();
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // Get user tier from database with fail-closed default
    const userTier = await getUserTier(session.user.id);
    
    const user: AuthenticatedUser = {
      id: session.user.id,
      email: session.user.email!,
      name: session.user.name || undefined,
      tier: userTier
    };

    // Fail-closed: AI endpoints require Redis for rate limiting.
    // If Redis is unavailable, return 503 to prevent unmetered AI usage.
    if (!await isRedisAvailable()) {
      log.warn({ userId: user.id }, '[auth] Redis unavailable — rejecting AI request (fail-closed)');
      return NextResponse.json(
        {
          error: 'Service temporarily unavailable',
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Rate limiting service is unavailable. Please try again shortly.',
        },
        { status: 503 },
      );
    }

    // Check rate limits
    const rateLimit = await checkRateLimit(
      `ai_requests:${user.id}`,
      RATE_LIMITS[user.tier],
      60 * 60 * 1000 // 1 hour window
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          tier: user.tier,
          limit: RATE_LIMITS[user.tier],
          resetTime: rateLimit.resetTime
        },
        { status: 429 }
      );
    }

    // Per-feature daily rate limit
    if (options?.feature) {
      const featureLimit = FEATURE_DAILY_LIMITS[options.feature];
      const featureRate = await checkFeatureDailyLimit(user.id, options.feature, featureLimit);

      if (!featureRate.allowed) {
        return NextResponse.json(
          {
            error: 'Daily feature limit exceeded',
            code: 'FEATURE_LIMIT_EXCEEDED',
            feature: options.feature,
            limit: featureLimit,
            resetTime: featureRate.resetTime,
          },
          { status: 429 }
        );
      }
    }

    // Add rate limit headers
    const startTime = Date.now();
    let response = await handler(user);
    response = await sanitizeAIJsonResponse(response);
    response.headers.set('X-RateLimit-Limit', RATE_LIMITS[user.tier].toString());
    response.headers.set('X-RateLimit-Remaining', rateLimit.remaining.toString());
    response.headers.set('X-RateLimit-Reset', rateLimit.resetTime.toString());

    // Track metrics
    const durationMs = Date.now() - startTime;
    trackRequest(request.method, request.nextUrl.pathname, response.status, durationMs);
    metrics.inc('ai_requests_total', { feature: options?.feature ?? 'general', tier: user.tier });

    return response;

  } catch (error) {
    log.error({ error }, 'AI authentication error:');
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// CSRF protection for state-changing operations
// Uses the proper double-submit cookie pattern from csrf.ts
// This is a lightweight check for the auth middleware layer;
// full validation (with Redis) happens via csrf.ts
export function validateCSRFToken(request: NextRequest): boolean {
  const headerToken = request.headers.get('X-CSRF-Token');
  const cookieToken = request.cookies.get('csrf-token')?.value;

  // Both header and cookie must exist and match (double-submit pattern)
  if (!headerToken || !cookieToken) {
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  if (headerToken.length !== cookieToken.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ cookieToken.charCodeAt(i);
  }

  return mismatch === 0;
}

export function requireCSRF(handler: (request: NextRequest) => Promise<Response> | Response) {
  return async (request: NextRequest) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      if (!validateCSRFToken(request)) {
        return NextResponse.json(
          { error: 'CSRF token required', code: 'CSRF_REQUIRED' },
          { status: 403 }
        );
      }
    }
    
    return handler(request);
  };
}
