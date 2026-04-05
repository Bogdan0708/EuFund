import { NextRequest, NextResponse } from 'next/server';
import { FondEUError } from '@/lib/errors';
import { requireOwnedSession } from '@/lib/ai/orchestrator/require-owned-session';
import { getVersionHistory, sectionExistsInSession } from '@/lib/ai/orchestrator/section-versions';
import { logger } from '@/lib/logger';

const log = logger.child({ route: 'section-versions-list' });

export async function GET(
  _req: NextRequest,
  ctx: { params: { sessionId: string; sectionId: string } },
) {
  try {
    const { sessionId, sectionId } = ctx.params;
    const { user, session } = await requireOwnedSession(sessionId);

    // Phase 1 feature flag: return 404 if disabled so the endpoint behaves
    // as if it doesn't exist from the client's perspective.
    const { isFeatureEnabled } = await import('@/lib/feature-flags');
    const enabled = await isFeatureEnabled('section_versioning', { userId: user.id });
    if (!enabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const sessionCtx = session.context as { projectSections?: import('@/lib/ai/orchestrator/types').SectionResult[] } | null;
    if (!sectionExistsInSession(sessionCtx?.projectSections, sectionId)) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 });
    }

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
