'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DsButton } from '@/components/ui/ds-button';

const TOPICS = [
  'digitalization',
  'green_energy',
  'infrastructure',
  'social_inclusion',
  'agriculture',
  'research_innovation',
  'healthcare',
  'education',
  'sme_development',
  'urban_development',
  'tourism',
  'transport',
  'environment',
  'culture',
  'public_administration',
  'energy_efficiency',
] as const;

export default function InterestsPage() {
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const router = useRouter();
  const { update: updateSession } = useSession();
  const t = useTranslations('onboarding');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggle = (topic: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) next.delete(topic);
      else next.add(topic);
      return next;
    });
  };

  const submit = async (interests: string[]) => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'interests', interests }),
      });
      if (!res.ok) throw new Error('Failed');
      // Force JWT refresh so middleware sees onboardingCompleted=true
      await updateSession();
      // Hard navigate to bypass client-side router cache
      window.location.href = `/${locale}/panou`;
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-body mesh-gradient min-h-screen flex flex-col items-center justify-center p-6" style={{ color: '#1a1b1f' }}>
      <div className="fixed top-[-10%] right-[-10%] w-[500px] h-[500px] bg-primary/10 rounded-full blur-[120px] pointer-events-none" />

      <main className="w-full max-w-lg z-10">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-1 rounded-full bg-primary-container" />
          <div className="w-8 h-1 rounded-full bg-primary-container" />
        </div>

        <div className="glass-card rounded-[1rem] p-10 shadow-[0_20px_40px_rgba(0,0,0,0.04)] border border-white/20">
          <div className="text-center mb-8">
            <h1 className="font-headline text-2xl font-bold tracking-tight mb-2" style={{ color: '#1a1b1f' }}>{t('interestsTitle')}</h1>
            <p className="text-sm" style={{ color: '#414753' }}>{t('interestsSubtitle')}</p>
          </div>

          {error && (
            <div className="mb-6 px-4 py-3 rounded-[0.75rem] bg-red-50 text-red-700 text-sm">{error}</div>
          )}

          <div className="flex flex-wrap gap-3 mb-8">
            {TOPICS.map((topic) => (
              <button
                key={topic}
                type="button"
                onClick={() => toggle(topic)}
                className={`px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  selected.has(topic)
                    ? 'bg-[#0071e3] text-white shadow-sm'
                    : 'bg-[#e9e7ed] text-[#414753] hover:bg-[#e3e2e7]'
                }`}
              >
                {t(topic)}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            <DsButton
              variant="primary"
              size="lg"
              className="w-full"
              disabled={loading}
              onClick={() => submit(Array.from(selected))}
            >
              {loading ? '...' : t('startExploring')}
            </DsButton>

            <button
              type="button"
              onClick={() => submit([])}
              disabled={loading}
              className="w-full py-3 text-sm font-medium text-[#414753] hover:text-[#1a1b1f] transition-colors"
            >
              {t('skip')}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
