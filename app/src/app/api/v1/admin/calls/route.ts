import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { callsForProposals } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { logAudit, sanitizeForAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-calls-route' });
export const dynamic = 'force-dynamic';

const createCallSchema = z.object({
  programId: z.string().uuid(),
  callCode: z.string().min(2).max(100),
  titleRo: z.string().min(3).max(1000),
  titleEn: z.string().max(1000).optional(),
  descriptionRo: z.string().max(5000).optional(),
  objective: z.string().max(5000).optional(),
  eligibleTypes: z.array(z.string()).optional(),
  eligibleRegions: z.array(z.string()).optional(),
  eligibleCaen: z.array(z.string()).optional(),
  budgetTotal: z.union([z.number().nonnegative(), z.string()]).optional(),
  budgetMin: z.union([z.number().nonnegative(), z.string()]).optional(),
  budgetMax: z.union([z.number().nonnegative(), z.string()]).optional(),
  cofinancingRate: z.union([z.number().min(0).max(100), z.string()]).optional(),
  durationMin: z.number().int().nonnegative().optional(),
  durationMax: z.number().int().nonnegative().optional(),
  submissionStart: z.string().datetime().optional(),
  submissionEnd: z.string().datetime().optional(),
  guideUrl: z.string().url().optional(),
  status: z.enum(['previzionat', 'deschis', 'in_evaluare', 'inchis', 'anulat']).optional(),
  isCompetitive: z.boolean().optional(),
  evaluationCriteria: z.record(z.string(), z.unknown()).optional(),
  eligibleExpenses: z.record(z.string(), z.unknown()).optional(),
  stateAidScheme: z.string().max(255).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateCallSchema = createCallSchema.partial().extend({
  id: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  try {
    await requirePlatformAdmin();

    const programId = req.nextUrl.searchParams.get('programId');
    const calls = await db.query.callsForProposals.findMany({
      where: programId ? eq(callsForProposals.programId, programId) : undefined,
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });

    return NextResponse.json({ success: true, data: calls });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[calls] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();

    const body = await req.json();
    const parsed = createCallSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const payload = parsed.data;
    const [created] = await db.insert(callsForProposals).values({
      programId: payload.programId,
      callCode: payload.callCode,
      titleRo: payload.titleRo,
      titleEn: payload.titleEn,
      descriptionRo: payload.descriptionRo,
      objective: payload.objective,
      eligibleTypes: payload.eligibleTypes,
      eligibleRegions: payload.eligibleRegions,
      eligibleCaen: payload.eligibleCaen,
      budgetTotal: payload.budgetTotal !== undefined ? String(payload.budgetTotal) : null,
      budgetMin: payload.budgetMin !== undefined ? String(payload.budgetMin) : null,
      budgetMax: payload.budgetMax !== undefined ? String(payload.budgetMax) : null,
      cofinancingRate: payload.cofinancingRate !== undefined ? String(payload.cofinancingRate) : null,
      durationMin: payload.durationMin,
      durationMax: payload.durationMax,
      submissionStart: payload.submissionStart ? new Date(payload.submissionStart) : null,
      submissionEnd: payload.submissionEnd ? new Date(payload.submissionEnd) : null,
      guideUrl: payload.guideUrl,
      status: payload.status ?? 'previzionat',
      isCompetitive: payload.isCompetitive ?? true,
      evaluationCriteria: payload.evaluationCriteria,
      eligibleExpenses: payload.eligibleExpenses,
      stateAidScheme: payload.stateAidScheme,
      metadata: payload.metadata ?? {},
    }).returning();

    await logAudit({
      userId: user.id,
      action: 'system.call_change',
      resourceType: 'call_for_proposal',
      resourceId: created.id,
      oldValue: {},
      newValue: sanitizeForAudit(created as unknown as Record<string, unknown>),
      metadata: { changeType: 'create' },
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[calls] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();

    const body = await req.json();
    const parsed = updateCallSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const { id, ...updates } = parsed.data;
    const existing = await db.query.callsForProposals.findFirst({ where: eq(callsForProposals.id, id) });
    if (!existing) throw Errors.notFound('call_for_proposal', id);

    const [updated] = await db.update(callsForProposals).set({
      ...updates,
      budgetTotal: updates.budgetTotal !== undefined ? String(updates.budgetTotal) : undefined,
      budgetMin: updates.budgetMin !== undefined ? String(updates.budgetMin) : undefined,
      budgetMax: updates.budgetMax !== undefined ? String(updates.budgetMax) : undefined,
      cofinancingRate: updates.cofinancingRate !== undefined ? String(updates.cofinancingRate) : undefined,
      submissionStart: updates.submissionStart ? new Date(updates.submissionStart) : undefined,
      submissionEnd: updates.submissionEnd ? new Date(updates.submissionEnd) : undefined,
      updatedAt: new Date(),
    }).where(eq(callsForProposals.id, id)).returning();

    await logAudit({
      userId: user.id,
      action: 'system.call_change',
      resourceType: 'call_for_proposal',
      resourceId: id,
      oldValue: sanitizeForAudit(existing as unknown as Record<string, unknown>),
      newValue: sanitizeForAudit(updated as unknown as Record<string, unknown>),
      metadata: { changeType: 'update' },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[calls] PUT error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
