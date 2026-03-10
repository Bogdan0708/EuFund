import { NextRequest, NextResponse } from 'next/server';
import { withRateLimit } from '@/lib/middleware/rate-limit';

/**
 * Readiness probe for Cloud Run and Load Balancer
 * Subject to a strict 12 requests/minute rate limit to prevent abuse
 * while allowing sufficient health monitoring frequency.
 */
async function readyHandler(req: NextRequest) {
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
  },
  readyHandler
);

export const dynamic = 'force-dynamic';
