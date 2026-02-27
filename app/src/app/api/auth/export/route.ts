import { NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { auditLog, consentRecords, documents, orgMembers, projects, users } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth/helpers';
import { checkRateLimit, isRedisAvailable } from '@/lib/redis/client';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/legal/audit';

const log = logger.child({ component: 'auth-export' });

export async function GET() {
  try {
    const authUser = await requireAuth();

    if (await isRedisAvailable()) {
      const rate = await checkRateLimit(`sar_export:${authUser.id}`, 1, 60 * 60 * 1000);
      if (!rate.allowed) {
        return NextResponse.json(
          {
            success: false,
            error: {
              code: 'RATE_LIMITED',
              message: 'Data export is limited to once per hour.',
              retryAfter: rate.resetTime,
            },
          },
          { status: 429 },
        );
      }
    }

    const [profile, memberships, userProjects, uploadedDocuments, consents, userAudit] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.id, authUser.id),
        columns: {
          // Excluded sensitive fields by design: passwordHash, mfaSecret
          id: true,
          email: true,
          fullName: true,
          phone: true,
          preferredLang: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      db.query.orgMembers.findMany({
        where: eq(orgMembers.userId, authUser.id),
        columns: { id: true, orgId: true, role: true, joinedAt: true },
      }),
      db.query.projects.findMany({
        where: eq(projects.createdBy, authUser.id),
        columns: {
          id: true,
          orgId: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
        },
      }),
      db.query.documents.findMany({
        where: eq(documents.uploadedBy, authUser.id),
        columns: {
          id: true,
          orgId: true,
          projectId: true,
          filename: true,
          mimeType: true,
          fileSize: true,
          docType: true,
          createdAt: true,
          deletedAt: true,
        },
      }),
      db.query.consentRecords.findMany({
        where: eq(consentRecords.userId, authUser.id),
        columns: {
          id: true,
          consentType: true,
          status: true,
          version: true,
          grantedAt: true,
          withdrawnAt: true,
          expiresAt: true,
        },
      }),
      db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(eq(auditLog.userId, authUser.id))
        .orderBy(desc(auditLog.createdAt)),
    ]);

    await logAudit({
      userId: authUser.id,
      action: 'gdpr.data_export',
      resourceType: 'user',
      resourceId: authUser.id,
      metadata: { scope: 'self_export' },
    });

    const payload = {
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        profile,
        memberships,
        projects: userProjects,
        documents: uploadedDocuments,
        consents,
        auditLog: userAudit,
      },
    };

    return new NextResponse(JSON.stringify(payload), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="gdpr-export-${authUser.id}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[auth:export]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
