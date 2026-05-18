import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/middleware/rate-limit';

/**
 * Readiness probe for Cloud Run and Load Balancer
 * Subject to a strict 12 requests/minute rate limit to prevent abuse
 * while allowing sufficient health monitoring frequency.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function readyHandler(_req: NextRequest) {
  return NextResponse.json(
    { status: 'ready', timestamp: new Date().toISOString() },
    { status: 200 }
  );
}

export const GET = withRateLimit(
  {
    keyPrefix: 'health:ready',
    maxRequests: 12,
    windowMs: 60 * 1000,
    messageRo: 'Prea multe verificări de stare. Vă rugăm să încercați din nou mai târziu.',
    // Readiness must answer even if Redis is down. On Cloud Run cold-start the
    // Redis client connects lazily; the first request can race the connect and
    // throw, which used to return 429 and broke load-balancer health checks.
    // The probe still serves its DDoS-mitigation purpose when Redis is healthy.
    failOpenOnError: true,
  },
  readyHandler
);

export const dynamic = 'force-dynamic';
