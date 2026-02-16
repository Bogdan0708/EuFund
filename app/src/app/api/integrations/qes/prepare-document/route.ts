import { requireAuth } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { prepareDocument } from '@/lib/integrations/qes';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json();
    const { documentId, documentTitle, documentContent, signers, expiresInDays } = body;

    if (!documentId || !documentTitle || !documentContent || !signers?.length) {
      return NextResponse.json({
        error: 'Câmpuri obligatorii: documentId, documentTitle, documentContent, signers',
      }, { status: 400 });
    }

    const workflow = await prepareDocument({
      documentId,
      documentTitle,
      documentContent,
      signers,
      expiresInDays,
    });

    return NextResponse.json({ workflow }, { status: 201 });
  } catch (error: any) {
    logger.error({ error: error }, 'QES prepare error:');
    return NextResponse.json(
      { error: 'Eroare la pregătirea documentului pentru semnare', details: error.message },
      { status: error.name === 'CircuitOpenError' ? 503 : 500 },
    );
  }
}
