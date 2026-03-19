'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/page-states';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { StatusBadge } from '@/components/ui/status-badge';

type FundingCallRow = {
  id: string;
  programId: string;
  titleRo: string;
  callCode: string;
  status: 'deschis' | 'previzionat' | 'in_evaluare' | 'inchis' | 'anulat';
  submissionEnd: string | null;
  budgetMin: string | null;
  budgetMax: string | null;
  programName: string;
  sourceSlug: string | null;
};

function sourceBucket(sourceSlug: string | null): 'eu' | 'ro' | 'unknown' {
  if (!sourceSlug) return 'unknown';
  if (sourceSlug.includes('ec') || sourceSlug.includes('eu')) return 'eu';
  return 'ro';
}

function sourceLabel(sourceSlug: string | null): string {
  const bucket = sourceBucket(sourceSlug);
  if (bucket === 'eu') return 'UE';
  if (bucket === 'ro') return 'România';
  return 'Necunoscut';
}

function formatBudget(min: string | null, max: string | null, locale: string): string {
  const parse = (value: string | null) => (value ? Number(value) : null);
  const minNum = parse(min);
  const maxNum = parse(max);
  if (!minNum && !maxNum) return 'N/A';
  const fmt = new Intl.NumberFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });
  if (minNum && maxNum) return `${fmt.format(minNum)} - ${fmt.format(maxNum)}`;
  return fmt.format(minNum ?? maxNum ?? 0);
}

export default function FinantariPage() {
  const params = useParams<{ locale?: string }>();
  const locale = params.locale || 'ro';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [calls, setCalls] = useState<FundingCallRow[]>([]);
  const [sourceTab, setSourceTab] = useState<'all' | 'eu' | 'ro'>('all');
  const [status, setStatus] = useState<'all' | 'open' | 'forthcoming'>('all');
  const [search, setSearch] = useState('');
  const [programId, setProgramId] = useState('all');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ perPage: '100' });
        if (status !== 'all') params.set('status', status);
        if (search.trim()) params.set('search', search.trim());
        if (programId !== 'all') params.set('programId', programId);

        const res = await fetch(`/api/v1/calls?${params.toString()}`);
        const payload = await res.json();
        if (!res.ok || !payload?.success) {
          throw new Error(payload?.error?.message || 'Nu s-au putut încărca apelurile');
        }

        if (!cancelled) setCalls(payload.data || []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Eroare neașteptată');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [status, search, programId]);

  const filtered = useMemo(() => {
    if (sourceTab === 'all') return calls;
    return calls.filter((call) => sourceBucket(call.sourceSlug) === sourceTab);
  }, [calls, sourceTab]);

  const programOptions = useMemo(() => {
    const seen = new Set<string>();
    return calls
      .filter((call) => {
        if (seen.has(call.programId)) return false;
        seen.add(call.programId);
        return true;
      })
      .map((call) => ({ id: call.programId, name: call.programName }));
  }, [calls]);

  if (loading) return <LoadingState label="Se încarcă apelurile..." />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Apeluri de finanțare"
        description="Programe active din surse UE și România, sincronizate în platformă."
        rightSlot={(
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href={`/${locale}/finantari/live`}>Portal live UE</Link>
            </Button>
            <Button asChild>
              <Link href={`/${locale}/proiecte/asistent-proiect`}>Asistent Proiect AI</Link>
            </Button>
          </div>
        )}
      />

      <div className="rounded-xl border bg-card/70 p-4 text-sm text-muted-foreground">
        Aici vezi apelurile sincronizate si curate in platforma, inclusiv sursele din Romania.
        Pentru feed-ul live din portalul Comisiei Europene, foloseste pagina dedicata de portal.
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Filtre apeluri</CardTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Caută după titlu sau cod apel"
            />
            <div className="flex gap-2">
              <Button size="sm" variant={status === 'all' ? 'default' : 'outline'} onClick={() => setStatus('all')}>Toate</Button>
              <Button size="sm" variant={status === 'open' ? 'default' : 'outline'} onClick={() => setStatus('open')}>Deschise</Button>
              <Button size="sm" variant={status === 'forthcoming' ? 'default' : 'outline'} onClick={() => setStatus('forthcoming')}>Viitoare</Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant={sourceTab === 'all' ? 'default' : 'outline'} onClick={() => setSourceTab('all')}>All</Button>
              <Button size="sm" variant={sourceTab === 'eu' ? 'default' : 'outline'} onClick={() => setSourceTab('eu')}>UE</Button>
              <Button size="sm" variant={sourceTab === 'ro' ? 'default' : 'outline'} onClick={() => setSourceTab('ro')}>România</Button>
            </div>
            <select
              className="rounded-md border bg-background px-3 py-2 text-sm"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
            >
              <option value="all">Toate programele</option>
              {programOptions.map((program) => (
                <option key={program.id} value={program.id}>{program.name}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState title="Nu au fost găsite apeluri" description="Încearcă alt filtru sau altă căutare." />
          ) : (
            <div className="max-h-[560px] overflow-auto rounded-xl border bg-white shadow-inner">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Apel</TableHead>
                    <TableHead>Program</TableHead>
                    <TableHead>Sursă</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Termen</TableHead>
                    <TableHead>Buget</TableHead>
                    <TableHead>Acțiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{call.titleRo}</p>
                          <p className="text-xs text-muted-foreground">{call.callCode}</p>
                        </div>
                      </TableCell>
                      <TableCell>{call.programName}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{sourceLabel(call.sourceSlug)}</Badge>
                      </TableCell>
                      <TableCell><StatusBadge kind="call" value={call.status} /></TableCell>
                      <TableCell>{call.submissionEnd ? new Date(call.submissionEnd).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB') : 'N/A'}</TableCell>
                      <TableCell>{formatBudget(call.budgetMin, call.budgetMax, locale)}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/${locale}/proiecte/asistent-proiect?callId=${call.id}`}>Verifică eligibilitate</Link>
                          </Button>
                          <Button asChild size="sm">
                            <Link href={`/${locale}/proiecte/asistent-proiect?callId=${call.id}`}>Creează proiect</Link>
                          </Button>
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
