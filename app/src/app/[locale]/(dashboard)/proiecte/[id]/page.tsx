'use client';

import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GanttChart } from '@/components/project/gantt-chart';
import { WorkPackageDashboard } from '@/components/project/work-package-dashboard';
import { WorkPackageTable } from '@/components/project/work-package-table';
import type { GanttData } from '@/types/timeline';
import type { WorkPackage } from '@/types/work-packages';

interface Project {
  id: string;
  title: string;
  acronym?: string;
  status: string;
  description?: string;
  totalBudget?: number;
  euContribution?: number;
  startDate?: string;
  endDate?: string;
}

export default function ProjectDetailPage() {
  const t = useTranslations();
  const params = useParams();
  const router = useRouter();
  const [project, setProject] = useState<Project | null>(null);
  const [ganttData, setGanttData] = useState<GanttData | null>(null);
  const [workPackages, setWorkPackages] = useState<WorkPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('detalii');
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState('');
  const [prediction, setPrediction] = useState<null | {
    successProbability?: number;
    confidenceLevel?: string;
    overallReadiness?: string;
    benchmarkComparison?: { programAverage?: number; romanianAverage?: number };
  }>(null);
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceError, setComplianceError] = useState('');
  const [compliance, setCompliance] = useState<null | {
    overallScore?: number;
    recommendations?: string[];
  }>(null);

  useEffect(() => {
    async function load() {
      try {
        const [projRes, wpRes, timelineRes] = await Promise.all([
          fetch(`/api/v1/projects/${params.id}`),
          fetch(`/api/v1/projects/${params.id}/work-packages`),
          fetch(`/api/v1/projects/${params.id}/timeline`),
        ]);

        if (projRes.ok) setProject(await projRes.json());
        else setError(t('errors.notFound'));

        if (wpRes.ok) setWorkPackages(await wpRes.json());
        if (timelineRes.ok) setGanttData(await timelineRes.json());
      } catch {
        setError(t('errors.serverError'));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id, t]);

  const handleTaskUpdate = async (taskId: string, updates: { startDate: string; endDate: string }) => {
    try {
      await fetch(`/api/v1/projects/${params.id}/timeline/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      // Refresh timeline
      const res = await fetch(`/api/v1/projects/${params.id}/timeline`);
      if (res.ok) setGanttData(await res.json());
    } catch { /* silent */ }
  };

  const handleWpStatusChange = async (wpId: string, status: string) => {
    try {
      await fetch(`/api/v1/projects/${params.id}/work-packages/${wpId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const res = await fetch(`/api/v1/projects/${params.id}/work-packages`);
      if (res.ok) setWorkPackages(await res.json());
    } catch { /* silent */ }
  };

  const runSuccessPrediction = async () => {
    if (!project) return;
    setPredictionLoading(true);
    setPredictionError('');
    try {
      const startDate = project.startDate ? new Date(project.startDate) : null;
      const endDate = project.endDate ? new Date(project.endDate) : null;
      const durationMonths = startDate && endDate
        ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)))
        : 24;

      const res = await fetch('/api/ai/predict-success', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectTitle: project.title,
          projectSummary: project.description || `Proiect ${project.title} cu focus pe implementare și rezultate măsurabile.`,
          programType: 'horizon_europe',
          totalBudget: Number(project.totalBudget) || 100000,
          durationMonths,
          sector: 'general',
          partners: [
            {
              name: 'Organizația solicitantă',
              country: 'RO',
              type: 'sme',
              role: 'coordinator',
              previousEUProjects: 1,
              budgetShare: 100,
            },
          ],
          locale: 'ro',
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Eroare la predicția de succes');
      setPrediction(data.data);
    } catch (err) {
      setPredictionError(err instanceof Error ? err.message : 'Eroare necunoscută');
    } finally {
      setPredictionLoading(false);
    }
  };

  const runComplianceValidation = async () => {
    if (!project) return;
    setComplianceLoading(true);
    setComplianceError('');
    try {
      const res = await fetch('/api/ai/validate-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalText: `${project.title}\n\n${project.description || 'Descriere indisponibilă.'}`,
          regulations: ['CPR 2021/1060', 'GDPR', 'Reguli eligibilitate cheltuieli'],
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error?.message || 'Eroare la validarea conformității');
      setCompliance(data.data);
    } catch (err) {
      setComplianceError(err instanceof Error ? err.message : 'Eroare necunoscută');
    } finally {
      setComplianceLoading(false);
    }
  };


  if (loading) {
    return <div className="flex justify-center p-12 text-muted-foreground">{t('common.loading')}</div>;
  }

  if (error || !project) {
    return (
      <Card className="max-w-md mx-auto mt-12">
        <CardContent className="p-6 text-center text-destructive">
          {error || t('errors.notFound')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">{project.title}</h1>
          {project.acronym && <p className="text-muted-foreground">{project.acronym}</p>}
          {project.startDate && project.endDate && (
            <p className="text-xs text-muted-foreground mt-1">
              📅 {new Date(project.startDate).toLocaleDateString('ro-RO')} → {new Date(project.endDate).toLocaleDateString('ro-RO')}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="secondary">{t(`project.status.${project.status}` as any) || project.status}</Badge>
          {project.totalBudget && (
            <Badge variant="outline">
              💰 {new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(project.totalBudget))}
            </Badge>
          )}
          <Button variant="outline">{t('common.edit')}</Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="detalii">Detalii</TabsTrigger>
          <TabsTrigger value="gantt">📊 Gantt</TabsTrigger>
          <TabsTrigger value="pachete">📦 Pachete</TabsTrigger>
          <TabsTrigger value="propunere">Propunere</TabsTrigger>
          <TabsTrigger value="documente">Documente</TabsTrigger>
          <TabsTrigger value="conformitate">Conformitate</TabsTrigger>
        </TabsList>

        <TabsContent value="detalii">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('project.sections.summary')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {project.description || 'Nicio descriere disponibilă. Editați proiectul pentru a adăuga detalii.'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Predicție succes AI</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button onClick={runSuccessPrediction} disabled={predictionLoading}>
                  {predictionLoading ? 'Se calculează...' : '📈 Rulează predicția de succes'}
                </Button>
                {predictionError && <p className="text-sm text-destructive">{predictionError}</p>}
                {prediction && (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Probabilitate succes: <span className="font-semibold text-foreground">{prediction.successProbability ?? 0}%</span></p>
                    <p>Încredere model: <span className="font-medium text-foreground">{prediction.confidenceLevel || 'n/a'}</span></p>
                    <p>Stare pregătire: <span className="font-medium text-foreground">{prediction.overallReadiness || 'n/a'}</span></p>
                    <p>Media program: {prediction.benchmarkComparison?.programAverage ?? 0}% | Media RO: {prediction.benchmarkComparison?.romanianAverage ?? 0}%</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="gantt">
          {ganttData ? (
            <GanttChart data={ganttData} onTaskUpdate={handleTaskUpdate} />
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Nu există date de timeline. Adăugați pachete de lucru cu activități.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pachete" className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Pachete de Lucru</h3>
            <Button onClick={() => router.push(`/${params.locale}/proiecte/${params.id}/pachete/nou`)}>
              ➕ Adaugă Pachet
            </Button>
          </div>
          <WorkPackageDashboard
            workPackages={workPackages}
            projectBudget={project.totalBudget ? Number(project.totalBudget) : undefined}
            onComplete={(id) => handleWpStatusChange(id, 'completed')}
            onDelay={(id) => handleWpStatusChange(id, 'delayed')}
          />
          <WorkPackageTable
            workPackages={workPackages}
            onRowClick={(wp) => {/* TODO: navigate to WP detail */}}
          />
        </TabsContent>

        <TabsContent value="propunere">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Propunere de Proiect</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">Propunerea nu a fost generată încă.</p>
              <Button>🤖 Generează cu AI</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documente">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('nav.documents')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">Niciun document încărcat.</p>
              <Button variant="outline" className="mt-4">📄 Încarcă document</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="conformitate">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('compliance.check')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground">{t('compliance.disclaimer')}</p>
              <Button onClick={runComplianceValidation} disabled={complianceLoading}>
                {complianceLoading ? 'Se validează...' : '✅ Validare Conformitate'}
              </Button>
              {complianceError && <p className="text-sm text-destructive">{complianceError}</p>}
              {compliance && (
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>Scor conformitate: <span className="font-semibold text-foreground">{compliance.overallScore ?? 0}/100</span></p>
                  {compliance.recommendations?.slice(0, 3).map((item, idx) => (
                    <p key={idx}>• {item}</p>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
