import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { fundingReviewQueue } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { getPaginationParams, requirePlatformAdmin } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-funding-ai-review-queue-route' });
export const dynamic = 'force-dynamic';

const createQueueItemSchema = z.object({
  callExternalKey: z.string().min(1).max(255),
  documentId: z.string().uuid().optional(),
  reason: z.string().min(3).max(10000),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignedTo: z.string().uuid().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin();
    const { perPage, offset } = getPaginationParams(req);
    const status = req.nextUrl.searchParams.get('status');
    const severity = req.nextUrl.searchParams.get('severity');
    const callExternalKey = req.nextUrl.searchParams.get('callExternalKey');

    const conditions = [];
    if (status) conditions.push(eq(fundingReviewQueue.status, status as 'pending' | 'in_review' | 'approved' | 'rejected'));
    if (severity) conditions.push(eq(fundingReviewQueue.severity, severity as 'low' | 'medium' | 'high' | 'critical'));
    if (callExternalKey) conditions.push(eq(fundingReviewQueue.callExternalKey, callExternalKey));

    const items = await db.query.fundingReviewQueue.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: (rows, { desc }) => [desc(rows.createdAt)],
      limit: perPage,
      offset,
    });

    return NextResponse.json({
      success: true,
      data: {
        items,
        page: Math.floor(offset / perPage) + 1,
        perPage,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-review-queue] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();
    const body = await req.json();
    const parsed = createQueueItemSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const payload = parsed.data;
    const [created] = await db.insert(fundingReviewQueue).values({
      callExternalKey: payload.callExternalKey,
      documentId: payload.documentId,
      reason: payload.reason,
      severity: payload.severity ?? 'medium',
      status: 'pending',
      assignedTo: payload.assignedTo,
      createdBy: user.id,
      metadata: payload.metadata ?? {},
    }).returning();

    await logAudit({
      userId: user.id,
      action: 'funding_ai.review_queue_create',
      resourceType: 'funding_review_queue',
      resourceId: created.id,
      metadata: {
        callExternalKey: created.callExternalKey,
        severity: created.severity,
      },
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-review-queue] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
