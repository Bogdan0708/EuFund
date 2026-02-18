 'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ locale?: string; id?: string }>();
  const t = useTranslations('nav');
  const locale = params.locale || 'ro';
  const manageSubscriptionLabel = locale === 'en' ? 'Manage subscription' : 'Gestionare abonament';
  const projectId = params.id;
  const projectBase = projectId ? `/${locale}/proiecte/${projectId}` : `/${locale}/proiecte`;

  const navItems = [
    { href: `/${locale}/panou`, icon: '📊', labelKey: 'dashboard' },
    { href: `/${locale}/proiecte`, icon: '📁', labelKey: 'projects' },
    { href: `/${locale}/finantari/live`, icon: '💰', labelKey: 'grants' },
    { href: `/${locale}/documente/incarca`, icon: '📄', labelKey: 'documents' },
    { href: `/${locale}/legislatie`, icon: '⚖️', labelKey: 'legislation' },
    { href: `/${locale}/asistent`, icon: '🤖', labelKey: 'organization' },
  ];

  const phase2Items = [
    { href: projectId ? `${projectBase}/consortium` : projectBase, icon: '🤝', label: 'Consorțiu' },
    { href: projectId ? `${projectBase}/budget` : projectBase, icon: '💶', label: 'Buget' },
    { href: projectId ? `${projectBase}/reports` : projectBase, icon: '📈', label: 'Rapoarte' },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card p-4 flex flex-col flex-shrink-0">
        <Link href={`/${locale}/panou`} className="mb-6 block text-xl font-bold text-primary">
          🇪🇺 FondEU
        </Link>

        {/* Main navigation */}
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Button key={item.href} asChild variant="ghost" className="w-full justify-start">
              <Link href={item.href}>
                <span className="mr-2">{item.icon}</span>
                {t(item.labelKey)}
              </Link>
            </Button>
          ))}
        </nav>

        {/* Phase 2 section */}
        <div className="mt-6 pt-4 border-t">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 px-3">
            Faza 2 — Avansat
          </p>
          <nav className="space-y-1">
            {phase2Items.map((item) => (
              <Button key={item.label} asChild variant="ghost" className="w-full justify-start">
                <Link href={item.href}>
                  <span className="mr-2">{item.icon}</span>
                  {item.label}
                  <span className="ml-auto text-[8px] bg-muted rounded px-1">per proiect</span>
                </Link>
              </Button>
            ))}
          </nav>
        </div>

        {/* Quick actions */}
        <div className="mt-auto pt-4 border-t space-y-2">
          <Button asChild variant="ghost" size="sm" className="w-full justify-start">
            <Link href="/api/billing/portal">
              <span className="mr-2">💳</span>
              {manageSubscriptionLabel}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="w-full justify-start">
            <Link href={`/${locale}/proiecte/nou`}>
              <span className="mr-2">➕</span>
              Proiect Nou
            </Link>
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 bg-background overflow-auto">{children}</main>
    </div>
  );
}
