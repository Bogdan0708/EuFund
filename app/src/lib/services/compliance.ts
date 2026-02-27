import { db, withUserRLS } from '@/lib/db';
import type { Database } from '@/lib/db';
import { auditLog, complianceChecks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { CreateComplianceCheckInput, UpdateComplianceCheckInput, ComplianceOverview } from '@/types/compliance';
import type { ComplianceTask } from '@/lib/compliance/ghid-task-generator';

type RLSExecutor = Parameters<Parameters<Database['transaction']>[0]>[0];

async function runWithContext<T>(userId: string | undefined, fn: (executor: RLSExecutor) => Promise<T>): Promise<T> {
  if (userId) return withUserRLS(userId, fn);
  return fn(db as unknown as RLSExecutor);
}

const GHID_TASK_MARKER = '[ghid-task]';

interface GhidTaskMetadata {
  marker: string;
  section: ComplianceTask['section'];
  ownerRole: ComplianceTask['ownerRole'];
  dueInDays: number;
  evidenceType: ComplianceTask['evidenceType'];
  risk: ComplianceTask['risk'];
  sourceRef: ComplianceTask['sourceRef'];
  sourceSnippet: string;
}

function buildGhidMetadata(task: ComplianceTask): string {
  const metadata: GhidTaskMetadata = {
    marker: GHID_TASK_MARKER,
    section: task.section,
    ownerRole: task.ownerRole,
    dueInDays: task.dueInDays,
    evidenceType: task.evidenceType,
    risk: task.risk,
    sourceRef: task.sourceRef,
    sourceSnippet: task.sourceSnippet,
  };
  return JSON.stringify(metadata);
}

function parseGhidMetadata(notes: string | null): GhidTaskMetadata | null {
  if (!notes) return null;
  try {
    const parsed = JSON.parse(notes) as Partial<GhidTaskMetadata>;
    if (parsed.marker !== GHID_TASK_MARKER) return null;
    if (!parsed.section || !parsed.ownerRole || !parsed.evidenceType || !parsed.risk || !parsed.sourceRef) return null;
    return parsed as GhidTaskMetadata;
  } catch {
    return null;
  }
}

export async function listComplianceChecks(projectId: string, userId?: string) {
  return runWithContext(userId, async (executor) => {
    return executor.query.complianceChecks.findMany({
      where: eq(complianceChecks.projectId, projectId),
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });
  });
}

export async function createComplianceCheck(projectId: string, input: CreateComplianceCheckInput, userId?: string) {
  return runWithContext(userId, async (executor) => {
    const [check] = await executor.insert(complianceChecks).values({
      projectId,
      criterionName: input.criterionName,
      requirementText: input.requirementText,
      complianceScore: input.complianceScore,
      status: input.status || 'pending',
      evidenceDocuments: input.evidenceDocuments || [],
      assessorNotes: input.assessorNotes,
    }).returning();
    return check;
  });
}

export async function updateComplianceCheck(projectId: string, checkId: string, input: UpdateComplianceCheckInput, userId?: string) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.complianceScore !== undefined) values.complianceScore = input.complianceScore;
  if (input.status !== undefined) values.status = input.status;
  if (input.evidenceDocuments !== undefined) values.evidenceDocuments = input.evidenceDocuments;
  if (input.assessorNotes !== undefined) values.assessorNotes = input.assessorNotes;
  if (input.status === 'compliant' || input.status === 'non_compliant') values.assessedAt = new Date();

  return runWithContext(userId, async (executor) => {
    const [check] = await executor.update(complianceChecks)
      .set(values)
      .where(and(eq(complianceChecks.id, checkId), eq(complianceChecks.projectId, projectId)))
      .returning();
    return check;
  });
}

export async function getComplianceOverview(projectId: string, userId?: string): Promise<ComplianceOverview> {
  const checks = await listComplianceChecks(projectId, userId);
  const checksByStatus: Record<string, number> = {};
  let totalScore = 0;
  let scoredCount = 0;
  let compliant = 0;
  let pending = 0;
  let nonCompliant = 0;

  for (const c of checks) {
    checksByStatus[c.status || 'pending'] = (checksByStatus[c.status || 'pending'] || 0) + 1;
    if (c.complianceScore != null) { totalScore += c.complianceScore; scoredCount++; }
    if (c.status === 'compliant') compliant++;
    else if (c.status === 'pending') pending++;
    else if (c.status === 'non_compliant') nonCompliant++;
  }

  return {
    totalChecks: checks.length,
    averageScore: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 10) / 10 : 0,
    compliantCount: compliant,
    pendingCount: pending,
    nonCompliantCount: nonCompliant,
    checksByStatus,
  };
}

export async function saveGhidComplianceTasks(projectId: string, tasks: ComplianceTask[], userId?: string) {
  if (tasks.length === 0) return [];

  const existing = await runWithContext(userId, async (executor) => {
    return executor.query.complianceChecks.findMany({
      where: eq(complianceChecks.projectId, projectId),
    });
  });

  const existingRequirementSet = new Set(
    existing
      .filter((check) => parseGhidMetadata(check.assessorNotes || null))
      .map((check) => check.requirementText || ''),
  );

  const toInsert = tasks
    .filter((task) => !existingRequirementSet.has(task.requirement))
    .map((task) => ({
      projectId,
      criterionName: task.title,
      requirementText: task.requirement,
      complianceScore: null as number | null,
      status: 'pending',
      evidenceDocuments: [{ type: task.evidenceType, source: 'ghid' }],
      assessorNotes: buildGhidMetadata(task),
      assessedAt: null as Date | null,
    }));

  if (toInsert.length === 0) return [];
  return runWithContext(userId, async (executor) => {
    return executor.insert(complianceChecks).values(toInsert).returning();
  });
}

export async function listGhidComplianceTasks(projectId: string, userId?: string) {
  const checks = await runWithContext(userId, async (executor) => {
    return executor.query.complianceChecks.findMany({
      where: eq(complianceChecks.projectId, projectId),
      orderBy: (c, { desc }) => [desc(c.createdAt)],
    });
  });

  return checks
    .map((check) => ({ check, metadata: parseGhidMetadata(check.assessorNotes || null) }))
    .filter((entry) => entry.metadata !== null)
    .map((entry) => ({
      id: entry.check.id,
      projectId: entry.check.projectId,
      title: entry.check.criterionName,
      requirement: entry.check.requirementText || '',
      status: entry.check.status || 'pending',
      complianceScore: entry.check.complianceScore,
      evidenceDocuments: entry.check.evidenceDocuments || [],
      createdAt: entry.check.createdAt,
      updatedAt: entry.check.updatedAt,
      metadata: entry.metadata!,
    }));
}

export async function getGhidEvidenceCoverage(projectId: string, userId?: string) {
  const [tasks, ledgerRows] = await Promise.all([
    listGhidComplianceTasks(projectId, userId),
    runWithContext(userId, async (executor) => {
      return executor
        .select({
          id: auditLog.id,
          metadata: auditLog.metadata,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .where(and(
          eq(auditLog.action, 'project.evidence_append'),
          eq(auditLog.resourceType, 'project'),
          eq(auditLog.resourceId, projectId),
        ));
    }),
  ]);

  const evidenceByObligation = new Map<string, Array<{ id: string; createdAt: Date | null; evidenceType?: string }>>();
  for (const row of ledgerRows) {
    const evidence = (row.metadata as Record<string, unknown>)?.evidence as Record<string, unknown> | undefined;
    if (!evidence) continue;
    const obligationId = typeof evidence.obligationId === 'string' ? evidence.obligationId : null;
    if (!obligationId) continue;
    const bucket = evidenceByObligation.get(obligationId) || [];
    bucket.push({
      id: row.id,
      createdAt: row.createdAt,
      evidenceType: typeof evidence.evidenceType === 'string' ? evidence.evidenceType : undefined,
    });
    evidenceByObligation.set(obligationId, bucket);
  }

  const items = tasks.map((task) => {
    const obligationId = task.metadata.sourceRef.clauseId;
    const evidences = evidenceByObligation.get(obligationId) || [];
    return {
      taskId: task.id,
      title: task.title,
      requirement: task.requirement,
      obligationId,
      risk: task.metadata.risk,
      status: task.status,
      evidenceCount: evidences.length,
      covered: evidences.length > 0,
      evidenceEvents: evidences,
    };
  });

  return {
    items,
    meta: {
      total: items.length,
      covered: items.filter((item) => item.covered).length,
      uncovered: items.filter((item) => !item.covered).length,
      highRiskUncovered: items.filter((item) => !item.covered && item.risk === 'high').length,
    },
  };
}
