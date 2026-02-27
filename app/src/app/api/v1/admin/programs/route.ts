import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { fundingPrograms } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requirePlatformAdmin } from '@/lib/auth/helpers';
import { logAudit, sanitizeForAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'admin-programs-route' });
export const dynamic = 'force-dynamic';

const createProgramSchema = z.object({
  code: z.string().min(2).max(50),
  nameRo: z.string().min(3).max(500),
  nameEn: z.string().min(3).max(500).optional(),
  descriptionRo: z.string().max(5000).optional(),
  descriptionEn: z.string().max(5000).optional(),
  managingAuth: z.string().max(255).optional(),
  fundSource: z.string().max(50).optional(),
  totalBudget: z.union([z.number().nonnegative(), z.string()]).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  websiteUrl: z.string().url().optional(),
  status: z.enum(['activ', 'inactiv', 'arhivat']).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateProgramSchema = createProgramSchema.partial().extend({
  id: z.string().uuid(),
});

export async function GET() {
  try {
    await requirePlatformAdmin();

    const programs = await db.query.fundingPrograms.findMany({
      orderBy: (p, { desc }) => [desc(p.createdAt)],
    });

    return NextResponse.json({ success: true, data: programs });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[programs] GET error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();

    const body = await req.json();
    const parsed = createProgramSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const payload = parsed.data;
    const [created] = await db.insert(fundingPrograms).values({
      code: payload.code,
      nameRo: payload.nameRo,
      nameEn: payload.nameEn,
      descriptionRo: payload.descriptionRo,
      descriptionEn: payload.descriptionEn,
      managingAuth: payload.managingAuth,
      fundSource: payload.fundSource,
      totalBudget: payload.totalBudget !== undefined ? String(payload.totalBudget) : null,
      periodStart: payload.periodStart ?? null,
      periodEnd: payload.periodEnd ?? null,
      websiteUrl: payload.websiteUrl,
      status: payload.status ?? 'activ',
      metadata: payload.metadata ?? {},
    }).returning();

    await logAudit({
      userId: user.id,
      action: 'system.program_change',
      resourceType: 'funding_program',
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
    log.error({ error }, '[programs] POST error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const user = await requirePlatformAdmin();

    const body = await req.json();
    const parsed = updateProgramSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message);
    }

    const { id, ...updates } = parsed.data;
    const existing = await db.query.fundingPrograms.findFirst({ where: eq(fundingPrograms.id, id) });
    if (!existing) throw Errors.notFound('funding_program', id);

    const [updated] = await db.update(fundingPrograms).set({
      ...updates,
      totalBudget: updates.totalBudget !== undefined ? String(updates.totalBudget) : undefined,
      updatedAt: new Date(),
    }).where(eq(fundingPrograms.id, id)).returning();

    await logAudit({
      userId: user.id,
      action: 'system.program_change',
      resourceType: 'funding_program',
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
    log.error({ error }, '[programs] PUT error');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
