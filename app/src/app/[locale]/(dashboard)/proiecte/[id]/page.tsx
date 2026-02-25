'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { CalendarDays, CheckCircle2, Clock3, Download, FileCheck2, Leaf, PlayCircle, Shield } from 'lucide-react';
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
import { ComplianceExplainabilityPanel } from '@/components/compliance/compliance-explainability-panel';
import type { GanttData } from '@/types/timeline';
import type { Milestone, WorkPackage } from '@/types/work-packages';
import type { RuleResult } from '@/lib/rules/eligibility';

interface AIComplianceCheck {
  area: string;
  status: 'pass' | 'fail' | 'warning';
  finding: string;
  recommendation: string;
  legalReference?: string;
  confidence?: number;
  citations?: number[];
}

interface ComplianceSourceTrace {
  sourceIndex: number;
  sourceId: string;
  title: string;
  sourceUrl?: string;
  snippet: string;
  score: number;
}

interface ComplianceExplainabilityData {
  overallScore: number;
  evaluatedAt?: string;
  aiResults: AIComplianceCheck[];
  deterministicResults: RuleResult[];
  sourceTrace: ComplianceSourceTrace[];
  recommendations: string[];
  dnshAssessment?: {
    status: 'pass' | 'warning' | 'fail';
    score: number;
    finding: string;
    recommendation: string;
    legalReference: string;
    missingEvidence: string[];
  };
}

interface MySMISExportData {
  projectId: string;
  ready: boolean;
  missingRequired: string[];
  warnings: string[];
  payload: Record<string, unknown>;
}

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
  const [complianceData, setComplianceData] = useState<ComplianceExplainabilityData | null>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState<string | null>(null);
  const [mysmisData, setMysmisData] = useState<MySMISExportData | null>(null);
  const [mysmisLoading, setMysmisLoading] = useState(false);
  const [mysmisError, setMysmisError] = useState<string | null>(null);
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

      const complianceRes = await fetch(`/api/v1/projects/${projectId}/compliance`);
      if (complianceRes.ok) {
        const compliancePayload = await complianceRes.json();
        const latestReport = compliancePayload?.data?.latestReport;
        const reportItems = latestReport?.items;
        if (reportItems && typeof reportItems === 'object') {
          setComplianceData({
            overallScore: Number(reportItems.overallScore || latestReport.overallScore || 0),
            evaluatedAt: reportItems.evaluatedAt || latestReport.createdAt,
            aiResults: Array.isArray(reportItems.aiResults) ? reportItems.aiResults : [],
            deterministicResults: Array.isArray(reportItems.deterministicResults) ? reportItems.deterministicResults : [],
            sourceTrace: Array.isArray(reportItems.sourceTrace) ? reportItems.sourceTrace : [],
            recommendations: Array.isArray(reportItems.recommendations) ? reportItems.recommendations : [],
            dnshAssessment: reportItems.dnshAssessment,
          });
        }
      }
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

  const runComplianceCheck = async () => {
    setComplianceLoading(true);
    setComplianceError(null);
    try {
      const response = await csrfFetch(`/api/v1/projects/${projectId}/compliance`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Analiza de conformitate nu a putut fi finalizată.');
      }
      const payload = await response.json();
      const data = payload?.data;
      setComplianceData({
        overallScore: Number(data?.overallScore || 0),
        evaluatedAt: data?.evaluatedAt || new Date().toISOString(),
        aiResults: Array.isArray(data?.aiResults) ? data.aiResults : [],
        deterministicResults: Array.isArray(data?.deterministicResults) ? data.deterministicResults : [],
        sourceTrace: Array.isArray(data?.sourceTrace) ? data.sourceTrace : [],
        recommendations: Array.isArray(data?.recommendations) ? data.recommendations : [],
        dnshAssessment: data?.dnshAssessment,
      });
    } catch (err) {
      setComplianceError(err instanceof Error ? err.message : 'A apărut o eroare la rularea verificării.');
    } finally {
      setComplianceLoading(false);
    }
  };

  const prepareMySMISExport = async () => {
    setMysmisLoading(true);
    setMysmisError(null);
    try {
      const response = await fetch(`/api/v1/projects/${projectId}/mysmis-export`);
      if (!response.ok) {
        throw new Error('Nu am putut pregăti pachetul pentru MySMIS.');
      }
      const payload = await response.json();
      setMysmisData(payload?.data as MySMISExportData);
    } catch (err) {
      setMysmisError(err instanceof Error ? err.message : 'Eroare la pregătirea pachetului MySMIS.');
    } finally {
      setMysmisLoading(false);
    }
  };

  const downloadMySMISPayload = () => {
    if (!mysmisData?.payload) return;
    const blob = new Blob([JSON.stringify(mysmisData.payload, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href;
    link.download = `mysmis-export-${projectId}.json`;
    link.click();
    URL.revokeObjectURL(href);
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

        <TabsContent value="compliance" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Indicii de conformitate și audit</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={prepareMySMISExport} disabled={mysmisLoading} className="inline-flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  {mysmisLoading ? 'Se pregătește MySMIS...' : 'Pregătește MySMIS'}
                </Button>
                <Button onClick={runComplianceCheck} disabled={complianceLoading} className="inline-flex items-center gap-2">
                  <PlayCircle className="h-4 w-4" />
                  {complianceLoading ? 'Se rulează analiza...' : 'Rulează verificare AI'}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Analiza include reguli deterministe, constatări AI cu nivel de încredere și citări către sursele legislative.
            </CardContent>
          </Card>

          {complianceError ? <ErrorState message={complianceError} onRetry={runComplianceCheck} /> : null}
          {mysmisError ? <ErrorState message={mysmisError} onRetry={prepareMySMISExport} /> : null}

          {complianceLoading ? <LoadingState label="Se pregătește raportul de explicabilitate..." /> : null}

          {!complianceLoading && complianceData?.dnshAssessment ? (
            <Card className="border-emerald-200/70 bg-emerald-50/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                <div className="flex items-center gap-2">
                  <Leaf className="h-4 w-4 text-emerald-700" />
                  <span className="font-medium">
                    DNSH: {complianceData.dnshAssessment.status === 'pass' ? 'Conform' : complianceData.dnshAssessment.status === 'warning' ? 'Atenție' : 'Neconform'}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs text-muted-foreground">
                    Scor {complianceData.dnshAssessment.score}/100
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{complianceData.dnshAssessment.legalReference}</span>
              </CardContent>
            </Card>
          ) : null}

          {!mysmisLoading && mysmisData ? (
            <Card className="border-indigo-200/70 bg-indigo-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Pachet MySMIS 2021+</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${mysmisData.ready ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {mysmisData.ready ? 'Pregătit pentru export' : 'Necesită completări'}
                  </span>
                  <Button variant="outline" size="sm" onClick={downloadMySMISPayload} className="inline-flex items-center gap-2">
                    <Download className="h-3.5 w-3.5" />
                    Descarcă JSON
                  </Button>
                </div>
                {mysmisData.missingRequired.length > 0 ? (
                  <div>
                    <p className="font-medium">Câmpuri obligatorii lipsă:</p>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {mysmisData.missingRequired.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {mysmisData.warnings.length > 0 ? (
                  <div>
                    <p className="font-medium">Atenționări:</p>
                    <ul className="mt-1 space-y-1 text-muted-foreground">
                      {mysmisData.warnings.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {!complianceLoading && complianceData ? (
            <ComplianceExplainabilityPanel data={complianceData} />
          ) : null}

          {!complianceLoading && !complianceData ? (
            <EmptyState
              title="Nu există încă un raport explicabil"
              description="Rulează verificarea AI pentru a vedea constatări, încredere, referințe legale și surse."
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
