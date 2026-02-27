import { db, withUserRLS } from '@/lib/db';
import type { Database } from '@/lib/db';
import { projectTimelines, workPackages } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import type { CreateTimelineInput, GanttData } from '@/types/timeline';

type RLSExecutor = Parameters<Parameters<Database['transaction']>[0]>[0];

async function runWithContext<T>(userId: string | undefined, fn: (executor: RLSExecutor) => Promise<T>): Promise<T> {
  if (userId) return withUserRLS(userId, fn);
  return fn(db as unknown as RLSExecutor);
}

export async function getProjectTimeline(projectId: string, userId?: string): Promise<GanttData> {
  const wps = await runWithContext(userId, async (executor) => {
    return executor.query.workPackages.findMany({
      where: eq(workPackages.projectId, projectId),
      with: { timelineItems: true },
      orderBy: (wp, { asc }) => [asc(wp.startDate)],
    });
  });

  let projectStart = '';
  let projectEnd = '';
  let totalProgress = 0;
  let taskCount = 0;

  const ganttWps = wps.map(wp => {
    const tasks = (wp.timelineItems || []).map(t => {
      taskCount++;
      totalProgress += t.progressPercentage || 0;
      return {
        id: t.id,
        projectId: t.projectId,
        workPackageId: t.workPackageId,
        taskName: t.taskName,
        startDate: t.startDate,
        endDate: t.endDate,
        dependencies: (t.dependencies as string[]) || [],
        progressPercentage: t.progressPercentage || 0,
        assignedTo: t.assignedTo,
        riskLevel: t.riskLevel || 'low',
        createdAt: t.createdAt?.toISOString() || '',
        updatedAt: t.updatedAt?.toISOString() || '',
      };
    });

    if (wp.startDate && (!projectStart || wp.startDate < projectStart)) projectStart = wp.startDate;
    if (wp.endDate && (!projectEnd || wp.endDate > projectEnd)) projectEnd = wp.endDate;

    return {
      id: wp.id,
      name: wp.name,
      startDate: wp.startDate || '',
      endDate: wp.endDate || '',
      status: wp.status || 'planned',
      tasks,
    };
  });

  return {
    workPackages: ganttWps,
    projectStartDate: projectStart,
    projectEndDate: projectEnd,
    totalProgress: taskCount > 0 ? Math.round(totalProgress / taskCount) : 0,
  };
}

export async function createTimelineItem(projectId: string, input: CreateTimelineInput, userId?: string) {
  return runWithContext(userId, async (executor) => {
    const [item] = await executor.insert(projectTimelines).values({
      projectId,
      workPackageId: input.workPackageId,
      taskName: input.taskName,
      startDate: input.startDate,
      endDate: input.endDate,
      dependencies: input.dependencies || [],
      progressPercentage: input.progressPercentage || 0,
      assignedTo: input.assignedTo,
      riskLevel: input.riskLevel || 'low',
    }).returning();
    return item;
  });
}

export async function updateTimelineItem(
  projectId: string,
  itemId: string,
  updates: Partial<CreateTimelineInput>,
  userId?: string,
) {
  const updateData: Record<string, unknown> = {};
  if (updates.taskName !== undefined) updateData.taskName = updates.taskName;
  if (updates.startDate !== undefined) updateData.startDate = updates.startDate;
  if (updates.endDate !== undefined) updateData.endDate = updates.endDate;
  if (updates.dependencies !== undefined) updateData.dependencies = updates.dependencies;
  if (updates.progressPercentage !== undefined) updateData.progressPercentage = updates.progressPercentage;
  if (updates.assignedTo !== undefined) updateData.assignedTo = updates.assignedTo;
  if (updates.riskLevel !== undefined) updateData.riskLevel = updates.riskLevel;
  if (updates.workPackageId !== undefined) updateData.workPackageId = updates.workPackageId;
  updateData.updatedAt = new Date();

  return runWithContext(userId, async (executor) => {
    const [item] = await executor.update(projectTimelines)
      .set(updateData)
      .where(and(
        eq(projectTimelines.id, itemId),
        eq(projectTimelines.projectId, projectId)
      ))
      .returning();
    return item;
  });
}

export async function deleteTimelineItem(projectId: string, itemId: string, userId?: string) {
  await runWithContext(userId, async (executor) => {
    await executor.delete(projectTimelines)
      .where(and(
        eq(projectTimelines.id, itemId),
        eq(projectTimelines.projectId, projectId)
      ));
  });
}

export async function updateTimelineProgress(
  projectId: string,
  itemId: string,
  progressPercentage: number,
  userId?: string,
) {
  return runWithContext(userId, async (executor) => {
    const [item] = await executor.update(projectTimelines)
      .set({ progressPercentage, updatedAt: new Date() })
      .where(and(
        eq(projectTimelines.id, itemId),
        eq(projectTimelines.projectId, projectId)
      ))
      .returning();
    return item;
  });
}
