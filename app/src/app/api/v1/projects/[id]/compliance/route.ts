// ─── Project Compliance Check API ────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, organizations, complianceReports, callsForProposals } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { validateCompliance } from '@/lib/ai/compliance-validator';
import { logAudit } from '@/lib/legal/audit';
import { listComplianceChecks, createComplianceCheck, getComplianceOverview } from '@/lib/services/compliance';
import { eq, and, isNull } from 'drizzle-orm';
import { logger } from '@/lib/logger';

const log = logger.child({ component: 'compliance-api' });

type Params = { params: { id: string } };

// GET: List compliance checks with overview
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'viewer');

    const [checks, overview] = await Promise.all([
      listComplianceChecks(id),
      getComplianceOverview(id),
    ]);

    return NextResponse.json({
      success: true,
      data: { checks, overview, lastAiScore: project.complianceScore },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[compliance:list]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}

// POST: Run AI compliance validation (existing) or create manual check
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);

    await requireOrgRole(user.id, project.orgId, 'project_manager');

    // Fetch organization and call data
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, project.orgId),
    });

    let call = null;
    if (project.callId) {
      call = await db.query.callsForProposals.findFirst({
        where: eq(callsForProposals.id, project.callId),
      });
    }

    const result = await validateCompliance({
      project: {
        title: project.title,
        summary: project.sectionSummary || undefined,
        objectives: typeof project.sectionObjectives === 'string'
          ? project.sectionObjectives
          : JSON.stringify(project.sectionObjectives),
        methodology: typeof project.sectionMethodology === 'string'
          ? project.sectionMethodology
          : JSON.stringify(project.sectionMethodology),
        budget: project.totalBudget ? Number(project.totalBudget) : undefined,
        ownContrib: project.ownContrib ? Number(project.ownContrib) : undefined,
        durationMonths: project.durationMonths || undefined,
      },
      organization: {
        orgType: org?.orgType || 'srl',
        orgSize: org?.orgSize || undefined,
        caenPrimary: org?.caenPrimary || undefined,
        caenSecondary: org?.caenSecondary || undefined,
        nutsRegion: org?.nutsRegion || undefined,
        employeeCount: org?.employeeCount || undefined,
        annualRevenue: org?.annualRevenue ? Number(org.annualRevenue) : undefined,
      },
      call: call ? {
        eligibleTypes: call.eligibleTypes || undefined,
        eligibleRegions: call.eligibleRegions || undefined,
        eligibleCaen: call.eligibleCaen || undefined,
        budgetMin: call.budgetMin ? Number(call.budgetMin) : undefined,
        budgetMax: call.budgetMax ? Number(call.budgetMax) : undefined,
        cofinancingRate: call.cofinancingRate ? Number(call.cofinancingRate) : undefined,
        durationMin: call.durationMin || undefined,
        durationMax: call.durationMax || undefined,
        submissionEnd: call.submissionEnd?.toISOString() || undefined,
      } : undefined,
    });

    // Save compliance report
    const [report] = await db.insert(complianceReports).values({
      projectId: id,
      generatedBy: user.id,
      overallScore: result.overallScore,
      items: result,
      modelUsed: 'gpt-4o',
      tokensUsed: result.tokensUsed,
    }).returning();

    // Update project compliance score
    await db
      .update(projects)
      .set({
        complianceScore: result.overallScore,
        lastComplianceCheck: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    await logAudit({
      userId: user.id,
      action: 'ai.compliance_check',
      resourceType: 'project',
      resourceId: id,
      metadata: { overallScore: result.overallScore, reportId: report.id },
    });

    return NextResponse.json({
      success: true,
      data: {
        reportId: report.id,
        overallScore: result.overallScore,
        deterministicResults: result.deterministicResults,
        aiResults: result.aiResults,
        recommendations: result.recommendations,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[projects:compliance]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
