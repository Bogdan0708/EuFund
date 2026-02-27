import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { withUserRLS } from '@/lib/db';
import { Errors, FondEUError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { runRetentionCleanup } from '@/lib/legal/retention-cleanup';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'retention-route' });
export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/admin/retention/run?dryRun=true — run retention cleanup
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();

    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dryRun') !== 'false';

    const result = await runRetentionCleanup(dryRun);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[retention] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
