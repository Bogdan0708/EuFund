'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';

export interface BudgetCategory {
  id: string;
  name: string;
  nameRo: string;
  allocated: number;
  spent: number;
  euEligible: boolean;
}

export interface BudgetData {
  totalBudget: number;
  euContribution: number;
  nationalContrib: number;
  ownContrib: number;
  currency: 'EUR' | 'RON';
  exchangeRate?: number; // EUR to RON
  categories: BudgetCategory[];
  monthlySpending?: { month: string; amount: number }[];
}

interface BudgetDashboardProps {
  data: BudgetData;
  showForecast?: boolean;
}

function ProgressBar({ value, max, color = 'bg-primary', warn = 80, danger = 95 }: {
  value: number; max: number; color?: string; warn?: number; danger?: number;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barColor = pct >= danger ? 'bg-red-500' : pct >= warn ? 'bg-orange-500' : color;
  return (
    <div className="h-2 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function BudgetDashboard({ data, showForecast }: BudgetDashboardProps) {
  const totalSpent = useMemo(() => data.categories.reduce((s, c) => s + c.spent, 0), [data.categories]);
  const totalAllocated = useMemo(() => data.categories.reduce((s, c) => s + c.allocated, 0), [data.categories]);
  const spentPct = data.totalBudget > 0 ? (totalSpent / data.totalBudget) * 100 : 0;
  const secondaryCurrency = data.currency === 'EUR' ? 'RON' : 'EUR';
  const rate = data.exchangeRate || 4.97;

  const complianceIssues = useMemo(() => {
    const issues: string[] = [];
    data.categories.forEach(c => {
      if (c.spent > c.allocated) issues.push(`${c.nameRo}: depășire buget (${formatCurrency(c.spent - c.allocated, data.currency)})`);
      if (!c.euEligible && c.spent > 0) issues.push(`${c.nameRo}: cheltuieli neeligibile UE`);
    });
    if (totalAllocated > data.totalBudget) issues.push('Alocări totale depășesc bugetul proiectului');
    return issues;
  }, [data, totalAllocated]);

  // Simple forecast: average monthly spending * remaining months
  const forecast = useMemo(() => {
    if (!data.monthlySpending?.length) return null;
    const avg = data.monthlySpending.reduce((s, m) => s + m.amount, 0) / data.monthlySpending.length;
    const remaining = data.totalBudget - totalSpent;
    const monthsLeft = avg > 0 ? Math.ceil(remaining / avg) : 0;
    return { avgMonthly: avg, monthsLeft, projectedTotal: totalSpent + avg * 6 };
  }, [data, totalSpent]);

  return (
    <div className="space-y-6">
      {/* Top-level KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Buget Total</p>
            <p className="text-xl font-bold">{formatCurrency(data.totalBudget, data.currency)}</p>
            <p className="text-[10px] text-muted-foreground">
              ≈ {formatCurrency(data.totalBudget * (data.currency === 'EUR' ? rate : 1 / rate), secondaryCurrency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Contribuție UE</p>
            <p className="text-xl font-bold text-blue-600">{formatCurrency(data.euContribution, data.currency)}</p>
            <p className="text-[10px] text-muted-foreground">
              {data.totalBudget > 0 ? ((data.euContribution / data.totalBudget) * 100).toFixed(0) : 0}%
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Cheltuit</p>
            <p className={`text-xl font-bold ${spentPct > 90 ? 'text-red-600' : ''}`}>
              {formatCurrency(totalSpent, data.currency)}
            </p>
            <p className="text-[10px] text-muted-foreground">{spentPct.toFixed(1)}% din total</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Disponibil</p>
            <p className="text-xl font-bold text-green-600">
              {formatCurrency(data.totalBudget - totalSpent, data.currency)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Conformitate</p>
            <p className={`text-xl font-bold ${complianceIssues.length === 0 ? 'text-green-600' : 'text-red-600'}`}>
              {complianceIssues.length === 0 ? '✅' : `⚠️ ${complianceIssues.length}`}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {complianceIssues.length === 0 ? 'Conform' : 'Probleme'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Overall progress */}
      <Card>
        <CardContent className="p-4">
          <div className="flex justify-between text-sm mb-2">
            <span>Execuție bugetară</span>
            <span className="font-medium">{spentPct.toFixed(1)}%</span>
          </div>
          <ProgressBar value={totalSpent} max={data.totalBudget} />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>{formatCurrency(totalSpent, data.currency)} cheltuit</span>
            <span>{formatCurrency(data.totalBudget - totalSpent, data.currency)} rămas</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Category breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Categorii de Cheltuieli</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.categories.map(cat => {
              return (
                <div key={cat.id} className="space-y-1">
                  <div className="flex justify-between items-center text-sm">
                    <span className="flex items-center gap-1">
                      {cat.nameRo}
                      {!cat.euEligible && <Badge variant="outline" className="text-[8px]">Neeligibil UE</Badge>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatCurrency(cat.spent, data.currency)} / {formatCurrency(cat.allocated, data.currency)}
                    </span>
                  </div>
                  <ProgressBar value={cat.spent} max={cat.allocated} />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Funding sources pie-like */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Surse de Finanțare</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: 'Contribuție UE', amount: data.euContribution, color: 'bg-blue-500' },
              { label: 'Contribuție națională', amount: data.nationalContrib, color: 'bg-green-500' },
              { label: 'Contribuție proprie', amount: data.ownContrib, color: 'bg-orange-500' },
            ].map(source => {
              const pct = data.totalBudget > 0 ? (source.amount / data.totalBudget) * 100 : 0;
              return (
                <div key={source.label} className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <span className={`w-3 h-3 rounded-sm ${source.color}`} />
                      {source.label}
                    </span>
                    <span>{formatCurrency(source.amount, data.currency)} ({pct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${source.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Compliance alerts */}
      {complianceIssues.length > 0 && (
        <Card className="border-red-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-600">⚠️ Alerte de Conformitate</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {complianceIssues.map((issue, i) => (
                <li key={i} className="text-sm text-red-600 flex items-center gap-2">
                  <span className="w-1 h-1 rounded-full bg-red-500" />
                  {issue}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Forecast */}
      {showForecast && forecast && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">📈 Proiecție Bugetară</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-lg font-bold">{formatCurrency(forecast.avgMonthly, data.currency)}</p>
              <p className="text-xs text-muted-foreground">Media lunară</p>
            </div>
            <div>
              <p className="text-lg font-bold">{forecast.monthsLeft}</p>
              <p className="text-xs text-muted-foreground">Luni estimate rămase</p>
            </div>
            <div>
              <p className={`text-lg font-bold ${forecast.projectedTotal > data.totalBudget ? 'text-red-600' : 'text-green-600'}`}>
                {formatCurrency(forecast.projectedTotal, data.currency)}
              </p>
              <p className="text-xs text-muted-foreground">Total proiectat (6 luni)</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly spending chart (simple bar) */}
      {data.monthlySpending && data.monthlySpending.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Cheltuieli Lunare</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-32">
              {data.monthlySpending.map((m, i) => {
                const maxAmount = Math.max(...data.monthlySpending!.map(x => x.amount));
                const height = maxAmount > 0 ? (m.amount / maxAmount) * 100 : 0;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[8px] text-muted-foreground">{formatCurrency(m.amount, data.currency)}</span>
                    <div className="w-full bg-primary/70 rounded-t" style={{ height: `${height}%`, minHeight: 2 }} />
                    <span className="text-[8px] text-muted-foreground">{m.month}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
