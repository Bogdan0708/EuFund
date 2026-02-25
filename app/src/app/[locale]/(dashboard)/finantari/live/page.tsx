'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/page-states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';

interface FundingCall {
  identifier: string;
  title: string;
  description: string;
  programme: string;
  status: 'open' | 'forthcoming' | 'closed';
  openingDate: string;
  deadlineDate: string;
  budget: number | null;
  url: string;
}

function formatCurrency(value: number | null, locale: string) {
  if (!value) return 'N/A';
  return new Intl.NumberFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function FundingCallsLivePage() {
  const params = useParams<{ locale?: string }>();
  const locale = params.locale || 'ro';

  const [calls, setCalls] = useState<FundingCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'open' | 'forthcoming' | 'all'>('open');
  const [search, setSearch] = useState('');

  const loadCalls = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const statusParam = status === 'all' ? '' : `&status=${status}`;
      const res = await fetch(`/api/integrations/funding-calls?limit=50${statusParam}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || 'Nu s-au putut prelua apelurile de finanțare.');
      setCalls(payload?.calls || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eroare neașteptată.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  const filteredCalls = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return calls;

    return calls.filter((call) => (
      call.title.toLowerCase().includes(normalizedSearch)
      || call.programme?.toLowerCase().includes(normalizedSearch)
      || call.identifier.toLowerCase().includes(normalizedSearch)
    ));
  }, [calls, search]);

  if (loading) return <LoadingState label="Se încarcă apelurile de finanțare..." />;
  if (error) return <ErrorState message={error} onRetry={loadCalls} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Apeluri de finanțare"
        description="Parcurge programele active și creează aplicații cu mai puțini pași."
        rightSlot={
          <Button variant="outline" onClick={loadCalls}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Actualizează
          </Button>
        }
      />

      <Card className="shadow-sm">
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Bară de filtrare apeluri</CardTitle>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Caută după titlu, program sau identificator"
              aria-label="Caută apeluri de finanțare"
            />

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant={status === 'open' ? 'default' : 'outline'} onClick={() => setStatus('open')}>
                Deschise
              </Button>
              <Button size="sm" variant={status === 'forthcoming' ? 'default' : 'outline'} onClick={() => setStatus('forthcoming')}>
                În curând
              </Button>
              <Button size="sm" variant={status === 'all' ? 'default' : 'outline'} onClick={() => setStatus('all')}>
                Toate
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {filteredCalls.length === 0 ? (
            <EmptyState title="Nu au fost găsite apeluri" description="Încearcă alt status sau altă căutare." />
          ) : (
            <div className="max-h-[520px] overflow-auto rounded-xl border bg-white shadow-inner">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Apel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead>Termen</TableHead>
                    <TableHead>Buget</TableHead>
                    <TableHead>Acțiuni rapide</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCalls.map((call) => (
                    <TableRow key={call.identifier}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{call.title}</p>
                          <p className="text-xs text-muted-foreground">{call.identifier}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="call" value={call.status} />
                      </TableCell>
                      <TableCell>{call.programme || 'N/A'}</TableCell>
                      <TableCell>{call.deadlineDate ? new Date(call.deadlineDate).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB') : 'N/A'}</TableCell>
                      <TableCell>{formatCurrency(call.budget, locale)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          <Button asChild size="sm" variant="outline">
                            <a href={call.url} target="_blank" rel="noreferrer noopener">
                              <ExternalLink className="mr-1 h-3.5 w-3.5" />
                              Vezi
                            </a>
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/${locale}/proiecte/nou`}>
                              Continuă
                            </Link>
                          </Button>
                          <Button size="sm">Depune</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
