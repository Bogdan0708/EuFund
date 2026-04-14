'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Clock3 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

type Locale = 'ro' | 'en';

interface BillingInfoResponse {
  isInFreeTrial: boolean;
  trialDaysRemaining: number;
  trialEndsAt: string | null;
}

const copy = {
  ro: {
    activeTitle: 'Trial Pro activ',
    activeDescription: 'Ai acces complet la functiile Pro in perioada de onboarding.',
    endingTitle: 'Trialul tau Pro se apropie de final',
    endingDescription: 'Pastreaza accesul la functiile Pro dupa expirare prin activarea unui abonament platit.',
    daysLeft: 'Zile ramase',
    endsOn: 'Se incheie pe',
    cta: 'Vezi facturarea',
  },
  en: {
    activeTitle: 'Pro trial active',
    activeDescription: 'You currently have full Pro access during onboarding.',
    endingTitle: 'Your Pro trial is about to end',
    endingDescription: 'Keep Pro access after expiry by activating a paid subscription.',
    daysLeft: 'Days remaining',
    endsOn: 'Ends on',
    cta: 'View billing',
  },
} as const;

function formatDate(value: string | null, locale: Locale): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString(locale === 'ro' ? 'ro-RO' : 'en-GB');
}

export function TrialBanner({ locale }: { locale: Locale }) {
  const [billingInfo, setBillingInfo] = useState<BillingInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch('/api/billing/info');
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) {
          setBillingInfo({
            isInFreeTrial: Boolean(payload.isInFreeTrial),
            trialDaysRemaining: Number(payload.trialDaysRemaining || 0),
            trialEndsAt: payload.trialEndsAt || null,
          });
        }
      } catch {
        // Non-critical banner state
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !billingInfo?.isInFreeTrial) {
    return null;
  }

  const content = copy[locale];
  const endingSoon = billingInfo.trialDaysRemaining <= 7;
  const Icon = endingSoon ? AlertTriangle : Clock3;

  return (
    <Alert className={endingSoon ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-blue-200 bg-blue-50 text-blue-950'}>
      <Icon className={endingSoon ? 'text-amber-700' : 'text-blue-700'} />
      <AlertTitle>{endingSoon ? content.endingTitle : content.activeTitle}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p>{endingSoon ? content.endingDescription : content.activeDescription}</p>
          <p className="text-xs uppercase tracking-wide">
            {content.daysLeft}: {billingInfo.trialDaysRemaining} · {content.endsOn}: {formatDate(billingInfo.trialEndsAt, locale)}
          </p>
        </div>
        <Button asChild size="sm" variant={endingSoon ? 'default' : 'outline'}>
          <Link href={`/${locale}/billing`}>{content.cta}</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
