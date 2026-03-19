'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useParams } from 'next/navigation';

export default function LoginPage() {
  const params = useParams();
  const locale = (params.locale as string) || 'ro';
  const [email, setEmail] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const isRo = locale !== 'en';

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    await signIn('google', { callbackUrl: `/${locale}/` });
  };

  const handleMagicLink = (e: React.FormEvent) => {
    e.preventDefault();
    alert(isRo ? 'Link-uri magice în curând!' : 'Magic links coming soon!');
  };

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
          gap: '1.5rem',
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

        {/* Google sign-in button */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={googleLoading}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.625rem',
            width: '100%',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: googleLoading ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
            color: 'var(--color-text)',
            fontSize: 'var(--font-size-base)',
            fontWeight: 500,
            cursor: googleLoading ? 'not-allowed' : 'pointer',
            transition: 'background var(--transition)',
            fontFamily: 'var(--font-family)',
          }}
          onMouseEnter={(e) => {
            if (!googleLoading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg-secondary)';
          }}
          onMouseLeave={(e) => {
            if (!googleLoading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-bg)';
          }}
        >
          {/* Google SVG icon */}
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
              fill="#4285F4"
            />
            <path
              d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
              fill="#34A853"
            />
            <path
              d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
              fill="#FBBC05"
            />
            <path
              d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.583 9 3.583z"
              fill="#EA4335"
            />
          </svg>
          {googleLoading
            ? (isRo ? 'Se conectează…' : 'Signing in…')
            : (isRo ? 'Continuă cu Google' : 'Continue with Google')}
        </button>

        {/* Divider */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
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
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: 'var(--font-size-base)',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background var(--transition)',
              fontFamily: 'var(--font-family)',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent-hover)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--color-accent)')}
          >
            {isRo ? 'Trimite link magic' : 'Send magic link'}
          </button>
        </form>
      </div>
    </main>
  );
}
