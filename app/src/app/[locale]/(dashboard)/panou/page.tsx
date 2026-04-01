'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { csrfFetch, bootstrapCSRFToken } from '@/lib/csrf/client';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

interface AISession {
  id: string;
  currentStep: number;
  updatedAt: string;
}

interface Project {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function SkeletonCard() {
  return (
    <div className="bg-surface-container-lowest rounded-[1rem] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.04)] animate-pulse">
      <div className="h-4 bg-surface-container-high rounded w-3/4 mb-3" />
      <div className="h-3 bg-surface-container-high rounded w-1/2" />
    </div>
  );
}

export default function PanouPage({ params }: { params: { locale: string } }) {
  const { locale } = params;
  const t = useTranslations('dashboard');
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<AISession | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inputText, setInputText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const [sessRes, projRes] = await Promise.all([
          fetch('/api/ai/orchestrator/sessions?status=active&limit=1'),
          fetch('/api/v1/projects?perPage=3'),
        ]);

        if (sessRes.ok) {
          const sessData = await sessRes.json();
          const sessions: AISession[] = sessData.sessions ?? sessData.data ?? [];
          setActiveSession(sessions[0] ?? null);
        }

        if (projRes.ok) {
          const projData = await projRes.json();
          const projectList: Project[] = projData.projects ?? projData.data ?? [];
          setProjects(projectList);
        }
      } catch {
        // Graceful degradation — show new user state
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  async function handleHeroSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!inputText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await bootstrapCSRFToken();
      const res = await csrfFetch('/api/ai/orchestrator/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: inputText, locale }),
      });
      const { sessionId } = await res.json();
      router.push(`/${locale}/asistent-ai?session=${sessionId}`);
    } catch {
      setSubmitting(false);
    }
  }

  const hours = new Date().getHours();
  const greetingKey =
    hours < 12 ? 'greetingMorning' : hours < 18 ? 'greetingAfternoon' : 'greetingEvening';

  const isNewUser = !loading && projects.length === 0 && !activeSession;
  const isReturning = !loading && (projects.length > 0 || activeSession !== null);

  const heroInput = (compact = false) => (
    <form
      onSubmit={handleHeroSubmit}
      className={`bg-surface-container-lowest rounded-[1.5rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.04)] ${compact ? '' : ''}`}
    >
      <textarea
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        placeholder={t('heroPlaceholder')}
        rows={compact ? 3 : 5}
        className="w-full resize-none bg-transparent text-on-surface placeholder:text-on-surface-variant text-base outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            handleHeroSubmit(e as unknown as React.FormEvent);
          }
        }}
      />
      <div className="flex justify-end mt-4">
        <DsButton type="submit" variant="primary" size="md" disabled={submitting || !inputText.trim()}>
          {submitting ? (
            <span className="flex items-center gap-2">
              <Icon name="progress_activity" className="animate-spin" size="sm" />
              {t('heroCta')}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Icon name="auto_awesome" size="sm" />
              {t('heroCta')}
            </span>
          )}
        </DsButton>
      </div>
    </form>
  );

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto fade-in-up space-y-6">
        <div className="h-8 bg-surface-container-high rounded w-64 animate-pulse" />
        <div className="h-4 bg-surface-container-high rounded w-96 animate-pulse" />
        <div className="bg-surface-container-lowest rounded-[1.5rem] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.04)] animate-pulse h-40" />
        <div className="grid grid-cols-3 gap-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (isNewUser) {
    return (
      <div className="max-w-4xl mx-auto fade-in-up space-y-8">
        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-on-surface">{t('welcome')}</h1>
          <p className="text-on-surface-variant text-base">{t('welcomeSubtitle')}</p>
        </div>

        {/* Hero input */}
        {heroInput(false)}

        {/* Quick-start cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => router.push(`/${locale}/finantari`)}
            className="bg-surface-container-lowest rounded-[1rem] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.04)] text-left hover:shadow-lg hover:-translate-y-[1px] transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center">
                <Icon name="search" size="sm" className="text-primary" />
              </div>
              <span className="font-semibold text-on-surface text-sm">{t('browseCalls')}</span>
            </div>
            <p className="text-on-surface-variant text-xs">{t('quickStartBrowseCallsDesc')}</p>
          </button>

          <button
            onClick={() => router.push(`/${locale}/asistent-ai`)}
            className="bg-surface-container-lowest rounded-[1rem] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.04)] text-left hover:shadow-lg hover:-translate-y-[1px] transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center">
                <Icon name="auto_awesome" size="sm" className="text-primary" />
              </div>
              <span className="font-semibold text-on-surface text-sm">{t('startAI')}</span>
            </div>
            <p className="text-on-surface-variant text-xs">{t('quickStartNewProjectDesc')}</p>
          </button>

          <button
            onClick={() => router.push(`/${locale}/documente`)}
            className="bg-surface-container-lowest rounded-[1rem] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.04)] text-left hover:shadow-lg hover:-translate-y-[1px] transition-all"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center">
                <Icon name="upload_file" size="sm" className="text-primary" />
              </div>
              <span className="font-semibold text-on-surface text-sm">{t('uploadDocs')}</span>
            </div>
            <p className="text-on-surface-variant text-xs">{t('quickStartUploadDesc')}</p>
          </button>
        </div>
      </div>
    );
  }

  // Returning user state
  return (
    <div className="max-w-4xl mx-auto fade-in-up space-y-8">
      {/* Time-of-day greeting */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-on-surface">{t(greetingKey)}</h1>
      </div>

      {/* Continue banner — active session */}
      {activeSession && (
        <div className="bg-surface-container-lowest rounded-[1rem] shadow-[0_20px_40px_rgba(0,0,0,0.04)] border-l-4 border-primary p-5 flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="font-semibold text-on-surface text-sm">{t('continueSession')}</p>
            <p className="text-on-surface-variant text-xs">
              Step {activeSession.currentStep}/7 &middot; {getRelativeTime(activeSession.updatedAt)}
            </p>
          </div>
          <DsButton
            variant="primary"
            size="sm"
            onClick={() => router.push(`/${locale}/asistent-ai?session=${activeSession.id}`)}
          >
            <Icon name="play_arrow" size="sm" />
            {t('resume')}
          </DsButton>
        </div>
      )}

      {/* Recent projects */}
      {projects.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-on-surface text-base">{t('recentProjects')}</h2>
            <button
              onClick={() => router.push(`/${locale}/proiecte`)}
              className="text-primary text-sm font-medium hover:underline"
            >
              {t('viewAll')}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {projects.map((project) => (
              <button
                key={project.id}
                onClick={() => router.push(`/${locale}/proiecte/${project.id}`)}
                className="bg-surface-container-lowest rounded-[1rem] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.04)] text-left hover:shadow-lg hover:-translate-y-[1px] transition-all"
              >
                <p className="font-semibold text-on-surface text-sm mb-2 line-clamp-2">
                  {project.title}
                </p>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary-fixed text-primary font-medium">
                    {project.status}
                  </span>
                  <span className="text-on-surface-variant text-xs">
                    {getRelativeTime(project.updatedAt)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hero input — compact variant at the bottom */}
      <div className="space-y-2">
        <p className="text-on-surface-variant text-sm">{t('heroDescription')}</p>
        {heroInput(true)}
      </div>
    </div>
  );
}
