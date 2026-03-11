// ─── Forgot Password API ─────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/middleware/rate-limit';
import { generatePasswordResetToken } from '@/lib/email/password-reset';
import { sendEmail } from '@/lib/email/transporter';
import { passwordResetEmail } from '@/lib/email/templates';

function detectLocale(acceptLanguage?: string | null): 'ro' | 'en' {
  if (!acceptLanguage) return 'ro';
  return acceptLanguage.toLowerCase().includes('en') ? 'en' : 'ro';
}

async function forgotPasswordHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : null;

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: { message: 'Adresă de email invalidă.' } },
        { status: 400 },
      );
    }

    // Always return success to prevent user enumeration
    const successResponse = NextResponse.json({ success: true }, { status: 200 });

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true, email: true, fullName: true, preferredLang: true },
    });

    if (!user) {
      return successResponse;
    }

    const locale = detectLocale(req.headers.get('accept-language')) as 'ro' | 'en';
    const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin;
    let token: string;
    try {
      token = await generatePasswordResetToken(user.id);
    } catch (tokenError) {
      logger.error({ tokenError, userId: user.id }, '[auth:forgot-password] Token generation failed');
      return successResponse;
    }

    const resetUrl = `${baseUrl}/${locale}/resetare-parola?token=${encodeURIComponent(token)}`;
    const template = passwordResetEmail(user.fullName, resetUrl, (user.preferredLang as 'ro' | 'en') || locale);

    try {
      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
      });
    } catch (emailError) {
      logger.warn({ emailError, userId: user.id }, '[auth:forgot-password] Email send failed');
    }

    return successResponse;
  } catch (error) {
    logger.error({ error }, '[auth:forgot-password]');
    // Always return 200 to prevent user enumeration (P0-2 / P2-3)
    return NextResponse.json({ success: true }, { status: 200 });
  }
}

export const POST = withRateLimit(
  {
    keyPrefix: 'auth:forgot-password',
    maxRequests: 3,
    windowMs: 15 * 60 * 1000,
    messageRo: 'Prea multe solicitări. Vă rugăm să așteptați 15 minute.',
  },
  forgotPasswordHandler,
);
