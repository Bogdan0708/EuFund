import { NextRequest, NextResponse } from 'next/server';
import { constantTimeEquals } from '@/lib/security/constant-time';

export const dynamic = 'force-dynamic';

const SERVICE_CHECK_TIMEOUT_MS = 2000;

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  return Promise.race([
    operation,
    new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), timeoutMs);
    }),
  ]);
}

function canViewDetailedHealth(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  const expectedToken = process.env.HEALTHCHECK_AUTH_TOKEN;
  if (!expectedToken) {
    return false;
  }

  const bearer = request.headers.get('authorization');
  const headerToken = request.headers.get('x-health-token');
  return constantTimeEquals(bearer, `Bearer ${expectedToken}`) || constantTimeEquals(headerToken, expectedToken);
}

export async function GET(request: NextRequest) {
  const baseHealth = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.3.4',
  };

  if (!canViewDetailedHealth(request)) {
    return NextResponse.json(baseHealth, { status: 200 });
  }

  const healthCheck = {
    ...baseHealth,
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: 'checking...',
      redis: 'checking...',
      ai: 'checking...',
      storage: 'checking...',
      sentry: 'checking...',
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  };

  try {
    // Optional database check with short timeout
    try {
      const dbCheck = await withTimeout(
        (async () => {
          const [{ db }, { sql }] = await Promise.all([
            import('@/lib/db'),
            import('drizzle-orm'),
          ]);
          await db.execute(sql`SELECT 1`);
        })(),
        SERVICE_CHECK_TIMEOUT_MS
      );
      healthCheck.services.database = dbCheck === 'timeout' ? 'timeout' : 'healthy';
    } catch {
      healthCheck.services.database = 'timeout';
      healthCheck.status = 'degraded';
    }

    // Optional Redis check with short timeout
    try {
      const redisCheck = await withTimeout(
        (async () => {
          const { getRedis } = await import('@/lib/redis/client');
          const redis = getRedis();
          if (!redis) return 'not_configured' as const;
          await redis.ping();
          return 'healthy' as const;
        })(),
        SERVICE_CHECK_TIMEOUT_MS
      );
      healthCheck.services.redis = redisCheck;
    } catch {
      healthCheck.services.redis = 'timeout';
      healthCheck.status = 'degraded';
    }

    // AI provider check (direct SDK — no external gateway)
    try {
      const hasProvider = !!(
        process.env.OPENAI_API_KEY ||
        process.env.ANTHROPIC_API_KEY ||
        process.env.GOOGLE_AI_API_KEY
      );
      healthCheck.services.ai = hasProvider ? 'configured' : 'not_configured';
    } catch {
      healthCheck.services.ai = 'error';
    }

    // Storage backend check
    try {
      healthCheck.services.storage = process.env.GCS_BUCKET ? 'gcs_configured' : 'local_fs';
    } catch {
      healthCheck.services.storage = 'error';
    }

    // Sentry configuration check
    try {
      healthCheck.services.sentry = process.env.SENTRY_DSN ? 'configured' : 'not_configured';
    } catch {
      healthCheck.services.sentry = 'error';
    }

    const hasTimeouts = [healthCheck.services.database, healthCheck.services.redis]
      .some(status => status === 'timeout');
    if (hasTimeouts) {
      healthCheck.status = 'degraded';
    }

    return NextResponse.json(healthCheck, { status: 200 });

  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 503 });
  }
}
