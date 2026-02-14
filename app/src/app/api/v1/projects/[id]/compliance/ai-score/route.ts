import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, complianceChecks } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { analyzeCompliance, type ComplianceCheckInput } from '@/lib/ai/compliance-engine';
import { listComplianceChecks } from '@/lib/services/compliance';
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

    const body = await req.json();
    const programId = body.programId || 'general';

    const existingChecks = await listComplianceChecks(id);

    // Look up organization
    const { organizations } = await import('@/lib/db/schema');
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, project.orgId),
    });

    // Build compliance input
    const complianceInput: ComplianceCheckInput = {
      project: {
        title: project.title,
        summary: project.sectionSummary || '',
        objectives: (project.sectionObjectives as string[]) || [],
        budget: Number(project.totalBudget) || 0,
        ownContribution: Number(project.ownContrib) || 0,
        durationMonths: project.durationMonths || 12,
      },
      organization: {
        type: org?.orgType || 'sme',
        country: 'RO',
        region: org?.nutsRegion || undefined,
      },
      program: programId as ComplianceCheckInput['program'],
      locale: 'ro',
    };

    // Run AI compliance analysis
    const analysis = await analyzeCompliance(complianceInput);

    // Store compliance checks in database
    const storedChecks = [];
    for (const [criterionName, criterion] of Object.entries(analysis.criteriaScores)) {
      const [check] = await db.insert(complianceChecks).values({
        projectId: id,
        criterionName,
        requirementText: criterion.gaps.join('; ') || null,
        complianceScore: Math.round(criterion.score),
        status: criterion.status === 'compliant' ? 'passed' : criterion.status === 'partial' ? 'warning' : 'failed',
        assessorNotes: criterion.recommendations.join('; ') || null,
        assessedAt: new Date(),
      }).returning();
      storedChecks.push(check);
    }

    // Update project compliance score
    await db.update(projects).set({
      complianceScore: String(analysis.overallScore),
      lastComplianceCheck: new Date(),
    }).where(eq(projects.id, id));

    return NextResponse.json({
      success: true,
      data: {
        analysis,
        storedChecks: storedChecks.length,
        previousChecksCount: existingChecks.length,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    console.error('[compliance:ai-score]', error);
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
