'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { GlassCard } from '@/components/glass/GlassCard';

const text = {
  ro: {
    title: 'Pagina nu a fost găsită',
    description: 'Ne pare rău, pagina pe care o căutați nu există sau a fost mutată.',
    button: 'Înapoi la pagina principală',
  },
  en: {
    title: 'Page not found',
    description: 'Sorry, the page you are looking for does not exist or has been moved.',
    button: 'Back to Home',
  },
};

export default function LocaleNotFound() {
  const params = useParams();
  const locale = (params?.locale as string) === 'en' ? 'en' : 'ro';
  const t = text[locale];

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-base)]">
      <GlassCard
        hover={false}
        className="w-full max-w-md p-10 flex flex-col items-center gap-4 text-center"
      >
        <h1 className="text-7xl font-bold text-[var(--accent)]">404</h1>
        <h2 className="text-xl font-semibold text-[var(--text-primary)]">
          {t.title}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          {t.description}
        </p>
        <Link
          href={`/${locale}`}
          className="inline-flex items-center justify-center font-medium rounded-[var(--btn-radius)] transition-all duration-[var(--transition-fast)] bg-[var(--accent)] text-white hover:brightness-110 px-6 py-2.5 text-[15px]"
        >
          {t.button}
        </Link>
      </GlassCard>
    </main>
  );
}
