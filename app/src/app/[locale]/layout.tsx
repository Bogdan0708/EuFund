import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { locales } from '@/lib/i18n';
import AuthSessionProvider from '@/components/providers/session-provider';
import { CookieConsentBanner } from '@/components/ui/cookie-consent';
import { getNonce } from '@/lib/security/nonce';
import '@/app/globals.css';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

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
    <html lang={locale} className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
        {nonce && (
          <meta name="csp-nonce" content={nonce} />
        )}
      </head>
      <body className="min-h-screen bg-background text-on-surface antialiased">
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
