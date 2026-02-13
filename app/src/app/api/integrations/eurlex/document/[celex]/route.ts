import { NextRequest, NextResponse } from 'next/server';
import { getDocumentByCelex } from '@/lib/integrations/eurlex';

export async function GET(
  _req: NextRequest,
  { params }: { params: { celex: string } },
) {
  try {
    const { celex } = params;
    if (!celex) {
      return NextResponse.json({ error: 'Numărul CELEX este obligatoriu' }, { status: 400 });
    }

    const document = await getDocumentByCelex(celex);
    if (!document) {
      return NextResponse.json({ error: `Documentul ${celex} nu a fost găsit` }, { status: 404 });
    }

    return NextResponse.json({ document });
  } catch (error: any) {
    console.error('EUR-Lex document error:', error);
    return NextResponse.json(
      { error: 'Eroare la obținerea documentului', details: error.message },
      { status: error.name === 'CircuitOpenError' ? 503 : 500 },
    );
  }
}
