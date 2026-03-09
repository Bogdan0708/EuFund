import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getBillingInfo } from '@/lib/integrations/stripe/billing';
import { requireAuth } from '@/lib/auth/helpers';

type Locale = 'ro' | 'en';

const copy = {
  ro: {
    title: 'Facturare si abonament',
    description: 'Gestioneaza perioada de trial, planul activ si consumul lunar.',
    trialBadge: 'Trial Pro activ',
    trialText: 'Ai acces la functiile Pro in perioada de onboarding.',
    trialEnds: 'Trialul se incheie pe',
    trialDaysLeft: 'Zile ramase',
    currentPlan: 'Plan curent',
    effectivePlan: 'Plan efectiv',
    status: 'Status facturare',
    usage: 'Utilizare AI',
    usageLimit: 'Limita lunara',
    portal: 'Gestioneaza abonamentul',
    upgrade: 'Treci la Pro',
    enterprise: 'Contacteaza pentru Enterprise',
    success: 'Plata a fost initiata. Daca Stripe a confirmat checkout-ul, abonamentul se va actualiza automat.',
  },
  en: {
    title: 'Billing and subscription',
    description: 'Track your trial, active plan, and monthly usage.',
    trialBadge: 'Pro trial active',
    trialText: 'You currently have Pro access during the onboarding trial.',
    trialEnds: 'Trial ends on',
    trialDaysLeft: 'Days remaining',
    currentPlan: 'Current plan',
    effectivePlan: 'Effective plan',
    status: 'Billing status',
    usage: 'AI usage',
    usageLimit: 'Monthly limit',
    portal: 'Manage subscription',
    upgrade: 'Upgrade to Pro',
    enterprise: 'Contact for Enterprise',
    success: 'Checkout was started. If Stripe confirmed payment, your subscription will update automatically.',
  },
} as const;

function formatDate(value: Date | string | null, locale: Locale): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB');
}

function formatStatus(value: string): string {
  return value.replace(/_/g, ' ');
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: Locale }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const { locale } = await params;
  const { checkout } = await searchParams;

  if (locale !== 'ro' && locale !== 'en') {
    redirect('/ro/billing');
  }

  const user = await requireAuth();
  const info = await getBillingInfo(user.id);
  const content = copy[locale];

  return (
    <div className="space-y-6">
      <PageHeader
        title={content.title}
        description={content.description}
        rightSlot={(
          <div className="flex gap-2">
            {info.stripeCustomerId ? (
              <Button asChild variant="outline">
                <Link href="/api/billing/portal">{content.portal}</Link>
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/api/billing/checkout?tier=pro&interval=monthly">{content.upgrade}</Link>
            </Button>
          </div>
        )}
      />

      {checkout === 'success' ? (
        <Card className="border-emerald-200 bg-emerald-50/60">
          <CardContent className="pt-6 text-sm text-emerald-900">
            {content.success}
          </CardContent>
        </Card>
      ) : null}

      {info.isInFreeTrial ? (
        <Card className="border-blue-200 bg-blue-50/60">
          <CardHeader>
            <CardTitle className="text-base">{content.trialBadge}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-slate-700 md:grid-cols-3">
            <div>
              <p className="font-medium text-slate-900">{content.trialText}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">{content.trialEnds}</p>
              <p className="font-medium text-slate-900">{formatDate(info.trialEndsAt, locale)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">{content.trialDaysLeft}</p>
              <p className="font-medium text-slate-900">{info.trialDaysRemaining}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{content.currentPlan}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{content.currentPlan}</span>
              <span className="font-medium uppercase">{info.tier}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{content.effectivePlan}</span>
              <span className="font-medium uppercase">{info.effectiveTier}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{content.status}</span>
              <span className="font-medium uppercase">{formatStatus(info.effectiveSubscriptionStatus)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{content.usage}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{content.usage}</span>
              <span className="font-medium">{info.usage.apiCallsThisMonth}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{content.usageLimit}</span>
              <span className="font-medium">{info.usage.apiCallsLimit}</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-blue-600"
                style={{ width: `${Math.min(info.usage.percentUsed, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Enterprise</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>{locale === 'ro' ? 'Pentru volume mari, audit extins si suport dedicat, foloseste planul Enterprise.' : 'For higher volumes, extended audit controls, and dedicated support, use Enterprise.'}</p>
          <Button asChild variant="outline">
            <Link href="/api/billing/checkout?tier=enterprise&interval=monthly">{content.enterprise}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
