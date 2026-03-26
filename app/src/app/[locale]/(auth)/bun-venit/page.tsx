'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DsInput } from '@/components/ui/ds-input';
import { DsButton } from '@/components/ui/ds-button';

const ORG_TYPES = ['srl', 'sa', 'pfa', 'ong', 'uat', 'institutie_publica', 'altul'] as const;

export default function WelcomePage() {
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const router = useRouter();
  const { data: session } = useSession();
  const t = useTranslations('onboarding');
  const tOrg = useTranslations('orgTypes');

  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationType, setOrganizationType] = useState('');
  const [preferredLang, setPreferredLang] = useState(locale);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (session?.user?.name) {
      setFullName(session.user.name);
    }
  }, [session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(t('fullNameRequired'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          step: 'profile',
          fullName: fullName.trim(),
          organizationName: organizationName.trim() || undefined,
          organizationType: organizationType || undefined,
          preferredLang,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      router.push(`/${locale}/interese`);
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-body mesh-gradient min-h-screen flex flex-col items-center justify-center p-6" style={{ color: '#1a1b1f' }}>
      <div className="fixed top-[-10%] left-[20%] w-[600px] h-[600px] bg-secondary/10 rounded-full blur-[120px] pointer-events-none" />

      <main className="w-full max-w-md z-10">
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-1 rounded-full bg-primary-container" />
          <div className="w-8 h-1 rounded-full bg-outline-variant/30" />
        </div>

        <div className="glass-card rounded-[1rem] p-10 shadow-[0_20px_40px_rgba(0,0,0,0.04)] border border-white/20">
          <div className="text-center mb-8">
            <h1 className="font-headline text-2xl font-bold tracking-tight mb-2" style={{ color: '#1a1b1f' }}>{t('welcomeTitle')}</h1>
            <p className="text-sm" style={{ color: '#414753' }}>{t('welcomeSubtitle')}</p>
          </div>

          {error && (
            <div className="mb-6 px-4 py-3 rounded-[0.75rem] bg-error-container text-on-error-container text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <DsInput
              label={t('fullName')}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t('fullName')}
              required
            />

            <DsInput
              label={t('organizationName')}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              placeholder={t('organizationName')}
            />

            <div>
              <label className="block text-sm font-medium text-on-surface mb-1.5">{t('organizationType')}</label>
              <select
                value={organizationType}
                onChange={(e) => setOrganizationType(e.target.value)}
                className="w-full px-5 py-4 bg-surface-container-high/50 border-none rounded-[0.75rem] text-on-surface outline-none focus:ring-2 focus:ring-primary/20 transition-all duration-200"
              >
                <option value="">{t('organizationType')}</option>
                {ORG_TYPES.map((type) => (
                  <option key={type} value={type}>{tOrg(type)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-on-surface mb-1.5">{t('preferredLanguage')}</label>
              <div className="flex gap-2">
                {(['ro', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setPreferredLang(lang)}
                    className={`flex-1 py-3 rounded-[0.75rem] text-sm font-semibold transition-all ${
                      preferredLang === lang
                        ? 'bg-primary-container text-on-primary'
                        : 'bg-surface-container-high/50 text-on-surface-variant hover:bg-surface-container-highest'
                    }`}
                  >
                    {lang === 'ro' ? 'Română' : 'English'}
                  </button>
                ))}
              </div>
            </div>

            <DsButton type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
              {loading ? '...' : t('continue')}
            </DsButton>
          </form>
        </div>
      </main>
    </div>
  );
}
