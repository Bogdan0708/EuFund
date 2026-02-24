'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { useParams, usePathname } from 'next/navigation';

const labelMap: Record<string, string> = {
  panou: 'Dashboard',
  finantari: 'Calls',
  live: 'Applications',
  proiecte: 'Projects',
  documente: 'Documents',
  incarca: 'Upload',
  rapoarte: 'Reports',
  reports: 'Reports',
  budget: 'Budget',
  consortium: 'Consortium',
  aprobare: 'Approvals',
  aprobari: 'Approvals',
  audit: 'Audit Log',
  setari: 'Settings',
};

export function AppBreadcrumbs() {
  const pathname = usePathname();
  const params = useParams<{ locale?: string }>();
  const locale = params.locale || 'ro';

  const parts = pathname.split('/').filter(Boolean).slice(1);

  const crumbs = parts.map((segment, index) => {
    const href = `/${locale}/${parts.slice(0, index + 1).join('/')}`;
    return {
      href,
      label: labelMap[segment] || decodeURIComponent(segment),
      current: index === parts.length - 1,
    };
  });

  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="rounded-md border bg-card/60 px-3 py-2">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <li>
          <Link href={`/${locale}/panou`} className="hover:text-foreground">
            Home
          </Link>
        </li>
        {crumbs.map((crumb) => (
          <li key={crumb.href} className="flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            {crumb.current ? (
              <span className="font-medium text-foreground">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="hover:text-foreground">
                {crumb.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
