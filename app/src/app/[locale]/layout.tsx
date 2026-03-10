import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/lib/i18n';
import AuthSessionProvider from '@/components/providers/session-provider';
import { CookieConsentBanner } from '@/components/ui/cookie-consent';
import { getNonce } from '@/lib/security/nonce';
import '@/app/globals.css';

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  return {
    title: locale === 'en'
      ? 'FondEU – European Funding Platform'
      : 'FondEU – Platforma de Finanțări Europene',
    description: locale === 'en'
      ? 'AI-powered platform for preparing EU funding applications for Romanian organizations.'
      : 'Platformă AI pentru pregătirea cererilor de finanțare europeană pentru organizații din România.',
  };
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!locales.includes(locale as (typeof locales)[number])) notFound();

  const [messages, nonce] = await Promise.all([getMessages({ locale }), getNonce()]);

  return (
    <html lang={locale}>
      <head>
        {nonce && (
          <meta name="csp-nonce" content={nonce} />
        )}
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <AuthSessionProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            {children}
            <CookieConsentBanner />
          </NextIntlClientProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
