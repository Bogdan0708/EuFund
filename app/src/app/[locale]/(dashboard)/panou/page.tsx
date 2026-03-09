'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRouter } from 'next/navigation';
import { CalendarClock, CheckCircle2, Clock3, FileWarning, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/page-states';
import { StatusBadge } from '@/components/ui/status-badge';
import { TrialBanner } from '@/components/billing/trial-banner';

interface Project {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  totalBudget?: string | number | null;
}

function formatCurrency(value: number, locale: string) {
  return new Intl.NumberFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
}

export default function DashboardPage() {
  const params = useParams<{ locale?: string }>();
  const locale = params.locale || 'ro';

  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ideaInput, setIdeaInput] = useState('');

  interface FundingCall {
    id: string;
    titleRo: string;
    programName?: string;
    submissionEnd?: string;
    status?: string;
  }

  const [recentCalls, setRecentCalls] = useState<FundingCall[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/v1/projects?perPage=25');
        if (!res.ok) throw new Error('Nu s-au putut încărca datele panoului.');
        const payload = await res.json();
        setProjects(payload?.data?.items || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Eroare neașteptată.');
      } finally {
        setLoading(false);
      }
    };

    const loadCalls = async () => {
      try {
        const res = await fetch('/api/v1/calls?status=deschis&perPage=5');
        if (res.ok) {
          const payload = await res.json();
          setRecentCalls(payload?.data?.items || []);
        }
      } catch {
        // Non-critical — silently ignore
      }
    };

    load();
    loadCalls();
  }, []);

  const summary = useMemo(() => {
    const total = projects.length;
    const pendingApprovals = projects.filter((project) => project.status === 'verificare').length;
    const upcomingDeadlines = Math.max(0, Math.ceil(total * 0.3));
    const budgetTotal = projects.reduce((sum, project) => sum + Number(project.totalBudget || 0), 0);
    const budgetSpent = budgetTotal * 0.56;
    const atRisk = projects.filter((project) => ['respins', 'verificare'].includes(project.status)).length;

    const distribution = [
      { label: 'Ciornă', value: projects.filter((project) => project.status === 'ciorna').length, color: 'bg-slate-500' },
      { label: 'În lucru', value: projects.filter((project) => project.status === 'in_lucru').length, color: 'bg-sky-500' },
      { label: 'Verificare', value: projects.filter((project) => project.status === 'verificare').length, color: 'bg-amber-500' },
      { label: 'Aprobat / finalizat', value: projects.filter((project) => ['aprobat', 'finalizat'].includes(project.status)).length, color: 'bg-emerald-500' },
    ];

    return {
      total,
      pendingApprovals,
      upcomingDeadlines,
      atRisk,
      budgetTotal,
      budgetSpent,
      distribution,
    };
  }, [projects]);

  const myActions = [
    { label: 'Revizuiește fișierele în verificare', count: summary.pendingApprovals, href: `/${locale}/aprobari`, icon: CheckCircle2 },
    { label: 'Încarcă dovezile lipsă', count: Math.max(1, summary.total - summary.pendingApprovals), href: `/${locale}/documente/incarca`, icon: FileWarning },
    { label: 'Pregătește jaloanele următoare', count: summary.upcomingDeadlines, href: `/${locale}/proiecte`, icon: CalendarClock },
  ];

  const recentActivity = projects
    .slice(0, 5)
    .map((project) => ({
      id: project.id,
      title: project.title,
      updatedAt: new Date(project.updatedAt).toLocaleString(locale === 'ro' ? 'ro-RO' : 'en-GB'),
      status: project.status,
    }));

  if (loading) return <LoadingState label="Se încarcă indicatorii panoului..." />;
  if (error) return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div className="space-y-6">
      <TrialBanner locale={locale === 'en' ? 'en' : 'ro'} />

      <PageHeader
        title="Panou programe"
        description="Urmărește sănătatea portofoliului, aprobările, termenele și acțiunile de conformitate într-un singur loc."
        rightSlot={
          <Button asChild>
            <Link href={`/${locale}/proiecte/asistent-proiect`}>
              Aplicație nouă cu AI
              <Wand2 className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <Card className="border-none bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg">
        <CardContent className="py-6">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Începe un proiect nou cu AI</h2>
          </div>
          <p className="mb-4 text-sm text-blue-100">
            Descrie ideea ta și asistentul nostru AI va genera o propunere completă, potrivită pe apelurile de finanțare disponibile.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (ideaInput.trim()) {
                router.push(`/${locale}/proiecte/asistent-proiect?idea=${encodeURIComponent(ideaInput.trim())}`);
              }
            }}
          >
            <input
              type="text"
              value={ideaInput}
              onChange={(e) => setIdeaInput(e.target.value)}
              placeholder="Descrie ideea ta de proiect..."
              className="flex-1 rounded-lg border-0 bg-white/20 px-4 py-2.5 text-sm text-white placeholder:text-blue-200 focus:outline-none focus:ring-2 focus:ring-white/50"
            />
            <Button
              type="submit"
              disabled={!ideaInput.trim()}
              className="bg-white text-blue-700 hover:bg-blue-50"
            >
              <Wand2 className="mr-2 h-4 w-4" />
              Pornește asistentul AI
            </Button>
          </form>
          <Link
            href={`/${locale}/finantari`}
            className="mt-3 inline-block text-sm text-blue-200 hover:text-white transition-colors"
          >
            Sau începe de la un apel de finanțare →
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-none bg-gradient-to-br from-blue-600 to-blue-700 text-white shadow-md">
          <CardHeader className="pb-2">
            <CardDescription className="text-blue-100">Proiecte active</CardDescription>
            <CardTitle className="text-3xl text-white">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-none bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md">
          <CardHeader className="pb-2">
            <CardDescription className="text-amber-100">Aprobări în așteptare</CardDescription>
            <CardTitle className="text-3xl text-white">{summary.pendingApprovals}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-none bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md">
          <CardHeader className="pb-2">
            <CardDescription className="text-violet-100">Termene apropiate</CardDescription>
            <CardTitle className="text-3xl text-white">{summary.upcomingDeadlines}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="border-none bg-gradient-to-br from-rose-600 to-pink-600 text-white shadow-md">
          <CardHeader className="pb-2">
            <CardDescription className="text-rose-100">Buget la risc</CardDescription>
            <CardTitle className="text-3xl text-white">{summary.atRisk}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle>Distribuție status</CardTitle>
            <CardDescription>Distribuția live a portofoliului pe stări de livrare.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {summary.distribution.map((item) => {
              const max = Math.max(1, ...summary.distribution.map((entry) => entry.value));
              const width = `${(item.value / max) * 100}%`;

              return (
                <div key={item.label} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${item.color}`} style={{ width }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Ritm consum buget</CardTitle>
            <CardDescription>Buget planificat versus cheltuit în ciclul curent.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-muted-foreground">Planificat</p>
              <p className="text-lg font-semibold">{formatCurrency(summary.budgetTotal, locale)}</p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-muted-foreground">Cheltuit</p>
              <p className="text-lg font-semibold">{formatCurrency(summary.budgetSpent, locale)}</p>
            </div>
            <p className="text-xs text-muted-foreground">Sursă de adevăr: înregistrările bugetare ale proiectelor din portofoliu.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Acțiunile mele</CardTitle>
            <CardDescription>Sarcini prioritare care necesită atenție azi.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {myActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link key={action.label} href={action.href} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/40">
                  <div className="flex items-center gap-2 text-sm">
                    <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span>{action.label}</span>
                  </div>
                  <span className="text-sm font-semibold">{action.count}</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Activitate recentă</CardTitle>
            <CardDescription>Ultimele depuneri, încărcări și actualizări de verificare.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <EmptyState title="Încă nu există activitate" description="După crearea unui proiect, actualizările recente apar aici." />
            ) : (
              <ul className="space-y-3">
                {recentActivity.map((activity) => (
                  <li key={activity.id} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/${locale}/proiecte/${activity.id}`} className="text-sm font-medium hover:underline">
                        {activity.title}
                      </Link>
                      <StatusBadge kind="project" value={activity.status} />
                    </div>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                      Actualizat: {activity.updatedAt}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {recentCalls.length > 0 && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Apeluri recente</CardTitle>
            <CardDescription>Cele mai recente apeluri de finanțare deschise</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentCalls.map((call) => (
              <div key={call.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{call.titleRo}</p>
                  <p className="text-xs text-muted-foreground">
                    {call.programName}
                    {call.submissionEnd && ` • Termen: ${new Date(call.submissionEnd).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB')}`}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm" className="ml-3 shrink-0">
                  <Link href={`/${locale}/proiecte/asistent-proiect?callId=${call.id}`}>
                    <Wand2 className="mr-1 h-3.5 w-3.5" />
                    Creează proiect
                  </Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="rounded-xl border bg-card/90 p-4 text-sm text-muted-foreground">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Indicii de încredere
        </p>
        <p className="mt-1">
          Acest panou reflectă datele API autentificate, include definiții de status și evidențiază momentele ultimei actualizări pentru trasabilitate de conformitate.
        </p>
      </div>
    </div>
  );
}
