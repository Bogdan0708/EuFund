import { db, withUserRLS } from '@/lib/db';
import type { Database } from '@/lib/db';
import { workPackages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { CreateWorkPackageInput, UpdateWorkPackageInput } from '@/types/work-packages';

type RLSExecutor = Parameters<Parameters<Database['transaction']>[0]>[0];

async function runWithContext<T>(userId: string | undefined, fn: (executor: RLSExecutor) => Promise<T>): Promise<T> {
  if (userId) return withUserRLS(userId, fn);
  return fn(db as unknown as RLSExecutor);
}

export async function listWorkPackages(projectId: string, userId?: string) {
  return runWithContext(userId, async (executor) => {
    return executor.query.workPackages.findMany({
      where: eq(workPackages.projectId, projectId),
      with: { timelineItems: true, leadPartner: true },
      orderBy: (wp, { asc }) => [asc(wp.startDate)],
    });
  });
}

export async function getWorkPackage(projectId: string, wpId: string, userId?: string) {
  return runWithContext(userId, async (executor) => {
    return executor.query.workPackages.findFirst({
      where: and(eq(workPackages.id, wpId), eq(workPackages.projectId, projectId)),
      with: { timelineItems: true, leadPartner: true },
    });
  });
}

export async function createWorkPackage(projectId: string, input: CreateWorkPackageInput, userId?: string) {
  return runWithContext(userId, async (executor) => {
    const [wp] = await executor.insert(workPackages).values({
      projectId,
      name: input.name,
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
      budgetAllocated: input.budgetAllocated?.toString(),
      status: input.status || 'planned',
      leadPartnerId: input.leadPartnerId,
      dependencies: input.dependencies || [],
      milestones: input.milestones || [],
      deliverables: input.deliverables || [],
    }).returning();
    return wp;
  });
}

export async function updateWorkPackage(projectId: string, wpId: string, input: UpdateWorkPackageInput, userId?: string) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values.description = input.description;
  if (input.startDate !== undefined) values.startDate = input.startDate;
  if (input.endDate !== undefined) values.endDate = input.endDate;
  if (input.budgetAllocated !== undefined) values.budgetAllocated = input.budgetAllocated.toString();
  if (input.budgetSpent !== undefined) values.budgetSpent = input.budgetSpent.toString();
  if (input.status !== undefined) values.status = input.status;
  if (input.leadPartnerId !== undefined) values.leadPartnerId = input.leadPartnerId;
  if (input.dependencies !== undefined) values.dependencies = input.dependencies;
  if (input.milestones !== undefined) values.milestones = input.milestones;
  if (input.deliverables !== undefined) values.deliverables = input.deliverables;

  return runWithContext(userId, async (executor) => {
    const [wp] = await executor.update(workPackages)
      .set(values)
      .where(and(eq(workPackages.id, wpId), eq(workPackages.projectId, projectId)))
      .returning();
    return wp;
  });
}

export async function deleteWorkPackage(projectId: string, wpId: string, userId?: string) {
  // Timeline items cascade via FK
  return runWithContext(userId, async (executor) => {
    const [wp] = await executor.delete(workPackages)
      .where(and(eq(workPackages.id, wpId), eq(workPackages.projectId, projectId)))
      .returning();
    return wp;
  });
}
