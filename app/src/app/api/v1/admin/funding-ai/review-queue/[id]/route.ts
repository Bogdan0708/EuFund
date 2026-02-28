import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { fundingReviewQueue } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-funding-ai-review-queue-item-route' });
export const dynamic = 'force-dynamic';

const updateQueueItemSchema = z.object({
  status: z.enum(['pending', 'in_review', 'approved', 'rejected']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
  resolutionNotes: z.string().max(10000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const user = await requirePlatformAdmin();
    const { id } = await params;
    const body = await req.json();
    const parsed = updateQueueItemSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const existing = await db.query.fundingReviewQueue.findFirst({
      where: eq(fundingReviewQueue.id, id),
    });
    if (!existing) throw Errors.notFound('funding_review_queue', id);

    const updates = parsed.data;
    const terminal = updates.status === 'approved' || updates.status === 'rejected';

    const [updated] = await db.update(fundingReviewQueue).set({
      status: updates.status ?? existing.status,
      severity: updates.severity ?? existing.severity,
      assignedTo: updates.assignedTo === undefined ? existing.assignedTo : updates.assignedTo,
      resolutionNotes: updates.resolutionNotes === undefined ? existing.resolutionNotes : updates.resolutionNotes,
      metadata: updates.metadata ?? existing.metadata,
      resolvedAt: terminal ? new Date() : existing.resolvedAt,
      updatedAt: new Date(),
    }).where(eq(fundingReviewQueue.id, id)).returning();

    await logAudit({
      userId: user.id,
      action: 'funding_ai.review_queue_update',
      resourceType: 'funding_review_queue',
      resourceId: id,
      oldValue: {
        status: existing.status,
        severity: existing.severity,
        assignedTo: existing.assignedTo,
      },
      newValue: {
        status: updated.status,
        severity: updated.severity,
        assignedTo: updated.assignedTo,
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[funding-ai-review-queue-item] PATCH error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
