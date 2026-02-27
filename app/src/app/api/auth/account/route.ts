import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  auditLog,
  consentRecords,
  emailVerificationTokens,
  notifications,
  orgMembers,
  passwordResetTokens,
  users,
} from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth/helpers';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'auth-account-delete' });
const DELETED_SENTINEL = 'deleted-user';

function anonymizedValue(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export async function DELETE(req: NextRequest) {
  try {
    const authUser = await requireAuth();
    const body = await req.json().catch(() => ({}));
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!password) {
      return NextResponse.json(
        Errors.validation('password', 'Parola este obligatorie.', 'Password is required.').toResponse('ro'),
        { status: 400 },
      );
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, authUser.id),
      columns: { id: true, email: true, passwordHash: true, fullName: true },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json(Errors.unauthorized().toResponse('ro'), { status: 401 });
    }

    const validPassword = await compare(password, user.passwordHash);
    if (!validPassword) {
      return NextResponse.json(
        Errors.validation('password', 'Parola este invalidă.', 'Invalid password.').toResponse('ro'),
        { status: 403 },
      );
    }

    const userHash = anonymizedValue(`${user.id}:${user.email}`);
    const anonymizedEmail = `${DELETED_SENTINEL}+${userHash.slice(0, 12)}@anon.local`;

    await logAudit({
      userId: user.id,
      action: 'gdpr.data_delete',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { anonymizedUserHash: userHash },
    });

    await db.transaction(async (tx) => {
      await tx.delete(consentRecords).where(eq(consentRecords.userId, user.id));
      await tx.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, user.id));
      await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
      await tx.delete(notifications).where(eq(notifications.userId, user.id));
      await tx.delete(orgMembers).where(eq(orgMembers.userId, user.id));

      await tx
        .update(auditLog)
        .set({
          userId: null,
          ipAddress: null,
          userAgent: null,
          metadata: {
            anonymizedUserHash: userHash,
            anonymizedAt: new Date().toISOString(),
          },
        })
        .where(eq(auditLog.userId, user.id));

      await tx
        .update(users)
        .set({
          email: anonymizedEmail,
          fullName: DELETED_SENTINEL,
          phone: null,
          avatarUrl: null,
          dateOfBirth: null,
          mfaSecret: null,
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));
    });

    return NextResponse.json({
      success: true,
      data: {
        message: 'Contul a fost șters și anonimizat conform GDPR.',
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[auth:account-delete]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
