'use client';

import { useTranslations } from 'next-intl';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
  sectionSummary?: string;
  sectionContext?: string;
  sectionObjectives?: unknown;
  sectionPartnership?: unknown;
  totalBudget?: number;
  euContribution?: number;
  ownContrib?: number;
  startDate?: string;
  endDate?: string;
  durationMonths?: number;
  callId?: string;
  programType?: string;
  sector?: string;
  metadata?: Record<string, unknown> | null;
  organizationName?: string;
}

type PredictionPartnerType = 'university' | 'research_institute' | 'sme' | 'large_enterprise' | 'ngo' | 'public_body';
type PredictionPartnerRole = 'coordinator' | 'partner';

function unwrapApiData<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function normalizeProgramType(project: Project): string {
  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {};
  const candidates = [
    project.programType,
    project.callId,
    typeof metadata['programType'] === 'string' ? metadata['programType'] : undefined,
    typeof metadata['program'] === 'string' ? metadata['program'] : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());

  const candidate = candidates.find((value) => value.length > 0) || '';
  if (candidate.includes('horizon')) return 'horizon_europe';
  if (candidate.includes('interreg')) return 'interreg';
  if (candidate.includes('life')) return 'life_plus';
  if (candidate.includes('pnrr')) return 'pnrr';
  if (candidate.includes('pocidif')) return 'pocidif';
  return 'general';
}

function deriveSector(project: Project): string {
  const metadata = project.metadata && typeof project.metadata === 'object' ? project.metadata : {};
  const candidates = [
    project.sector,
    typeof metadata['sector'] === 'string' ? metadata['sector'] : undefined,
    project.sectionContext,
    project.sectionSummary,
  ].filter((value): value is string => Boolean(value));

  const joined = candidates.join(' ').toLowerCase();
  if (joined.includes('digital') || joined.includes('software') || joined.includes('it')) return 'digital';
  if (joined.includes('energie') || joined.includes('energy')) return 'energy';
  if (joined.includes('sănăt') || joined.includes('health')) return 'health';
  if (joined.includes('educa') || joined.includes('education')) return 'education';
  if (joined.includes('mediu') || joined.includes('environment')) return 'environment';
  return candidates[0]?.trim() || 'general';
}

function toPartnerType(value: unknown): PredictionPartnerType {
  const raw = typeof value === 'string' ? value.toLowerCase() : '';
  if (raw === 'university' || raw === 'research_institute' || raw === 'sme' || raw === 'large_enterprise' || raw === 'ngo' || raw === 'public_body') {
    return raw;
  }
  if (raw.includes('univers')) return 'university';
  if (raw.includes('research') || raw.includes('institut')) return 'research_institute';
  if (raw.includes('public') || raw.includes('uat')) return 'public_body';
  if (raw.includes('ngo') || raw.includes('ong')) return 'ngo';
  if (raw.includes('enterprise') || raw.includes('corporate')) return 'large_enterprise';
  return 'sme';
}

function extractProjectPartners(project: Project) {
  const source = project.sectionPartnership;
  const fromArray = Array.isArray(source)
    ? source
    : source && typeof source === 'object' && Array.isArray((source as { partners?: unknown[] }).partners)
      ? (source as { partners: unknown[] }).partners
      : [];

  const parsed = fromArray
    .map((partner, index) => {
      if (typeof partner === 'string') {
        return {
          name: partner,
          country: 'RO',
          type: 'sme' as PredictionPartnerType,
          role: index === 0 ? 'coordinator' as PredictionPartnerRole : 'partner' as PredictionPartnerRole,
          previousEUProjects: 1,
        };
      }

      if (!partner || typeof partner !== 'object') return null;
      const rawPartner = partner as Record<string, unknown>;
      const name = typeof rawPartner.name === 'string' ? rawPartner.name : `Partener ${index + 1}`;
      const country = typeof rawPartner.country === 'string' ? rawPartner.country : 'RO';
      const role = rawPartner.role === 'coordinator' ? 'coordinator' : 'partner';
      const previousEUProjects = typeof rawPartner.previousEUProjects === 'number'
        ? rawPartner.previousEUProjects
        : typeof rawPartner.previous_projects === 'number'
          ? rawPartner.previous_projects
          : 1;

      return {
        name,
        country,
        type: toPartnerType(rawPartner.type),
        role,
        previousEUProjects,
        budgetShare: typeof rawPartner.budgetShare === 'number' ? rawPartner.budgetShare : undefined,
      };
    })
    .filter((partner): partner is NonNullable<typeof partner> => Boolean(partner))
    .map((partner, index) => ({
      ...partner,
      role: index === 0 ? 'coordinator' : partner.role,
    }));

  if (parsed.length > 0) {
    const hasShares = parsed.some((partner) => typeof partner.budgetShare === 'number');
    if (hasShares) return parsed;
    const equalShare = Number((100 / parsed.length).toFixed(2));
    return parsed.map((partner) => ({ ...partner, budgetShare: equalShare }));
  }

  return [
    {
      name: project.organizationName || `Coordonator ${project.acronym || project.title}`,
      country: 'RO',
      type: 'sme' as PredictionPartnerType,
      role: 'coordinator' as PredictionPartnerRole,
      previousEUProjects: 1,
      budgetShare: 100,
    },
  ];
}

function getComplianceRegulations(programType: string): string[] {
  switch (programType) {
    case 'horizon_europe':
      return ['Regulamentul (UE) 2021/695', 'Model Grant Agreement Horizon Europe', 'GDPR'];
    case 'interreg':
      return ['Regulamentul (UE) 2021/1059', 'Regulamentul (UE) 2021/1060', 'Reguli naționale Interreg România'];
    case 'pnrr':
      return ['Regulamentul (UE) 2021/241', 'Principiul DNSH', 'GDPR'];
    case 'pocidif':
      return ['Programul POCIDIF 2021-2027', 'Regulamentul (UE) 2021/1060', 'Reguli ajutor de stat aplicabile'];
    case 'life_plus':
      return ['Regulamentul (UE) 2021/783', 'Programul LIFE 2021-2027', 'GDPR'];
    default:
      return ['Regulamentul (UE) 2021/1060', 'GDPR', 'Reguli eligibilitate cheltuieli'];
  }
}

export default function ProjectDetailPage() {
  const t = useTranslations();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
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

        if (projRes.ok) {
          const projectPayload = await projRes.json();
          const projectData = unwrapApiData<Project>(projectPayload);
          setProject({
            ...projectData,
            description: projectData.description || projectData.sectionSummary || '',
          });
        }
        else setError(t('errors.notFound'));

        if (wpRes.ok) {
          const wpPayload = await wpRes.json();
          setWorkPackages(unwrapApiData<WorkPackage[]>(wpPayload));
        }
        if (timelineRes.ok) {
          const timelinePayload = await timelineRes.json();
          setGanttData(unwrapApiData<GanttData>(timelinePayload));
        }
      } catch {
        setError(t('errors.serverError'));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id, t]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'detalii' || tab === 'gantt' || tab === 'pachete' || tab === 'propunere' || tab === 'documente' || tab === 'conformitate') {
      setActiveTab(tab);
    }
  }, [searchParams]);

  const handleTaskUpdate = async (taskId: string, updates: { startDate: string; endDate: string }) => {
    try {
      await fetch(`/api/v1/projects/${params.id}/timeline/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      // Refresh timeline
      const res = await fetch(`/api/v1/projects/${params.id}/timeline`);
      if (res.ok) {
        const payload = await res.json();
        setGanttData(unwrapApiData<GanttData>(payload));
      }
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
      if (res.ok) {
        const payload = await res.json();
        setWorkPackages(unwrapApiData<WorkPackage[]>(payload));
      }
    } catch { /* silent */ }
  };

  const runSuccessPrediction = async () => {
    if (!project) return;
    setPredictionLoading(true);
    setPredictionError('');
    try {
      const startDate = project.startDate ? new Date(project.startDate) : null;
      const endDate = project.endDate ? new Date(project.endDate) : null;
      const durationMonths = project.durationMonths || (startDate && endDate
        ? Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)))
        : 24);

      const programType = normalizeProgramType(project);
      const sector = deriveSector(project);
      const partners = extractProjectPartners(project);
      const derivedBudget = Number(project.totalBudget) > 0
        ? Number(project.totalBudget)
        : Number(project.euContribution || 0) + Number(project.ownContrib || 0) || Math.max(50000, partners.length * 50000);

      const res = await fetch('/api/ai/predict-success', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectTitle: project.title,
          projectSummary: project.description || project.sectionSummary || `Proiect ${project.title} cu focus pe implementare și rezultate măsurabile.`,
          programType,
          totalBudget: derivedBudget,
          durationMonths,
          sector,
          partners,
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
      const programType = normalizeProgramType(project);
      const objectiveText = Array.isArray(project.sectionObjectives)
        ? project.sectionObjectives.filter((item) => typeof item === 'string').join('\n')
        : typeof project.sectionObjectives === 'string'
          ? project.sectionObjectives
          : '';

      const res = await fetch('/api/ai/validate-compliance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalText: `${project.title}\n\n${project.description || project.sectionSummary || 'Descriere indisponibilă.'}\n\n${project.sectionContext || ''}\n\n${objectiveText}`,
          regulations: getComplianceRegulations(programType),
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
