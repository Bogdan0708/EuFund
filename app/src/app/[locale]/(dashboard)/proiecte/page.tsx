'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Download, Eye, FileUp, Filter, Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/page-states';
import { StatusBadge } from '@/components/ui/status-badge';

interface Project {
  id: string;
  title: string;
  acronym?: string;
  status: string;
  updatedAt: string;
  createdAt: string;
  totalBudget?: string | null;
}

type ColumnKey = 'title' | 'status' | 'budget' | 'updatedAt' | 'actions';

const allColumns: Array<{ key: ColumnKey; label: string }> = [
  { key: 'title', label: 'Aplicație' },
  { key: 'status', label: 'Status' },
  { key: 'budget', label: 'Buget' },
  { key: 'updatedAt', label: 'Ultima actualizare' },
  { key: 'actions', label: 'Acțiuni rapide' },
];

const savedFilters = [
  { id: 'all', label: 'Toate aplicațiile', status: 'all' },
  { id: 'review', label: 'În verificare', status: 'verificare' },
  { id: 'drafts', label: 'Ciorne', status: 'ciorna' },
  { id: 'approved', label: 'Aprobate', status: 'aprobat' },
];

function formatCurrency(value: string | null | undefined, locale: string) {
  const numeric = Number(value || 0);
  if (!numeric) return 'N/A';
  return new Intl.NumberFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(numeric);
}

export default function ProjectsPage() {
  const params = useParams<{ locale?: string }>();
  const locale = params.locale || 'ro';

  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [visibleColumns, setVisibleColumns] = useState<ColumnKey[]>(allColumns.map((column) => column.key));

  useEffect(() => {
    const storedColumns = localStorage.getItem('eufund:applications:columns');
    if (storedColumns) {
      try {
        const parsed = JSON.parse(storedColumns) as ColumnKey[];
        if (parsed.length > 0) setVisibleColumns(parsed);
      } catch {
        // ignore invalid local storage
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('eufund:applications:columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  useEffect(() => {
    const loadProjects = async () => {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        query.set('perPage', '200');
        if (search.trim()) query.set('search', search.trim());
        if (status !== 'all') query.set('status', status);

        const res = await fetch(`/api/v1/projects?${query.toString()}`);
        if (!res.ok) throw new Error('Nu s-au putut încărca aplicațiile.');
        const payload = await res.json();
        setItems(payload?.data?.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Eroare neașteptată.');
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, [search, status]);

  const pageSize = 10;
  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page]);

  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const toggleColumn = (column: ColumnKey) => {
    setVisibleColumns((previous) => {
      if (previous.includes(column)) {
        if (previous.length === 1) return previous;
        return previous.filter((item) => item !== column);
      }
      return [...previous, column];
    });
  };

  if (loading) return <LoadingState label="Se încarcă aplicațiile..." />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Apeluri și aplicații"
        description="Urmărește ciornele, depunerile și aplicațiile verificate cu acțiuni rapide."
        rightSlot={
          <Button asChild>
            <Link href={`/${locale}/proiecte/asistent-proiect`}>
              <Plus className="mr-2 h-4 w-4" />
              Aplicație nouă
            </Link>
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Bară de filtrare</CardTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="Caută aplicații..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Caută aplicații"
            />

            <div className="flex flex-wrap gap-2">
              {savedFilters.map((entry) => (
                <Button
                  key={entry.id}
                  variant={status === entry.status ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setStatus(entry.status)}
                  className="gap-1"
                >
                  <Filter className="h-3.5 w-3.5" />
                  {entry.label}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {allColumns.map((column) => (
                <Button
                  key={column.key}
                  variant={visibleColumns.includes(column.key) ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleColumn(column.key)}
                  aria-pressed={visibleColumns.includes(column.key)}
                >
                  {column.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              title="Nu există aplicații încă"
              description="Începe cu o aplicație nouă sau extinde filtrele."
              actionHref={`/${locale}/proiecte/asistent-proiect`}
              actionLabel="Creează aplicație"
            />
          ) : (
            <div className="space-y-3">
              <div className="max-h-[520px] overflow-auto rounded-xl border bg-white shadow-inner">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      {visibleColumns.includes('title') && <TableHead>Aplicație</TableHead>}
                      {visibleColumns.includes('status') && <TableHead>Status</TableHead>}
                      {visibleColumns.includes('budget') && <TableHead>Buget</TableHead>}
                      {visibleColumns.includes('updatedAt') && <TableHead>Ultima actualizare</TableHead>}
                      {visibleColumns.includes('actions') && <TableHead>Acțiuni rapide</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedItems.map((project) => (
                      <TableRow key={project.id} className="hover:bg-slate-50">
                        {visibleColumns.includes('title') && (
                          <TableCell>
                            <div>
                              <p className="font-medium">{project.title}</p>
                              {project.acronym && <p className="text-xs text-muted-foreground">{project.acronym}</p>}
                            </div>
                          </TableCell>
                        )}
                        {visibleColumns.includes('status') && (
                          <TableCell>
                            <StatusBadge kind="project" value={project.status} />
                          </TableCell>
                        )}
                        {visibleColumns.includes('budget') && <TableCell>{formatCurrency(project.totalBudget, locale)}</TableCell>}
                        {visibleColumns.includes('updatedAt') && (
                          <TableCell>{new Date(project.updatedAt).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}</TableCell>
                        )}
                        {visibleColumns.includes('actions') && (
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/${locale}/proiecte/${project.id}`}>
                                  <Eye className="mr-1 h-3.5 w-3.5" />
                                  Vezi
                                </Link>
                              </Button>
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/${locale}/proiecte/${project.id}`}>
                                  <FileUp className="mr-1 h-3.5 w-3.5" />
                                  Continuă
                                </Link>
                              </Button>
                              <Button variant="outline" size="sm" disabled={project.status === 'depus'}>
                                <Send className="mr-1 h-3.5 w-3.5" />
                                Depune
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Se afișează {pagedItems.length} din {items.length} înregistrări
                </p>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Anterior
                  </Button>
                  <span className="text-sm">{page} / {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                    Următor
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => alert('Exportul folosește filtrarea curentă.')}>
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Exportă
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
