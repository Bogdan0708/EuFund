import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function ProjectsPage() {
  const t = useTranslations('project');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('list')}</h1>
        <Link
          href="/ro/proiecte/nou"
          className="rounded-lg bg-brand-500 px-4 py-2 text-white font-medium hover:bg-brand-600 transition"
        >
          + {t('create')}
        </Link>
      </div>

      <div className="rounded-xl bg-white p-8 shadow text-center text-gray-500">
        <p className="text-5xl mb-4">📁</p>
        <p>Nu aveți încă niciun proiect.</p>
        <Link href="/ro/proiecte/nou" className="text-brand-500 hover:underline mt-2 inline-block">
          {t('create')}
        </Link>
      </div>
    </div>
  );
}
