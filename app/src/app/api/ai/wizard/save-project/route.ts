import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { projects, projectVersions, workPackages } from '@/lib/db/schema';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { wizardSaveProjectSchema } from '@/lib/validation/schemas';
import { Errors, FondEUError } from '@/lib/errors';
import { logAudit } from '@/lib/legal/audit';
import { logger } from '@/lib/logger';
import { ProposalOutput } from '@/lib/ai/proposal-generator';

const log = logger.child({ component: 'wizard-save-project' });

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await req.json();
    const parsed = wizardSaveProjectSchema.safeParse(body);
    
    if (!parsed.success) {
      throw Errors.validation('body', 'Date invalide', 'Invalid input');
    }

    const { callId, orgId, proposal: p } = parsed.data;
    const proposal = p as ProposalOutput;

    // 1. Strict multi-tenant authorization
    await requireOrgRole(user.id, orgId, 'project_manager');

    // 2. Persist project in transaction
    const createdProject = await db.transaction(async (tx) => {
      // Create project
      const [project] = await tx.insert(projects).values({
        orgId,
        callId,
        createdBy: user.id,
        title: proposal.title,
        status: 'ciorna',
        sectionSummary: proposal.summary,
        sectionObjectives: proposal.objectives,
        sectionMethodology: proposal.methodology,
        sectionBudget: proposal.budget,
        sectionIndicators: proposal.indicators,
        sectionRisks: proposal.risks,
        sectionSustainability: proposal.sustainability,
        currentVersion: 1,
      }).returning();

      // Create initial work packages if methodology includes them
      if (Array.isArray(proposal.methodology?.workPackages)) {
        for (const wp of proposal.methodology.workPackages) {
          await tx.insert(workPackages).values({
            projectId: project.id,
            name: wp.name,
            description: wp.description,
            budgetAllocated: null,
            status: 'planned',
          });
        }
      }

      // Create initial version snapshot
      await tx.insert(projectVersions).values({
        projectId: project.id,
        versionNumber: 1,
        snapshot: proposal as unknown as Record<string, unknown>,
        changedBy: user.id,
        changeSummary: 'Initial generation via AI Wizard',
      });

      return project;
    });

    await logAudit({
      userId: user.id,
      action: 'project.create',
      resourceType: 'project',
      resourceId: createdProject.id,
      metadata: { method: 'ai_wizard', callId },
    });

    return NextResponse.json({
      success: true,
      data: createdProject,
    });

  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse(), { status: error.statusCode });
    }
    log.error({ error }, '[wizard:save] error');
    return NextResponse.json(Errors.internal().toResponse(), { status: 500 });
  }
}
