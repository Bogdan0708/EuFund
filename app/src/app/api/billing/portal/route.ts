import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/helpers';
import { createPortalSession } from '@/lib/integrations/stripe/billing';
import { FondEUError } from '@/lib/errors';

async function createSession(request: NextRequest): Promise<string | NextResponse> {
  try {
    const user = await requireAuth();
    const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;
    const returnUrl = `${baseUrl}/billing`;
    const session = await createPortalSession(user.id, returnUrl);

    return session.url;
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const result = await createSession(request);
  if (typeof result !== 'string') {
    return result;
  }

  return NextResponse.json({ url: result });
}
