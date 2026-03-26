import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Locale } from '@/lib/i18n';
import { getPricingTiers, type BillingTier } from '@/lib/integrations/stripe/billing';

type Tier = {
  tier: BillingTier;
  features: string[];
};

const copy = {
  ro: {
    badge: 'Prețuri FondEU',
    title: 'Alege planul potrivit pentru echipa ta',
    description: 'Începe cu un trial de 30 de zile cu funcții Pro, apoi rămâi pe Free sau treci la un plan plătit pentru volume mai mari și suport prioritar.',
    ctaLoggedOut: 'Ai deja cont? Autentifică-te',
    ctaManageSubscription: 'Gestionează abonamentul',
    tiers: [
      {
        tier: 'free',
        features: [
          'Trial Pro 30 de zile pentru utilizatori noi',
          'Până la 1.000 cereri AI/lună',
          'Instrumente de bază pentru proiecte',
          'Suport prin documentație',
        ],
      },
      {
        tier: 'pro',
        features: [
          'Până la 25.000 cereri AI/lună',
          'Fluxuri avansate pentru conformitate',
          'Suport prioritar',
        ],
      },
      {
        tier: 'enterprise',
        features: [
          'Până la 200.000 cereri AI/lună',
          'Politici și audit pentru echipe extinse',
          'Suport dedicat',
        ],
      },
    ] satisfies Tier[],
  },
  en: {
    badge: 'FondEU Pricing',
    title: 'Pick the plan that fits your team',
    description: 'Start with a 30-day Pro trial, then stay on Free or upgrade for higher usage and priority support.',
    ctaLoggedOut: 'Already have an account? Log in',
    ctaManageSubscription: 'Manage subscription',
    tiers: [
      {
        tier: 'free',
        features: [
          '30-day Pro trial for new users',
          'Up to 1,000 AI requests/month',
          'Core project tooling',
          'Documentation support',
        ],
      },
      {
        tier: 'pro',
        features: [
          'Up to 25,000 AI requests/month',
          'Advanced compliance workflows',
          'Priority support',
        ],
      },
      {
        tier: 'enterprise',
        features: [
          'Up to 200,000 AI requests/month',
          'Team-wide governance and audit controls',
          'Dedicated support',
        ],
      },
    ] satisfies Tier[],
  },
} as const;

function getTierCta(locale: Locale, tier: BillingTier): { label: string; href: string } {
  if (tier === 'free') {
    return {
      label: locale === 'en' ? 'Start 30-day trial' : 'Începe trialul de 30 de zile',
      href: locale === 'en' ? '/en/autentificare' : '/ro/autentificare',
    };
  }

  if (tier === 'pro') {
    return {
      label: locale === 'en' ? 'Upgrade to Pro' : 'Treci la Pro',
      href: '/api/billing/checkout?tier=pro&interval=monthly',
    };
  }

  return {
    label: locale === 'en' ? 'Choose Enterprise' : 'Alege Enterprise',
    href: '/api/billing/checkout?tier=enterprise&interval=monthly',
  };
}

function formatPrice(amount: number): string {
  return `EUR ${amount}`;
}

export function PricingPage({ locale }: { locale: Locale }) {
  const content = copy[locale === 'en' ? 'en' : 'ro'];
  const pricingTiers = getPricingTiers();
  const tiers = content.tiers.map((tier) => {
    const pricing = pricingTiers.find((entry) => entry.tier === tier.tier);
    if (!pricing) {
      throw new Error(`Missing pricing tier definition for ${tier.tier}`);
    }

    return {
      ...tier,
      displayName: pricing.displayName,
      price: formatPrice(pricing.monthlyPriceEur),
      subtitle: locale === 'en' ? 'month' : 'lună',
      cta: getTierCta(locale, tier.tier),
    };
  });

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
          {tiers.map((tier) => (
            <Card key={tier.tier} className="flex h-full flex-col">
              <CardHeader>
                <CardTitle>{tier.displayName}</CardTitle>
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
                  <Link href={tier.cta.href}>{tier.cta.label}</Link>
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
