import { useTranslations } from 'next-intl';

export default function DashboardPage() {
  const t = useTranslations();

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t('nav.dashboard')}</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="text-sm text-gray-500 mb-1">{t('nav.projects')}</h3>
          <p className="text-3xl font-bold">0</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="text-sm text-gray-500 mb-1">{t('grants.available')}</h3>
          <p className="text-3xl font-bold">0</p>
        </div>
        <div className="rounded-xl bg-white p-6 shadow">
          <h3 className="text-sm text-gray-500 mb-1">{t('nav.documents')}</h3>
          <p className="text-3xl font-bold">0</p>
        </div>
      </div>
    </div>
  );
}
