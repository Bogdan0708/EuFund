import Link from 'next/link';

export default function NotFound() {
  return (
    <html lang="ro">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <main className="flex min-h-screen items-center justify-center p-4">
          <div className="rounded-lg border bg-white text-gray-900 shadow-sm w-full max-w-md">
            <div className="flex flex-col space-y-1.5 p-6 text-center">
              <h1 className="text-6xl font-bold text-primary">404</h1>
              <h2 className="font-semibold tracking-tight text-xl mt-2">
                Pagina nu a fost găsită
              </h2>
              <p className="text-sm text-gray-500 mt-2">
                Ne pare rău, pagina pe care o căutați nu există sau a fost mutată.
              </p>
            </div>
            <div className="p-6 pt-0 flex flex-col gap-3 items-center">
              <Link
                href="/ro/autentificare"
                className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-white hover:bg-primary/90 h-10 px-6"
              >
                Înapoi la pagina principală
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
