'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useParams } from 'next/navigation';
import { GlassCard } from '@/components/glass/GlassCard';
import { GlassInput } from '@/components/glass/GlassInput';
import { GlassButton } from '@/components/glass/GlassButton';

export default function LoginPage() {
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const [email, setEmail] = useState('');
  const [oauthLoading, setOauthLoading] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [error, setError] = useState('');

  const isRo = locale !== 'en';

  const handleOAuthSignIn = async (provider: string) => {
    setOauthLoading(provider);
    setError('');
    await signIn(provider, { callbackUrl: `/${locale}/` });
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError(isRo ? 'Introduceți adresa de email' : 'Enter your email address');
      return;
    }
    setEmailLoading(true);
    setError('');
    try {
      const result = await signIn('email', { email, redirect: false, callbackUrl: `/${locale}/` });
      if (result?.error) {
        setError(isRo ? 'Nu am putut trimite link-ul. Verificați adresa de email.' : 'Could not send link. Check your email address.');
      } else {
        setEmailSent(true);
      }
    } catch {
      setError(isRo ? 'Eroare la trimiterea link-ului' : 'Error sending link');
    } finally {
      setEmailLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-base)]">
      <GlassCard
        hover={false}
        className="w-full max-w-[400px] p-10 flex flex-col gap-4"
      >
        {/* Logo / Title */}
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
            FondEU
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
            {isRo ? 'Intră în cont pentru a continua' : 'Sign in to continue'}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="px-4 py-3 rounded-[var(--input-radius)] bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.25)] text-[var(--danger)] text-sm">
            {error}
          </div>
        )}

        {/* Google */}
        <GlassButton
          type="button"
          variant="ghost"
          size="md"
          onClick={() => handleOAuthSignIn('google')}
          disabled={!!oauthLoading}
          className="w-full gap-2.5"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853" />
            <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05" />
            <path d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.583 9 3.583z" fill="#EA4335" />
          </svg>
          {oauthLoading === 'google'
            ? (isRo ? 'Se conectează…' : 'Signing in…')
            : (isRo ? 'Continuă cu Google' : 'Continue with Google')}
        </GlassButton>

        {/* Microsoft */}
        <GlassButton
          type="button"
          variant="ghost"
          size="md"
          onClick={() => handleOAuthSignIn('microsoft-entra-id')}
          disabled={!!oauthLoading}
          className="w-full gap-2.5"
        >
          <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
          </svg>
          {oauthLoading === 'microsoft-entra-id'
            ? (isRo ? 'Se conectează…' : 'Signing in…')
            : (isRo ? 'Continuă cu Microsoft' : 'Continue with Microsoft')}
        </GlassButton>

        {/* Facebook */}
        <GlassButton
          type="button"
          variant="ghost"
          size="md"
          onClick={() => handleOAuthSignIn('facebook')}
          disabled={!!oauthLoading}
          className="w-full gap-2.5"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
          </svg>
          {oauthLoading === 'facebook'
            ? (isRo ? 'Se conectează…' : 'Signing in…')
            : (isRo ? 'Continuă cu Facebook' : 'Continue with Facebook')}
        </GlassButton>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[var(--border-subtle)]" />
          <span className="text-xs text-[var(--text-tertiary)] whitespace-nowrap">
            {isRo ? 'sau continuă cu email' : 'or continue with email'}
          </span>
          <div className="flex-1 h-px bg-[var(--border-subtle)]" />
        </div>

        {/* Magic link form */}
        {emailSent ? (
          <div className="px-4 py-3 rounded-[var(--input-radius)] bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.25)] text-[var(--success)] text-sm text-center">
            {isRo
              ? 'Link-ul a fost trimis! Verificați email-ul pentru a vă conecta.'
              : 'Link sent! Check your email to sign in.'}
          </div>
        ) : (
          <form onSubmit={handleMagicLink} noValidate className="flex flex-col gap-3">
            <GlassInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isRo ? 'adresa@exemplu.ro' : 'you@example.com'}
              required
            />
            <GlassButton
              type="submit"
              variant="accent"
              size="md"
              disabled={emailLoading}
              className="w-full"
            >
              {emailLoading
                ? (isRo ? 'Se trimite…' : 'Sending…')
                : (isRo ? 'Trimite link magic' : 'Send magic link')}
            </GlassButton>
          </form>
        )}
      </GlassCard>
    </main>
  );
}
