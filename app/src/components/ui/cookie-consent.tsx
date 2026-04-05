'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

type ConsentStatus = 'granted' | 'withdrawn';

interface ConsentRecord {
  id: string;
  consentType: string;
  status: ConsentStatus;
}

const i18n = {
  ro: {
    title: 'Preferințe cookie',
    description: 'Cookie-urile esențiale sunt active permanent. Alegeți dacă permiteți analytics și marketing.',
    privacyLink: 'Vezi politica de confidențialitate',
    essential: 'Esențiale',
    essentialDesc: 'Necesare pentru autentificare și securitate.',
    analyticsDesc: 'Măsoară utilizarea produsului.',
    marketingDesc: 'Comunicări promoționale personalizate.',
    rejectAll: 'Respinge toate opționale',
    savePrefs: 'Salvează preferințe',
    acceptAll: 'Acceptă toate',
    hasConsent: 'Cel puțin un consent opțional activ.',
    noConsent: 'Niciun consent opțional activ.',
  },
  en: {
    title: 'Cookie preferences',
    description: 'Essential cookies are always active. Choose whether to allow analytics and marketing.',
    privacyLink: 'View privacy policy',
    essential: 'Essential',
    essentialDesc: 'Required for authentication and security.',
    analyticsDesc: 'Measures product usage.',
    marketingDesc: 'Personalized promotional communications.',
    rejectAll: 'Reject all optional',
    savePrefs: 'Save preferences',
    acceptAll: 'Accept all',
    hasConsent: 'At least one optional consent is active.',
    noConsent: 'No optional consent active.',
  },
};

const CONSENT_VERSION = process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION || 'v1';
const STORAGE_KEY = `eufund:cookie-consent-dismissed:${CONSENT_VERSION}`;
/**
 * Settings page writes this flag to force the banner to re-open even if
 * backend consent records already exist. Cleared when the user makes a
 * new choice via the banner.
 */
export const FORCE_SHOW_KEY = 'eufund:cookie-consent-force-show';

function hasAuthSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;

  return document.cookie.split('; ').some((cookie) =>
    cookie.startsWith('authjs.session-token')
    || cookie.startsWith('__Secure-authjs.session-token')
  );
}

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
      // Force-show flag (set from settings' "Manage cookies") wins over
      // stored dismissal AND backend consent records. Users can re-visit
      // their choice without us deleting their existing consent audit trail.
      const forceShow =
        typeof window !== 'undefined' && localStorage.getItem(FORCE_SHOW_KEY) === '1';

      if (!forceShow && typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') {
        if (!cancelled) {
          setVisible(false);
          setLoading(false);
        }
        return;
      }

      try {
        // Check for session cookie before fetching authenticated endpoint.
        // This avoids a 401 console error on every unauthenticated page load.
        if (!hasAuthSessionCookie()) {
          // Show basic cookie banner for unauthenticated users (GDPR compliance)
          if (!cancelled) {
            setVisible(true);
            setLoading(false);
          }
          return;
        }

        const csrfToken = getCsrfToken();
        const res = await fetch('/api/auth/consent', {
          headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
        });

        if (!res.ok) {
          if (!cancelled) {
            setVisible(true);
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
          // Force-show overrides "has records" check
          setVisible(forceShow || (!analytics && !marketing));
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
      if (hasAuthSessionCookie()) {
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
      }

      setAnalyticsEnabled(analytics);
      setMarketingEnabled(marketing);
      setVisible(false);
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, '1');
        // User has made a fresh choice — clear the force-show flag
        localStorage.removeItem(FORCE_SHOW_KEY);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!mounted || loading || !visible) return null;

  const t = locale === 'en' ? i18n.en : i18n.ro;

  return (
    <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-3xl rounded-xl glass-card p-4 shadow-xl">
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-black">{t.title}</h2>
          <p className="text-xs text-on-surface">
            {t.description}
            {' '}
            <a
              href={locale === 'en' ? '/en/privacy-policy' : '/ro/politica-de-confidentialitate'}
              className="underline underline-offset-2"
            >
              {t.privacyLink}
            </a>
          </p>
        </div>

        <div className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-md border p-2">
            <p className="font-medium">{t.essential}</p>
            <p className="text-xs text-on-surface">{t.essentialDesc}</p>
          </div>
          <label className="rounded-md border p-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-medium">Analytics</p>
                <p className="text-xs text-on-surface">{t.analyticsDesc}</p>
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
                <p className="text-xs text-on-surface">{t.marketingDesc}</p>
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
            {t.rejectAll}
          </Button>
          <Button variant="outline" size="sm" onClick={() => persistConsent(analyticsEnabled, marketingEnabled)} disabled={saving}>
            {t.savePrefs}
          </Button>
          <Button size="sm" onClick={() => persistConsent(true, true)} disabled={saving}>
            {t.acceptAll}
          </Button>
          <span className="self-center text-xs text-on-surface">
            {hasOptionalConsent ? t.hasConsent : t.noConsent}
          </span>
        </div>
      </div>
    </div>
  );
}
