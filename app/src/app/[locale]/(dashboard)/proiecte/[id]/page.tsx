'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CalendarDays, CheckCircle2, CircleDashed, Clock3, FileCheck2, Shield } from 'lucide-react';
import { csrfFetch } from '@/lib/csrf/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/components/ui/page-header';
import { ErrorState, LoadingState, EmptyState } from '@/components/ui/page-states';
import { StatusBadge } from '@/components/ui/status-badge';
import { GanttChart } from '@/components/project/gantt-chart';
import { WorkPackageDashboard } from '@/components/project/work-package-dashboard';
import { WorkPackageTable } from '@/components/project/work-package-table';
import type { GanttData } from '@/types/timeline';
import type { Milestone, WorkPackage } from '@/types/work-packages';

interface Project {
  id: string;
  title: string;
  acronym?: string;
  status: string;
  description?: string;
  sectionSummary?: string;
  programType?: string;
  organizationName?: string;
  startDate?: string;
  endDate?: string;
  totalBudget?: number;
  euContribution?: number;
  ownContrib?: number;
  updatedAt?: string;
}

function unwrapApiData<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

const lifecycle = ['application', 'contracting', 'implementation', 'reporting', 'closure'] as const;

function lifecycleIndex(status: string) {
  if (status === 'ciorna') return 0;
  if (status === 'in_lucru') return 1;
  if (status === 'verificare' || status === 'depus') return 2;
  if (status === 'aprobat' || status === 'finalizat') return 3;
  return 4;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id?: string; locale?: string }>();
  const router = useRouter();
  const locale = params.locale || 'ro';
  const projectId = params.id || '';

  const [project, setProject] = useState<Project | null>(null);
  const [workPackages, setWorkPackages] = useState<WorkPackage[]>([]);
  const [ganttData, setGanttData] = useState<GanttData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProject = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [projectRes, wpRes, timelineRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}`),
        fetch(`/api/v1/projects/${projectId}/work-packages`),
        fetch(`/api/v1/projects/${projectId}/timeline`),
      ]);

      if (!projectRes.ok) throw new Error('Project could not be loaded.');

      const projectPayload = await projectRes.json();
      const wpPayload = wpRes.ok ? await wpRes.json() : [];
      const timelinePayload = timelineRes.ok ? await timelineRes.json() : null;

      const resolvedProject = unwrapApiData<Project>(projectPayload);
      setProject({
        ...resolvedProject,
        description: resolvedProject.description || resolvedProject.sectionSummary || '',
      });

      setWorkPackages(wpRes.ok ? unwrapApiData<WorkPackage[]>(wpPayload) : []);
      setGanttData(timelineRes.ok ? unwrapApiData<GanttData>(timelinePayload) : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error while loading project data.');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    loadProject();
  }, [projectId, loadProject]);

  const milestoneSnapshot = useMemo(() => {
    const milestones = workPackages.flatMap((workPackage) =>
      (workPackage.milestones || []).map((milestone) => ({ ...milestone, wpName: workPackage.name })),
    );

    const nextDue = [...milestones]
      .filter((milestone) => !milestone.completed)
      .sort((left, right) => new Date(left.dueDate).getTime() - new Date(right.dueDate).getTime())
      .slice(0, 3);

    return {
      total: milestones.length,
      completed: milestones.filter((milestone) => milestone.completed).length,
      nextDue,
    };
  }, [workPackages]);

  const budget = useMemo(() => {
    const allocated = Number(project?.totalBudget || 0);
    const spent = workPackages.reduce((sum, workPackage) => sum + Number(workPackage.budgetSpent || 0), 0);
    const remaining = Math.max(0, allocated - spent);

    return { allocated, spent, remaining };
  }, [project, workPackages]);

  const updateWorkPackageStatus = async (wpId: string, status: string) => {
    await csrfFetch(`/api/v1/projects/${projectId}/work-packages/${wpId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    loadProject();
  };

  const updateTaskDate = async (taskId: string, updates: { startDate: string; endDate: string }) => {
    await csrfFetch(`/api/v1/projects/${projectId}/timeline/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    loadProject();
  };

  if (loading) return <LoadingState label="Loading project overview..." />;
  if (error || !project) return <ErrorState message={error || 'Project not found.'} onRetry={loadProject} />;

  const currentStageIndex = lifecycleIndex(project.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.title}
        description={project.description || 'No project summary available.'}
        rightSlot={<Button onClick={() => router.push(`/${locale}/proiecte/${projectId}/reports`)}>Open Reporting Wizard</Button>}
        meta={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge kind="project" value={project.status} />
            <span className="rounded-full bg-muted px-2 py-0.5">Programme: {project.programType || 'General'}</span>
            <span className="rounded-full bg-muted px-2 py-0.5">Beneficiary: {project.organizationName || 'N/A'}</span>
            <span className="rounded-full bg-muted px-2 py-0.5">Assigned officer: Programme PM</span>
            {project.updatedAt && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                Last updated: {new Date(project.updatedAt).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}
              </span>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lifecycle Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-5">
            {lifecycle.map((step, index) => (
              <li key={step} className={`rounded-lg border p-3 text-sm ${index <= currentStageIndex ? 'border-emerald-200 bg-emerald-50/40' : ''}`}>
                <p className="text-xs uppercase text-muted-foreground">Stage {index + 1}</p>
                <p className="mt-1 font-medium capitalize">{step}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Milestones Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Completed <span className="font-semibold">{milestoneSnapshot.completed}</span> of{' '}
              <span className="font-semibold">{milestoneSnapshot.total}</span> milestones.
            </p>

            {milestoneSnapshot.nextDue.length === 0 ? (
              <EmptyState title="No due milestones" description="Create work packages and milestones to track delivery." />
            ) : (
              <ul className="space-y-2">
                {milestoneSnapshot.nextDue.map((milestone: Milestone & { wpName: string }) => (
                  <li key={milestone.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{milestone.name}</p>
                      <p className="text-xs text-muted-foreground">{new Date(milestone.dueDate).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Work package: {milestone.wpName}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Budget Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Allocated</p>
                <p className="font-semibold">{budget.allocated.toLocaleString()} EUR</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Spent</p>
                <p className="font-semibold">{budget.spent.toLocaleString()} EUR</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Remaining</p>
                <p className="font-semibold">{budget.remaining.toLocaleString()} EUR</p>
              </div>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full ${budget.allocated > 0 && budget.spent / budget.allocated > 0.85 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                style={{ width: `${budget.allocated > 0 ? Math.min(100, (budget.spent / budget.allocated) * 100) : 0}%` }}
              />
            </div>

            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Shield className="h-3.5 w-3.5" />
              Source of truth: project budget and work package spending records.
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="gantt">Timeline</TabsTrigger>
          <TabsTrigger value="packages">Work packages</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Project Header Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /> Start: {project.startDate ? new Date(project.startDate).toLocaleDateString() : 'N/A'}</p>
              <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-muted-foreground" /> End: {project.endDate ? new Date(project.endDate).toLocaleDateString() : 'N/A'}</p>
              <p className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-muted-foreground" /> EU contribution: {Number(project.euContribution || 0).toLocaleString()} EUR</p>
              <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> Own contribution: {Number(project.ownContrib || 0).toLocaleString()} EUR</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gantt">
          {ganttData ? (
            <GanttChart data={ganttData} onTaskUpdate={updateTaskDate} />
          ) : (
            <EmptyState title="No timeline data" description="Add work package tasks to render the project timeline." />
          )}
        </TabsContent>

        <TabsContent value="packages" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => router.push(`/${locale}/proiecte/${projectId}/pachete/nou`)}>Add Work Package</Button>
          </div>
          <WorkPackageDashboard
            workPackages={workPackages}
            projectBudget={Number(project.totalBudget || 0)}
            onEdit={(wp) => router.push(`/${locale}/proiecte/${projectId}/pachete/${wp.id}`)}
            onComplete={(wpId) => updateWorkPackageStatus(wpId, 'completed')}
            onDelay={(wpId) => updateWorkPackageStatus(wpId, 'delayed')}
          />
          <WorkPackageTable
            workPackages={workPackages}
            onRowClick={(wp) => router.push(`/${locale}/proiecte/${projectId}/pachete/${wp.id}`)}
          />
        </TabsContent>

        <TabsContent value="compliance">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compliance & Audit cues</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><CircleDashed className="h-4 w-4" /> Use report wizard for submissions and evidence traceability.</p>
              <p className="flex items-center gap-2"><CircleDashed className="h-4 w-4" /> Upload supporting files in Documents with milestone linkage.</p>
              <p className="flex items-center gap-2"><CircleDashed className="h-4 w-4" /> Check audit log for project-level history and approvals.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
