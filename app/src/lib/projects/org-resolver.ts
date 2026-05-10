// app/src/lib/projects/org-resolver.ts
import { eq } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { organizations, orgMembers, users } from '@/lib/db/schema';
import { FondEUError } from '@/lib/errors';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Resolves the org context for a project create. Tx-aware so callers can
 * compose this with their own atomic write (e.g., session-to-project
 * promotion needs a Personal Workspace creation that rolls back on dry-run).
 *
 *   - Explicit requestedOrgId → returned verbatim (caller validates membership).
 *   - 1 membership            → that org.
 *   - 0 memberships           → auto-creates a Personal Workspace + admin org_member.
 *   - 2+ memberships          → throws FondEUError(CONFLICT, PROJECT_ORG_REQUIRED).
 */
export async function resolveProjectOrgIdInTx(
  tx: DbTransaction,
  userId: string,
  requestedOrgId?: string,
): Promise<string> {
  if (requestedOrgId) {
    return requestedOrgId;
  }

  await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
    .limit(1);

  const memberships = await tx.query.orgMembers.findMany({
    where: eq(orgMembers.userId, userId),
    columns: { orgId: true },
    limit: 2,
  });

  if (memberships.length === 1) {
    return memberships[0].orgId;
  }

  if (memberships.length === 0) {
    const [org] = await tx
      .insert(organizations)
      .values({ name: `Personal Workspace`, orgType: 'pfa' })
      .returning({ id: organizations.id });

    await tx.insert(orgMembers).values({
      userId,
      orgId: org.id,
      role: 'admin',
    });

    return org.id;
  }

  throw new FondEUError({
    code: 'CONFLICT',
    statusCode: 409,
    messageEn: 'A valid organization context is required to create a project.',
    messageRo: 'Este necesar contextul unei organizații valide pentru a crea proiectul.',
    details: { reason: 'PROJECT_ORG_REQUIRED' },
    retryable: false,
  });
}
