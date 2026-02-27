import { z } from 'zod';

const isoDateString = z.string().datetime({ offset: true });

const mysmisPayloadSchema = z.object({
  schemaVersion: z.literal('mysmis-2021-plus-v1'),
  generatedAt: isoDateString,
  project: z.object({
    localProjectId: z.string().uuid(),
    title: z.string().min(5).max(1000),
    acronym: z.string().max(50).nullable().optional(),
    status: z.enum(['draft', 'submitted', 'evaluation', 'contracted', 'implementation', 'closed']),
    summary: z.string().min(20).max(20000),
    sustainability: z.string().max(10000).optional().nullable(),
    timeline: z.object({
      startDate: isoDateString.nullable().optional(),
      endDate: isoDateString.nullable().optional(),
      durationMonths: z.number().int().positive().max(120).nullable().optional(),
    }),
    financials: z.object({
      totalBudget: z.number().positive(),
      euContribution: z.number().nonnegative(),
      ownContribution: z.number().nonnegative(),
    }),
    objectives: z.array(z.string().min(3).max(4000)).max(50),
    methodology: z.array(z.string().min(3).max(4000)).max(100),
  }),
  applicant: z.object({
    name: z.string().min(2).max(500),
    cui: z.string().min(2).max(20),
    regCom: z.string().max(30).nullable().optional(),
    legalType: z.string().max(50).nullable().optional(),
    address: z.string().max(1000).nullable().optional(),
    nutsRegion: z.string().max(10).nullable().optional(),
  }),
  call: z.object({
    callCode: z.string().max(100).nullable().optional(),
    title: z.string().max(1000).nullable().optional(),
    deadline: isoDateString.nullable().optional(),
    guideUrl: z.string().url().nullable().optional(),
  }),
  compliance: z.object({
    overallScore: z.number().min(0).max(100).nullable().optional(),
    evaluatedAt: isoDateString.nullable().optional(),
    dnshStatus: z.enum(['pass', 'warning', 'fail']).nullable().optional(),
    dnshScore: z.number().min(0).max(100).nullable().optional(),
    highRiskFindings: z.array(z.string().min(2).max(2000)).max(100),
  }),
  workPackages: z.array(z.object({
    localWorkPackageId: z.string().uuid(),
    name: z.string().min(3).max(500),
    description: z.string().max(10000).optional(),
    startDate: isoDateString.nullable().optional(),
    endDate: isoDateString.nullable().optional(),
    budgetAllocated: z.number().nonnegative(),
    status: z.string().max(50),
    milestones: z.array(z.unknown()).max(200),
    deliverables: z.array(z.unknown()).max(200),
  })).max(200),
});

export type MySMISPayload = z.infer<typeof mysmisPayloadSchema>;

export interface MySMISContractValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateMySMISPayload(payload: Record<string, unknown>): MySMISContractValidationResult {
  const parsed = mysmisPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'payload';
      return `${path}: ${issue.message}`;
    });
    return { valid: false, errors, warnings: [] };
  }

  const data = parsed.data;
  const warnings: string[] = [];

  if (!data.call.callCode) warnings.push('Cod apel MySMIS lipsă (call.callCode).');
  if (!data.call.deadline) warnings.push('Deadline apel lipsă (call.deadline).');
  if (!data.project.timeline.startDate || !data.project.timeline.endDate) {
    warnings.push('Perioada proiectului incompletă (project.timeline.startDate/endDate).');
  }
  if (data.project.objectives.length === 0) {
    warnings.push('Nu există obiective mapate în payload (project.objectives).');
  }
  if (data.project.methodology.length === 0) {
    warnings.push('Nu există pași metodologici mapați (project.methodology).');
  }
  if (data.workPackages.length === 0) {
    warnings.push('Nu există pachete de lucru pentru export.');
  }
  if (data.compliance.overallScore == null) {
    warnings.push('Snapshot de conformitate fără overallScore.');
  }
  if (data.compliance.dnshStatus == null) {
    warnings.push('Snapshot DNSH lipsă (compliance.dnshStatus).');
  }

  return { valid: true, errors: [], warnings };
}

