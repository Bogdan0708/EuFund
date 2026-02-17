'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
        success: '✅ Email verified!',
        error: '❌ Expired or invalid link',
        login: 'Go to login',
      };
    }

    return {
      title: 'Verificare email',
      loading: 'Verificăm adresa ta de email...',
      success: '✅ Email verificat!',
      error: '❌ Link expirat sau invalid',
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
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle>{content.title}</CardTitle>
        </CardHeader>
        <CardContent>
          {status === 'loading' && <p>{content.loading}</p>}
          {status === 'success' && <p className="text-green-600">{content.success}</p>}
          {status === 'error' && <p className="text-red-600">{content.error}</p>}
        </CardContent>
        {status === 'success' && (
          <CardFooter className="justify-center">
            <Button asChild>
              <Link href={`/${locale}/autentificare`}>{content.login}</Link>
            </Button>
          </CardFooter>
        )}
      </Card>
    </main>
  );
}
