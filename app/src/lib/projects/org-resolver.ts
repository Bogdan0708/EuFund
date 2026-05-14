// app/src/lib/projects/org-resolver.ts
import { asc, eq } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { organizations, orgMembers, users } from '@/lib/db/schema';
import { FondEUError } from '@/lib/errors';

type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ResolveOrgOpts {
  /**
   * When true and the user has 2+ memberships with no requestedOrgId, return
   * the OLDEST membership (by joined_at, falling back to org_members.id for
   * stable ordering) instead of throwing PROJECT_ORG_REQUIRED.
   *
   * The agent-driven promotion path (`ensureProjectForSession`) can't pause
   * mid-LLM-loop to ask the user which org to use, so it opts in here. The
   * explicit POST /api/v1/projects route keeps the throw — API consumers
   * should be deliberate about which org they're writing to.
   */
  autoPickOnAmbiguous?: boolean;
}

/**
 * Resolves the org context for a project create. Tx-aware so callers can
 * compose this with their own atomic write (e.g., session-to-project
 * promotion needs a Personal Workspace creation that rolls back on dry-run).
 *
 *   - Explicit requestedOrgId → returned verbatim (caller validates membership).
 *   - 1 membership            → that org.
 *   - 0 memberships           → auto-creates a Personal Workspace + admin org_member.
 *   - 2+ memberships          → opts.autoPickOnAmbiguous ? oldest membership
 *                               : throws FondEUError(CONFLICT, PROJECT_ORG_REQUIRED).
 */
export async function resolveProjectOrgIdInTx(
  tx: DbTransaction,
  userId: string,
  requestedOrgId?: string,
  opts: ResolveOrgOpts = {},
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

  // Cap at 2 unless we may auto-pick: when auto-pick is on we need a stable
  // ordering across the whole membership set so the "oldest" picked today
  // matches the oldest picked next week. limit:2 was enough for the
  // count-the-rows distinction but loses ordering when 3+ memberships exist.
  const memberships = opts.autoPickOnAmbiguous
    ? await tx
        .select({ orgId: orgMembers.orgId, joinedAt: orgMembers.joinedAt, id: orgMembers.id })
        .from(orgMembers)
        .where(eq(orgMembers.userId, userId))
        .orderBy(asc(orgMembers.joinedAt), asc(orgMembers.id))
    : await tx.query.orgMembers.findMany({
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

  // 2+ memberships path.
  if (opts.autoPickOnAmbiguous) {
    // Oldest-first ordering already applied above — head of the list IS the
    // user's primary org. Stable: joinedAt is set on insert via defaultNow
    // and never mutated; the id tiebreaker handles same-instant inserts.
    return memberships[0].orgId;
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
