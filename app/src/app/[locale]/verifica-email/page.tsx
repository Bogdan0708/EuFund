'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { GlassCard } from '@/components/glass/GlassCard';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const locale = ((params.locale as string) || 'ro') === 'en' ? 'en' : 'ro';
  const [status, setStatus] = useState<Status>('loading');
  const hasRequested = useRef(false);

  const content = useMemo(() => {
    if (locale === 'en') {
      return {
        title: 'Email verification',
        loading: 'Verifying your email address...',
        success: 'Email verified!',
        successDesc: 'Your email has been confirmed. You can now sign in.',
        error: 'Expired or invalid link',
        errorDesc: 'The verification link has expired or is invalid. Please request a new one.',
        login: 'Go to sign in',
      };
    }

    return {
      title: 'Verificare email',
      loading: 'Verificăm adresa ta de email...',
      success: 'Email verificat!',
      successDesc: 'Adresa ta de email a fost confirmată. Poți acum să te autentifici.',
      error: 'Link expirat sau invalid',
      errorDesc: 'Link-ul de verificare a expirat sau este invalid. Solicită unul nou.',
      login: 'Mergi la autentificare',
    };
  }, [locale]);

  useEffect(() => {
    if (hasRequested.current) {
      return;
    }
    hasRequested.current = true;

    const runVerification = async () => {
      if (!token) {
        setStatus('error');
        return;
      }

      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        setStatus(response.ok ? 'success' : 'error');
      } catch {
        setStatus('error');
      }
    };

    void runVerification();
  }, [token]);

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[var(--bg-base)]">
      <GlassCard
        hover={false}
        className="w-full max-w-md p-10 flex flex-col items-center gap-4 text-center"
      >
        <h1 className="text-2xl font-semibold text-[var(--text-primary)] tracking-tight">
          {content.title}
        </h1>

        {status === 'loading' && (
          <p className="text-sm text-[var(--text-secondary)]">{content.loading}</p>
        )}

        {status === 'success' && (
          <>
            <div className="px-4 py-3 rounded-[var(--input-radius)] bg-[rgba(34,197,94,0.1)] border border-[rgba(34,197,94,0.25)] text-[var(--success)] text-sm w-full">
              {content.success}
            </div>
            <p className="text-sm text-[var(--text-secondary)]">{content.successDesc}</p>
            <Link
              href={`/${locale}/autentificare`}
              className="inline-flex items-center justify-center font-medium rounded-[var(--btn-radius)] transition-all duration-[var(--transition-fast)] bg-[var(--accent)] text-white hover:brightness-110 px-6 py-2.5 text-[15px] mt-2"
            >
              {content.login}
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="px-4 py-3 rounded-[var(--input-radius)] bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.25)] text-[var(--danger)] text-sm w-full">
              {content.error}
            </div>
            <p className="text-sm text-[var(--text-secondary)]">{content.errorDesc}</p>
            <Link
              href={`/${locale}/autentificare`}
              className="inline-flex items-center justify-center font-medium rounded-[var(--btn-radius)] transition-all duration-[var(--transition-fast)] bg-[var(--accent)] text-white hover:brightness-110 px-6 py-2.5 text-[15px] mt-2"
            >
              {content.login}
            </Link>
          </>
        )}
      </GlassCard>
    </main>
  );
}
