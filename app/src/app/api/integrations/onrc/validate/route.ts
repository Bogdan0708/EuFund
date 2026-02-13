import { NextRequest, NextResponse } from 'next/server';
import { lookupCompany, validateCompanyEligibility } from '@/lib/integrations/romanian/onrc';

export async function POST(req: NextRequest) {
  try {
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
  } catch (error: any) {
    console.error('ONRC validation error:', error);
    const status = error.message?.includes('CUI invalid') ? 400
      : error.name === 'CircuitOpenError' ? 503 : 500;
    return NextResponse.json(
      { error: error.message ?? 'Eroare la validarea companiei' },
      { status },
    );
  }
}
