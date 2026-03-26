'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

/* ---------- types ---------- */
type FileFilter = 'all' | 'recent' | 'shared' | 'archived';

interface FileItem {
  id: string;
  name: string;
  size: string;
  updated: string;
  iconName: string;
  iconBg: string;
  iconColor: string;
  owner: string;
  ownerInitials: string;
}

interface ComplianceFile {
  id: string;
  name: string;
  category: string;
  size: string;
  iconName: string;
  status: 'verified' | 'pending';
}

/* ---------- placeholder data ---------- */
const PROJECT_FILES: FileItem[] = [
  {
    id: '1',
    name: 'Horizon_Europe_2024.pdf',
    size: '12.4 MB',
    updated: '2h',
    iconName: 'picture_as_pdf',
    iconBg: 'bg-red-50',
    iconColor: 'text-red-500',
    owner: 'Marcus Thorne',
    ownerInitials: 'MT',
  },
  {
    id: '2',
    name: 'Budget_Allocation_V3.docx',
    size: '2.1 MB',
    updated: '1d',
    iconName: 'description',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-500',
    owner: 'Sarah Jenkins',
    ownerInitials: 'SJ',
  },
  {
    id: '3',
    name: 'Annex_Research_Assets.zip',
    size: '156.0 MB',
    updated: '3d',
    iconName: 'folder_zip',
    iconBg: 'bg-amber-50',
    iconColor: 'text-amber-600',
    owner: 'System Generated',
    ownerInitials: 'SY',
  },
];

const COMPLIANCE_FILES: ComplianceFile[] = [
  {
    id: '1',
    name: 'GDPR_Audit_Q3.pdf',
    category: 'Regulatory',
    size: '4.5 MB',
    iconName: 'verified_user',
    status: 'verified',
  },
  {
    id: '2',
    name: 'Ethics_Framework_2024.pdf',
    category: 'Internal',
    size: '1.2 MB',
    iconName: 'policy',
    status: 'pending',
  },
];

const SMART_TEMPLATES = [
  { iconName: 'article', labelKey: 'templateExecutiveSummary' },
  { iconName: 'pie_chart', labelKey: 'templateBudgetPlanner' },
  { iconName: 'timeline', labelKey: 'templateProjectRoadmap' },
];

const FILTER_OPTIONS: FileFilter[] = ['all', 'recent', 'shared', 'archived'];

/* ---------- page component ---------- */
export default function DocumentePage() {
  const t = useTranslations('files');
  const [activeFilter, setActiveFilter] = useState<FileFilter>('all');

  return (
    <div className="fade-in-up max-w-[1200px] mx-auto">
      {/* ── Header Section ── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
        <div className="space-y-2">
          <h2 className="text-[56px] font-bold tracking-tighter leading-none text-on-surface">
            {t('pageTitle')}
          </h2>
          <p className="text-lg text-on-surface-variant font-medium">
            {t('pageSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Icon
              name="search"
              className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant/50"
            />
            <input
              className="pl-12 pr-6 py-3 bg-surface-container-high rounded-full border-none focus:ring-2 focus:ring-primary/20 transition-all w-64 text-sm font-medium"
              placeholder={t('searchPlaceholder')}
              type="text"
            />
          </div>
          <DsButton>
            <Icon name="upload" />
            <span>{t('upload')}</span>
          </DsButton>
        </div>
      </header>

      {/* ── Filter Chips ── */}
      <div className="flex gap-3 mb-12">
        {FILTER_OPTIONS.map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`px-6 py-2 rounded-full text-sm font-semibold transition-all ${
              activeFilter === filter
                ? 'bg-on-surface text-surface'
                : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container-highest'
            }`}
          >
            {t(`filter.${filter}`)}
          </button>
        ))}
      </div>

      {/* ── Section: Project Documents ── */}
      <section className="mb-20">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-bold tracking-tight">
            {t('projectDocuments')}
          </h3>
          <button className="text-primary font-semibold text-sm flex items-center hover:opacity-80 transition-opacity">
            {t('viewAll')}{' '}
            <Icon name="chevron_right" size="sm" className="ml-1" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {PROJECT_FILES.map((file) => (
            <div
              key={file.id}
              className="glass-card p-6 rounded-[1rem] border border-white/20 shadow-[0_20px_40px_rgba(0,0,0,0.04)] hover:translate-y-[-4px] transition-all duration-300 group"
            >
              <div className="flex justify-between items-start mb-6">
                <div
                  className={`w-12 h-12 ${file.iconBg} ${file.iconColor} rounded-xl flex items-center justify-center`}
                >
                  <Icon name={file.iconName} size="lg" />
                </div>
                <button className="text-on-surface-variant/40 hover:text-on-surface transition-colors">
                  <Icon name="more_vert" />
                </button>
              </div>
              <h4 className="font-bold text-on-surface text-lg mb-1 truncate">
                {file.name}
              </h4>
              <p className="text-sm text-on-surface-variant mb-6">
                {file.size} &bull; {t('updatedAgo', { time: file.updated })}
              </p>
              <div className="flex items-center gap-2 border-t border-slate-100 pt-4">
                <div className="w-6 h-6 rounded-full bg-surface-container-highest flex items-center justify-center text-[10px] font-bold">
                  {file.ownerInitials}
                </div>
                <span className="text-xs font-medium text-on-surface-variant">
                  {file.owner}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section: Compliance & Templates Bento Style ── */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-20">
        {/* Compliance Left */}
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold tracking-tight">
              {t('compliance')}
            </h3>
          </div>
          <div className="space-y-4">
            {COMPLIANCE_FILES.map((file) => (
              <div
                key={file.id}
                className="glass-card p-4 rounded-[1rem] flex items-center justify-between hover:bg-white transition-colors"
              >
                <div className="flex items-center gap-4">
                  <Icon
                    name={file.iconName}
                    className="text-tertiary-container"
                  />
                  <div>
                    <p className="font-semibold text-sm">{file.name}</p>
                    <p className="text-xs text-on-surface-variant">
                      {file.category} &bull; {file.size}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <span
                    className={`px-3 py-1 text-[10px] font-bold rounded-full ${
                      file.status === 'verified'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {t(`status.${file.status}`)}
                  </span>
                  <button className="text-on-surface-variant/40 hover:text-on-surface transition-colors">
                    <Icon name="download" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Smart Templates Right (Asymmetric) */}
        <div className="lg:col-span-4 mt-12 lg:mt-0">
          <div className="bg-primary-container p-8 rounded-[1rem] text-white h-full relative overflow-hidden group">
            {/* Subtle mesh background */}
            <div className="absolute inset-0 opacity-20 pointer-events-none bg-gradient-to-br from-white to-transparent" />
            <div className="relative z-10">
              <Icon name="auto_awesome" size="lg" className="mb-4" />
              <h3 className="text-2xl font-bold mb-2">
                {t('smartTemplatesTitle')}
              </h3>
              <p className="text-white/80 text-sm mb-8 leading-relaxed">
                {t('smartTemplatesDescription')}
              </p>
              <ul className="space-y-3 mb-8">
                {SMART_TEMPLATES.map((tmpl) => (
                  <li
                    key={tmpl.labelKey}
                    className="flex items-center gap-2 text-xs font-medium bg-white/10 p-2 rounded-lg"
                  >
                    <Icon name={tmpl.iconName} size="sm" /> {t(tmpl.labelKey)}
                  </li>
                ))}
              </ul>
              <button className="w-full bg-white text-primary py-3 rounded-full font-bold text-sm hover:bg-surface-bright transition-colors shadow-lg">
                {t('browseTemplates')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
