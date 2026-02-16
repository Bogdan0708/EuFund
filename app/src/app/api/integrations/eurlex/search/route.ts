import { requireAuth } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { searchEURLex } from '@/lib/integrations/eurlex';
import { logger } from '@/lib/logger';

export async function GET(req: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q');
    if (!query) {
      return NextResponse.json({ error: 'Parametrul "q" este obligatoriu' }, { status: 400 });
    }

    const type = searchParams.get('type') as 'regulation' | 'directive' | 'decision' | undefined;
    const language = (searchParams.get('lang') ?? 'ro') as 'ro' | 'en';
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);

    const results = await searchEURLex(query, { type, language, limit });
    return NextResponse.json({ results, count: results.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Eroare necunoscută';
    const status = error instanceof Error && error.name === 'CircuitOpenError' ? 503 : 500;
    logger.error({ error: error }, 'EUR-Lex search error:');
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Eroare la căutarea în EUR-Lex: ${message}` },
      },
      { status },
    );
  }
}
