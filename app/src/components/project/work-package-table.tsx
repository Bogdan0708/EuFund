'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { WorkPackage } from '@/types/work-packages';
import { formatCurrency } from '@/lib/utils';

interface WorkPackageTableProps {
  workPackages: WorkPackage[];
  onRowClick?: (wp: WorkPackage) => void;
}

type SortKey = 'name' | 'status' | 'startDate' | 'endDate' | 'budgetAllocated' | 'progress';
type SortDir = 'asc' | 'desc';

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planificat', active: 'Activ', completed: 'Finalizat',
  delayed: 'Întârziat', cancelled: 'Anulat',
};
const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  planned: 'outline', active: 'default', completed: 'secondary',
  delayed: 'destructive', cancelled: 'outline',
};

function getProgress(wp: WorkPackage): number {
  if (!wp.milestones?.length) return wp.status === 'completed' ? 100 : 0;
  return Math.round((wp.milestones.filter(m => m.completed).length / wp.milestones.length) * 100);
}

export function WorkPackageTable({
  workPackages, onRowClick,
}: WorkPackageTableProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('startDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const filtered = useMemo(() => {
    let list = [...workPackages];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(wp => wp.name.toLowerCase().includes(q) || wp.description?.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      list = list.filter(wp => wp.status === statusFilter);
    }
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'status': cmp = a.status.localeCompare(b.status); break;
        case 'startDate': cmp = (a.startDate || '').localeCompare(b.startDate || ''); break;
        case 'endDate': cmp = (a.endDate || '').localeCompare(b.endDate || ''); break;
        case 'budgetAllocated': cmp = (a.budgetAllocated || 0) - (b.budgetAllocated || 0); break;
        case 'progress': cmp = getProgress(a) - getProgress(b); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [workPackages, search, statusFilter, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => (
    <span className="ml-1 text-muted-foreground">
      {sortKey === k ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
    </span>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <CardTitle className="text-lg">Pachete de Lucru</CardTitle>
          <div className="flex gap-2 flex-wrap">
            <Input
              placeholder="Caută..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-48 h-8 text-sm"
            />
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-sm"
            >
              <option value="all">Toate</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('name')}>
                  Nume <SortIcon k="name" />
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('status')}>
                  Stare <SortIcon k="status" />
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('startDate')}>
                  Început <SortIcon k="startDate" />
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('endDate')}>
                  Sfârșit <SortIcon k="endDate" />
                </TableHead>
                <TableHead className="cursor-pointer text-right" onClick={() => toggleSort('budgetAllocated')}>
                  Buget <SortIcon k="budgetAllocated" />
                </TableHead>
                <TableHead className="cursor-pointer" onClick={() => toggleSort('progress')}>
                  Progres <SortIcon k="progress" />
                </TableHead>
                <TableHead>Dep.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Niciun pachet de lucru găsit
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(wp => {
                  const progress = getProgress(wp);
                  const budgetPct = wp.budgetAllocated
                    ? Math.round((wp.budgetSpent / wp.budgetAllocated) * 100)
                    : 0;

                  return (
                    <TableRow
                      key={wp.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => onRowClick?.(wp)}
                    >
                      <TableCell className="font-medium max-w-[200px]">
                        <span className="truncate block">{wp.name}</span>
                        {wp.deliverables?.length > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            📦 {wp.deliverables.filter(d => d.completed).length}/{wp.deliverables.length}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANTS[wp.status]}>{STATUS_LABELS[wp.status]}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {wp.startDate ? new Date(wp.startDate).toLocaleDateString('ro-RO') : '-'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {wp.endDate ? new Date(wp.endDate).toLocaleDateString('ro-RO') : '-'}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {wp.budgetAllocated ? (
                          <div>
                            <span>{formatCurrency(wp.budgetAllocated)}</span>
                            <div className="h-1 w-16 bg-muted rounded-full ml-auto mt-0.5">
                              <div
                                className={`h-full rounded-full ${budgetPct > 90 ? 'bg-red-500' : 'bg-green-500'}`}
                                style={{ width: `${Math.min(budgetPct, 100)}%` }}
                              />
                            </div>
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 bg-muted rounded-full">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <span className="text-xs">{progress}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {wp.dependencies?.length ? `🔗 ${wp.dependencies.length}` : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
