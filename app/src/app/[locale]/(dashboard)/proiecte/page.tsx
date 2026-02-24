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
  { key: 'title', label: 'Application' },
  { key: 'status', label: 'Status' },
  { key: 'budget', label: 'Budget' },
  { key: 'updatedAt', label: 'Last update' },
  { key: 'actions', label: 'Quick actions' },
];

const savedFilters = [
  { id: 'all', label: 'All applications', status: 'all' },
  { id: 'review', label: 'Pending review', status: 'verificare' },
  { id: 'drafts', label: 'Drafts', status: 'ciorna' },
  { id: 'approved', label: 'Approved', status: 'aprobat' },
];

function formatCurrency(value: string | null | undefined) {
  const numeric = Number(value || 0);
  if (!numeric) return 'N/A';
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(numeric);
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
        if (!res.ok) throw new Error('Could not load applications.');
        const payload = await res.json();
        setItems(payload?.data?.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unexpected error.');
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

  if (loading) return <LoadingState label="Loading applications..." />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calls & Applications"
        description="Track draft, submitted, and reviewed applications with fast actions."
        rightSlot={
          <Button asChild>
            <Link href={`/${locale}/proiecte/nou`}>
              <Plus className="mr-2 h-4 w-4" />
              New Application
            </Link>
          </Button>
        }
      />

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Filter bar</CardTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              placeholder="Search applications..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search applications"
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
              title="No applications yet"
              description="Start with a new application or broaden your filters."
              actionHref={`/${locale}/proiecte/nou`}
              actionLabel="Create Application"
            />
          ) : (
            <div className="space-y-3">
              <div className="max-h-[520px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      {visibleColumns.includes('title') && <TableHead>Application</TableHead>}
                      {visibleColumns.includes('status') && <TableHead>Status</TableHead>}
                      {visibleColumns.includes('budget') && <TableHead>Budget</TableHead>}
                      {visibleColumns.includes('updatedAt') && <TableHead>Last update</TableHead>}
                      {visibleColumns.includes('actions') && <TableHead>Quick actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedItems.map((project) => (
                      <TableRow key={project.id}>
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
                        {visibleColumns.includes('budget') && <TableCell>{formatCurrency(project.totalBudget)}</TableCell>}
                        {visibleColumns.includes('updatedAt') && (
                          <TableCell>{new Date(project.updatedAt).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}</TableCell>
                        )}
                        {visibleColumns.includes('actions') && (
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/${locale}/proiecte/${project.id}`}>
                                  <Eye className="mr-1 h-3.5 w-3.5" />
                                  View
                                </Link>
                              </Button>
                              <Button asChild variant="outline" size="sm">
                                <Link href={`/${locale}/proiecte/${project.id}`}>
                                  <FileUp className="mr-1 h-3.5 w-3.5" />
                                  Continue
                                </Link>
                              </Button>
                              <Button variant="outline" size="sm" disabled={project.status === 'depus'}>
                                <Send className="mr-1 h-3.5 w-3.5" />
                                Submit
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
                  Showing {pagedItems.length} of {items.length} entries
                </p>

                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    Previous
                  </Button>
                  <span className="text-sm">{page} / {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                    Next
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => alert('Export uses the current filtered view.')}>
                    <Download className="mr-1 h-3.5 w-3.5" />
                    Export
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
