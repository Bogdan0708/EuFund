import { NextRequest, NextResponse } from 'next/server';
import { verifyEmailToken } from '@/lib/email/verification';
import { logger } from '@/lib/logger';

// POST-only to prevent email scanners from auto-verifying links via prefetch/GET
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { token?: string };
    const token = body.token || '';

    if (!token) {
      return NextResponse.json({ success: false, message: 'Token lipsă.' }, { status: 400 });
    }

    const verified = await verifyEmailToken(token);
    if (!verified) {
      return NextResponse.json({ success: false, message: 'Link expirat sau invalid.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Email verificat cu succes.' });
  } catch (error) {
    logger.error({ error }, '[auth:verify-email]');
    return NextResponse.json({ success: false, message: 'A apărut o eroare internă.' }, { status: 500 });
  }
}
