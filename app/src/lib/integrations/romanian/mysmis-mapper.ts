export interface MySMISExportInput {
  project: {
    id: string;
    title: string;
    acronym?: string | null;
    status?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    durationMonths?: number | null;
    totalBudget?: number | null;
    euContribution?: number | null;
    ownContrib?: number | null;
    sectionSummary?: string | null;
    sectionObjectives?: unknown;
    sectionMethodology?: unknown;
    sectionSustainability?: string | null;
  };
  organization: {
    name?: string | null;
    cui?: string | null;
    regCom?: string | null;
    orgType?: string | null;
    address?: string | null;
    nutsRegion?: string | null;
  };
  call?: {
    callCode?: string | null;
    titleRo?: string | null;
    submissionEnd?: string | null;
    guideUrl?: string | null;
  } | null;
  workPackages: Array<{
    id: string;
    name: string;
    description?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    budgetAllocated?: number | null;
    status?: string | null;
    milestones?: unknown;
    deliverables?: unknown;
  }>;
}

export interface MySMISExportResult {
  ready: boolean;
  missingRequired: string[];
  warnings: string[];
  payload: Record<string, unknown>;
}

function ensureStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeStatus(status?: string | null): 'draft' | 'submitted' | 'evaluation' | 'contracted' | 'implementation' | 'closed' {
  if (status === 'depus') return 'submitted';
  if (status === 'verificare') return 'evaluation';
  if (status === 'aprobat') return 'contracted';
  if (status === 'in_lucru') return 'implementation';
  if (status === 'finalizat') return 'closed';
  return 'draft';
}

export function mapProjectToMySMIS(input: MySMISExportInput): MySMISExportResult {
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  if (!input.project.title?.trim()) missingRequired.push('Titlu proiect');
  if (!input.organization.name?.trim()) missingRequired.push('Nume organizație');
  if (!input.organization.cui?.trim()) missingRequired.push('CUI organizație');
  if (!input.project.totalBudget || input.project.totalBudget <= 0) missingRequired.push('Buget total proiect');
  if (!input.project.sectionSummary?.trim()) missingRequired.push('Rezumat proiect');

  if (!input.project.startDate || !input.project.endDate) {
    warnings.push('Datele de început/final nu sunt complete; MySMIS poate solicita perioada exactă.');
  }
  if (!input.call?.callCode) {
    warnings.push('Proiectul nu este asociat încă unui cod de apel MySMIS.');
  }
  if (input.workPackages.length === 0) {
    warnings.push('Nu există pachete de lucru definite.');
  }

  const objectives = ensureStringArray(input.project.sectionObjectives);
  const methodology = ensureStringArray(input.project.sectionMethodology);

  const payload: Record<string, unknown> = {
    schemaVersion: 'mysmis-2021-plus-v1',
    generatedAt: new Date().toISOString(),
    project: {
      localProjectId: input.project.id,
      title: input.project.title,
      acronym: input.project.acronym || null,
      status: normalizeStatus(input.project.status),
      summary: input.project.sectionSummary || '',
      sustainability: input.project.sectionSustainability || '',
      timeline: {
        startDate: input.project.startDate || null,
        endDate: input.project.endDate || null,
        durationMonths: input.project.durationMonths || null,
      },
      financials: {
        totalBudget: input.project.totalBudget || 0,
        euContribution: input.project.euContribution || 0,
        ownContribution: input.project.ownContrib || 0,
      },
      objectives,
      methodology,
    },
    applicant: {
      name: input.organization.name || '',
      cui: input.organization.cui || '',
      regCom: input.organization.regCom || null,
      legalType: input.organization.orgType || null,
      address: input.organization.address || null,
      nutsRegion: input.organization.nutsRegion || null,
    },
    call: {
      callCode: input.call?.callCode || null,
      title: input.call?.titleRo || null,
      deadline: input.call?.submissionEnd || null,
      guideUrl: input.call?.guideUrl || null,
    },
    workPackages: input.workPackages.map((wp) => ({
      localWorkPackageId: wp.id,
      name: wp.name,
      description: wp.description || '',
      startDate: wp.startDate || null,
      endDate: wp.endDate || null,
      budgetAllocated: wp.budgetAllocated || 0,
      status: wp.status || 'planned',
      milestones: Array.isArray(wp.milestones) ? wp.milestones : [],
      deliverables: Array.isArray(wp.deliverables) ? wp.deliverables : [],
    })),
  };

  return {
    ready: missingRequired.length === 0,
    missingRequired,
    warnings,
    payload,
  };
}
