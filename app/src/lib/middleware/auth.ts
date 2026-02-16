// ─── Authentication Middleware for AI Endpoints ───────────────
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit } from '@/lib/redis/client';
import { db, schema } from '@/lib/db';
import { logger } from '@/lib/logger';
import { eq } from 'drizzle-orm';
import { LRUCache } from 'lru-cache';

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

export async function withAIAuth(
  request: NextRequest,
  handler: (user: AuthenticatedUser) => Promise<NextResponse>
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

    // Add rate limit headers
    const response = await handler(user);
    response.headers.set('X-RateLimit-Limit', RATE_LIMITS[user.tier].toString());
    response.headers.set('X-RateLimit-Remaining', rateLimit.remaining.toString());
    response.headers.set('X-RateLimit-Reset', rateLimit.resetTime.toString());

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

export function requireCSRF(handler: Function) {
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
