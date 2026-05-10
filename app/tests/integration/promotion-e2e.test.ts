// app/tests/integration/promotion-e2e.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '@/lib/db';
import { agentSessions, projects, orgMembers, organizations, users, callsForProposals, fundingPrograms } from '@/lib/db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { ensureProjectForSession } from '@/lib/projects/promotion';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_CALL_CODE = 'CALL-E2E-PROMO';
const TEST_PROGRAM_ID = '00000000-0000-0000-0000-000000000003';

describe('promotion E2E regression', () => {
  beforeEach(async () => {
    // 1. Find all orgs for the test user
    const userOrgs = await db.select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(eq(orgMembers.userId, TEST_USER_ID));
    
    // 2. Cleanup linked data
    await db.delete(agentSessions).where(eq(agentSessions.userId, TEST_USER_ID));
    await db.delete(projects).where(eq(projects.userId, TEST_USER_ID));
    await db.delete(orgMembers).where(eq(orgMembers.userId, TEST_USER_ID));
    
    // 3. Delete the orgs if they were personal workspaces
    if (userOrgs.length > 0) {
      const orgIds = userOrgs.map(o => o.orgId);
      await db.delete(organizations)
        .where(and(
          inArray(organizations.id, orgIds),
          eq(organizations.name, 'Personal Workspace')
        ));
    }
    
    // 4. Ensure user, program, and call exist
    await db.insert(users).values({
      id: TEST_USER_ID,
      email: 'promo-test@example.com',
      fullName: 'Promo Tester'
    }).onConflictDoNothing();

    await db.insert(fundingPrograms).values({
      id: TEST_PROGRAM_ID,
      code: 'E2E-PROG',
      nameRo: 'Program E2E',
    }).onConflictDoNothing();

    await db.insert(callsForProposals).values({
      id: '00000000-0000-0000-0000-000000000002',
      programId: TEST_PROGRAM_ID,
      callCode: TEST_CALL_CODE,
      titleRo: 'E2E Call',
      status: 'deschis',
    }).onConflictDoNothing();
  });

  it('performs a full fresh promotion with real DB side effects', async () => {
    // 1. Create a session shell
    const [session] = await db.insert(agentSessions).values({
      userId: TEST_USER_ID,
      selectedCallId: TEST_CALL_CODE,
      locale: 'ro',
      currentPhase: 'drafting',
      stateVersion: 1,
    }).returning({ id: agentSessions.id });

    // 2. Promote
    const ctx = { userId: TEST_USER_ID, sessionId: session.id, requestId: 'e2e-1', now: new Date() } as any;
    const res = await ensureProjectForSession(ctx, session.id);

    expect(res.promoted).toBe(true);
    if (res.promoted) {
      expect(res.created).toBe(true);
      expect(res.projectId).toBeDefined();
    }

    // 3. Verify side effects
    const [linkedSession] = await db.select().from(agentSessions).where(eq(agentSessions.id, session.id));
    expect(linkedSession.projectId).toBe((res as any).projectId);

    const [proj] = await db.select().from(projects).where(eq(projects.id, (res as any).projectId));
    expect(proj.userId).toBe(TEST_USER_ID);
    expect(proj.callId).toBeDefined();
    expect((proj.metadata as any).agentSessionId).toBe(session.id);

    // Verify org creation
    const memberships = await db.select().from(orgMembers).where(eq(orgMembers.userId, TEST_USER_ID));
    expect(memberships).toHaveLength(1);
  });
});
