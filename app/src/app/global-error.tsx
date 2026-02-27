'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/monitoring/sentry';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="ro">
      <body>
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
          <h1 className="text-2xl font-semibold">A apărut o eroare neașteptată</h1>
          <p className="text-sm text-muted-foreground">
            Echipa tehnică a fost notificată. Puteți reîncerca operațiunea.
          </p>
          <button
            onClick={() => reset()}
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:opacity-90"
          >
            Reîncearcă
          </button>
        </main>
      </body>
    </html>
  );
}
