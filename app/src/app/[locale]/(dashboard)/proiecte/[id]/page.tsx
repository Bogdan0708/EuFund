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

const lifecycle = ['aplicație', 'contractare', 'implementare', 'raportare', 'închidere'] as const;

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

      if (!projectRes.ok) throw new Error('Proiectul nu a putut fi încărcat.');

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
      setError(err instanceof Error ? err.message : 'Eroare neașteptată la încărcarea datelor proiectului.');
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

  if (loading) return <LoadingState label="Se încarcă prezentarea proiectului..." />;
  if (error || !project) return <ErrorState message={error || 'Proiectul nu a fost găsit.'} onRetry={loadProject} />;

  const currentStageIndex = lifecycleIndex(project.status);

  return (
    <div className="space-y-6">
      <PageHeader
        title={project.title}
        description={project.description || 'Nu există rezumat disponibil pentru proiect.'}
        rightSlot={<Button onClick={() => router.push(`/${locale}/proiecte/${projectId}/reports`)}>Deschide asistentul de raportare</Button>}
        meta={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge kind="project" value={project.status} />
            <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">Program: {project.programType || 'General'}</span>
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-violet-700">Beneficiar: {project.organizationName || 'N/A'}</span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">Ofițer: Manager program</span>
            {project.updatedAt && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                Ultima actualizare: {new Date(project.updatedAt).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}
              </span>
            )}
          </div>
        }
      />

      <Card className="border-none bg-gradient-to-r from-sky-50 via-white to-emerald-50 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Progres ciclu de viață</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-2 sm:grid-cols-5">
            {lifecycle.map((step, index) => (
              <li
                key={step}
                className={`rounded-xl border px-3 py-3 text-sm ${
                  index <= currentStageIndex ? 'border-emerald-300 bg-emerald-100/70' : 'border-slate-200 bg-white/80'
                }`}
              >
                <p className="text-xs uppercase text-muted-foreground">Etapa {index + 1}</p>
                <p className="mt-1 font-semibold capitalize">{step}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Situație jaloane</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Finalizate <span className="font-semibold text-emerald-700">{milestoneSnapshot.completed}</span> din{' '}
              <span className="font-semibold">{milestoneSnapshot.total}</span> jaloane.
            </p>

            {milestoneSnapshot.nextDue.length === 0 ? (
              <EmptyState title="Nu există jaloane scadente" description="Creează pachete de lucru și jaloane pentru a urmări livrarea." />
            ) : (
              <ul className="space-y-2">
                {milestoneSnapshot.nextDue.map((milestone: Milestone & { wpName: string }) => (
                  <li key={milestone.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{milestone.name}</p>
                      <p className="text-xs text-muted-foreground">{new Date(milestone.dueDate).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">Pachet de lucru: {milestone.wpName}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Rezumat buget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-xl border border-sky-200 bg-sky-50 p-3">
                <p className="text-xs text-sky-700">Alocat</p>
                <p className="font-semibold text-sky-900">{budget.allocated.toLocaleString()} EUR</p>
              </div>
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs text-amber-700">Cheltuit</p>
                <p className="font-semibold text-amber-900">{budget.spent.toLocaleString()} EUR</p>
              </div>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs text-emerald-700">Rămas</p>
                <p className="font-semibold text-emerald-900">{budget.remaining.toLocaleString()} EUR</p>
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
              Sursă de adevăr: bugetul proiectului și cheltuielile din pachetele de lucru.
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-auto">
          <TabsTrigger value="overview">Prezentare</TabsTrigger>
          <TabsTrigger value="gantt">Cronologie</TabsTrigger>
          <TabsTrigger value="packages">Pachete de lucru</TabsTrigger>
          <TabsTrigger value="compliance">Conformitate</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Detalii proiect</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
              <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" /> Început: {project.startDate ? new Date(project.startDate).toLocaleDateString() : 'N/A'}</p>
              <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-muted-foreground" /> Sfârșit: {project.endDate ? new Date(project.endDate).toLocaleDateString() : 'N/A'}</p>
              <p className="flex items-center gap-2"><FileCheck2 className="h-4 w-4 text-muted-foreground" /> Contribuție UE: {Number(project.euContribution || 0).toLocaleString()} EUR</p>
              <p className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-muted-foreground" /> Contribuție proprie: {Number(project.ownContrib || 0).toLocaleString()} EUR</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gantt">
          {ganttData ? (
            <GanttChart data={ganttData} onTaskUpdate={updateTaskDate} />
          ) : (
            <EmptyState title="Nu există date de cronologie" description="Adaugă sarcini în pachetele de lucru pentru a afișa cronologia proiectului." />
          )}
        </TabsContent>

        <TabsContent value="packages" className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => router.push(`/${locale}/proiecte/${projectId}/pachete/nou`)}>Adaugă pachet de lucru</Button>
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
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Indicii de conformitate și audit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2"><CircleDashed className="h-4 w-4" /> Folosește asistentul de raportare pentru depuneri și trasabilitatea dovezilor.</p>
              <p className="flex items-center gap-2"><CircleDashed className="h-4 w-4" /> Încarcă fișiere justificative în Documente cu legare la jaloane.</p>
              <p className="flex items-center gap-2"><CircleDashed className="h-4 w-4" /> Verifică jurnalul de audit pentru istoricul și aprobările proiectului.</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
