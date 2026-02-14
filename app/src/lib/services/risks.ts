import { db } from '@/lib/db';
import { riskAssessments } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { CreateRiskInput, UpdateRiskInput, RiskOverview } from '@/types/risks';

export async function listRisks(projectId: string) {
  const risks = await db.query.riskAssessments.findMany({
    where: eq(riskAssessments.projectId, projectId),
    orderBy: (r, { desc }) => [desc(r.createdAt)],
  });
  return risks.map(r => ({
    ...r,
    riskScore: (r.probability || 0) * (r.impact || 0),
  }));
}

export async function createRisk(projectId: string, input: CreateRiskInput) {
  const [risk] = await db.insert(riskAssessments).values({
    projectId,
    riskType: input.riskType,
    description: input.description,
    probability: input.probability,
    impact: input.impact,
    mitigationStrategy: input.mitigationStrategy,
    status: input.status || 'identified',
  }).returning();
  return { ...risk, riskScore: (risk.probability || 0) * (risk.impact || 0) };
}

export async function updateRisk(projectId: string, riskId: string, input: UpdateRiskInput) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.riskType !== undefined) values.riskType = input.riskType;
  if (input.description !== undefined) values.description = input.description;
  if (input.probability !== undefined) values.probability = input.probability;
  if (input.impact !== undefined) values.impact = input.impact;
  if (input.mitigationStrategy !== undefined) values.mitigationStrategy = input.mitigationStrategy;
  if (input.status !== undefined) values.status = input.status;

  const [risk] = await db.update(riskAssessments)
    .set(values)
    .where(and(eq(riskAssessments.id, riskId), eq(riskAssessments.projectId, projectId)))
    .returning();
  return risk ? { ...risk, riskScore: (risk.probability || 0) * (risk.impact || 0) } : null;
}

export async function getRiskOverview(projectId: string): Promise<RiskOverview> {
  const risks = await listRisks(projectId);
  const risksByType: Record<string, number> = {};
  const risksByStatus: Record<string, number> = {};
  let highRisks = 0;
  let totalScore = 0;

  for (const r of risks) {
    risksByType[r.riskType] = (risksByType[r.riskType] || 0) + 1;
    risksByStatus[r.status || 'identified'] = (risksByStatus[r.status || 'identified'] || 0) + 1;
    if (r.riskScore >= 15) highRisks++;
    totalScore += r.riskScore;
  }

  return {
    totalRisks: risks.length,
    highRisks,
    averageRiskScore: risks.length > 0 ? Math.round((totalScore / risks.length) * 10) / 10 : 0,
    risksByType,
    risksByStatus,
  };
}
