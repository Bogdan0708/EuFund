import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function HomePage() {
  const t = useTranslations();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="mb-4 text-4xl font-bold text-brand-500">
          🇪🇺 FondEU
        </h1>
        <p className="mb-8 text-lg text-gray-600">
          Platformă inteligentă pentru pregătirea cererilor de finanțare europeană.
          Verificare automată a conformității, generare de propuneri și potrivire cu apeluri de proiecte.
        </p>
        <div className="flex gap-4 justify-center">
          <Link
            href="/ro/autentificare"
            className="rounded-lg bg-brand-500 px-6 py-3 text-white font-medium hover:bg-brand-600 transition"
          >
            {t('auth.login')}
          </Link>
          <Link
            href="/ro/inregistrare"
            className="rounded-lg border-2 border-brand-500 px-6 py-3 text-brand-500 font-medium hover:bg-brand-50 transition"
          >
            {t('auth.register')}
          </Link>
        </div>
      </div>
    </main>
  );
}
