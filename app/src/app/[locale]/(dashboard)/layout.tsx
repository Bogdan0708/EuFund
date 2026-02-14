import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const navItems = [
  { href: '/ro/panou', icon: '📊', labelKey: 'dashboard' },
  { href: '/ro/proiecte', icon: '📁', labelKey: 'projects' },
  { href: '/ro/finantari/live', icon: '💰', labelKey: 'grants' },
  { href: '/ro/documente/incarca', icon: '📄', labelKey: 'documents' },
  { href: '/ro/legislatie', icon: '⚖️', labelKey: 'legislation' },
  { href: '/ro/asistent', icon: '🤖', labelKey: 'organization' },
];

const phase2Items = [
  { href: '#', icon: '🤝', label: 'Consorțiu', disabled: true },
  { href: '#', icon: '💶', label: 'Buget', disabled: true },
  { href: '#', icon: '📈', label: 'Rapoarte', disabled: true },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card p-4 flex flex-col flex-shrink-0">
        <Link href="/ro/panou" className="mb-6 block text-xl font-bold text-primary">
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
              <Button
                key={item.label}
                variant="ghost"
                className="w-full justify-start text-muted-foreground cursor-default opacity-60"
                disabled
              >
                <span className="mr-2">{item.icon}</span>
                {item.label}
                <span className="ml-auto text-[8px] bg-muted rounded px-1">per proiect</span>
              </Button>
            ))}
          </nav>
        </div>

        {/* Quick actions */}
        <div className="mt-auto pt-4 border-t space-y-2">
          <Button asChild variant="outline" size="sm" className="w-full justify-start">
            <Link href="/ro/proiecte/nou">
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
