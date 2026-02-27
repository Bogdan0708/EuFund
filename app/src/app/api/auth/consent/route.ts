// ─── Consent Management API ─────────────────────────────────────
// GET   /api/auth/consent - Get user's active consent records
// PATCH /api/auth/consent - Withdraw a specific consent type

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { consentRecords } from '@/lib/db/schema';
import { requireAuth } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { Errors, FondEUError } from '@/lib/errors';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'consent' });
const CONSENT_VERSION = process.env.CONSENT_POLICY_VERSION || process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION || 'v1';

function requestContext(request: NextRequest): { ipAddress?: string; userAgent?: string } {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const ipAddress = forwardedFor?.split(',')[0]?.trim() || undefined;
  const userAgent = request.headers.get('user-agent') || undefined;
  return { ipAddress, userAgent };
}

export async function GET() {
  try {
    const user = await requireAuth();

    const consents = await db.query.consentRecords.findMany({
      where: eq(consentRecords.userId, user.id),
      columns: {
        id: true,
        consentType: true,
        status: true,
        version: true,
        grantedAt: true,
        withdrawnAt: true,
        expiresAt: true,
      },
      orderBy: (records, { desc }) => [desc(records.grantedAt)],
    });

    return NextResponse.json({ success: true, data: consents });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[consent] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

const consentSchema = z.object({
  consentType: z.enum(['marketing', 'analytics']),
  status: z.enum(['granted', 'withdrawn']).optional().default('withdrawn'),
});

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth();
    const context = requestContext(request);
    const body = await request.json();
    const parsed = consentSchema.safeParse(body);

    if (!parsed.success) {
      throw Errors.validation('body', 'Tip consimțământ invalid', 'Invalid consent type');
    }

    const { consentType, status } = parsed.data;

    const latest = await db.query.consentRecords.findFirst({
      where: and(eq(consentRecords.userId, user.id), eq(consentRecords.consentType, consentType)),
      orderBy: (records, { desc }) => [desc(records.grantedAt)],
    });

    if (status === 'granted') {
      if (latest?.status !== 'granted') {
        const [created] = await db.insert(consentRecords).values({
          userId: user.id,
          consentType,
          status: 'granted',
          version: CONSENT_VERSION,
          grantedAt: new Date(),
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        }).returning();

        await logAudit({
          userId: user.id,
          action: 'consent.grant',
          resourceType: 'consent',
          resourceId: created.id,
          metadata: { consentType, ...context },
        });
      }
      return NextResponse.json({
        success: true,
        data: { consentType, status: 'granted' },
      });
    }

    let mutated = false;
    let resourceId = latest?.id;

    if (latest?.status === 'granted') {
      await db
        .update(consentRecords)
        .set({
          status: 'withdrawn',
          withdrawnAt: new Date(),
        })
        .where(eq(consentRecords.id, latest.id));
      mutated = true;
    } else if (!latest) {
      const [created] = await db.insert(consentRecords).values({
        userId: user.id,
        consentType,
        status: 'withdrawn',
        version: CONSENT_VERSION,
        withdrawnAt: new Date(),
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      }).returning();
      resourceId = created.id;
      mutated = true;
    }

    if (mutated) {
      await logAudit({
        userId: user.id,
        action: 'consent.withdraw',
        resourceType: 'consent',
        resourceId,
        metadata: { consentType, ...context },
      });
    }

    return NextResponse.json({
      success: true,
      data: { consentType, status: 'withdrawn' },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[consent] PATCH error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
