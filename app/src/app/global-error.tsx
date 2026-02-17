'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ro">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <main className="flex min-h-screen items-center justify-center p-4">
          <div className="rounded-lg border bg-white text-gray-900 shadow-sm w-full max-w-md">
            <div className="flex flex-col space-y-1.5 p-6 text-center">
              <h1 className="text-6xl font-bold text-red-600">500</h1>
              <h2 className="font-semibold tracking-tight text-xl mt-2">
                A apărut o eroare neașteptată
              </h2>
              <p className="text-sm text-gray-500 mt-2">
                Ne cerem scuze pentru inconveniență. Vă rugăm să încercați din nou.
              </p>
              {error.digest && (
                <p className="text-xs text-gray-400 mt-1">
                  Cod eroare: {error.digest}
                </p>
              )}
            </div>
            <div className="p-6 pt-0 flex flex-col gap-3 items-center">
              <button
                onClick={reset}
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-white hover:bg-primary/90 h-10 px-6"
              >
                Încearcă din nou
              </button>
              <a
                href="/ro/autentificare"
                className="text-sm text-primary hover:underline"
              >
                Înapoi la pagina principală
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
