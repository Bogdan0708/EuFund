import { NextRequest, NextResponse } from 'next/server';
import { FondEUError } from '@/lib/errors';
import { requireOwnedSession } from '@/lib/ai/orchestrator/require-owned-session';
import { getVersionHistory } from '@/lib/ai/orchestrator/section-versions';
import { logger } from '@/lib/logger';

const log = logger.child({ route: 'section-versions-list' });

export async function GET(
  _req: NextRequest,
  ctx: { params: { sessionId: string; sectionId: string } },
) {
  try {
    const { sessionId, sectionId } = ctx.params;
    await requireOwnedSession(sessionId);

    const history = await getVersionHistory(sessionId, sectionId);
    return NextResponse.json(history);
  } catch (err) {
    if (err instanceof FondEUError) {
      return NextResponse.json(err.toResponse('ro'), { status: err.statusCode });
    }
    log.error({ error: err instanceof Error ? err.message : String(err) }, 'GET versions failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
