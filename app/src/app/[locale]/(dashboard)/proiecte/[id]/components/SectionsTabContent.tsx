'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Icon } from '@/components/ui/ds-icon';
import { MarkdownRender } from '@/components/ui/markdown-render';
import { SectionStateBadge } from '@/components/ui/section-state-badge';
import type { SectionResult } from '@/lib/ai/agent/types';

interface SectionsResponse {
  sections: SectionResult[];
  sessionId: string | null;
  source: 'session' | 'snapshot';
  readOnly: boolean;
}

export function SectionsTabContent({ projectId }: { projectId: string }) {
  const params = useParams();
  const locale = params.locale as string;
  const t = useTranslations('sectionEditor');
  const [data, setData] = useState<SectionsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/sections`);
        if (res.ok) setData(await res.json());
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId]);

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse bg-surface-container rounded-xl h-32" />
        ))}
      </div>
    );
  }

  if (!data || data.sections.length === 0) {
    return (
      <div className="text-center py-16">
        <Icon name="article" size="lg" className="text-on-surface-variant/30 mx-auto mb-4" />
        <p className="text-on-surface-variant">{t('noSections')}</p>
      </div>
    );
  }

  const sorted = [...data.sections].sort((a, b) => a.order - b.order);

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-on-surface-variant">
          {t('sectionCount', { count: data.sections.length })}
        </p>
        <a
          href={`/api/v1/projects/${projectId}/export?format=docx`}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 transition-colors"
        >
          <Icon name="download" size="sm" />
          {t('exportFullDocx')}
        </a>
      </div>

      {/* Section cards */}
      <div className="space-y-3">
        {sorted.map((section, i) => (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="bg-surface border border-outline-variant/15 rounded-xl p-5 hover:border-outline-variant/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-bold text-on-surface-variant bg-surface-container rounded-full w-6 h-6 flex items-center justify-center">
                    {section.order}
                  </span>
                  <h3 className="text-base font-semibold text-on-surface truncate">{section.title}</h3>
                  <SectionStateBadge state={section.state} />
                  <span className="text-xs text-on-surface-variant">v{section.currentVersion}</span>
                </div>
                <div className="line-clamp-3 overflow-hidden">
                  <MarkdownRender content={section.content.slice(0, 300)} />
                </div>
              </div>

              <a
                href={`/${locale}/proiecte/${projectId}/sectiuni/${section.id}`}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 text-primary hover:bg-primary/10"
              >
                <Icon name={data.readOnly ? 'visibility' : 'edit'} size="sm" />
                {data.readOnly ? t('viewAction') : t('editAction')}
              </a>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
