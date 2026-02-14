'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Integration {
  id: string;
  name: string;
  type: 'government' | 'eu' | 'market' | 'internal';
  status: 'connected' | 'degraded' | 'disconnected' | 'error';
  lastSync: string;
  latency: number; // ms
  errorCount: number;
  description: string;
}

interface GovernmentAPI {
  id: string;
  name: string;
  provider: string;
  status: 'active' | 'maintenance' | 'offline';
  lastCheck: string;
}

interface MarketDataSource {
  id: string;
  name: string;
  type: string;
  freshness: string;
  records: number;
}

interface IntegrationDashboardProps {
  activeIntegrations: Integration[];
  governmentAPIs: GovernmentAPI[];
  marketDataSources: MarketDataSource[];
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function IntegrationStatusCard({ integration }: { integration: Integration }) {
  const statusConfig: Record<string, { color: string; label: string; icon: string }> = {
    connected: { color: 'bg-green-500', label: 'Conectat', icon: '✅' },
    degraded: { color: 'bg-yellow-500', label: 'Degradat', icon: '⚠️' },
    disconnected: { color: 'bg-gray-400', label: 'Deconectat', icon: '⭕' },
    error: { color: 'bg-red-500', label: 'Eroare', icon: '❌' },
  };

  const config = statusConfig[integration.status];

  return (
    <Card className={integration.status === 'error' ? 'border-destructive' : ''}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${config.color} ${integration.status === 'connected' ? 'animate-pulse' : ''}`} />
            <div>
              <p className="font-medium text-sm">{integration.name}</p>
              <p className="text-xs text-muted-foreground">{integration.description}</p>
            </div>
          </div>
          <div className="text-right">
            <Badge variant={integration.status === 'connected' ? 'default' : integration.status === 'error' ? 'destructive' : 'secondary'} className="text-xs">
              {config.icon} {config.label}
            </Badge>
            <p className="text-xs text-muted-foreground mt-1">{integration.latency}ms • {integration.lastSync}</p>
          </div>
        </div>
        {integration.errorCount > 0 && (
          <div className="mt-2 p-2 bg-destructive/10 rounded text-xs text-destructive flex items-center justify-between">
            <span>{integration.errorCount} erori în ultimele 24h</span>
            <Button size="sm" variant="outline" className="h-6 text-xs">Reîncercați</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GovernmentAPIPanel({ apis }: { apis: GovernmentAPI[] }) {
  const statusIcons: Record<string, string> = { active: '🟢', maintenance: '🟡', offline: '🔴' };
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">API-uri Guvernamentale România 🇷🇴</CardTitle>
        <CardDescription>Starea sincronizării cu bazele de date ale statului</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {apis.map((api) => (
            <div key={api.id} className="flex items-center justify-between p-2 rounded border">
              <div className="flex items-center gap-2">
                <span>{statusIcons[api.status]}</span>
                <div>
                  <p className="text-sm font-medium">{api.name}</p>
                  <p className="text-xs text-muted-foreground">{api.provider}</p>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Verificat: {api.lastCheck}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function MarketDataPanel({ sources }: { sources: MarketDataSource[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Surse Date Piață</CardTitle>
        <CardDescription>Feed-uri de inteligență competitivă și oportunități</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {sources.map((src) => (
            <div key={src.id} className="flex items-center justify-between p-2 rounded border">
              <div>
                <p className="text-sm font-medium">{src.name}</p>
                <p className="text-xs text-muted-foreground">{src.type}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-mono">{src.records.toLocaleString()} înregistrări</p>
                <p className="text-xs text-muted-foreground">Actualizat: {src.freshness}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function IntegrationDashboard({ activeIntegrations, governmentAPIs, marketDataSources }: IntegrationDashboardProps) {
  // Default mock data
  const integrations = activeIntegrations.length > 0 ? activeIntegrations : [
    { id: '1', name: 'ONRC (Registrul Comerțului)', type: 'government' as const, status: 'connected' as const, lastSync: 'acum 5 min', latency: 120, errorCount: 0, description: 'Verificare companii românești' },
    { id: '2', name: 'ANAF', type: 'government' as const, status: 'connected' as const, lastSync: 'acum 15 min', latency: 250, errorCount: 0, description: 'Conformitate fiscală' },
    { id: '3', name: 'SICAP', type: 'government' as const, status: 'degraded' as const, lastSync: 'acum 1 oră', latency: 1200, errorCount: 3, description: 'Achiziții publice România' },
    { id: '4', name: 'EC Funding & Tenders Portal', type: 'eu' as const, status: 'connected' as const, lastSync: 'acum 2 min', latency: 85, errorCount: 0, description: 'Portal finanțări CE' },
    { id: '5', name: 'CORDIS', type: 'eu' as const, status: 'connected' as const, lastSync: 'acum 30 min', latency: 190, errorCount: 0, description: 'Baza de date proiecte UE' },
    { id: '6', name: 'OpenAI API', type: 'internal' as const, status: 'connected' as const, lastSync: 'acum 1 min', latency: 45, errorCount: 0, description: 'Motor AI predictiv' },
    { id: '7', name: 'EUR-Lex', type: 'eu' as const, status: 'error' as const, lastSync: 'acum 3 ore', latency: 0, errorCount: 12, description: 'Legislație europeană' },
  ];

  const govAPIs = governmentAPIs.length > 0 ? governmentAPIs : [
    { id: '1', name: 'ONRC API', provider: 'Oficiul Registrului Comerțului', status: 'active' as const, lastCheck: 'acum 5 min' },
    { id: '2', name: 'ANAF WebService', provider: 'Agenția Națională de Administrare Fiscală', status: 'active' as const, lastCheck: 'acum 15 min' },
    { id: '3', name: 'SICAP API', provider: 'Agenția Națională pentru Achiziții Publice', status: 'maintenance' as const, lastCheck: 'acum 1 oră' },
    { id: '4', name: 'MySMIS 2021+', provider: 'Ministerul Investițiilor și Proiectelor Europene', status: 'active' as const, lastCheck: 'acum 10 min' },
  ];

  const dataSources = marketDataSources.length > 0 ? marketDataSources : [
    { id: '1', name: 'EU Funding Opportunities', type: 'Oportunități', freshness: 'acum 2 min', records: 1247 },
    { id: '2', name: 'Partner Database', type: 'Parteneri', freshness: 'acum 1 oră', records: 8543 },
    { id: '3', name: 'EU Project Results', type: 'Benchmark', freshness: 'zilnic', records: 45200 },
    { id: '4', name: 'Romanian Market Intel', type: 'Piață RO', freshness: 'acum 30 min', records: 2341 },
  ];

  const connectedCount = integrations.filter((i) => i.status === 'connected').length;
  const errorCount = integrations.filter((i) => i.status === 'error').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Management Integrări</h2>
          <p className="text-muted-foreground">Monitorizare în timp real a tuturor conexiunilor externe</p>
        </div>
        <div className="flex gap-2">
          <Badge variant="default">{connectedCount} conectate</Badge>
          {errorCount > 0 && <Badge variant="destructive">{errorCount} erori</Badge>}
        </div>
      </div>

      {/* Overall health */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Total Integrări', value: integrations.length, icon: '🔗' },
          { label: 'Conectate', value: connectedCount, icon: '✅' },
          { label: 'Cu Probleme', value: integrations.filter((i) => i.status === 'degraded' || i.status === 'error').length, icon: '⚠️' },
          { label: 'Latență Medie', value: `${Math.round(integrations.reduce((s, i) => s + i.latency, 0) / integrations.length)}ms`, icon: '⚡' },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-3 text-center">
              <span className="text-xl">{stat.icon}</span>
              <p className="text-xl font-bold mt-1">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Integration cards */}
      <div className="space-y-3">
        <h3 className="font-semibold">Stare Integrări</h3>
        {integrations.map((integration) => (
          <IntegrationStatusCard key={integration.id} integration={integration} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GovernmentAPIPanel apis={govAPIs} />
        <MarketDataPanel sources={dataSources} />
      </div>
    </div>
  );
}
