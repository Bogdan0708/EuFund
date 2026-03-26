'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { DsCard } from '@/components/ui/ds-card';
import { DsButton } from '@/components/ui/ds-button';

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
      loading: 'Verificam adresa ta de email...',
      success: 'Email verificat!',
      successDesc: 'Adresa ta de email a fost confirmata. Poti acum sa te autentifici.',
      error: 'Link expirat sau invalid',
      errorDesc: 'Link-ul de verificare a expirat sau este invalid. Solicita unul nou.',
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
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <DsCard
        className="w-full max-w-md p-10 flex flex-col items-center gap-4 text-center"
      >
        <h1 className="text-2xl font-semibold text-on-surface tracking-tight">
          {content.title}
        </h1>

        {status === 'loading' && (
          <p className="text-sm text-on-surface-variant">{content.loading}</p>
        )}

        {status === 'success' && (
          <>
            <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm w-full">
              {content.success}
            </div>
            <p className="text-sm text-on-surface-variant">{content.successDesc}</p>
            <DsButton variant="primary" size="md" asChild className="mt-2">
              <Link href={`/${locale}/autentificare`}>
                {content.login}
              </Link>
            </DsButton>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="px-4 py-3 rounded-xl bg-error-container text-on-error-container text-sm w-full">
              {content.error}
            </div>
            <p className="text-sm text-on-surface-variant">{content.errorDesc}</p>
            <DsButton variant="primary" size="md" asChild className="mt-2">
              <Link href={`/${locale}/autentificare`}>
                {content.login}
              </Link>
            </DsButton>
          </>
        )}
      </DsCard>
    </main>
  );
}
