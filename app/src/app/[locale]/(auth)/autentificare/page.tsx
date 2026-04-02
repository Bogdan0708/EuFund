'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DsInput } from '@/components/ui/ds-input';

export default function LoginPage() {
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [error, setError] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const [devPassword, setDevPassword] = useState('');
  const [devLoading, setDevLoading] = useState(false);
  const isDev = process.env.NEXT_PUBLIC_NODE_ENV === 'development' || process.env.NODE_ENV === 'development';

  const handleOAuthSignIn = async (provider: string) => {
    setOauthLoading(provider);
    setError('');
    await signIn(provider, { callbackUrl: `/${locale}/panou` });
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(t('emailRequired'));
      return;
    }
    setEmailLoading(true);
    setError('');
    try {
      const result = await signIn('email', { email, redirect: false, callbackUrl: `/${locale}/panou` });
      if (result?.error) {
        setError(t('magicLinkError'));
      } else {
        setEmailSent(true);
      }
    } catch {
      setError(t('magicLinkError'));
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <div className="font-body text-on-surface bg-background min-h-screen flex flex-col items-center justify-center p-6 selection:bg-primary-fixed selection:text-on-primary-fixed relative overflow-hidden">
      {/* Atmospheric blobs — same as LiveBackground */}
      <div className="fixed top-[-10%] left-[-5%] w-[600px] h-[600px] bg-[#0071E3] opacity-[0.15] rounded-full blur-[120px] pointer-events-none" style={{ animation: 'float-orb-1 25s ease-in-out infinite' }} />
      <div className="fixed bottom-[-10%] right-[-5%] w-[500px] h-[500px] bg-[#4A47D2] opacity-[0.10] rounded-full blur-[120px] pointer-events-none" style={{ animation: 'float-orb-2 30s ease-in-out infinite' }} />
      <div className="fixed top-[40%] left-[30%] w-[400px] h-[400px] bg-[#00637F] opacity-[0.07] rounded-full blur-[120px] pointer-events-none" style={{ animation: 'float-orb-3 35s ease-in-out infinite' }} />

      <main className="w-full max-w-md z-10">
        {/* Login Card */}
        <div className="glass-card rounded-lg p-10 shadow-[0_20px_40px_rgba(0,0,0,0.04)] border border-white/20">
          {/* Branding */}
          <div className="text-center mb-10">
            <h1 className="font-headline text-3xl font-extrabold tracking-tighter text-on-surface mb-2">FondEU</h1>
            <p className="text-on-surface-variant font-medium text-sm tracking-wide">{t('brandSubtitle')}</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 px-4 py-3 rounded-[0.75rem] bg-error-container text-on-error-container text-sm">
              {error}
            </div>
          )}

          {/* OAuth Providers */}
          <div className="space-y-3 mb-8">
            {/* Google */}
            <button
              onClick={() => handleOAuthSignIn('google')}
              disabled={!!oauthLoading}
              className="w-full flex items-center justify-start gap-4 px-6 py-4 bg-surface-container-lowest hover:bg-surface-container-low transition-all duration-[250ms] rounded-[0.75rem] border border-outline-variant/10 text-on-surface font-medium hover:-translate-y-[1px] disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
                <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05" />
                <path d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.583 9 3.583z" fill="#EA4335" />
              </svg>
              {oauthLoading === 'google' ? t('signingIn') : t('continueWithGoogle')}
            </button>

            {/* Microsoft */}
            <button
              onClick={() => handleOAuthSignIn('microsoft-entra-id')}
              disabled={!!oauthLoading}
              className="w-full flex items-center justify-start gap-4 px-6 py-4 bg-surface-container-lowest hover:bg-surface-container-low transition-all duration-[250ms] rounded-[0.75rem] border border-outline-variant/10 text-on-surface font-medium hover:-translate-y-[1px] disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#F25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
                <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
                <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
              </svg>
              {oauthLoading === 'microsoft-entra-id' ? t('signingIn') : t('continueWithMicrosoft')}
            </button>

            {/* Facebook */}
            <button
              onClick={() => handleOAuthSignIn('facebook')}
              disabled={!!oauthLoading}
              className="w-full flex items-center justify-start gap-4 px-6 py-4 bg-surface-container-lowest hover:bg-surface-container-low transition-all duration-[250ms] rounded-[0.75rem] border border-outline-variant/10 text-on-surface font-medium hover:-translate-y-[1px] disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
              </svg>
              {oauthLoading === 'facebook' ? t('signingIn') : t('continueWithFacebook')}
            </button>

            {/* Apple */}
            <button
              onClick={() => handleOAuthSignIn('apple')}
              disabled={!!oauthLoading}
              className="w-full flex items-center justify-start gap-4 px-6 py-4 bg-surface-container-lowest hover:bg-surface-container-low transition-all duration-[250ms] rounded-[0.75rem] border border-outline-variant/10 text-on-surface font-medium hover:-translate-y-[1px] disabled:opacity-50"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </svg>
              {oauthLoading === 'apple' ? t('signingIn') : t('continueWithApple')}
            </button>
          </div>

          {/* Divider */}
          <div className="relative flex items-center py-6">
            <div className="flex-grow border-t border-outline-variant/20" />
            <span className="flex-shrink mx-4 text-xs font-semibold uppercase tracking-widest text-on-surface">{t('orDivider')}</span>
            <div className="flex-grow border-t border-outline-variant/20" />
          </div>

          {/* Magic Link */}
          {emailSent ? (
            <div className="px-4 py-4 rounded-[0.75rem] bg-primary-fixed text-on-primary-fixed text-sm text-center">
              {t('magicLinkSent')}
            </div>
          ) : (
            <section className="space-y-4">
              <h2 className="text-sm font-bold text-on-surface-variant px-1">{t('magicLinkTitle')}</h2>
              <form onSubmit={handleMagicLink} noValidate className="space-y-3">
                <DsInput
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('magicLinkPlaceholder')}
                  required
                />
                <button
                  type="submit"
                  disabled={emailLoading}
                  className="w-full py-4 bg-primary-container hover:bg-primary text-on-primary font-bold rounded-[0.75rem] transition-all duration-[250ms] active:scale-[0.98] hover:-translate-y-[1px] disabled:opacity-50"
                >
                  {emailLoading ? t('sending') : t('magicLinkButton')}
                </button>
                <p className="text-[13px] text-on-surface-variant text-center leading-relaxed px-4">
                  {t('magicLinkHelp')}
                </p>
              </form>
            </section>
          )}
        </div>
      </main>

      {/* Dev Login (development only) */}
      {isDev && (
        <div className="w-full max-w-md z-10 mt-6">
          <div className="rounded-lg p-6 border-2 border-dashed border-yellow-500/50 bg-yellow-500/5">
            <h3 className="text-sm font-bold text-yellow-600 mb-3">Dev Login (local only)</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setDevLoading(true);
                setError('');
                const result = await signIn('credentials', {
                  email: devEmail,
                  password: devPassword,
                  redirect: false,
                  callbackUrl: `/${locale}/panou`,
                });
                setDevLoading(false);
                if (result?.error) {
                  setError('Invalid email or password');
                } else if (result?.url) {
                  window.location.href = result.url;
                }
              }}
              className="space-y-3"
            >
              <input
                type="email"
                value={devEmail}
                onChange={(e) => setDevEmail(e.target.value)}
                placeholder="Email"
                className="w-full px-4 py-3 rounded-lg border border-outline-variant/20 bg-surface-container-lowest text-sm"
              />
              <input
                type="password"
                value={devPassword}
                onChange={(e) => setDevPassword(e.target.value)}
                placeholder="Password"
                className="w-full px-4 py-3 rounded-lg border border-outline-variant/20 bg-surface-container-lowest text-sm"
              />
              <button
                type="submit"
                disabled={devLoading}
                className="w-full py-3 bg-yellow-500 hover:bg-yellow-600 text-white font-bold rounded-lg transition-all disabled:opacity-50 text-sm"
              >
                {devLoading ? 'Signing in...' : 'Dev Sign In'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-16 text-center z-10">
        <div className="text-[13px] font-medium text-on-surface flex items-center justify-center gap-4">
          <span>&copy; 2026 FondEU.</span>
          <div className="flex gap-4">
            <a className="hover:text-primary transition-colors" href={`/${locale}/confidentialitate`}>Privacy Policy</a>
            <span className="text-on-surface/30">&bull;</span>
            <a className="hover:text-primary transition-colors" href={`/${locale}/termeni`}>Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
