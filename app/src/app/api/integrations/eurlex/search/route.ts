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

    const type = searchParams.get('type') as any;
    const language = (searchParams.get('lang') ?? 'ro') as 'ro' | 'en';
    const limit = parseInt(searchParams.get('limit') ?? '20', 10);

    const results = await searchEURLex(query, { type, language, limit });
    return NextResponse.json({ results, count: results.length });
  } catch (error: any) {
    logger.error({ error: error }, 'EUR-Lex search error:');
    return NextResponse.json(
      { error: 'Eroare la căutarea în EUR-Lex', details: error.message },
      { status: error.name === 'CircuitOpenError' ? 503 : 500 },
    );
  }
}
