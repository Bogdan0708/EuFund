'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

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
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="rounded-lg border bg-card text-card-foreground shadow-sm w-full max-w-md">
        <div className="flex flex-col space-y-1.5 p-6 text-center">
          <h1 className="text-6xl font-bold text-primary">404</h1>
          <h2 className="font-semibold tracking-tight text-xl mt-2">
            {t.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-2">
            {t.description}
          </p>
        </div>
        <div className="p-6 pt-0 flex flex-col gap-3 items-center">
          <Link
            href={`/${locale}`}
            className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-6"
          >
            {t.button}
          </Link>
        </div>
      </div>
    </main>
  );
}
