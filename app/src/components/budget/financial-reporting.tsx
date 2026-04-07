'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { BudgetCategory } from './budget-dashboard';
import { formatCurrency as formatCurrencyBase } from '@/lib/utils';

interface ReportEntry {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  currency: 'EUR' | 'RON';
  exchangeRate?: number;
  amountEur: number;
  partnerId?: string;
  partnerName?: string;
  documentRef?: string;
  euEligible: boolean;
  approved: boolean;
}

interface FinancialReportingProps {
  entries: ReportEntry[];
  categories: BudgetCategory[];
  projectTitle: string;
  reportingPeriod?: { start: string; end: string };
  onExportExcel?: () => void;
  onExportPdf?: () => void;
  onGenerateAuditReport?: () => void;
}

function formatCurrency(n: number, c: string = 'EUR'): string {
  return formatCurrencyBase(n, c, 2);
}

export function FinancialReporting({
  entries, categories, projectTitle, reportingPeriod,
  onExportExcel, onExportPdf, onGenerateAuditReport,
}: FinancialReportingProps) {
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterPartner, setFilterPartner] = useState('all');
  const [filterEligible, setFilterEligible] = useState('all');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const partners = useMemo(() => {
    const set = new Set(entries.filter(e => e.partnerName).map(e => e.partnerName!));
    return Array.from(set);
  }, [entries]);

  const filtered = useMemo(() => {
    let list = [...entries];
    if (filterCategory !== 'all') list = list.filter(e => e.category === filterCategory);
    if (filterPartner !== 'all') list = list.filter(e => e.partnerName === filterPartner);
    if (filterEligible === 'eligible') list = list.filter(e => e.euEligible);
    else if (filterEligible === 'ineligible') list = list.filter(e => !e.euEligible);

    list.sort((a, b) => {
      const cmp = sortBy === 'date'
        ? a.date.localeCompare(b.date)
        : a.amountEur - b.amountEur;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [entries, filterCategory, filterPartner, filterEligible, sortBy, sortDir]);

  const totals = useMemo(() => {
    const totalEur = filtered.reduce((s, e) => s + e.amountEur, 0);
    const eligibleEur = filtered.filter(e => e.euEligible).reduce((s, e) => s + e.amountEur, 0);
    const approvedEur = filtered.filter(e => e.approved).reduce((s, e) => s + e.amountEur, 0);
    return { totalEur, eligibleEur, approvedEur };
  }, [filtered]);

  // Category summary for audit report
  const categorySummary = useMemo(() => {
    return categories.map(cat => {
      const catEntries = entries.filter(e => e.category === cat.id || e.category === cat.name);
      const total = catEntries.reduce((s, e) => s + e.amountEur, 0);
      return { ...cat, reportedSpent: total, entries: catEntries.length };
    });
  }, [categories, entries]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold">Raportare Financiară</h2>
          <p className="text-sm text-muted-foreground">{projectTitle}</p>
          {reportingPeriod && (
            <p className="text-xs text-muted-foreground">
              Perioada: {new Date(reportingPeriod.start).toLocaleDateString('ro-RO')} –{' '}
              {new Date(reportingPeriod.end).toLocaleDateString('ro-RO')}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {onExportExcel && (
            <Button variant="outline" size="sm" onClick={onExportExcel}>📊 Export Excel</Button>
          )}
          {onExportPdf && (
            <Button variant="outline" size="sm" onClick={onExportPdf}>📄 Export PDF</Button>
          )}
          {onGenerateAuditReport && (
            <Button size="sm" onClick={onGenerateAuditReport}>🔍 Raport Audit UE</Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Total raportat</p>
            <p className="text-lg font-bold">{formatCurrency(totals.totalEur)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Eligibil UE</p>
            <p className="text-lg font-bold text-blue-600">{formatCurrency(totals.eligibleEur)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Aprobat</p>
            <p className="text-lg font-bold text-green-600">{formatCurrency(totals.approvedEur)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Înregistrări</p>
            <p className="text-lg font-bold">{filtered.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Category summary for audit */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rezumat pe Categorii (Audit-ready)</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categorie</TableHead>
                <TableHead className="text-right">Alocat</TableHead>
                <TableHead className="text-right">Raportat</TableHead>
                <TableHead className="text-right">Diferență</TableHead>
                <TableHead className="text-right">% Utilizat</TableHead>
                <TableHead>Eligibil UE</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {categorySummary.map(cat => {
                const diff = cat.allocated - cat.reportedSpent;
                const pct = cat.allocated > 0 ? (cat.reportedSpent / cat.allocated) * 100 : 0;
                return (
                  <TableRow key={cat.id}>
                    <TableCell className="font-medium text-sm">{cat.nameRo}</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(cat.allocated)}</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(cat.reportedSpent)}</TableCell>
                    <TableCell className={`text-right text-sm ${diff < 0 ? 'text-red-600' : ''}`}>
                      {formatCurrency(diff)}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      <Badge variant={pct > 100 ? 'destructive' : pct > 80 ? 'secondary' : 'outline'}>
                        {pct.toFixed(1)}%
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {cat.euEligible ? '✅' : '❌'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detailed entries with filters */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
            <CardTitle className="text-sm">Detalii Cheltuieli</CardTitle>
            <div className="flex gap-2 flex-wrap">
              <select className="h-8 rounded-md border bg-background px-2 text-xs"
                value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
                <option value="all">Toate categoriile</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.nameRo}</option>)}
              </select>
              <select className="h-8 rounded-md border bg-background px-2 text-xs"
                value={filterPartner} onChange={e => setFilterPartner(e.target.value)}>
                <option value="all">Toți partenerii</option>
                {partners.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className="h-8 rounded-md border bg-background px-2 text-xs"
                value={filterEligible} onChange={e => setFilterEligible(e.target.value)}>
                <option value="all">Toate</option>
                <option value="eligible">Eligibil UE</option>
                <option value="ineligible">Neeligibil</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => { setSortBy('date'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                  Data {sortBy === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead>Descriere</TableHead>
                <TableHead>Categorie</TableHead>
                <TableHead>Partener</TableHead>
                <TableHead className="cursor-pointer text-right" onClick={() => { setSortBy('amount'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                  Sumă {sortBy === 'amount' && (sortDir === 'asc' ? '↑' : '↓')}
                </TableHead>
                <TableHead className="text-right">EUR</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nicio înregistrare găsită.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(entry => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm">{new Date(entry.date).toLocaleDateString('ro-RO')}</TableCell>
                    <TableCell className="text-sm max-w-[200px] truncate">{entry.description}</TableCell>
                    <TableCell className="text-xs">{entry.category}</TableCell>
                    <TableCell className="text-xs">{entry.partnerName || '-'}</TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(entry.amount, entry.currency)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {entry.currency !== 'EUR' && (
                        <span className="text-muted-foreground">{formatCurrency(entry.amountEur)}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        {entry.euEligible ? (
                          <Badge variant="outline" className="text-[8px]">Eligibil</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-[8px]">Neeligibil</Badge>
                        )}
                        {entry.approved && (
                          <Badge variant="secondary" className="text-[8px]">✓</Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
