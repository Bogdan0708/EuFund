import { createHash, randomBytes } from 'crypto';
import { eq, or } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { logger } from '@/lib/logger';

const VERIFICATION_TOKEN_TTL_HOURS = 24;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function generateVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.userId, userId));

    await tx.insert(schema.emailVerificationTokens).values({
      userId,
      token: tokenHash,
      expiresAt,
    });
  });

  return token;
}

export async function verifyEmailToken(token: string): Promise<boolean> {
  const now = new Date();
  const tokenHash = hashToken(token);

  const tokenRecord = await db.query.emailVerificationTokens.findFirst({
    where: or(
      eq(schema.emailVerificationTokens.token, tokenHash),
      eq(schema.emailVerificationTokens.token, token),
    ),
  });

  if (!tokenRecord) {
    return false;
  }

  if (tokenRecord.expiresAt < now) {
    await db.delete(schema.emailVerificationTokens).where(eq(schema.emailVerificationTokens.id, tokenRecord.id));
    return false;
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, tokenRecord.userId));

      // Delete used token + any expired tokens for this user
      await tx
        .delete(schema.emailVerificationTokens)
        .where(eq(schema.emailVerificationTokens.userId, tokenRecord.userId));
    });

    return true;
  } catch (error) {
    logger.error({ error }, '[email:verify] Failed to verify email token');
    return false;
  }
}
