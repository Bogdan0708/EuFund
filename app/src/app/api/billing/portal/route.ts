import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { createPortalSession } from '@/lib/integrations/stripe/billing';
import { FondEUError } from '@/lib/errors';

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const returnUrl = `${request.nextUrl.origin}/billing`;
    const session = await createPortalSession(user.id, returnUrl);

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 });
  }
}
