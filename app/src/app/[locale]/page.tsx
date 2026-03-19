'use client';

import { useSession } from 'next-auth/react';
import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChatPage } from '@/components/chat/ChatPage';

function LandingPage() {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="max-w-4xl text-center">
        <h1 className="mb-2 text-5xl font-bold text-primary">
          FondEU
        </h1>
        <Badge variant="secondary" className="mb-6">
          {locale === 'ro'
            ? 'Platforma AI pentru Finantari Europene'
            : 'AI Platform for European Funding'}
        </Badge>
        <p className="mb-8 text-lg text-muted-foreground max-w-2xl mx-auto">
          {locale === 'ro'
            ? 'Platforma inteligenta pentru pregatirea cererilor de finantare europeana. Verificare automata a conformitatii, generare de propuneri si potrivire cu apeluri de proiecte.'
            : 'Intelligent platform for preparing EU funding applications. Automated compliance checking, proposal generation and grant matching.'}
        </p>
        <div className="flex gap-4 justify-center mb-12">
          <Button asChild size="lg">
            <Link href={`/${locale}/autentificare`}>{t('auth.login')}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/${locale}/inregistrare`}>{t('auth.register')}</Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {locale === 'ro' ? 'Generare AI' : 'AI Generation'}
              </CardTitle>
              <CardDescription>
                {locale === 'ro'
                  ? 'Propuneri de proiect generate automat pe baza ghidului solicitantului'
                  : 'Auto-generated project proposals based on the applicant guide'}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {locale === 'ro' ? 'Conformitate' : 'Compliance'}
              </CardTitle>
              <CardDescription>
                {locale === 'ro'
                  ? 'Verificare automata a eligibilitatii si conformitatii cu cerintele UE'
                  : 'Automated eligibility and EU compliance checking'}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {locale === 'ro' ? 'Potrivire Granturi' : 'Grant Matching'}
              </CardTitle>
              <CardDescription>
                {locale === 'ro'
                  ? 'Identificarea automata a apelurilor de finantare potrivite organizatiei'
                  : 'Automatically find funding calls matching your organization'}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    </main>
  );
}

export default function HomePage() {
  const { status } = useSession();

  // Show loading state while checking auth
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-border)]"
          style={{ borderTopColor: 'var(--color-accent)' }}
        />
      </div>
    );
  }

  if (status === 'authenticated') {
    return <ChatPage />;
  }

  return <LandingPage />;
}
