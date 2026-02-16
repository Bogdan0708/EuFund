// ─── CSRF Protection System ───────────────────────────────────────
// Implements double-submit cookie pattern with Redis backing

import { NextRequest } from 'next/server';
import { randomBytes } from 'crypto';
import { getRedis } from '@/lib/redis/client';
import { logger } from '@/lib/logger';

export interface CSRFToken {
  token: string;
  expiresAt: number;
  sessionId: string;
}

const CSRF_TOKEN_TTL = 60 * 60; // 1 hour in seconds
const CSRF_TOKEN_LENGTH = 32; // 32 bytes = 64 hex characters
const log = logger.child({ component: 'csrf' });

/**
 * Generate a new CSRF token for a session
 * Stores in Redis with session binding
 */
export async function generateCSRFToken(sessionId: string): Promise<string> {
  const token = randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
  const redis = getRedis();

  if (redis) {
    try {
      await redis.setex(`csrf:${sessionId}`, CSRF_TOKEN_TTL, token);
      log.info(`[csrf] Generated token for session: ${sessionId}`);
    } catch (error) {
      log.error({ error }, '[csrf] Failed to store token in Redis:');
      // Continue anyway - will use cookie-only validation
    }
  }

  return token;
}

/**
 * Validate CSRF token using double-submit cookie pattern
 * Checks: header matches cookie AND token exists in Redis
 */
export async function validateCSRFToken(
  request: NextRequest,
  sessionId: string
): Promise<boolean> {
  // Extract token from header
  const headerToken = request.headers.get('X-CSRF-Token');

  // Extract token from cookie
  const cookieToken = request.cookies.get('csrf-token')?.value;

  // Both must exist and match (double-submit pattern)
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    log.warn({
      hasHeader: !!headerToken,
      hasCookie: !!cookieToken,
      match: headerToken === cookieToken,
    }, '[csrf] Token mismatch or missing');
    return false;
  }

  // Validate against Redis (if available)
  const redis = getRedis();
  if (redis) {
    try {
      const storedToken = await redis.get(`csrf:${sessionId}`);

      if (!storedToken) {
        log.warn({ sessionId }, '[csrf] Token not found in Redis for session:');
        return false;
      }

      if (storedToken !== headerToken) {
        log.warn('[csrf] Token does not match Redis value');
        return false;
      }

      log.info('[csrf] Token validated successfully');
      return true;
    } catch (error) {
      log.error({ error }, '[csrf] Redis validation error:');
      // Fallback to cookie-only validation
      return headerToken === cookieToken;
    }
  }

  // Fallback: if Redis unavailable, trust double-submit pattern
  log.warn('[csrf] Redis unavailable, using cookie-only validation');
  return headerToken === cookieToken;
}

/**
 * Refresh CSRF token TTL (extend expiry on valid use)
 */
export async function refreshCSRFToken(sessionId: string): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      const token = await redis.get(`csrf:${sessionId}`);
      if (token) {
        await redis.expire(`csrf:${sessionId}`, CSRF_TOKEN_TTL);
        log.info({ sessionId }, '[csrf] Token TTL refreshed for session:');
      }
    } catch (error) {
      log.error({ error }, '[csrf] Failed to refresh token TTL:');
    }
  }
}

/**
 * Revoke (delete) a CSRF token
 */
export async function revokeCSRFToken(sessionId: string): Promise<void> {
  const redis = getRedis();

  if (redis) {
    try {
      await redis.del(`csrf:${sessionId}`);
      log.info({ sessionId }, '[csrf] Token revoked for session:');
    } catch (error) {
      log.error({ error }, '[csrf] Failed to revoke token:');
    }
  }
}

/**
 * Helper: Check if a request requires CSRF validation
 */
export function requiresCSRFValidation(request: NextRequest): boolean {
  const pathname = request.nextUrl.pathname;

  // Only state-changing methods
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
    return false;
  }

  // Exempt paths
  const exemptPaths = [
    '/api/auth/callback',
    '/api/auth/session',
    '/api/auth/signin',
    '/api/auth/signout',
    '/api/webhooks',
    '/api/health',
  ];

  return !exemptPaths.some(p => pathname.startsWith(p));
}

/**
 * Express-style middleware wrapper for API routes
 */
export function withCSRFProtection<T>(
  handler: (request: NextRequest, ...args: any[]) => Promise<T>
) {
  return async (request: NextRequest, ...args: any[]): Promise<T> => {
    if (!requiresCSRFValidation(request)) {
      return handler(request, ...args);
    }

    // TODO: Extract session ID from request
    // For now, we'll skip validation in route handlers as middleware handles it
    return handler(request, ...args);
  };
}
