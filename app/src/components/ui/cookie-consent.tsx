'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

type ConsentStatus = 'granted' | 'withdrawn';

interface ConsentRecord {
  id: string;
  consentType: string;
  status: ConsentStatus;
}

const CONSENT_VERSION = process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION || 'v1';
const STORAGE_KEY = `eufund:cookie-consent-dismissed:${CONSENT_VERSION}`;

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('csrf-token='))
    ?.split('=')[1] ?? null;
}

export function CookieConsentBanner() {
  const [mounted, setMounted] = useState(false);
  const [locale, setLocale] = useState('ro');
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [marketingEnabled, setMarketingEnabled] = useState(false);

  const hasOptionalConsent = useMemo(
    () => analyticsEnabled || marketingEnabled,
    [analyticsEnabled, marketingEnabled],
  );

  useEffect(() => {
    setMounted(true);
    setLocale(document.documentElement.lang || 'ro');
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadConsent() {
      if (typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') {
        if (!cancelled) {
          setVisible(false);
          setLoading(false);
        }
        return;
      }

      try {
        const csrfToken = getCsrfToken();
        const res = await fetch('/api/auth/consent', {
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
        });

        if (!res.ok) {
          if (!cancelled) {
            // Hide for unauthenticated users (401), show for others
            setVisible(res.status !== 401);
            setLoading(false);
          }
          return;
        }

        const payload = await res.json();
        const records: ConsentRecord[] = payload?.data ?? [];

        const analytics = records.find((r) => r.consentType === 'analytics');
        const marketing = records.find((r) => r.consentType === 'marketing');

        if (!cancelled) {
          setAnalyticsEnabled(analytics?.status === 'granted');
          setMarketingEnabled(marketing?.status === 'granted');
          setVisible(!analytics && !marketing);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setVisible(true);
          setLoading(false);
        }
      }
    }

    loadConsent();
    return () => {
      cancelled = true;
    };
  }, []);

  async function persistConsent(analytics: boolean, marketing: boolean) {
    setSaving(true);
    try {
      const csrfToken = getCsrfToken();
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      };

      const response = await fetch('/api/auth/consent/bulk', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          consents: [
            { consentType: 'analytics', status: analytics ? 'granted' : 'withdrawn' },
            { consentType: 'marketing', status: marketing ? 'granted' : 'withdrawn' },
          ],
        }),
      });

      if (!response.ok) return;

      setAnalyticsEnabled(analytics);
      setMarketingEnabled(marketing);
      setVisible(false);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, '1');
      }
    } finally {
      setSaving(false);
    }
  }

  if (!mounted || loading || !visible) return null;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-xl border bg-white p-4 shadow-xl">
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Preferințe cookie</h2>
          <p className="text-xs text-muted-foreground">
            Cookie-urile esențiale sunt active permanent. Alegeți dacă permiteți analytics și marketing.
            {' '}
            <a
              href={locale === 'en' ? '/en/privacy-policy' : '/ro/politica-de-confidentialitate'}
              className="underline underline-offset-2"
            >
              Vezi politica de confidențialitate
            </a>
          </p>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md border p-2">
            <p className="font-medium">Esențiale</p>
            <p className="text-xs text-muted-foreground">Necesare pentru autentificare și securitate.</p>
          </div>
          <label className="rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">Analytics</p>
                <p className="text-xs text-muted-foreground">Măsoară utilizarea produsului.</p>
              </div>
              <input
                type="checkbox"
                checked={analyticsEnabled}
                onChange={(e) => setAnalyticsEnabled(e.target.checked)}
                disabled={saving}
              />
            </div>
          </label>
          <label className="rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">Marketing</p>
                <p className="text-xs text-muted-foreground">Comunicări promoționale personalizate.</p>
              </div>
              <input
                type="checkbox"
                checked={marketingEnabled}
                onChange={(e) => setMarketingEnabled(e.target.checked)}
                disabled={saving}
              />
            </div>
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" size="sm" onClick={() => persistConsent(false, false)} disabled={saving}>
            Respinge toate opționale
          </Button>
          <Button variant="outline" size="sm" onClick={() => persistConsent(analyticsEnabled, marketingEnabled)} disabled={saving}>
            Salvează preferințe
          </Button>
          <Button size="sm" onClick={() => persistConsent(true, true)} disabled={saving}>
            Acceptă toate
          </Button>
          <span className="self-center text-xs text-muted-foreground">
            {hasOptionalConsent ? 'Cel puțin un consent opțional activ.' : 'Niciun consent opțional activ.'}
          </span>
        </div>
      </div>
    </div>
  );
}
