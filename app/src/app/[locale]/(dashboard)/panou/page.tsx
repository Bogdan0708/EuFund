'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { csrfFetch } from '@/lib/csrf/client';
import { relativeTime } from '@/lib/utils';
import { Icon } from '@/components/ui/ds-icon';
import { staggerContainer, staggerItem, staggerTransition } from '@/lib/motion';

interface V3Session {
  id: string;
  projectTitle: string | null;
  currentPhase: string;
  status: string;
  messageSummary: string | null;
  sectionCount: number;
  updatedAt: string;
}

interface Project {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
}

function getProgressPercent(status: string): number {
  switch (status) {
    case 'deschis': return 100;
    case 'in_lucru': return 60;
    case 'ciorna': return 20;
    default: return 30;
  }
}

export default function PanouPage({ params }: { params: { locale: string } }) {
  const { locale } = params;
  const t = useTranslations('dashboard');
  const tSession = useTranslations('session');
  const router = useRouter();
  const { data: session } = useSession();

  const [loading, setLoading] = useState(true);
  const [activeSession, setActiveSession] = useState<V3Session | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [inputText, setInputText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [greetingKey, setGreetingKey] = useState('greetingMorning');

  useEffect(() => {
    const hours = new Date().getHours();
    setGreetingKey(
      hours < 12 ? 'greetingMorning' : hours < 18 ? 'greetingAfternoon' : 'greetingEvening'
    );
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const [sessRes, projRes] = await Promise.all([
          csrfFetch('/api/ai/agent/sessions?status=active&limit=1'),
          fetch('/api/v1/projects?perPage=3'),
        ]);

        if (sessRes.ok) {
          const sessData = await sessRes.json();
          const sessions: V3Session[] = sessData.data ?? [];
          setActiveSession(sessions[0] ?? null);
        }

        if (projRes.ok) {
          const projData = await projRes.json();
          const projectList: Project[] = projData.data?.items ?? projData.projects ?? projData.data ?? [];
          setProjects(Array.isArray(projectList) ? projectList : []);
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
    router.push(`/${locale}/proiecte/nou`);
  }

  // Derive first name from session
  const firstName = session?.user?.name?.split(' ')[0] ?? 'Alex';

  if (loading) {
    return (
      <div className="pt-24 px-6 md:px-12 lg:px-24 max-w-[1400px] mx-auto">
        <div className="mb-12 animate-pulse">
          <div className="h-6 bg-surface-container-high rounded w-48 mb-3" />
          <div className="h-4 bg-surface-container-high rounded w-80" />
        </div>
        <div className="mb-24">
          <div className="h-16 bg-surface-container-high rounded w-96 mb-8 animate-pulse" />
          <div className="glass p-2 rounded-full h-14 w-full max-w-2xl animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-24">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass p-8 rounded-lg h-40 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const hasReturningContent = projects.length > 0 || !!activeSession;

  return (
    <div className="pt-24 px-6 md:px-12 lg:px-24 max-w-[1400px] mx-auto">
      {/* Greeting Banner */}
      <motion.div
        className="mb-12"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
      >
        <h2 className="text-lg font-medium text-primary">
          {t(greetingKey)}, {firstName}
        </h2>
        <p className="text-on-surface-variant">{t('welcomeSubtitle')}</p>
      </motion.div>

      {/* Hero Section */}
      <section className="mb-24 text-center md:text-left">
        <motion.h1
          className="text-5xl md:text-7xl font-bold tracking-[-0.03em] text-on-surface leading-tight mb-8 max-w-4xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          {t('heroTitle')}
        </motion.h1>
        <motion.div
          className="relative max-w-2xl"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <form onSubmit={handleHeroSubmit}>
            <div className="glass p-2 rounded-full flex items-center shadow-xl">
              <Icon name="search" className="ml-6 text-on-surface-variant" size="md" />
              <input
                className="bg-transparent border-none focus:ring-0 flex-1 px-4 py-3 text-lg placeholder:text-on-surface-variant/70 outline-none"
                placeholder={t('heroPlaceholder')}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
              />
              <button
                type="submit"
                disabled={submitting || !inputText.trim()}
                className="bg-[#2997FF] hover:bg-[#0071E3] text-white px-8 py-3 rounded-full font-semibold transition-all hover:translate-y-[-1px] active:scale-95 shadow-lg shadow-blue-500/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <Icon name="progress_activity" className="animate-spin" size="sm" />
                ) : (
                  t('heroCta')
                )}
              </button>
            </div>
          </form>
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2 scrollbar-hide px-4">
            <span className="text-xs font-medium text-on-surface-variant px-3 py-1 bg-surface-container-high rounded-full whitespace-nowrap">
              {t('chipDigitalization')}
            </span>
            <span className="text-xs font-medium text-on-surface-variant px-3 py-1 bg-surface-container-high rounded-full whitespace-nowrap">
              {t('chipGreenEnergy')}
            </span>
            <span className="text-xs font-medium text-on-surface-variant px-3 py-1 bg-surface-container-high rounded-full whitespace-nowrap">
              {t('chipStartup')}
            </span>
          </div>
        </motion.div>
      </section>

      {/* Quick-start Glass Cards */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-24"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        <motion.div
          variants={staggerItem}
          transition={staggerTransition}
          className="glass p-8 rounded-lg group hover:bg-white transition-all duration-300 cursor-pointer"
          onClick={() => router.push(`/${locale}/proiecte/nou`)}
        >
          <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center text-primary mb-6 group-hover:scale-110 transition-transform">
            <Icon name="add_circle" filled size="lg" />
          </div>
          <h3 className="text-xl font-bold mb-2">{t('quickStartNewProject')}</h3>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            {t('quickStartNewProjectDesc')}
          </p>
        </motion.div>

        <motion.div
          variants={staggerItem}
          transition={staggerTransition}
          className="glass p-8 rounded-lg group hover:bg-white transition-all duration-300 cursor-pointer"
          onClick={() => router.push(`/${locale}/asistent-ai`)}
        >
          <div className="w-12 h-12 bg-secondary/10 rounded-2xl flex items-center justify-center text-secondary mb-6 group-hover:scale-110 transition-transform">
            <Icon name="manage_search" filled size="lg" />
          </div>
          <h3 className="text-xl font-bold mb-2">{t('quickStartBrowseCalls')}</h3>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            {t('quickStartBrowseCallsDesc')}
          </p>
        </motion.div>

        <motion.div
          variants={staggerItem}
          transition={staggerTransition}
          className="glass p-8 rounded-lg group hover:bg-white transition-all duration-300 cursor-pointer"
          onClick={() => router.push(`/${locale}/documente`)}
        >
          <div className="w-12 h-12 bg-tertiary-container/10 rounded-2xl flex items-center justify-center text-tertiary mb-6 group-hover:scale-110 transition-transform">
            <Icon name="upload_file" filled size="lg" />
          </div>
          <h3 className="text-xl font-bold mb-2">{t('quickStartUpload')}</h3>
          <p className="text-on-surface-variant text-sm leading-relaxed">
            {t('quickStartUploadDesc')}
          </p>
        </motion.div>
      </motion.div>

      {/* Returning User Content */}
      {hasReturningContent && (
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-3 gap-12 items-start"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut', delay: 0.2 }}
        >
          {/* Continue Session & Recent Projects */}
          <div className="lg:col-span-2 space-y-12">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold tracking-tight">{t('continueActivity')}</h3>
              <button
                onClick={() => router.push(`/${locale}/proiecte`)}
                className="text-primary text-sm font-semibold hover:underline"
              >
                {t('viewAll')}
              </button>
            </div>

            <div className="bg-surface-container-low rounded-lg p-1 space-y-1">
              {/* Active AI session row */}
              {activeSession && (
                <div
                  className="bg-white rounded-[1.5rem] p-6 shadow-sm flex items-center gap-6 group cursor-pointer border border-transparent hover:border-outline-variant/20 transition-all"
                  onClick={() => router.push(`/${locale}/proiecte/nou?session=${activeSession.id}`)}
                >
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-primary/10 flex items-center justify-center text-primary">
                    <Icon name="smart_toy" filled size="lg" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-bold text-lg">
                      {activeSession.projectTitle ?? tSession('untitledProject')}
                    </h4>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        {tSession(`phase.${activeSession.currentPhase}`)}
                      </span>
                      <span className="text-xs text-on-surface-variant">
                        {tSession('sections', { count: activeSession.sectionCount })}
                      </span>
                      <span className="text-xs text-on-surface-variant flex items-center gap-1">
                        <Icon name="schedule" size="sm" />
                        {relativeTime(activeSession.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <Icon
                    name="chevron_right"
                    className="text-on-surface-variant group-hover:translate-x-1 transition-transform"
                    size="md"
                  />
                </div>
              )}

              {/* Recent project rows */}
              {projects.map((project, idx) => {
                const pct = getProgressPercent(project.status);
                return (
                  <div
                    key={project.id}
                    className={`${idx === 0 && !activeSession ? 'bg-white' : 'bg-white/50'} rounded-[1.5rem] p-6 flex items-center gap-6 group cursor-pointer hover:bg-white transition-all`}
                    onClick={() => router.push(`/${locale}/proiecte/${project.id}`)}
                  >
                    <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 bg-primary/10 flex items-center justify-center text-primary">
                      <Icon name="business" size="lg" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-bold text-lg line-clamp-1">{project.title}</h4>
                      <div className="flex items-center gap-4 mt-1">
                        <span className="text-xs text-on-surface-variant flex items-center gap-1">
                          <Icon name="schedule" size="sm" />
                          {relativeTime(project.updatedAt)}
                        </span>
                        <div className="w-32 h-1.5 bg-surface-container rounded-full overflow-hidden">
                          <div className="bg-primary h-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] font-bold text-primary">{t('complete', { percent: pct })}</span>
                      </div>
                    </div>
                    <Icon
                      name="chevron_right"
                      className="text-on-surface-variant group-hover:translate-x-1 transition-transform"
                      size="md"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top Funding Matches Sidebar */}
          <div className="space-y-8">
            <h3 className="text-2xl font-bold tracking-tight">{t('topMatches')}</h3>
            <div className="space-y-4">
              {/* Match Card 1 */}
              <div className="glass p-6 rounded-lg relative overflow-hidden group transition-all hover:translate-y-[-4px]">
                <div className="absolute top-0 right-0 p-3 bg-primary text-white text-[10px] font-bold rounded-bl-xl">
                  {t('matchPercent', { percent: 98 })}
                </div>
                <h4 className="font-bold text-base pr-12 mb-2">Digital Transformation Grant 2024</h4>
                <p className="text-xs text-on-surface-variant mb-4">
                  {t('matchDescription1')}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-primary">€200,000</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    {t('deadline', { date: '15 Nov' })}
                  </span>
                </div>
              </div>

              {/* Match Card 2 */}
              <div className="glass p-6 rounded-lg relative overflow-hidden group transition-all hover:translate-y-[-4px]">
                <div className="absolute top-0 right-0 p-3 bg-secondary text-white text-[10px] font-bold rounded-bl-xl">
                  {t('matchPercent', { percent: 85 })}
                </div>
                <h4 className="font-bold text-base pr-12 mb-2">Eco-Innovation Seed Fund</h4>
                <p className="text-xs text-on-surface-variant mb-4">
                  {t('matchDescription2')}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-primary">€50,000</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                    {t('deadline', { date: '2 Dec' })}
                  </span>
                </div>
              </div>
            </div>

            {/* AI Assistant Floating Teaser */}
            <div
              className="bg-gradient-to-br from-primary to-secondary p-6 rounded-lg text-white shadow-xl shadow-primary/20 relative overflow-hidden group cursor-pointer"
              onClick={() => router.push(`/${locale}/asistent-ai`)}
            >
              <div className="absolute -right-4 -bottom-4 opacity-20 transform group-hover:scale-125 transition-transform">
                <Icon name="smart_toy" className="text-[9rem]" />
              </div>
              <div className="relative z-10">
                <h4 className="font-bold text-lg mb-1">{t('askAiCurator')}</h4>
                <p className="text-xs opacity-90 mb-4">
                  {t('askAiCuratorHint')}
                </p>
                <button className="bg-white/20 backdrop-blur-md px-4 py-2 rounded-full text-xs font-bold hover:bg-white/30 transition-all">
                  {t('startChat')}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* New user — no returning content, show bottom padding */}
      {!hasReturningContent && <div className="pb-24" />}
    </div>
  );
}
