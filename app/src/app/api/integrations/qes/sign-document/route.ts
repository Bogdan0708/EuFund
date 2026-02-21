import { withAuthScope } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { getSigningUrl, getWorkflowStatus } from '@/lib/integrations/qes';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    return await withAuthScope(async () => {
      const body = await req.json();
      const { workflowId, signerEmail, action } = body;

      if (!workflowId) {
        return NextResponse.json({ error: 'workflowId este obligatoriu' }, { status: 400 });
      }

      if (action === 'status') {
        const status = await getWorkflowStatus(workflowId);
        if (!status) {
          return NextResponse.json({ error: 'Workflow-ul nu a fost găsit' }, { status: 404 });
        }
        return NextResponse.json({ workflow: status });
      }

      // Default: get signing URL
      if (!signerEmail) {
        return NextResponse.json({ error: 'signerEmail este obligatoriu' }, { status: 400 });
      }

      const signingUrl = await getSigningUrl(workflowId, signerEmail);
      return NextResponse.json({ signingUrl });
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Eroare necunoscută';
    const status = error instanceof Error && error.name === 'CircuitOpenError' ? 503 : 500;
    logger.error({ error: error }, 'QES sign error:');
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: `Eroare la procesul de semnare: ${message}` },
      },
      { status },
    );
  }
}
