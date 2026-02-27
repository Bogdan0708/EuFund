import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { withUserRLS } from '@/lib/db';
import { callsForProposals, complianceReports, organizations, projects, workPackages } from '@/lib/db/schema';
import { Errors, FondEUError } from '@/lib/errors';
import { requireAuth, requireOrgRole } from '@/lib/auth/helpers';
import { logger } from '@/lib/logger';
import { logAudit } from '@/lib/legal/audit';
import { mapProjectToMySMIS, serializeMySMISPayloadToXml } from '@/lib/integrations/romanian/mysmis-mapper';
import { validateMySMISPayload } from '@/lib/integrations/romanian/mysmis-contract';

const log = logger.child({ component: 'project-mysmis-export-api' });

type Params = { params: { id: string } };

function normalizeAddress(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === 'string') return address;
  if (typeof address !== 'object') return null;

  const parts = ['street', 'city', 'county', 'postalCode']
    .map((key) => (address as Record<string, unknown>)[key])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  return parts.length > 0 ? parts.join(', ') : JSON.stringify(address);
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const user = await requireAuth();
    const { id } = params;

    const project = await withUserRLS(user.id, async (tx) => {
      return tx.query.projects.findFirst({
        where: and(eq(projects.id, id), isNull(projects.deletedAt)),
      });
    });
    if (!project) throw Errors.notFound('project', id);

    await requireOrgRole(user.id, project.orgId, 'project_manager');

    const [organization, call, packages, latestComplianceReport] = await withUserRLS(user.id, async (tx) => {
      return Promise.all([
        tx.query.organizations.findFirst({ where: eq(organizations.id, project.orgId) }),
        project.callId
          ? tx.query.callsForProposals.findFirst({ where: eq(callsForProposals.id, project.callId) })
          : Promise.resolve(null),
        tx.query.workPackages.findMany({ where: eq(workPackages.projectId, project.id) }),
        tx.query.complianceReports.findFirst({
          where: eq(complianceReports.projectId, project.id),
          orderBy: desc(complianceReports.createdAt),
        }),
      ]);
    });

    const reportItems = (latestComplianceReport?.items || {}) as {
      aiResults?: Array<{ area?: string; status?: string }>;
      dnshAssessment?: { status?: 'pass' | 'warning' | 'fail'; score?: number };
      evaluatedAt?: string;
      overallScore?: number;
    };

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
        address: normalizeAddress(organization?.address),
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
      compliance: {
        overallScore: latestComplianceReport?.overallScore ? Number(latestComplianceReport.overallScore) : Number(project.complianceScore || reportItems.overallScore || 0) || null,
        evaluatedAt: reportItems.evaluatedAt || latestComplianceReport?.createdAt?.toISOString() || null,
        dnshStatus: reportItems.dnshAssessment?.status || null,
        dnshScore: reportItems.dnshAssessment?.score || null,
        highRiskFindings: (reportItems.aiResults || [])
          .filter((item) => item.status === 'fail')
          .slice(0, 5)
          .map((item) => item.area || 'constatare'),
      },
    });

    const contractValidation = validateMySMISPayload(mapped.payload);
    const strict = new URL(req.url).searchParams.get('strict') === 'true';
    const ready = mapped.ready && contractValidation.valid;
    const contractWarnings = contractValidation.warnings.filter((warning) => !mapped.warnings.includes(warning));

    if (strict && !contractValidation.valid) {
      return NextResponse.json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payload MySMIS invalid',
          details: {
            schemaVersion: 'mysmis-2021-plus-v1',
            contractErrors: contractValidation.errors,
          },
        },
      }, { status: 422 });
    }

    await logAudit({
      userId: user.id,
      action: 'project.export',
      resourceType: 'project',
      resourceId: id,
      metadata: {
        ready,
        missingRequiredCount: mapped.missingRequired.length,
        warningCount: mapped.warnings.length + contractWarnings.length,
        contractValid: contractValidation.valid,
        contractErrorCount: contractValidation.errors.length,
        format: new URL(req.url).searchParams.get('format') || 'json',
      },
    });

    const format = new URL(req.url).searchParams.get('format');
    if (format === 'xml') {
      const xml = serializeMySMISPayloadToXml(mapped.payload);
      return new NextResponse(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Content-Disposition': `attachment; filename=\"mysmis-export-${id}.xml\"`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        projectId: id,
        ready,
        missingRequired: mapped.missingRequired,
        warnings: [...mapped.warnings, ...contractWarnings],
        contractValidation: {
          valid: contractValidation.valid,
          errors: contractValidation.errors,
          warnings: contractValidation.warnings,
        },
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
