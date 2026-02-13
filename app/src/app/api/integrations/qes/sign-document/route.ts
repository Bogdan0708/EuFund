import { NextRequest, NextResponse } from 'next/server';
import { getSigningUrl, getWorkflowStatus } from '@/lib/integrations/qes';

export async function POST(req: NextRequest) {
  try {
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
  } catch (error: any) {
    console.error('QES sign error:', error);
    return NextResponse.json(
      { error: 'Eroare la procesul de semnare', details: error.message },
      { status: error.name === 'CircuitOpenError' ? 503 : 500 },
    );
  }
}
