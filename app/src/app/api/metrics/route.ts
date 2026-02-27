// ─── Prometheus Metrics Endpoint ─────────────────────────────────
// GET /api/metrics — returns Prometheus exposition format

import { metrics } from '@/lib/monitoring/metrics';
export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(metrics.toPrometheus(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
