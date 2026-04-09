import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { logger } from '@/lib/logger';

const RESET_TOKEN_TTL_HOURS = 1;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function generatePasswordResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await db.transaction(async (tx) => {
    // Invalidate any existing tokens for this user
    await tx.delete(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.userId, userId));

    await tx.insert(schema.passwordResetTokens).values({
      userId,
      token: tokenHash,
      expiresAt,
    });
  });

  return token;
}

export async function verifyPasswordResetToken(token: string): Promise<string | null> {
  const now = new Date();
  const tokenHash = hashToken(token);

  const tokenRecord = await db.query.passwordResetTokens.findFirst({
    where: eq(schema.passwordResetTokens.token, tokenHash),
  });

  if (!tokenRecord) {
    return null;
  }

  if (tokenRecord.expiresAt < now) {
    await db.delete(schema.passwordResetTokens).where(eq(schema.passwordResetTokens.id, tokenRecord.id));
    return null;
  }

  return tokenRecord.userId;
}

export async function consumePasswordResetToken(token: string): Promise<void> {
  try {
    const tokenHash = hashToken(token);
    await db.delete(schema.passwordResetTokens).where(
      eq(schema.passwordResetTokens.token, tokenHash),
    );
  } catch (error) {
    logger.error({ error }, '[password-reset] Failed to delete token');
  }
}
