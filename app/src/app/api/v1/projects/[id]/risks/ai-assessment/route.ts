import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, riskAssessments } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { assessRisk, type RiskAssessmentInput } from '@/lib/ai/risk-assessment';
import { listRisks } from '@/lib/services/risks';
import { listWorkPackages } from '@/lib/services/work-packages';
import { eq, and, isNull } from 'drizzle-orm';

type Params = { params: { id: string } };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);
    await requireOrgRole(user.id, project.orgId, 'project_manager');

    // Gather context for AI analysis
    const [existingRisks, workPackages] = await Promise.all([
      listRisks(id),
      listWorkPackages(id),
    ]);

    // Calculate elapsed months
    const startDate = project.startDate ? new Date(project.startDate) : new Date();
    const now = new Date();
    const elapsedMonths = Math.max(0, Math.round(
      (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    ));

    // Build AI input from project data
    const riskInput: RiskAssessmentInput = {
      project: {
        title: project.title,
        summary: project.sectionSummary || '',
        programType: 'general',
        totalBudget: Number(project.totalBudget) || 0,
        spentBudget: 0, // Would need financial tracking data
        durationMonths: project.durationMonths || 12,
        elapsedMonths,
        startDate: project.startDate || new Date().toISOString(),
        endDate: project.endDate || new Date().toISOString(),
      },
      workPackages: workPackages.map(wp => ({
        id: wp.id,
        name: wp.name,
        progress: 0,
        budget: Number(wp.budgetAllocated) || 0,
        spent: Number(wp.budgetSpent) || 0,
        plannedStart: wp.startDate || '',
        plannedEnd: wp.endDate || '',
        status: wp.status || 'planned',
        dependencies: [],
        deliverables: [],
      })),
      partners: [],
      locale: 'ro',
    };

    // Run AI risk assessment
    const assessment = await assessRisk(riskInput);

    // Store individual risks in risk_assessments table
    const storedRisks = [];
    for (const entry of assessment.riskMatrix.slice(0, 10)) {
      const [risk] = await db.insert(riskAssessments).values({
        projectId: id,
        riskType: entry.category,
        description: entry.risk,
        probability: entry.probability,
        impact: entry.impact,
        mitigationStrategy: entry.response,
        status: 'identified',
      }).returning();
      storedRisks.push(risk);
    }

    return NextResponse.json({
      success: true,
      data: {
        assessment,
        storedRisks: storedRisks.length,
        existingRisksCount: existingRisks.length,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[risks:ai-assessment]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
