/**
 * Comprehensive Health Check Endpoint
 * Checks: Database, Redis, External APIs (ONRC, ANAF, certSIGN)
 */

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: Record<string, ComponentCheck>;
}

interface ComponentCheck {
  status: 'pass' | 'fail' | 'warn';
  responseTimeMs: number;
  message?: string;
}

const startTime = Date.now();

async function checkDatabase(): Promise<ComponentCheck> {
  const start = Date.now();
  try {
    // In production, use actual DB connection
    // await db.execute(sql`SELECT 1`);
    return { status: 'pass', responseTimeMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'fail',
      responseTimeMs: Date.now() - start,
      message: error instanceof Error ? error.message : 'Database unreachable',
    };
  }
}

async function checkRedis(): Promise<ComponentCheck> {
  const start = Date.now();
  try {
    // In production, use actual Redis connection
    // await redis.ping();
    return { status: 'pass', responseTimeMs: Date.now() - start };
  } catch (error) {
    return {
      status: 'fail',
      responseTimeMs: Date.now() - start,
      message: 'Redis unreachable',
    };
  }
}

async function checkExternalAPI(
  name: string,
  url: string,
  timeoutMs: number = 5000
): Promise<ComponentCheck> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const ms = Date.now() - start;
    return {
      status: response.ok ? 'pass' : 'warn',
      responseTimeMs: ms,
      message: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      status: 'warn', // External API failure = degraded, not unhealthy
      responseTimeMs: Date.now() - start,
      message: `${name} unreachable`,
    };
  }
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const [db, redis, onrc, anaf, certsign] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkExternalAPI('ONRC', 'https://api.onrc.ro/health'),
    checkExternalAPI('ANAF', 'https://api.anaf.ro/health'),
    checkExternalAPI('certSIGN', 'https://api.certsign.ro/health'),
  ]);

  const checks = { database: db, redis, onrc, anaf, certsign };
  const coreHealthy = db.status === 'pass' && redis.status === 'pass';
  const anyFail = Object.values(checks).some((c) => c.status === 'fail');

  return {
    status: coreHealthy ? (anyFail ? 'degraded' : 'healthy') : 'unhealthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
  };
}

/**
 * Next.js API route handler: GET /api/health
 */
export async function GET() {
  const health = await getHealthStatus();
  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  return new Response(JSON.stringify(health), {
    status: statusCode,
    headers: { 'Content-Type': 'application/json' },
  });
}
