// ─── AI Reviews API (EU AI Act Art. 14 — Human Oversight) ──────
// GET  /api/v1/organizations/[id]/ai-reviews - List pending AI reviews
// POST /api/v1/organizations/[id]/ai-reviews - Approve or reject an AI review

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { aiReviews, users } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, getPaginationParams } from '@/lib/auth/helpers';
import { logAudit } from '@/lib/legal/audit';
import { desc, eq, and, sql } from 'drizzle-orm';
import { z } from 'zod';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'ai-reviews' });

type Params = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    await requireAuth();
    const orgId = params.id;


    const { page, perPage, offset } = getPaginationParams(req);
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status') || 'pending_review';

    const whereClause = and(
      eq(aiReviews.orgId, orgId),
      eq(aiReviews.status, statusFilter as 'pending_review' | 'approved' | 'rejected'),
    );

    const [countResult, reviews] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(aiReviews).where(whereClause),
      db
        .select({
          id: aiReviews.id,
          feature: aiReviews.feature,
          riskLevel: aiReviews.riskLevel,
          inputSummary: aiReviews.inputSummary,
          resultData: aiReviews.resultData,
          resultMetadata: aiReviews.resultMetadata,
          status: aiReviews.status,
          reviewNote: aiReviews.reviewNote,
          createdAt: aiReviews.createdAt,
          reviewedAt: aiReviews.reviewedAt,
          requestedByName: users.fullName,
          requestedByEmail: users.email,
        })
        .from(aiReviews)
        .leftJoin(users, eq(aiReviews.requestedBy, users.id))
        .where(whereClause)
        .orderBy(desc(aiReviews.createdAt))
        .limit(perPage)
        .offset(offset),
    ]);

    const total = Number(countResult[0]?.count ?? 0);

    return NextResponse.json({
      success: true,
      data: reviews,
      pagination: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[ai-reviews] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

const reviewDecisionSchema = z.object({
  reviewId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const orgId = params.id;


    const body = await req.json();
    const parsed = reviewDecisionSchema.safeParse(body);
    if (!parsed.success) {
      throw Errors.validation('body', 'Date invalide', 'Invalid input');
    }

    const { reviewId, decision, note } = parsed.data;

    // Verify review exists, belongs to this org, and is pending
    const review = await db.query.aiReviews.findFirst({
      where: and(
        eq(aiReviews.id, reviewId),
        eq(aiReviews.orgId, orgId),
        eq(aiReviews.status, 'pending_review'),
      ),
    });

    if (!review) {
      throw Errors.notFound('ai_review', reviewId);
    }

    await db
      .update(aiReviews)
      .set({
        status: decision,
        reviewedBy: user.id,
        reviewNote: note ?? null,
        reviewedAt: new Date(),
      })
      .where(eq(aiReviews.id, reviewId));

    await logAudit({
      userId: user.id,
      action: 'ai.compliance_check',
      resourceType: 'ai_review',
      resourceId: reviewId,
      oldValue: { status: 'pending_review' },
      newValue: { status: decision, note },
    });

    return NextResponse.json({
      success: true,
      data: { reviewId, status: decision },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[ai-reviews] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
