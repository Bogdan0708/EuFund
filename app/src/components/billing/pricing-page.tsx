import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Locale } from '@/lib/i18n';

type Tier = {
  name: string;
  price: string;
  subtitle: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
};

const copy = {
  ro: {
    badge: 'Prețuri FondEU',
    title: 'Alege planul potrivit pentru echipa ta',
    description: 'Începe gratuit, apoi activează Pro sau Enterprise pentru volume mai mari și suport prioritar.',
    ctaLoggedOut: 'Ai deja cont? Autentifică-te',
    ctaManageSubscription: 'Gestionează abonamentul',
    tiers: [
      {
        name: 'Free',
        price: 'EUR 0',
        subtitle: 'lună',
        features: [
          'Până la 1.000 cereri AI/lună',
          'Instrumente de bază pentru proiecte',
          'Suport prin documentație',
        ],
        ctaLabel: 'Începe gratuit',
        ctaHref: '/ro/inregistrare',
      },
      {
        name: 'Pro',
        price: 'EUR 29',
        subtitle: 'lună',
        features: [
          'Până la 25.000 cereri AI/lună',
          'Fluxuri avansate pentru conformitate',
          'Suport prioritar',
        ],
        ctaLabel: 'Treci la Pro',
        ctaHref: '/api/billing/checkout?tier=pro&interval=monthly',
      },
      {
        name: 'Enterprise',
        price: 'EUR 99',
        subtitle: 'lună',
        features: [
          'Până la 200.000 cereri AI/lună',
          'Politici și audit pentru echipe extinse',
          'Suport dedicat',
        ],
        ctaLabel: 'Alege Enterprise',
        ctaHref: '/api/billing/checkout?tier=enterprise&interval=monthly',
      },
    ] satisfies Tier[],
  },
  en: {
    badge: 'FondEU Pricing',
    title: 'Pick the plan that fits your team',
    description: 'Start free, then unlock Pro or Enterprise for higher usage and priority support.',
    ctaLoggedOut: 'Already have an account? Log in',
    ctaManageSubscription: 'Manage subscription',
    tiers: [
      {
        name: 'Free',
        price: 'EUR 0',
        subtitle: 'month',
        features: [
          'Up to 1,000 AI requests/month',
          'Core project tooling',
          'Documentation support',
        ],
        ctaLabel: 'Start for free',
        ctaHref: '/en/inregistrare',
      },
      {
        name: 'Pro',
        price: 'EUR 29',
        subtitle: 'month',
        features: [
          'Up to 25,000 AI requests/month',
          'Advanced compliance workflows',
          'Priority support',
        ],
        ctaLabel: 'Upgrade to Pro',
        ctaHref: '/api/billing/checkout?tier=pro&interval=monthly',
      },
      {
        name: 'Enterprise',
        price: 'EUR 99',
        subtitle: 'month',
        features: [
          'Up to 200,000 AI requests/month',
          'Team-wide governance and audit controls',
          'Dedicated support',
        ],
        ctaLabel: 'Choose Enterprise',
        ctaHref: '/api/billing/checkout?tier=enterprise&interval=monthly',
      },
    ] satisfies Tier[],
  },
} as const;

export function PricingPage({ locale }: { locale: Locale }) {
  const content = copy[locale === 'en' ? 'en' : 'ro'];

  return (
    <main className="min-h-screen bg-background px-6 py-16">
      <div className="mx-auto max-w-6xl">
        <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">{content.badge}</p>
        {/* Manage subscription button - only useful for authenticated users.
           The sidebar already links to /api/billing/portal for logged-in users.
           Hidden here since pricing page is public. */}
        <h1 className="text-4xl font-bold tracking-tight">{content.title}</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">{content.description}</p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {content.tiers.map((tier) => (
            <Card key={tier.name} className="flex h-full flex-col">
              <CardHeader>
                <CardTitle>{tier.name}</CardTitle>
                <p className="text-3xl font-bold">
                  {tier.price}
                  <span className="ml-2 text-sm font-medium text-muted-foreground">/{tier.subtitle}</span>
                </p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <ul className="mb-8 space-y-2 text-sm text-muted-foreground">
                  {tier.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <Button asChild className="mt-auto w-full">
                  <Link href={tier.ctaHref}>{tier.ctaLabel}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-10">
          <Button asChild variant="ghost">
            <Link href={locale === 'en' ? '/en/autentificare' : '/ro/autentificare'}>{content.ctaLoggedOut}</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
