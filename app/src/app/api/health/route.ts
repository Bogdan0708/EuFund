import { NextRequest, NextResponse } from 'next/server';

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

export async function GET(req: NextRequest) {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      database: 'checking...',
      redis: 'checking...',
      ai: 'checking...'
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
    } catch (error) {
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
    } catch (error) {
      healthCheck.services.redis = 'timeout';
      healthCheck.status = 'degraded';
    }

    // AI service check
    try {
      if (process.env.OPENAI_API_KEY) {
        healthCheck.services.ai = 'configured';
      } else {
        healthCheck.services.ai = 'not_configured';
      }
    } catch (error) {
      healthCheck.services.ai = 'error';
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
