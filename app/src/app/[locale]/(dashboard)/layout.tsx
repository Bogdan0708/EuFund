import { useTranslations } from 'next-intl';
import Link from 'next/link';

const navItems = [
  { href: '/ro/panou', icon: '📊', labelKey: 'dashboard' },
  { href: '/ro/proiecte', icon: '📁', labelKey: 'projects' },
  { href: '/ro/grantori', icon: '💰', labelKey: 'grants' },
  { href: '/ro/documente', icon: '📄', labelKey: 'documents' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('nav');

  return (
    <div className="flex min-h-screen">
      <aside className="w-64 border-r bg-white p-4">
        <Link href="/ro/panou" className="mb-8 block text-xl font-bold text-brand-500">
          🇪🇺 FondEU
        </Link>
        <nav className="space-y-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-gray-700 hover:bg-gray-100 transition"
            >
              <span>{item.icon}</span>
              <span>{t(item.labelKey)}</span>
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
