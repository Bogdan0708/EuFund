'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdvancedAnalytics } from '@/hooks/use-advanced-analytics';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ProjectAnalyticsProps {
  projectId: string;
  analyticsType: 'performance' | 'predictive' | 'competitive';
  timeRange: 'realtime' | '7d' | '30d' | 'lifetime';
}

interface KPI {
  id: string;
  name: string;
  value: number;
  previousValue: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  target?: number;
}

interface RiskCell {
  category: string;
  dimension: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'none';
  description: string;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KPICard({ kpi }: { kpi: KPI }) {
  const change = kpi.previousValue ? ((kpi.value - kpi.previousValue) / kpi.previousValue * 100) : 0;
  const trendIcon = kpi.trend === 'up' ? '↑' : kpi.trend === 'down' ? '↓' : '→';
  const trendColor = kpi.trend === 'up' ? 'text-green-600' : kpi.trend === 'down' ? 'text-red-600' : 'text-gray-500';

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{kpi.name}</p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-2xl font-bold">{kpi.value.toLocaleString()}</span>
          <span className="text-sm text-muted-foreground">{kpi.unit}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-xs font-medium ${trendColor}`}>{trendIcon} {change >= 0 ? '+' : ''}{change.toFixed(1)}%</span>
          {kpi.target && (
            <span className="text-xs text-muted-foreground">Țintă: {kpi.target}{kpi.unit}</span>
          )}
        </div>
        {kpi.target && (
          <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${Math.min(100, (kpi.value / kpi.target) * 100)}%` }} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RiskHeatMap({ risks }: { risks: RiskCell[] }) {
  const severityColors: Record<string, string> = {
    critical: 'bg-red-600 text-white',
    high: 'bg-orange-500 text-white',
    medium: 'bg-yellow-400 text-black',
    low: 'bg-green-300 text-black',
    none: 'bg-gray-100 text-gray-400',
  };
  const severityLabels: Record<string, string> = { critical: 'Critic', high: 'Ridicat', medium: 'Mediu', low: 'Scăzut', none: '-' };

  const dimensions = [...new Set(risks.map((r) => r.dimension))];
  const categories = [...new Set(risks.map((r) => r.category))];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Hartă Termică Riscuri</CardTitle>
        <CardDescription>Evaluarea riscurilor pe toate dimensiunile proiectului</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs" role="grid" aria-label="Matrice riscuri">
            <thead>
              <tr>
                <th className="text-left p-2" />
                {dimensions.map((d) => <th key={d} className="p-2 text-center font-medium">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => (
                <tr key={cat}>
                  <td className="p-2 font-medium whitespace-nowrap">{cat}</td>
                  {dimensions.map((dim) => {
                    const cell = risks.find((r) => r.category === cat && r.dimension === dim);
                    const sev = cell?.severity || 'none';
                    return (
                      <td key={dim} className="p-1">
                        <div className={`rounded p-2 text-center cursor-help ${severityColors[sev]}`} title={cell?.description || ''}>
                          {severityLabels[sev]}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ForecastChart({ title, data }: { title: string; data: { label: string; actual?: number; predicted: number }[] }) {
  const maxVal = Math.max(...data.map((d) => Math.max(d.actual ?? 0, d.predicted)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {data.map((d) => (
            <div key={d.label} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span>{d.label}</span>
                <span className="font-mono">{d.actual !== undefined ? `${d.actual} / ` : ''}{d.predicted}</span>
              </div>
              <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                {d.actual !== undefined && (
                  <div className="absolute h-full bg-primary rounded-full z-10" style={{ width: `${(d.actual / maxVal) * 100}%` }} />
                )}
                <div className="absolute h-full bg-primary/30 rounded-full border-r-2 border-dashed border-primary" style={{ width: `${(d.predicted / maxVal) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-3 h-1 bg-primary rounded" /> Actual</span>
          <span className="flex items-center gap-1"><span className="w-3 h-1 bg-primary/30 rounded" /> Predicție</span>
        </div>
      </CardContent>
    </Card>
  );
}

function CompetitiveBenchmark({ metrics }: { metrics: { name: string; yourRank: number; totalProjects: number; percentile: number }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Benchmarking Competitiv</CardTitle>
        <CardDescription>Poziția proiectului vs proiecte UE similare</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {metrics.map((m) => (
            <div key={m.name} className="flex items-center gap-3">
              <span className="text-sm font-medium w-40">{m.name}</span>
              <div className="flex-1 h-3 bg-muted rounded-full relative overflow-hidden">
                <div className="h-full bg-gradient-to-r from-red-400 via-yellow-400 to-green-400 rounded-full" />
                <div className="absolute top-0 h-full w-0.5 bg-black" style={{ left: `${m.percentile}%` }} title={`Percentila ${m.percentile}%`} />
              </div>
              <span className="text-xs font-mono w-20 text-right">#{m.yourRank}/{m.totalProjects}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ProjectAnalytics({ projectId, analyticsType, timeRange }: ProjectAnalyticsProps) {
  const { data: analytics, isLoading } = useAdvancedAnalytics(projectId, analyticsType, timeRange);
  const [selectedTimeRange, setSelectedTimeRange] = useState(timeRange);

  const kpis: KPI[] = analytics?.kpis ?? [
    { id: '1', name: 'Scor Global', value: 78, previousValue: 72, unit: '/100', trend: 'up', target: 85 },
    { id: '2', name: 'Progres Propunere', value: 64, previousValue: 58, unit: '%', trend: 'up', target: 100 },
    { id: '3', name: 'Buget Utilizat', value: 42, previousValue: 35, unit: '%', trend: 'up', target: 100 },
    { id: '4', name: 'Parteneri Confirmați', value: 5, previousValue: 4, unit: '', trend: 'up', target: 8 },
    { id: '5', name: 'Documente Finalizate', value: 12, previousValue: 9, unit: '', trend: 'up', target: 20 },
    { id: '6', name: 'Zile până la deadline', value: 45, previousValue: 52, unit: 'zile', trend: 'down' },
  ];

  const risks: RiskCell[] = analytics?.risks ?? [
    { category: 'Tehnic', dimension: 'Probabilitate', severity: 'medium', description: 'TRL gap moderat' },
    { category: 'Tehnic', dimension: 'Impact', severity: 'high', description: 'Afectează livrabile cheie' },
    { category: 'Tehnic', dimension: 'Mitigare', severity: 'low', description: 'Plan de mitigare solid' },
    { category: 'Financiar', dimension: 'Probabilitate', severity: 'low', description: 'Buget realist' },
    { category: 'Financiar', dimension: 'Impact', severity: 'high', description: 'Cofinanțare esențială' },
    { category: 'Financiar', dimension: 'Mitigare', severity: 'medium', description: 'Surse alternative parțiale' },
    { category: 'Organizațional', dimension: 'Probabilitate', severity: 'high', description: 'Coordonare complexă' },
    { category: 'Organizațional', dimension: 'Impact', severity: 'medium', description: 'Poate întârzia livrabilele' },
    { category: 'Organizațional', dimension: 'Mitigare', severity: 'medium', description: 'Proces de escaladare definit' },
    { category: 'Piață', dimension: 'Probabilitate', severity: 'low', description: 'Cerere stabilă' },
    { category: 'Piață', dimension: 'Impact', severity: 'medium', description: 'Competiție în creștere' },
    { category: 'Piață', dimension: 'Mitigare', severity: 'low', description: 'Diferențiatori puternici' },
  ];

  const forecastData = analytics?.forecast ?? [
    { label: 'T1 2026', actual: 25, predicted: 30 },
    { label: 'T2 2026', actual: 45, predicted: 55 },
    { label: 'T3 2026', predicted: 75 },
    { label: 'T4 2026', predicted: 90 },
    { label: 'T1 2027', predicted: 100 },
  ];

  const competitiveMetrics = analytics?.competitive ?? [
    { name: 'Scor Impact', yourRank: 23, totalProjects: 150, percentile: 85 },
    { name: 'Calitate Consorțiu', yourRank: 45, totalProjects: 150, percentile: 70 },
    { name: 'Inovație', yourRank: 18, totalProjects: 150, percentile: 88 },
    { name: 'Implementare', yourRank: 52, totalProjects: 150, percentile: 65 },
    { name: 'Valoare Buget', yourRank: 67, totalProjects: 150, percentile: 55 },
  ];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]" role="status">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Analiză Avansată Proiect</h2>
          <p className="text-muted-foreground">Vizualizare completă a performanței și predicțiilor</p>
        </div>
        <div className="flex gap-1">
          {(['realtime', '7d', '30d', 'lifetime'] as const).map((range) => (
            <Button key={range} size="sm" variant={selectedTimeRange === range ? 'default' : 'outline'} onClick={() => setSelectedTimeRange(range)}>
              {range === 'realtime' ? 'Live' : range === 'lifetime' ? 'Total' : range}
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpis.map((kpi) => <KPICard key={kpi.id} kpi={kpi} />)}
      </div>

      <Tabs defaultValue="performance">
        <TabsList>
          <TabsTrigger value="performance">Performanță</TabsTrigger>
          <TabsTrigger value="predictive">Predicții</TabsTrigger>
          <TabsTrigger value="competitive">Competiție</TabsTrigger>
          <TabsTrigger value="risks">Riscuri</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="space-y-4">
          <ForecastChart title="Progres Proiect - Actual vs Planificat" data={forecastData} />
        </TabsContent>

        <TabsContent value="predictive" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ForecastChart title="Predicție Buget (%)" data={[
              { label: 'Cheltuieli', actual: 42, predicted: 95 },
              { label: 'Personal', actual: 38, predicted: 90 },
              { label: 'Echipamente', actual: 55, predicted: 85 },
              { label: 'Deplasări', actual: 20, predicted: 80 },
            ]} />
            <ForecastChart title="Predicție Timeline" data={forecastData} />
          </div>
        </TabsContent>

        <TabsContent value="competitive">
          <CompetitiveBenchmark metrics={competitiveMetrics} />
        </TabsContent>

        <TabsContent value="risks">
          <RiskHeatMap risks={risks} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
