'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface Partner {
  id: string;
  name: string;
  cui?: string;
  role: 'coordinator' | 'partner' | 'observer';
  country: string;
  budgetAllocated: number;
  budgetSpent: number;
  contactName?: string;
  contactEmail?: string;
  workPackages: string[];
  performanceScore?: number;
  joinedAt: string;
}

interface CommunicationEntry {
  id: string;
  partnerId: string;
  type: 'message' | 'meeting' | 'decision' | 'document';
  title: string;
  date: string;
  summary?: string;
}

interface PartnerDashboardProps {
  partners: Partner[];
  communications?: CommunicationEntry[];
  currentUserRole?: 'coordinator' | 'partner' | 'observer';
  onPartnerClick?: (partner: Partner) => void;
  onInvite?: () => void;
}

const ROLE_LABELS: Record<string, string> = {
  coordinator: 'Coordonator', partner: 'Partener', observer: 'Observator',
};
const ROLE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  coordinator: 'default', partner: 'secondary', observer: 'outline',
};

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

function PerformanceIndicator({ score }: { score?: number }) {
  if (score == null) return <span className="text-xs text-muted-foreground">N/A</span>;
  const color = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-yellow-600' : 'text-red-600';
  return <span className={`text-sm font-bold ${color}`}>{score}%</span>;
}

export function PartnerDashboard({
  partners, communications = [], currentUserRole = 'coordinator',
  onPartnerClick, onInvite,
}: PartnerDashboardProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const totalBudget = partners.reduce((s, p) => s + p.budgetAllocated, 0);
  const totalSpent = partners.reduce((s, p) => s + p.budgetSpent, 0);
  const coordinator = partners.find(p => p.role === 'coordinator');

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{partners.length}</p>
            <p className="text-xs text-muted-foreground">Parteneri</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{partners.filter(p => p.role === 'partner').length + 1}</p>
            <p className="text-xs text-muted-foreground">Organizații active</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{formatCurrency(totalBudget)}</p>
            <p className="text-xs text-muted-foreground">Buget total alocat</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold">{totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0}%</p>
            <p className="text-xs text-muted-foreground">Buget utilizat</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview">Prezentare generală</TabsTrigger>
          <TabsTrigger value="contributions">Contribuții</TabsTrigger>
          <TabsTrigger value="timeline">Comunicare</TabsTrigger>
          <TabsTrigger value="performance">Performanță</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {partners.map(partner => (
              <Card
                key={partner.id}
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => onPartnerClick?.(partner)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPartnerClick?.(partner);
                  }
                }}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm">{partner.name}</CardTitle>
                      <CardDescription className="text-xs">{partner.country} {partner.cui && `· CUI: ${partner.cui}`}</CardDescription>
                    </div>
                    <Badge variant={ROLE_VARIANTS[partner.role]}>{ROLE_LABELS[partner.role]}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Buget</span>
                    <span>{formatCurrency(partner.budgetAllocated)}</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full">
                    <div
                      className="h-full bg-primary rounded-full"
                      style={{ width: `${partner.budgetAllocated > 0 ? Math.min((partner.budgetSpent / partner.budgetAllocated) * 100, 100) : 0}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Pachete: {partner.workPackages.length}</span>
                    <PerformanceIndicator score={partner.performanceScore} />
                  </div>
                  {partner.contactName && (
                    <p className="text-[10px] text-muted-foreground">
                      👤 {partner.contactName} {partner.contactEmail && `· ${partner.contactEmail}`}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}

            {currentUserRole === 'coordinator' && (
              <Card
                className="border-dashed cursor-pointer hover:bg-muted/50 flex items-center justify-center min-h-[200px]"
                onClick={onInvite}
              >
                <CardContent className="text-center text-muted-foreground">
                  <p className="text-3xl mb-2">➕</p>
                  <p className="text-sm">Adaugă partener</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="contributions" className="mt-4">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                {partners
                  .sort((a, b) => b.budgetAllocated - a.budgetAllocated)
                  .map(p => {
                    const pct = totalBudget > 0 ? (p.budgetAllocated / totalBudget) * 100 : 0;
                    return (
                      <div key={p.id} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{p.name}</span>
                          <span>{formatCurrency(p.budgetAllocated)} ({pct.toFixed(1)}%)</span>
                        </div>
                        <div className="h-3 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary/70 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground">
                          <span>Cheltuit: {formatCurrency(p.budgetSpent)}</span>
                          <span>Restant: {formatCurrency(p.budgetAllocated - p.budgetSpent)}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <Card>
            <CardContent className="p-6">
              {communications.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nicio comunicare înregistrată încă.
                </p>
              ) : (
                <div className="space-y-4">
                  {communications
                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                    .map(entry => (
                      <div key={entry.id} className="flex gap-3 border-l-2 pl-4 py-1 border-muted">
                        <div className="text-lg">
                          {entry.type === 'meeting' ? '📅' :
                           entry.type === 'decision' ? '⚖️' :
                           entry.type === 'document' ? '📄' : '💬'}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{entry.title}</p>
                          {entry.summary && <p className="text-xs text-muted-foreground">{entry.summary}</p>}
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {new Date(entry.date).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' })}
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="mt-4">
          <Card>
            <CardContent className="p-6">
              <div className="space-y-4">
                {partners.map(p => (
                  <div key={p.id} className="flex items-center gap-4">
                    <div className="w-48 truncate font-medium text-sm">{p.name}</div>
                    <div className="flex-1">
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            (p.performanceScore || 0) >= 80 ? 'bg-green-500' :
                            (p.performanceScore || 0) >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${p.performanceScore || 0}%` }}
                        />
                      </div>
                    </div>
                    <PerformanceIndicator score={p.performanceScore} />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
