import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { locales } from '@/lib/i18n';
import AuthSessionProvider from '@/components/providers/session-provider';
import { CookieConsentBanner } from '@/components/ui/cookie-consent';
import { getNonce } from '@/lib/security/nonce';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'FondEU – Platforma de Finanțări Europene',
  description: 'Platformă AI pentru pregătirea cererilor de finanțare europeană pentru organizații din România.',
};

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!locales.includes(locale as (typeof locales)[number])) notFound();

  const [messages, nonce] = await Promise.all([getMessages(), getNonce()]);

  return (
    <html lang={locale}>
      <head>
        {nonce && (
          <meta name="csp-nonce" content={nonce} />
        )}
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <AuthSessionProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
            <CookieConsentBanner />
          </NextIntlClientProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
