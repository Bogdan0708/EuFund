import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/lib/db';
import { auditLog, projects } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/legal/audit';

const log = logger.child({ component: 'project-evidence-ledger-api' });
type Params = { params: { id: string } };

const evidenceSchema = z.object({
  obligationId: z.string().min(1).max(128),
  title: z.string().min(3).max(300),
  evidenceType: z.enum(['document', 'declaration', 'financial_report', 'technical_report', 'audit_trail']),
  storageRef: z.string().min(3).max(500),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  notes: z.string().max(2000).optional(),
});

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, params.id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', params.id);
    await requireOrgRole(user.id, project.orgId, 'viewer');

    const limitRaw = Number(new URL(req.url).searchParams.get('limit') || '50');
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitRaw) ? limitRaw : 50));

    const rows = await db
      .select({
        id: auditLog.id,
        userId: auditLog.userId,
        resourceId: auditLog.resourceId,
        createdAt: auditLog.createdAt,
        metadata: auditLog.metadata,
      })
      .from(auditLog)
      .where(and(
        eq(auditLog.action, 'project.evidence_append'),
        eq(auditLog.resourceType, 'project'),
        eq(auditLog.resourceId, project.id),
      ))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    return NextResponse.json({
      success: true,
      data: {
        items: rows.map((row) => ({
          id: row.id,
          userId: row.userId,
          createdAt: row.createdAt,
          evidence: (row.metadata as Record<string, unknown>)?.evidence || null,
        })),
        meta: { total: rows.length, limit },
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[evidence-ledger:list]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, params.id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', params.id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const body = await req.json();
    const parsed = evidenceSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        Errors.validation(issue.path.join('.') || 'body', issue.message, issue.message).toResponse('ro'),
        { status: 400 },
      );
    }

    const eventId = crypto.randomUUID();
    await logAudit({
      userId: user.id,
      action: 'project.evidence_append',
      resourceType: 'project',
      resourceId: project.id,
      metadata: {
        eventId,
        evidence: parsed.data,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        eventId,
        projectId: project.id,
        appendedAt: new Date().toISOString(),
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[evidence-ledger:append]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

