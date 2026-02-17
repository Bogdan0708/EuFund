'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

interface Project {
  id: string;
  title: string;
  acronym?: string;
  status: string;
  createdAt: string;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ciorna: { label: 'Ciornă', color: 'bg-gray-100 text-gray-700' },
  in_lucru: { label: 'În lucru', color: 'bg-blue-100 text-blue-700' },
  verificare: { label: 'Verificare', color: 'bg-yellow-100 text-yellow-700' },
  finalizat: { label: 'Finalizat', color: 'bg-green-100 text-green-700' },
  depus: { label: 'Depus', color: 'bg-purple-100 text-purple-700' },
  aprobat: { label: 'Aprobat', color: 'bg-emerald-100 text-emerald-700' },
  respins: { label: 'Respins', color: 'bg-red-100 text-red-700' },
};

export default function ProjectsPage() {
  const t = useTranslations('project');
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await fetch('/api/v1/projects');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setProjects(data.data?.items || []);
      } catch (err) {
        setError('Nu s-au putut încărca proiectele.');
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('list')}</h1>
        <Link
          href={`/${locale}/proiecte/nou`}
          className="rounded-lg bg-brand-500 px-4 py-2 text-white font-medium hover:bg-brand-600 transition"
        >
          + {t('create')}
        </Link>
      </div>

      {loading && (
        <div className="rounded-xl bg-white p-8 shadow text-center text-gray-500">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500 mx-auto mb-4" />
          <p>Se încarcă proiectele...</p>
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && projects.length === 0 && (
        <div className="rounded-xl bg-white p-8 shadow text-center text-gray-500">
          <p className="text-5xl mb-4">📁</p>
          <p>Nu aveți încă niciun proiect.</p>
          <Link href={`/${locale}/proiecte/nou`} className="text-brand-500 hover:underline mt-2 inline-block">
            {t('create')}
          </Link>
        </div>
      )}

      {!loading && !error && projects.length > 0 && (
        <div className="space-y-3">
          {projects.map((project) => {
            const status = STATUS_LABELS[project.status] || { label: project.status, color: 'bg-gray-100 text-gray-700' };
            return (
              <Link
                key={project.id}
                href={`/${locale}/proiecte/${project.id}`}
                className="block rounded-xl bg-white p-5 shadow hover:shadow-md transition"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{project.title}</h3>
                    {project.acronym && (
                      <p className="text-sm text-gray-500">{project.acronym}</p>
                    )}
                  </div>
                  <span className={`text-xs font-medium px-3 py-1 rounded-full ${status.color}`}>
                    {status.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
