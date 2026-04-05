import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { db } from '@/lib/db';
import { workflowSessions } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { getVersionHistory } from '@/lib/ai/orchestrator/section-versions';
import { logger } from '@/lib/logger';

const log = logger.child({ route: 'section-versions-list' });

export async function GET(
  req: NextRequest,
  ctx: { params: { sessionId: string; sectionId: string } },
) {
  try {
    const user = await requireAuth();
    const { sessionId, sectionId } = ctx.params;

    // Verify session ownership
    const [session] = await db
      .select()
      .from(workflowSessions)
      .where(and(eq(workflowSessions.id, sessionId), eq(workflowSessions.userId, user.id)))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const history = await getVersionHistory(sessionId, sectionId);
    return NextResponse.json(history);
  } catch (err) {
    log.error({ error: err instanceof Error ? err.message : String(err) }, 'GET versions failed');
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
