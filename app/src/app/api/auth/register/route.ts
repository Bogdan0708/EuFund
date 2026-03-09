// ─── User Registration API ───────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, consentRecords } from '@/lib/db/schema';
import { registerSchema } from '@/lib/validators';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { eq } from 'drizzle-orm';
import { hash } from 'bcryptjs';
import { logger } from '@/lib/logger';
import { withRateLimit } from '@/lib/middleware/rate-limit';
import { generateVerificationToken } from '@/lib/email/verification';
import { sendEmail } from '@/lib/email/transporter';
import { welcomeEmail } from '@/lib/email/templates';

function detectLocale(acceptLanguage?: string | null): 'ro' | 'en' {
  if (!acceptLanguage) {
    return 'ro';
  }

  return acceptLanguage.toLowerCase().includes('en') ? 'en' : 'ro';
}

async function registerHandler(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      return NextResponse.json(
        Errors.validation(firstError.path.join('.'), firstError.message, firstError.message).toResponse('ro'),
        { status: 400 },
      );
    }

    const data = parsed.data;

    // Check for existing user
    const existing = await db.query.users.findFirst({
      where: eq(users.email, data.email),
    });

    if (existing) {
      return NextResponse.json(
        Errors.validation('email', 'Un cont cu acest email există deja.', 'An account with this email already exists.').toResponse('ro'),
        { status: 409 },
      );
    }

    const passwordHash = await hash(data.password, 12);

    const ipAddress = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined;
    const userAgent = req.headers.get('user-agent') || undefined;
    const consentTypes = ['privacy_policy', 'terms_of_service', 'data_processing'] as const;

    const user = await db.transaction(async (tx) => {
      const [createdUser] = await tx.insert(users).values({
        email: data.email,
        passwordHash,
        fullName: data.fullName,
        phone: data.phone,
        dateOfBirth: data.dateOfBirth,
        ageVerified: true,
        preferredLang: 'ro',
      }).returning({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        createdAt: users.createdAt,
      });

      for (const consentType of consentTypes) {
        await tx.insert(consentRecords).values({
          userId: createdUser.id,
          consentType,
          status: 'granted',
          version: '1.0',
          ipAddress,
          userAgent,
        });
      }

      return createdUser;
    });

    await logAudit({
      userId: user.id,
      action: 'auth.register',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress: ipAddress || undefined,
      userAgent: userAgent || undefined,
    });

    try {
      const locale = detectLocale(req.headers.get('accept-language'));
      const baseUrl = process.env.NEXTAUTH_URL || req.nextUrl.origin;
      const token = await generateVerificationToken(user.id);
      const verificationUrl = `${baseUrl}/${locale}/verifica-email?token=${encodeURIComponent(token)}`;
      const template = welcomeEmail(user.fullName, verificationUrl, locale);

      await sendEmail({
        to: user.email,
        subject: template.subject,
        html: template.html,
      });
    } catch (emailError) {
      logger.warn({ emailError, userId: user.id }, '[auth:register] Verification email failed');
    }

    return NextResponse.json({
      success: true,
      data: user,
      message: 'Contul a fost creat cu succes.',
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    logger.error({ error: error }, '[auth:register]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export const POST = withRateLimit(
  {
    keyPrefix: 'auth:register',
    maxRequests: 5,
    windowMs: 15 * 60 * 1000,
    messageRo: 'Prea multe încercări de înregistrare. Vă rugăm să încercați din nou mai târziu.',
  },
  registerHandler,
);
