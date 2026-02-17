import { NextRequest, NextResponse } from 'next/server';
import { verifyEmailToken } from '@/lib/email/verification';
import logger from '@/lib/logger';

function readToken(req: NextRequest, bodyToken?: string): string {
  return bodyToken || req.nextUrl.searchParams.get('token') || '';
}

export async function GET(req: NextRequest) {
  try {
    const token = readToken(req);

    if (!token) {
      return NextResponse.json({ success: false, message: 'Token lipsă.' }, { status: 400 });
    }

    const verified = await verifyEmailToken(token);
    if (!verified) {
      return NextResponse.json({ success: false, message: 'Link expirat sau invalid.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Email verificat cu succes.' });
  } catch (error) {
    logger.error({ error }, '[auth:verify-email:get]');
    return NextResponse.json({ success: false, message: 'A apărut o eroare internă.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { token?: string };
    const token = readToken(req, body.token);

    if (!token) {
      return NextResponse.json({ success: false, message: 'Token lipsă.' }, { status: 400 });
    }

    const verified = await verifyEmailToken(token);
    if (!verified) {
      return NextResponse.json({ success: false, message: 'Link expirat sau invalid.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, message: 'Email verificat cu succes.' });
  } catch (error) {
    logger.error({ error }, '[auth:verify-email:post]');
    return NextResponse.json({ success: false, message: 'A apărut o eroare internă.' }, { status: 500 });
  }
}
