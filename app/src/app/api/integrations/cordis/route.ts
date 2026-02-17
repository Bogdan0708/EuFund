import { requireAuth } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { searchFundedProjects } from '@/lib/integrations/cordis';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);

    const query = searchParams.get('q') ?? undefined;
    const programme = searchParams.get('programme') ?? undefined;
    const country = searchParams.get('country') ?? undefined;
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10);

    const projects = await searchFundedProjects({
      query,
      programme,
      country,
      limit: Number.isFinite(limit) ? Math.max(1, Math.min(limit, 100)) : 20,
      offset: Number.isFinite(offset) ? Math.max(0, offset) : 0,
    });

    return NextResponse.json({ projects, count: projects.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Eroare necunoscută';
    const status = error instanceof Error && error.name === 'CircuitOpenError' ? 503 : 500;
    logger.error({ error: error }, 'CORDIS search error:');
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Eroare la căutarea proiectelor CORDIS: ${message}` },
      },
      { status },
    );
  }
}
