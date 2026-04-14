import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { getBillingInfo } from '@/lib/integrations/stripe/billing';
import { FondEUError } from '@/lib/errors';

export async function GET() {
  try {
    const user = await requireAuth();
    const info = await getBillingInfo(user.id);

    return NextResponse.json(info);
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to fetch billing info' }, { status: 500 });
  }
}
