import { requireAuth } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { searchFundingCalls, type ECProgramme } from '@/lib/integrations/ec-portal';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const programme = searchParams.get('programme') as ECProgramme | undefined;
    const status = (searchParams.get('status') ?? 'open') as 'open' | 'forthcoming' | 'closed';
    const query = searchParams.get('q') ?? undefined;
    const limit = parseInt(searchParams.get('limit') ?? '50', 10);

    const calls = await searchFundingCalls({ programme: programme ?? undefined, status, query, limit });
    return NextResponse.json({ calls, count: calls.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Eroare necunoscută';
    const status = error instanceof Error && error.name === 'CircuitOpenError' ? 503 : 500;
    logger.error({ error: error }, 'Funding calls error:');
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Eroare la obținerea apelurilor de finanțare: ${message}` },
      },
      { status },
    );
  }
}
