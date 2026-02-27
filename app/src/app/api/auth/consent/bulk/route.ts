import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { consentRecords } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { Errors, FondEUError } from '@/lib/errors';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'consent-bulk' });
const CONSENT_VERSION = process.env.CONSENT_POLICY_VERSION || process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION || 'v1';

const bulkSchema = z.object({
  consents: z.array(z.object({
    consentType: z.enum(['marketing', 'analytics']),
    status: z.enum(['granted', 'withdrawn']),
  })).min(1).max(5),
});

function requestContext(request: NextRequest): { ipAddress?: string; userAgent?: string } {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;
  return { ipAddress, userAgent };
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth();
    const context = requestContext(request);
    const body = await request.json();
    const parsed = bulkSchema.safeParse(body);

    if (!parsed.success) {
      throw Errors.validation('body', 'Date consimțământ invalide', 'Invalid consent payload');
    }

    const deduped = new Map(parsed.data.consents.map((item) => [item.consentType, item.status]));
    const changes = Array.from(deduped.entries()).map(([consentType, status]) => ({ consentType, status }));
    const auditEvents: Array<{ action: 'consent.grant' | 'consent.withdraw'; consentType: string; resourceId?: string }> = [];

    await db.transaction(async (tx) => {
      for (const change of changes) {
        const latest = await tx.query.consentRecords.findFirst({
          where: and(eq(consentRecords.userId, user.id), eq(consentRecords.consentType, change.consentType)),
          orderBy: (records, { desc }) => [desc(records.grantedAt)],
        });

        if (change.status === 'granted') {
          if (latest?.status !== 'granted') {
            const [created] = await tx.insert(consentRecords).values({
              userId: user.id,
              consentType: change.consentType,
              status: 'granted',
              version: CONSENT_VERSION,
              grantedAt: new Date(),
              ipAddress: context.ipAddress,
              userAgent: context.userAgent,
            }).returning({ id: consentRecords.id });
            auditEvents.push({ action: 'consent.grant', consentType: change.consentType, resourceId: created.id });
          }
          continue;
        }

        if (latest?.status === 'granted') {
          await tx.update(consentRecords).set({
            status: 'withdrawn',
            withdrawnAt: new Date(),
          }).where(eq(consentRecords.id, latest.id));
          auditEvents.push({ action: 'consent.withdraw', consentType: change.consentType, resourceId: latest.id });
        } else if (!latest) {
          const [created] = await tx.insert(consentRecords).values({
            userId: user.id,
            consentType: change.consentType,
            status: 'withdrawn',
            version: CONSENT_VERSION,
            withdrawnAt: new Date(),
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          }).returning({ id: consentRecords.id });
          auditEvents.push({ action: 'consent.withdraw', consentType: change.consentType, resourceId: created.id });
        }
      }
    });

    for (const event of auditEvents) {
      await logAudit({
        userId: user.id,
        action: event.action,
        resourceType: 'consent',
        resourceId: event.resourceId,
        metadata: { consentType: event.consentType, ...context },
      });
    }

    return NextResponse.json({
      success: true,
      data: changes,
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[consent:bulk] PATCH error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

