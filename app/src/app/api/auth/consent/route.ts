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

const withdrawSchema = z.object({
  consentType: z.enum(['marketing', 'analytics']),
});

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();
    const parsed = withdrawSchema.safeParse(body);

    if (!parsed.success) {
      throw Errors.validation('body', 'Tip consimțământ invalid', 'Invalid consent type');
    }

    const { consentType } = parsed.data;

    // Find active consent of this type
    const existing = await db.query.consentRecords.findFirst({
      where: and(
        eq(consentRecords.userId, user.id),
        eq(consentRecords.consentType, consentType),
        eq(consentRecords.status, 'granted'),
      ),
    });

    if (!existing) {
      throw Errors.notFound('consent_record', consentType);
    }

    await db
      .update(consentRecords)
      .set({
        status: 'withdrawn',
        withdrawnAt: new Date(),
      })
      .where(eq(consentRecords.id, existing.id));

    await logAudit({
      userId: user.id,
      action: 'consent.withdraw',
      resourceType: 'consent',
      resourceId: existing.id,
      metadata: { consentType },
    });

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
