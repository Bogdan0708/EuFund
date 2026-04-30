// ─── Authentication Middleware for AI Endpoints ───────────────
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit, getRedis, isRedisAvailable } from '@/lib/redis/client';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';
import { sanitizeAIResponseDeep, sanitizeUserInput } from '@/lib/ai/sanitize';
import { AI_CONFIG } from '@/lib/ai/config';
import { resolveBillingTrialState, type BillingTier } from '@/lib/billing/trial';

export type UserTier = BillingTier;
export type AIFeature = 'proposal' | 'document' | 'grant' | 'compliance';

const tierCache = new LRUCache<string, UserTier>({ max: 10_000, ttl: 5 * 60 * 1000 });
const log = logger.child({ component: 'auth' });

export function invalidateUserTierCache(userId: string): void {
  tierCache.delete(userId);
}

export async function getUserTier(userId: string): Promise<UserTier> {
  const cached = tierCache.get(userId);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const rows = await db
      .select({
        tier: users.tier,
        subscriptionStatus: users.subscriptionStatus,
        stripeSubscriptionId: users.stripeSubscriptionId,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const tier = resolveBillingTrialState(rows[0] || {}).effectiveTier;
    tierCache.set(userId, tier);
    return tier;
  } catch (error) {
    log.error({ error }, '[auth] Failed to get user tier, defaulting to free');
    return 'free';
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name?: string;
  tier: UserTier;
}

// Hourly request limits by tier.
const RATE_LIMITS: Record<UserTier, number> = {
  free: 10,
  pro: 100,
  enterprise: 1000,
};

const FEATURE_DAILY_LIMITS: Record<AIFeature, number> = {
  proposal: AI_CONFIG.rateLimits.proposalGenerationsPerDay,
  document: AI_CONFIG.rateLimits.documentAnalysesPerDay,
  grant: AI_CONFIG.rateLimits.grantMatchesPerDay,
  compliance: AI_CONFIG.rateLimits.complianceChecksPerDay,
};

const HOUR_MS = 60 * 60 * 1000;
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
  limit: number,
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
    23, 59, 59, 999,
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

  const tier = await getUserTier(session.user.id);
  const user: AuthenticatedUser = {
    id: session.user.id,
    email: session.user.email!,
    name: session.user.name || undefined,
    tier,
  };

  // Fail-closed: refuse AI traffic if the rate-limiter is unreachable.
  if (!(await isRedisAvailable())) {
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

  const hourlyLimit = RATE_LIMITS[user.tier] ?? RATE_LIMITS.free;
  const rateLimit = await checkRateLimit(`ai_requests:${user.id}`, hourlyLimit, HOUR_MS);

  if (!rateLimit.allowed) {
    const retryAfter = Math.max(1, Math.ceil((rateLimit.resetTime - Date.now()) / 1000));
    return {
      errorResponse: NextResponse.json(
        {
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          tier: user.tier,
          limit: hourlyLimit,
          resetTime: rateLimit.resetTime,
        },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      ),
    };
  }

  if (options?.feature) {
    const featureLimit = FEATURE_DAILY_LIMITS[options.feature];
    const featureRate = await checkFeatureDailyLimit(user.id, options.feature, featureLimit);

    if (!featureRate.allowed) {
      const retryAfter = Math.max(1, Math.ceil((featureRate.resetTime - Date.now()) / 1000));
      return {
        errorResponse: NextResponse.json(
          {
            error: 'Daily feature limit exceeded',
            code: 'FEATURE_LIMIT_EXCEEDED',
            feature: options.feature,
            limit: featureLimit,
            resetTime: featureRate.resetTime,
          },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
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

    if (request.method === 'POST') {
      try {
        const body = await request.clone().json();
        const fieldsToSanitize = ['message', 'prompt', 'query', 'goal', 'description'];
        for (const field of fieldsToSanitize) {
          if (typeof body[field] === 'string') {
            const sanitizeResult = sanitizeUserInput(body[field]);
            if (!sanitizeResult.clean) {
              log.warn({ field, patterns: sanitizeResult.matched, userId: result.user.id },
                `[AI Sanitize] Injection patterns detected in field "${field}"`);
            }
          }
        }
      } catch {
        // Body parsing may fail for non-JSON requests — that's fine
      }
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

    if (request.method === 'POST') {
      try {
        const body = await request.clone().json();
        const fieldsToSanitize = ['message', 'prompt', 'query', 'goal', 'description'];
        for (const field of fieldsToSanitize) {
          if (typeof body[field] === 'string') {
            const sanitizeResult = sanitizeUserInput(body[field]);
            if (!sanitizeResult.clean) {
              log.warn({ field, patterns: sanitizeResult.matched, userId: result.user.id },
                `[AI Sanitize] Injection patterns detected in field "${field}"`);
            }
          }
        }
      } catch {
        // Body parsing may fail for non-JSON requests — that's fine
      }
    }

    const response = await handler(result.user);
    return await sanitizeAIJsonResponse(response);

  } catch (error) {
    log.error({ error }, 'AI authentication error:');
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
