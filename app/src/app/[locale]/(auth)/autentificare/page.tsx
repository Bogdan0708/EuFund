'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useParams } from 'next/navigation';

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

  const btnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.625rem',
    width: '100%',
    padding: '0.75rem 1rem',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-base)',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background var(--transition)',
    fontFamily: 'var(--font-family)',
  };

  const oauthBtn = (provider: string): React.CSSProperties => ({
    ...btnBase,
    background: oauthLoading === provider ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
    cursor: oauthLoading === provider ? 'not-allowed' : 'pointer',
  });

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
        background: 'var(--color-bg-secondary)',
        fontFamily: 'var(--font-family)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: '2.5rem 2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        {/* Logo / Title */}
        <div style={{ textAlign: 'center' }}>
          <h1
            style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 600,
              color: 'var(--color-text)',
              margin: 0,
              letterSpacing: '-0.02em',
            }}
          >
            FondEU
          </h1>
          <p
            style={{
              marginTop: '0.5rem',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            {isRo ? 'Intră în cont pentru a continua' : 'Sign in to continue'}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-error-bg, #fef2f2)',
              color: 'var(--color-error, #dc2626)',
              fontSize: 'var(--font-size-sm)',
            }}
          >
            {error}
          </div>
        )}

        {/* Google */}
        <button
          type="button"
          onClick={() => handleOAuthSignIn('google')}
          disabled={!!oauthLoading}
          style={oauthBtn('google')}
          onMouseEnter={(e) => {
            if (!oauthLoading) e.currentTarget.style.background = 'var(--color-bg-secondary)';
          }}
          onMouseLeave={(e) => {
            if (!oauthLoading) e.currentTarget.style.background = 'var(--color-bg)';
          }}
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
        </button>

        {/* Microsoft */}
        <button
          type="button"
          onClick={() => handleOAuthSignIn('microsoft-entra-id')}
          disabled={!!oauthLoading}
          style={oauthBtn('microsoft-entra-id')}
          onMouseEnter={(e) => {
            if (!oauthLoading) e.currentTarget.style.background = 'var(--color-bg-secondary)';
          }}
          onMouseLeave={(e) => {
            if (!oauthLoading) e.currentTarget.style.background = 'var(--color-bg)';
          }}
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
        </button>

        {/* Facebook */}
        <button
          type="button"
          onClick={() => handleOAuthSignIn('facebook')}
          disabled={!!oauthLoading}
          style={oauthBtn('facebook')}
          onMouseEnter={(e) => {
            if (!oauthLoading) e.currentTarget.style.background = 'var(--color-bg-secondary)';
          }}
          onMouseLeave={(e) => {
            if (!oauthLoading) e.currentTarget.style.background = 'var(--color-bg)';
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" fill="#1877F2" />
          </svg>
          {oauthLoading === 'facebook'
            ? (isRo ? 'Se conectează…' : 'Signing in…')
            : (isRo ? 'Continuă cu Facebook' : 'Continue with Facebook')}
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
          <span
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'nowrap',
            }}
          >
            {isRo ? 'sau continuă cu email' : 'or continue with email'}
          </span>
          <div style={{ flex: 1, height: '1px', background: 'var(--color-border)' }} />
        </div>

        {/* Magic link form */}
        {emailSent ? (
          <div
            style={{
              padding: '1rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-success-bg, #f0fdf4)',
              color: 'var(--color-success, #16a34a)',
              fontSize: 'var(--font-size-sm)',
              textAlign: 'center',
            }}
          >
            {isRo
              ? 'Link-ul a fost trimis! Verificați email-ul pentru a vă conecta.'
              : 'Link sent! Check your email to sign in.'}
          </div>
        ) : (
          <form onSubmit={handleMagicLink} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isRo ? 'adresa@exemplu.ro' : 'you@example.com'}
              required
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                fontSize: 'var(--font-size-base)',
                color: 'var(--color-text)',
                background: 'var(--color-bg)',
                outline: 'none',
                fontFamily: 'var(--font-family)',
                boxSizing: 'border-box',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-border)')}
            />
            <button
              type="submit"
              disabled={emailLoading}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                border: 'none',
                background: emailLoading ? 'var(--color-accent-hover)' : 'var(--color-accent)',
                color: '#fff',
                fontSize: 'var(--font-size-base)',
                fontWeight: 500,
                cursor: emailLoading ? 'not-allowed' : 'pointer',
                transition: 'background var(--transition)',
                fontFamily: 'var(--font-family)',
              }}
              onMouseEnter={(e) => {
                if (!emailLoading) e.currentTarget.style.background = 'var(--color-accent-hover)';
              }}
              onMouseLeave={(e) => {
                if (!emailLoading) e.currentTarget.style.background = 'var(--color-accent)';
              }}
            >
              {emailLoading
                ? (isRo ? 'Se trimite…' : 'Sending…')
                : (isRo ? 'Trimite link magic' : 'Send magic link')}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
