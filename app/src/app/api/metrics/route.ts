import { NextRequest, NextResponse } from 'next/server';
import { metrics } from '@/lib/monitoring/metrics';
import { constantTimeEquals } from '@/lib/security/constant-time';

export const dynamic = 'force-dynamic';

function isAuthorized(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }

  const expectedToken = process.env.METRICS_AUTH_TOKEN;
  if (!expectedToken) {
    return false;
  }

  const bearer = request.headers.get('authorization');
  const headerToken = request.headers.get('x-metrics-token');

  return constantTimeEquals(bearer, `Bearer ${expectedToken}`) || constantTimeEquals(headerToken, expectedToken);
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new Response(metrics.toPrometheus(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
