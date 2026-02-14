import { db } from '@/lib/db';
import { complianceChecks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { CreateComplianceCheckInput, UpdateComplianceCheckInput, ComplianceOverview } from '@/types/compliance';

export async function listComplianceChecks(projectId: string) {
  return db.query.complianceChecks.findMany({
    where: eq(complianceChecks.projectId, projectId),
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });
}

export async function createComplianceCheck(projectId: string, input: CreateComplianceCheckInput) {
  const [check] = await db.insert(complianceChecks).values({
    projectId,
    criterionName: input.criterionName,
    requirementText: input.requirementText,
    complianceScore: input.complianceScore,
    status: input.status || 'pending',
    evidenceDocuments: input.evidenceDocuments || [],
    assessorNotes: input.assessorNotes,
  }).returning();
  return check;
}

export async function updateComplianceCheck(projectId: string, checkId: string, input: UpdateComplianceCheckInput) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.complianceScore !== undefined) values.complianceScore = input.complianceScore;
  if (input.status !== undefined) values.status = input.status;
  if (input.evidenceDocuments !== undefined) values.evidenceDocuments = input.evidenceDocuments;
  if (input.assessorNotes !== undefined) values.assessorNotes = input.assessorNotes;
  if (input.status === 'compliant' || input.status === 'non_compliant') values.assessedAt = new Date();

  const [check] = await db.update(complianceChecks)
    .set(values)
    .where(and(eq(complianceChecks.id, checkId), eq(complianceChecks.projectId, projectId)))
    .returning();
  return check;
}

export async function getComplianceOverview(projectId: string): Promise<ComplianceOverview> {
  const checks = await listComplianceChecks(projectId);
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
