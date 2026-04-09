import { NextRequest, NextResponse } from 'next/server';
import { FondEUError, Errors } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { runTrialLifecycleNotifications } from '@/lib/billing/trial-notifications';
import { logger } from '@/lib/logger';
import { constantTimeEquals } from '@/lib/security/constant-time';

const log = logger.child({ component: 'admin-billing-trial-notifications-route' });
export const dynamic = 'force-dynamic';

function isAuthorized(req: NextRequest): boolean {
  const expectedToken = process.env.TRIAL_NOTIFICATIONS_AUTH_TOKEN;
  if (expectedToken) {
    const bearer = req.headers.get('authorization');
    const headerToken = req.headers.get('x-trial-notifications-token');
    if (constantTimeEquals(bearer, `Bearer ${expectedToken}`) || constantTimeEquals(headerToken, expectedToken)) {
      return true;
    }
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    // Allow either a valid scheduler token OR a platform admin session
    if (!isAuthorized(req)) {
      await requirePlatformAdmin();
    }

    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dryRun') !== 'false';
    const result = await runTrialLifecycleNotifications({ dryRun });

    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }

    log.error({ error }, '[admin-billing-trial-notifications] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
