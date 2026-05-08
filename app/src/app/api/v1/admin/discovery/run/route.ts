import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { runDiscovery } from '@/lib/discovery/pipeline';
import { verifySchedulerOIDC } from '@/lib/auth/scheduler';
import { Errors, FondEUError } from '@/lib/errors';

// Pin Node.js runtime — google-auth-library is Node-oriented.
export const runtime = 'nodejs';

const SCHEDULER_SA =
  process.env.SCHEDULER_SERVICE_ACCOUNT
  ?? 'fondeu-scheduler@eufunding.iam.gserviceaccount.com';

export async function POST(req: NextRequest) {
  let authPath: 'scheduler' | 'admin' = 'admin';
  try {
    const url = new URL(req.url);
    const audience = `${url.origin}${url.pathname}`;

    const scheduler = await verifySchedulerOIDC(req, audience, SCHEDULER_SA);
    if (scheduler) {
      authPath = 'scheduler';
    } else {
      await requirePlatformAdmin();
    }

    console.log(JSON.stringify({ event: 'discovery.run.start', authPath }));

    const result = await runDiscovery();

    console.log(
      JSON.stringify({
        event: 'discovery.run.complete',
        authPath,
        newCalls: result.newCalls,
        duplicates: result.duplicates,
        errorCount: result.errors.length,
      }),
    );

    if (result.errors.length > 0 && result.newCalls === 0) {
      return NextResponse.json(
        {
          success: false,
          data: result,
          error: { code: 'SERVICE_UNAVAILABLE', message: result.errors[0] },
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('en'), { status: error.statusCode });
    }
    return NextResponse.json(Errors.internal().toResponse('en'), { status: 500 });
  }
}
