import { requireAuth } from '@/lib/auth/helpers';
import { NextRequest, NextResponse } from 'next/server';
import { lookupCompany, validateCompanyEligibility } from '@/lib/integrations/romanian/onrc';
import { logger } from '@/lib/logger';

export async function POST(req: NextRequest) {
  try {
    await requireAuth();
    const body = await req.json();
    const { cui, requirements } = body;

    if (!cui) {
      return NextResponse.json({ error: 'CUI este obligatoriu' }, { status: 400 });
    }

    const company = await lookupCompany(cui);
    if (!company) {
      return NextResponse.json({ error: `Compania cu CUI ${cui} nu a fost găsită` }, { status: 404 });
    }

    const eligibility = requirements
      ? validateCompanyEligibility(company, requirements)
      : { eligible: company.isActive, issues: company.isActive ? [] : ['Compania nu este activă'] };

    return NextResponse.json({ company, eligibility });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: error }, 'ONRC validation error:');
    const status = message.includes('CUI invalid') ? 400
      : error instanceof Error && error.name === 'CircuitOpenError' ? 503 : 500;
    return NextResponse.json(
      {
        success: false,
        error: { code: 'INTERNAL_ERROR', message: message || 'Eroare la validarea companiei' },
      },
      { status },
    );
  }
}
