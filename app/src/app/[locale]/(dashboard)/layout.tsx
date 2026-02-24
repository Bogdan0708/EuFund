'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { Bell, FolderKanban, LayoutDashboard, Menu, Search, ShieldCheck, Signature, Wallet, X, FileText, ClipboardList, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppBreadcrumbs } from '@/components/ui/breadcrumbs';

type UserRole = 'admin' | 'org_admin' | 'project_manager' | 'viewer';

type SearchResult = {
  id: string;
  title: string;
  type: 'project' | 'call' | 'document';
  href: string;
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ locale?: string }>();
  const pathname = usePathname();
  const locale = params.locale || 'ro';

  const [mobileOpen, setMobileOpen] = useState(false);
  const [role, setRole] = useState<UserRole>('project_manager');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    const savedRole = localStorage.getItem('eufund:user-role') as UserRole | null;
    if (savedRole) setRole(savedRole);
  }, []);

  useEffect(() => {
    const loadResults = async () => {
      if (query.trim().length < 2) {
        setResults([]);
        return;
      }

      setSearchLoading(true);
      try {
        const projectRes = await fetch(`/api/v1/projects?search=${encodeURIComponent(query)}&perPage=5`);
        const projectPayload = await projectRes.json();
        const items: SearchResult[] = (projectPayload?.data?.items || []).map((item: { id: string; title: string }) => ({
          id: item.id,
          title: item.title,
          type: 'project',
          href: `/${locale}/proiecte/${item.id}`,
        }));

        const shortcuts = ([
          { id: 'calls', title: 'Funding calls', type: 'call', href: `/${locale}/finantari/live` },
          { id: 'docs', title: 'Document evidence upload', type: 'document', href: `/${locale}/documente/incarca` },
        ] satisfies SearchResult[]).filter((item) => item.title.toLowerCase().includes(query.toLowerCase()));

        setResults([...items, ...shortcuts].slice(0, 6));
      } catch {
        setResults([]);
      } finally {
        setSearchLoading(false);
      }
    };

    const timer = window.setTimeout(loadResults, 250);
    return () => window.clearTimeout(timer);
  }, [query, locale]);

  const navItems = useMemo(() => {
    const items = [
      { href: `/${locale}/panou`, label: 'Dashboard', icon: LayoutDashboard },
      { href: `/${locale}/finantari/live`, label: 'Calls & Applications', icon: ClipboardList },
      { href: `/${locale}/proiecte`, label: 'Projects', icon: FolderKanban },
      { href: `/${locale}/proiecte`, label: 'Tasks & Milestones', icon: Signature },
      { href: `/${locale}/proiecte`, label: 'Budget & Costs', icon: Wallet },
      { href: `/${locale}/proiecte`, label: 'Reports', icon: FileText },
      { href: `/${locale}/documente/incarca`, label: 'Documents', icon: FileText },
      { href: `/${locale}/audit`, label: 'Audit Log', icon: ShieldCheck },
      { href: `/${locale}/setari`, label: 'Settings', icon: Settings },
    ];

    if (role === 'admin' || role === 'org_admin') {
      items.splice(7, 0, { href: `/${locale}/aprobari`, label: 'Approvals', icon: Bell });
    }

    return items;
  }, [locale, role]);

  const sidebar = (
    <aside className="w-72 shrink-0 border-r bg-card/90 p-4">
      <Link href={`/${locale}/panou`} className="mb-6 block rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground">
        EUFund Control Center
      </Link>

      <nav className="space-y-1" aria-label="Primary navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Button
              key={`${item.href}-${item.label}`}
              asChild
              variant={active ? 'secondary' : 'ghost'}
              className="w-full justify-start"
            >
              <Link href={item.href} onClick={() => setMobileOpen(false)}>
                <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            </Button>
          );
        })}
      </nav>

      <div className="mt-6 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Role preview</p>
        <p className="mt-1">Current: {role}</p>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen lg:flex">
      <div className="hidden lg:block">{sidebar}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="h-full w-72 bg-white" onClick={(event) => event.stopPropagation()}>
            {sidebar}
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1 p-4 md:p-6">
        <div className="mb-4 flex items-center gap-3 rounded-lg border bg-card/70 p-3">
          <Button variant="outline" size="icon" onClick={() => setMobileOpen((prev) => !prev)} className="lg:hidden" aria-label="Toggle navigation">
            {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>

          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search projects, calls, documents"
              className="pl-9"
              aria-label="Global search"
            />
            {(query.trim().length >= 2 || searchLoading) && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-card p-2 shadow-lg">
                {searchLoading && <p className="px-2 py-2 text-xs text-muted-foreground">Searching...</p>}
                {!searchLoading && results.length === 0 && (
                  <p className="px-2 py-2 text-xs text-muted-foreground">No matches for &quot;{query}&quot;.</p>
                )}
                {!searchLoading && results.map((result) => (
                  <Link
                    key={`${result.type}-${result.id}`}
                    href={result.href}
                    onClick={() => setQuery('')}
                    className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted"
                  >
                    <span>{result.title}</span>
                    <span className="text-xs text-muted-foreground">{result.type}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" aria-label="Notifications">
            <Bell className="mr-2 h-4 w-4" />
            Alerts
          </Button>
        </div>

        <div className="space-y-4">
          <AppBreadcrumbs />
          {children}
        </div>
      </main>
    </div>
  );
}
