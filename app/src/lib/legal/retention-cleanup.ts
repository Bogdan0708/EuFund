// ─── Data Retention Enforcement ──────────────────────────────────
// DPIA-defined retention policies with dry-run support

import { db } from '@/lib/db';
import {
  users,
  emailVerificationTokens,
  passwordResetTokens,
  documents,
} from '@/lib/db/schema';
import { and, eq, lt, isNotNull, sql } from 'drizzle-orm';
import { logAudit } from './audit';

export interface RetentionRunResult {
  executedAt: string;
  policies: Array<{
    policy: string;
    recordsProcessed: number;
    dryRun: boolean;
  }>;
  totalProcessed: number;
  dryRun: boolean;
}

/**
 * Run all data retention policies.
 * @param dryRun If true, counts records but does not modify them.
 */
export async function runRetentionCleanup(dryRun = true): Promise<RetentionRunResult> {
  const policies: RetentionRunResult['policies'] = [];

  const tokenCount = await purgeExpiredTokens(dryRun);
  policies.push({ policy: 'purge_expired_tokens', recordsProcessed: tokenCount, dryRun });

  const anonymizedCount = await anonymizeDeletedUsers(dryRun);
  policies.push({ policy: 'anonymize_deleted_users', recordsProcessed: anonymizedCount, dryRun });

  const aiContentCount = await purgeOldAIContent(dryRun);
  policies.push({ policy: 'purge_old_ai_content', recordsProcessed: aiContentCount, dryRun });

  const totalProcessed = policies.reduce((sum, p) => sum + p.recordsProcessed, 0);

  return {
    executedAt: new Date().toISOString(),
    policies,
    totalProcessed,
    dryRun,
  };
}

/**
 * Delete expired email verification and password reset tokens.
 */
async function purgeExpiredTokens(dryRun: boolean): Promise<number> {
  const now = new Date();

  const [emailCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(emailVerificationTokens)
    .where(lt(emailVerificationTokens.expiresAt, now));

  const [resetCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, now));

  const total = Number(emailCount.count) + Number(resetCount.count);

  if (dryRun || total === 0) {
    return total;
  }

  await db
    .delete(emailVerificationTokens)
    .where(lt(emailVerificationTokens.expiresAt, now));

  await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, now));

  return total;
}

/**
 * Anonymize soft-deleted users older than 30 days.
 * Skips already-anonymized users (email starts with 'anon_').
 */
async function anonymizeDeletedUsers(dryRun: boolean): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const candidates = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(
      and(
        isNotNull(users.deletedAt),
        lt(users.deletedAt, cutoff),
        sql`${users.email} NOT LIKE 'anon_%'`,
      ),
    );

  if (dryRun || candidates.length === 0) {
    return candidates.length;
  }

  for (const user of candidates) {
    const anonId = user.id.substring(0, 8);
    await db
      .update(users)
      .set({
        email: `anon_${anonId}@deleted.local`,
        fullName: 'Deleted User',
        phone: null,
        passwordHash: null,
        avatarUrl: null,
        dateOfBirth: null,
        mfaSecret: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
      })
      .where(eq(users.id, user.id));

    await logAudit({
      action: 'system.retention_cleanup',
      resourceType: 'user',
      resourceId: user.id,
      metadata: { policy: 'anonymize_deleted_users', originalEmail: '[REDACTED]' },
    });
  }

  return candidates.length;
}

/**
 * Null out AI-generated content on documents older than 90 days.
 */
async function purgeOldAIContent(dryRun: boolean): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(documents)
    .where(
      and(
        lt(documents.createdAt, cutoff),
        sql`(${documents.aiSummary} IS NOT NULL OR ${documents.extractedData} IS NOT NULL)`,
      ),
    );

  const count = Number(countResult.count);

  if (dryRun || count === 0) {
    return count;
  }

  await db
    .update(documents)
    .set({ aiSummary: null, extractedData: null })
    .where(
      and(
        lt(documents.createdAt, cutoff),
        sql`(${documents.aiSummary} IS NOT NULL OR ${documents.extractedData} IS NOT NULL)`,
      ),
    );

  return count;
}
