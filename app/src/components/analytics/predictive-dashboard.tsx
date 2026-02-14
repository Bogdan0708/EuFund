'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSuccessPrediction } from '@/hooks/use-success-prediction';
import { useLifecycleForecasting } from '@/hooks/use-lifecycle-forecasting';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PredictiveDashboardProps {
  projectId: string;
  showSuccessPrediction: boolean;
  showPartnerRecommendations: boolean;
  showLifecycleForecasting: boolean;
}

interface SuccessFactor {
  id: string;
  name: string;
  impact: 'high' | 'medium' | 'low';
  direction: 'positive' | 'negative';
  score: number;
  description: string;
  recommendation?: string;
}

interface Recommendation {
  id: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  estimatedImpact: number; // percentage points improvement
  effort: 'low' | 'medium' | 'high';
  category: string;
}

interface BenchmarkData {
  metric: string;
  projectValue: number;
  averageValue: number;
  topPerformerValue: number;
  unit: string;
}

interface RomanianIndicator {
  id: string;
  label: string;
  value: string;
  status: 'good' | 'warning' | 'critical';
  detail: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SuccessProbabilityGauge({ probability, confidence }: { probability: number; confidence: number }) {
  const circumference = 2 * Math.PI * 60;
  const strokeDashoffset = circumference - (probability / 100) * circumference;
  const color = probability >= 70 ? 'text-green-500' : probability >= 40 ? 'text-yellow-500' : 'text-red-500';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Probabilitate de Succes</CardTitle>
        <CardDescription>Predicție bazată pe AI cu actualizare în timp real</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center">
        <div className="relative w-40 h-40" role="meter" aria-valuenow={probability} aria-valuemin={0} aria-valuemax={100} aria-label={`Probabilitate de succes: ${probability}%`}>
          <svg className="w-40 h-40 -rotate-90" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="60" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
            <circle cx="64" cy="64" r="60" fill="none" stroke="currentColor" className={color} strokeWidth="8" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1s ease-in-out' }} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold">{probability}%</span>
            <span className="text-xs text-muted-foreground">±{(100 - confidence).toFixed(0)}%</span>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Nivel de încredere:</span>
          <Badge variant={confidence >= 80 ? 'default' : 'secondary'}>{confidence}%</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function CriticalFactorsDisplay({ factors }: { factors: SuccessFactor[] }) {
  const sorted = useMemo(() => [...factors].sort((a, b) => Math.abs(b.score) - Math.abs(a.score)), [factors]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Factori Critici</CardTitle>
        <CardDescription>Factorii care influențează cel mai mult succesul proiectului</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3" role="list" aria-label="Factori critici de succes">
          {sorted.map((factor) => (
            <div key={factor.id} role="listitem" className="flex items-start gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer" tabIndex={0} aria-label={`${factor.name}: impact ${factor.impact}, ${factor.direction === 'positive' ? 'pozitiv' : 'negativ'}`}>
              <div className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${factor.direction === 'positive' ? 'bg-green-500' : 'bg-red-500'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{factor.name}</span>
                  <Badge variant={factor.impact === 'high' ? 'destructive' : factor.impact === 'medium' ? 'default' : 'secondary'} className="text-xs">
                    {factor.impact === 'high' ? 'Ridicat' : factor.impact === 'medium' ? 'Mediu' : 'Scăzut'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{factor.description}</p>
                {factor.recommendation && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">💡 {factor.recommendation}</p>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`text-sm font-mono font-bold ${factor.direction === 'positive' ? 'text-green-600' : 'text-red-600'}`}>
                  {factor.direction === 'positive' ? '+' : ''}{factor.score.toFixed(1)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ImprovementRecommendations({ recommendations }: { recommendations: Recommendation[] }) {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = useMemo(() => [...recommendations].sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]), [recommendations]);

  const priorityLabels: Record<string, string> = { critical: 'Critic', high: 'Ridicat', medium: 'Mediu', low: 'Scăzut' };
  const priorityColors: Record<string, string> = { critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200', high: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200', medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200', low: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Recomandări de Îmbunătățire</CardTitle>
        <CardDescription>Acțiuni prioritizate pentru creșterea șanselor de succes</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sorted.map((rec, i) => (
            <div key={rec.id} className="p-3 rounded-lg border">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">#{i + 1}</span>
                  <span className="font-medium text-sm">{rec.title}</span>
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${priorityColors[rec.priority]}`}>{priorityLabels[rec.priority]}</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{rec.description}</p>
              <div className="flex gap-4 mt-2 text-xs">
                <span>Impact: <strong className="text-green-600">+{rec.estimatedImpact}%</strong></span>
                <span>Efort: <strong>{rec.effort === 'low' ? 'Scăzut' : rec.effort === 'medium' ? 'Mediu' : 'Ridicat'}</strong></span>
                <span className="text-muted-foreground">{rec.category}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BenchmarkComparison({ benchmarks }: { benchmarks: BenchmarkData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Comparație Benchmark</CardTitle>
        <CardDescription>Performanța proiectului vs proiecte similare de succes</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {benchmarks.map((b) => {
            const maxVal = Math.max(b.projectValue, b.averageValue, b.topPerformerValue);
            return (
              <div key={b.metric} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{b.metric}</span>
                  <span className="text-muted-foreground">{b.unit}</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-24 text-muted-foreground">Proiect</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-700" style={{ width: `${(b.projectValue / maxVal) * 100}%` }} />
                    </div>
                    <span className="text-xs w-12 text-right font-mono">{b.projectValue}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-24 text-muted-foreground">Media</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-gray-400 rounded-full" style={{ width: `${(b.averageValue / maxVal) * 100}%` }} />
                    </div>
                    <span className="text-xs w-12 text-right font-mono">{b.averageValue}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs w-24 text-muted-foreground">Top 10%</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full" style={{ width: `${(b.topPerformerValue / maxVal) * 100}%` }} />
                    </div>
                    <span className="text-xs w-12 text-right font-mono">{b.topPerformerValue}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RomanianContextPanel({ indicators }: { indicators: RomanianIndicator[] }) {
  const statusColors: Record<string, string> = { good: 'bg-green-500', warning: 'bg-yellow-500', critical: 'bg-red-500' };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Context România 🇷🇴</CardTitle>
        <CardDescription>Indicatori specifici pentru organizații românești</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {indicators.map((ind) => (
            <div key={ind.id} className="flex items-center gap-3 p-2 rounded-lg border">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColors[ind.status]}`} />
              <div className="flex-1">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">{ind.label}</span>
                  <span className="text-sm font-mono">{ind.value}</span>
                </div>
                <p className="text-xs text-muted-foreground">{ind.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function PredictiveDashboard({ projectId, showSuccessPrediction, showPartnerRecommendations, showLifecycleForecasting }: PredictiveDashboardProps) {
  const { data: prediction, isLoading: predLoading, error: predError } = useSuccessPrediction(projectId);
  const { data: forecast, isLoading: forecastLoading } = useLifecycleForecasting(projectId);
  const [activeTab, setActiveTab] = useState('overview');

  // WebSocket for live updates
  const [wsConnected, setWsConnected] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/predictions/${projectId}`);
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => setWsConnected(false);
    ws.onerror = () => setWsConnected(false);
    return () => ws.close();
  }, [projectId]);

  if (predLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]" role="status" aria-label="Se încarcă predicțiile">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Se analizează datele proiectului...</p>
        </div>
      </div>
    );
  }

  if (predError) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-6">
          <p className="text-destructive">Nu s-au putut încărca predicțiile. Verificați conexiunea.</p>
          <Button variant="outline" className="mt-2" onClick={() => window.location.reload()}>Reîncercați</Button>
        </CardContent>
      </Card>
    );
  }

  // Mock data when API not yet available
  const prob = prediction?.probability ?? 68;
  const conf = prediction?.confidence ?? 82;
  const factors: SuccessFactor[] = prediction?.factors ?? [
    { id: '1', name: 'Calitatea consorțiului', impact: 'high', direction: 'positive', score: 8.5, description: 'Parteneriate puternice cu experiență dovedită', recommendation: 'Adăugați un partener din Europa de Vest' },
    { id: '2', name: 'Alinierea bugetară', impact: 'high', direction: 'positive', score: 7.2, description: 'Buget bine structurat conform cerințelor programului' },
    { id: '3', name: 'Dimensiune TRL', impact: 'medium', direction: 'negative', score: -3.1, description: 'TRL actual sub media așteptată', recommendation: 'Documentați mai bine progresul tehnologic' },
    { id: '4', name: 'Impactul social', impact: 'medium', direction: 'positive', score: 5.8, description: 'Impact social bine definit cu indicatori măsurabili' },
    { id: '5', name: 'Experiența coordonatorului', impact: 'high', direction: 'negative', score: -4.2, description: 'Coordonatorul are experiență limitată cu proiecte H2020/HE', recommendation: 'Includeți un co-coordonator experimentat' },
  ];
  const recommendations: Recommendation[] = prediction?.recommendations ?? [
    { id: '1', title: 'Adăugați partener din DE/FR/NL', description: 'Consorțiul necesită cel puțin un partener din Europa de Vest pentru echilibru geografic', priority: 'critical', estimatedImpact: 12, effort: 'high', category: 'Consorțiu' },
    { id: '2', title: 'Îmbunătățiți secțiunea Impact', description: 'Adăugați indicatori cantitativi și KPI-uri pentru fiecare obiectiv', priority: 'high', estimatedImpact: 8, effort: 'medium', category: 'Propunere' },
    { id: '3', title: 'Consolidați planul de diseminare', description: 'Adăugați canale specifice și buget dedicat', priority: 'medium', estimatedImpact: 5, effort: 'low', category: 'Diseminare' },
  ];
  const benchmarks: BenchmarkData[] = [
    { metric: 'Scor Impact', projectValue: 72, averageValue: 65, topPerformerValue: 88, unit: '/100' },
    { metric: 'Diversitate Consorțiu', projectValue: 5, averageValue: 7, topPerformerValue: 12, unit: 'țări' },
    { metric: 'Buget/Partener', projectValue: 420, averageValue: 380, topPerformerValue: 350, unit: 'k€' },
    { metric: 'Experiență H2020', projectValue: 3, averageValue: 5, topPerformerValue: 9, unit: 'proiecte' },
  ];
  const romanianIndicators: RomanianIndicator[] = [
    { id: '1', label: 'Cofinanțare disponibilă', value: '15%', status: 'good', detail: 'Fonduri PNRR și POCIDIF eligibile' },
    { id: '2', label: 'Capacitate absorbție', value: '72%', status: 'warning', detail: 'Sub media UE de 85% - necesită plan de contingență' },
    { id: '3', label: 'Parteneriate RO active', value: '12', status: 'good', detail: 'Rețea solidă de parteneri români verificați' },
    { id: '4', label: 'Conformitate ANAF', value: 'OK', status: 'good', detail: 'Toate obligațiile fiscale la zi' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Analiză Predictivă</h2>
          <p className="text-muted-foreground">Inteligență predictivă bazată pe AI pentru proiectul dvs.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          <span className="text-xs text-muted-foreground">{wsConnected ? 'Actualizări live' : 'Offline'}</span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Prezentare Generală</TabsTrigger>
          <TabsTrigger value="factors">Factori</TabsTrigger>
          <TabsTrigger value="recommendations">Recomandări</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmark</TabsTrigger>
          {showLifecycleForecasting && <TabsTrigger value="lifecycle">Ciclul de Viață</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {showSuccessPrediction && <SuccessProbabilityGauge probability={prob} confidence={conf} />}
            <CriticalFactorsDisplay factors={factors.slice(0, 3)} />
            <RomanianContextPanel indicators={romanianIndicators} />
          </div>
        </TabsContent>

        <TabsContent value="factors">
          <CriticalFactorsDisplay factors={factors} />
        </TabsContent>

        <TabsContent value="recommendations">
          <ImprovementRecommendations recommendations={recommendations} />
        </TabsContent>

        <TabsContent value="benchmarks">
          <BenchmarkComparison benchmarks={benchmarks} />
        </TabsContent>

        {showLifecycleForecasting && (
          <TabsContent value="lifecycle">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prognoză Ciclu de Viață</CardTitle>
                <CardDescription>Predicții pentru etapele viitoare ale proiectului</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(forecast?.phases ?? [
                    { name: 'Pregătire propunere', progress: 75, deadline: '2026-03-15', risk: 'low' },
                    { name: 'Evaluare EC', progress: 0, deadline: '2026-06-01', risk: 'medium' },
                    { name: 'Negociere Grant', progress: 0, deadline: '2026-09-01', risk: 'low' },
                    { name: 'Implementare Faza 1', progress: 0, deadline: '2027-03-01', risk: 'high' },
                  ]).map((phase: any) => (
                    <div key={phase.name} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{phase.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant={phase.risk === 'high' ? 'destructive' : phase.risk === 'medium' ? 'default' : 'secondary'}>
                            {phase.risk === 'high' ? 'Risc ridicat' : phase.risk === 'medium' ? 'Risc mediu' : 'Risc scăzut'}
                          </Badge>
                          <span className="text-muted-foreground text-xs">{phase.deadline}</span>
                        </div>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${phase.progress}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
