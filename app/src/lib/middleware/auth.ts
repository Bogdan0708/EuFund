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
import { resolveBillingTrialState } from '@/lib/billing/trial';

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
    const user = await db.select({
      tier: schema.users.tier,
      subscriptionStatus: schema.users.subscriptionStatus,
      stripeSubscriptionId: schema.users.stripeSubscriptionId,
      createdAt: schema.users.createdAt,
    })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const tier = resolveBillingTrialState(user[0] || {}).effectiveTier as UserTier;
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

function validateAllowedContentType(
  request: NextRequest,
  allowedContentTypes: string[] = ['application/json'],
): NextResponse | null {
  const method = request.method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH'].includes(method)) {
    return null;
  }

  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() || '';
  if (!contentType || !allowedContentTypes.some((value) => contentType.startsWith(value))) {
    return NextResponse.json(
      { error: 'Unsupported Media Type', code: 'UNSUPPORTED_MEDIA_TYPE' },
      { status: 415 },
    );
  }

  return null;
}

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

type AuthGuardResult =
  | { user: AuthenticatedUser; rateLimit: { remaining: number; resetTime: number } }
  | { errorResponse: NextResponse };

async function guardAIRequest(
  request: NextRequest,
  options?: { feature?: AIFeature; allowedContentTypes?: string[] }
): Promise<AuthGuardResult> {
  const contentTypeError = validateAllowedContentType(request, options?.allowedContentTypes);
  if (contentTypeError) {
    return { errorResponse: contentTypeError };
  }

  const session = await auth();
  if (!session?.user?.id) {
    return {
      errorResponse: NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHORIZED' },
        { status: 401 },
      ),
    };
  }

  const userTier = await getUserTier(session.user.id);
  const user: AuthenticatedUser = {
    id: session.user.id,
    email: session.user.email!,
    name: session.user.name || undefined,
    tier: userTier,
  };

  if (!await isRedisAvailable()) {
    log.warn({ userId: user.id }, '[auth] Redis unavailable — rejecting AI request (fail-closed)');
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Service temporarily unavailable',
          code: 'RATE_LIMIT_UNAVAILABLE',
          message: 'Rate limiting service is unavailable. Please try again shortly.',
        },
        { status: 503 },
      ),
    };
  }

  const rateLimit = await checkRateLimit(
    `ai_requests:${user.id}`,
    RATE_LIMITS[user.tier],
    60 * 60 * 1000,
  );

  if (!rateLimit.allowed) {
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          tier: user.tier,
          limit: RATE_LIMITS[user.tier],
          resetTime: rateLimit.resetTime,
        },
        { status: 429 },
      ),
    };
  }

  if (options?.feature) {
    const featureLimit = FEATURE_DAILY_LIMITS[options.feature];
    const featureRate = await checkFeatureDailyLimit(user.id, options.feature, featureLimit);

    if (!featureRate.allowed) {
      return {
        errorResponse: NextResponse.json(
          {
            error: 'Daily feature limit exceeded',
            code: 'FEATURE_LIMIT_EXCEEDED',
            feature: options.feature,
            limit: featureLimit,
            resetTime: featureRate.resetTime,
          },
          { status: 429 },
        ),
      };
    }
  }

  return { user, rateLimit };
}

/**
 * Authenticate and rate-limit an AI request, returning the user or an error response.
 * Use this for streaming routes where you need to run auth before returning a stream.
 */
export async function authenticateAIUser(
  request: NextRequest,
  options?: { feature?: AIFeature; allowedContentTypes?: string[] }
): Promise<{ user: AuthenticatedUser } | { errorResponse: NextResponse }> {
  try {
    const result = await guardAIRequest(request, options);
    if ('errorResponse' in result) {
      return result;
    }

    return { user: result.user };
  } catch (error) {
    log.error({ error }, 'AI authentication error:');
    return {
      errorResponse: NextResponse.json(
        { error: 'Internal server error', code: 'INTERNAL_ERROR' },
        { status: 500 }
      ),
    };
  }
}

export async function withAIAuth(
  request: NextRequest,
  handler: (user: AuthenticatedUser) => Promise<NextResponse>,
  options?: { feature?: AIFeature; allowedContentTypes?: string[] }
): Promise<NextResponse> {
  try {
    const result = await guardAIRequest(request, options);
    if ('errorResponse' in result) {
      return result.errorResponse;
    }

    // Add rate limit headers
    const startTime = Date.now();
    let response = await handler(result.user);
    response = await sanitizeAIJsonResponse(response);
    response.headers.set('X-RateLimit-Limit', RATE_LIMITS[result.user.tier].toString());
    response.headers.set('X-RateLimit-Remaining', result.rateLimit.remaining.toString());
    response.headers.set('X-RateLimit-Reset', result.rateLimit.resetTime.toString());

    // Track metrics
    const durationMs = Date.now() - startTime;
    trackRequest(request.method, request.nextUrl.pathname, response.status, durationMs);
    metrics.inc('ai_requests_total', { feature: options?.feature ?? 'general', tier: result.user.tier });

    return response;

  } catch (error) {
    log.error({ error }, 'AI authentication error:');
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
