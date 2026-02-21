import { NextRequest, NextResponse } from 'next/server';
import { withAuthScope } from '@/lib/auth/helpers';
import { createPortalSession } from '@/lib/integrations/stripe/billing';
import { FondEUError } from '@/lib/errors';

async function createSession(request: NextRequest, userId: string): Promise<string | NextResponse> {
  const baseUrl = process.env.NEXTAUTH_URL || request.nextUrl.origin;
  const returnUrl = `${baseUrl}/billing`;

  const session = await createPortalSession(userId, returnUrl);
  return session.url;
}

export async function POST(request: NextRequest) {
  try {
    const result = await withAuthScope(async (user) => createSession(request, user.id));
    if (typeof result !== 'string') {
      return result;
    }

    return NextResponse.json({ url: result });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }

    return NextResponse.json({ error: 'Failed to create billing portal session' }, { status: 500 });
  }
}
