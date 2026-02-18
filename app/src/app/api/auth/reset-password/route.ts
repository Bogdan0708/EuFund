// ─── Reset Password API ──────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/middleware/rate-limit';
import { verifyPasswordResetToken, consumePasswordResetToken } from '@/lib/email/password-reset';
import { logAudit } from '@/lib/legal/audit';

async function resetPasswordHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : null;
    const newPassword = typeof body?.password === 'string' ? body.password : null;

    if (!token || !newPassword) {
      return NextResponse.json(
        { error: { message: 'Token și parola sunt obligatorii.' } },
        { status: 400 },
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: { message: 'Parola trebuie să aibă cel puțin 8 caractere.' } },
        { status: 400 },
      );
    }

    const userId = await verifyPasswordResetToken(token);

    if (!userId) {
      return NextResponse.json(
        { error: { message: 'Link-ul de resetare este invalid sau a expirat.' } },
        { status: 400 },
      );
    }

    const passwordHash = await hash(newPassword, 12);

    await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));

    await consumePasswordResetToken(token);

    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined;
    const userAgent = req.headers.get('user-agent') || undefined;

    await logAudit({
      userId,
      action: 'auth.password_reset',
      resourceType: 'user',
      resourceId: userId,
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    logger.error({ error }, '[auth:reset-password]');
    return NextResponse.json(
      { error: { message: 'A apărut o eroare internă.' } },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(
  {
    keyPrefix: 'auth:reset-password',
    maxRequests: 5,
    windowMs: 15 * 60 * 1000,
    messageRo: 'Prea multe încercări. Vă rugăm să așteptați 15 minute.',
  },
  resetPasswordHandler,
);
