import Link from 'next/link'

export default function NotFound() {
  return (
    <html lang="ro">
      <body className="min-h-screen bg-[#F5F5F7] text-black flex flex-col items-center justify-center overflow-hidden relative">
        {/* Decorative halo */}
        <div className="absolute inset-0 -z-10 flex items-center justify-center">
          <div
            className="w-[600px] h-[600px] rounded-full blur-3xl opacity-60"
            style={{
              background: 'radial-gradient(circle at center, rgba(0, 113, 227, 0.08) 0%, rgba(74, 71, 210, 0.05) 30%, transparent 70%)',
            }}
          />
        </div>

        {/* Background blobs */}
        <div className="fixed bottom-0 left-0 w-full h-1/2 pointer-events-none -z-20">
          <div className="absolute bottom-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full blur-[100px]" style={{ background: 'rgba(74, 71, 210, 0.05)' }} />
          <div className="absolute top-[20%] left-[-10%] w-[400px] h-[400px] rounded-full blur-[80px]" style={{ background: 'rgba(0, 113, 227, 0.05)' }} />
        </div>

        <main className="relative flex flex-col items-center text-center px-6 max-w-4xl mx-auto w-full">
          {/* 404 Typography */}
          <div className="relative mb-8">
            <h1 className="text-[120px] md:text-[180px] font-black tracking-tighter select-none" style={{ color: 'rgba(26, 27, 31, 0.1)' }}>
              404
            </h1>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-black text-8xl md:text-9xl tracking-tight drop-shadow-sm" style={{ color: '#0059b5' }}>
                404
              </span>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-6 max-w-xl">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Pagina nu a fost gasita
            </h2>
            <p className="text-lg md:text-xl leading-relaxed text-black">
              Pagina pe care o cautati nu exista sau a fost mutata.
              Curatorul nostru digital nu a gasit aceasta pagina in arhivele FondEU.
            </p>

            <div className="pt-10">
              <Link
                href="/ro/panou"
                className="inline-flex items-center gap-2 px-8 py-4 rounded-full font-semibold text-lg text-white transition-all duration-200 hover:-translate-y-[1px] hover:shadow-lg active:scale-[0.98]"
                style={{ backgroundColor: '#0071e3' }}
              >
                <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}>
                  home
                </span>
                Inapoi acasa
              </Link>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="fixed bottom-8 w-full text-center">
          <div className="flex items-center justify-center gap-2 opacity-70">
            <span className="text-xl font-black tracking-tighter">FondEU</span>
            <div className="w-1 h-1 rounded-full" style={{ backgroundColor: '#0059b5' }} />
            <span className="text-sm font-medium tracking-tight text-black">
              Curatorul Digital
            </span>
          </div>
        </footer>
      </body>
    </html>
  )
}
