import { requireAuth } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { getDocumentByCelex } from '@/lib/integrations/eurlex';
import { logger } from '@/lib/logger';

export async function GET(
  _req: NextRequest,
  { params }: { params: { celex: string } },
) {
  try {
    await requireAuth();
    const { celex } = params;
    if (!celex) {
      return NextResponse.json({ error: 'Numărul CELEX este obligatoriu' }, { status: 400 });
    }

    const document = await getDocumentByCelex(celex);
    if (!document) {
      return NextResponse.json({ error: `Documentul ${celex} nu a fost găsit` }, { status: 404 });
    }

    return NextResponse.json({ document });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Eroare necunoscută';
    const status = error instanceof Error && error.name === 'CircuitOpenError' ? 503 : 500;
    logger.error({ error: error }, 'EUR-Lex document error:');
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Eroare la obținerea documentului: ${message}` },
      },
      { status },
    );
  }
}
