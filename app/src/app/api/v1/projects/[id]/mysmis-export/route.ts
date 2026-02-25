import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { callsForProposals, organizations, projects, workPackages } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/legal/audit';
import { mapProjectToMySMIS } from '@/lib/integrations/romanian/mysmis-mapper';

const log = logger.child({ component: 'project-mysmis-export-api' });

type Params = { params: { id: string } };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await db.query.projects.findFirst({
      where: and(eq(projects.id, id), isNull(projects.deletedAt)),
    });
    if (!project) throw Errors.notFound('project', id);

    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const [organization, call, packages] = await Promise.all([
      db.query.organizations.findFirst({ where: eq(organizations.id, project.orgId) }),
      project.callId
        ? db.query.callsForProposals.findFirst({ where: eq(callsForProposals.id, project.callId) })
        : Promise.resolve(null),
      db.query.workPackages.findMany({ where: eq(workPackages.projectId, project.id) }),
    ]);

    const mapped = mapProjectToMySMIS({
      project: {
        id: project.id,
        title: project.title,
        acronym: project.acronym,
        status: project.status,
        startDate: project.startDate ? new Date(project.startDate).toISOString() : null,
        endDate: project.endDate ? new Date(project.endDate).toISOString() : null,
        durationMonths: project.durationMonths,
        totalBudget: project.totalBudget ? Number(project.totalBudget) : null,
        euContribution: project.euContribution ? Number(project.euContribution) : null,
        ownContrib: project.ownContrib ? Number(project.ownContrib) : null,
        sectionSummary: project.sectionSummary,
        sectionObjectives: project.sectionObjectives,
        sectionMethodology: project.sectionMethodology,
        sectionSustainability: project.sectionSustainability,
      },
      organization: {
        name: organization?.name,
        cui: organization?.cui,
        regCom: organization?.regCom,
        orgType: organization?.orgType,
        address: organization?.address,
        nutsRegion: organization?.nutsRegion,
      },
      call: call
        ? {
          callCode: call.callCode,
          titleRo: call.titleRo,
          submissionEnd: call.submissionEnd ? new Date(call.submissionEnd).toISOString() : null,
          guideUrl: call.guideUrl,
        }
        : null,
      workPackages: packages.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        startDate: item.startDate ? new Date(item.startDate).toISOString() : null,
        endDate: item.endDate ? new Date(item.endDate).toISOString() : null,
        budgetAllocated: item.budgetAllocated ? Number(item.budgetAllocated) : null,
        status: item.status,
        milestones: item.milestones,
        deliverables: item.deliverables,
      })),
    });

    await logAudit({
      userId: user.id,
      action: 'project.mysmis_export_prepare',
      resourceType: 'project',
      resourceId: id,
      metadata: {
        ready: mapped.ready,
        missingRequiredCount: mapped.missingRequired.length,
        warningCount: mapped.warnings.length,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        projectId: id,
        ready: mapped.ready,
        missingRequired: mapped.missingRequired,
        warnings: mapped.warnings,
        payload: mapped.payload,
      },
    });
  } catch (error) {
    if (error instanceof FondEUError) {
      return NextResponse.json(error.toResponse('ro'), { status: error.statusCode });
    }
    log.error({ error }, '[projects:mysmis-export]');
    return NextResponse.json(Errors.internal().toResponse('ro'), { status: 500 });
  }
}
