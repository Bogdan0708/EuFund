'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Icon } from '@/components/ui/ds-icon';
import { csrfFetch, bootstrapCSRFToken } from '@/lib/csrf/client';
import { staggerContainer, staggerItem, staggerTransition } from '@/lib/motion';

/* ---------- types ---------- */
interface Preferences {
  defaultModel: string;
  responseStyle: string;
  autoApprove: boolean;
}

interface Org {
  name: string;
  orgType: string;
}

interface PricingTier {
  tier: string;
  displayName: string;
  monthlyPriceEur: number;
}

interface SessionUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  tier?: string;
}

const AI_MODEL_OPTIONS = [
  { value: 'auto', label: 'Auto (Recommended)' },
  { value: 'claude-sonnet', label: 'Claude Sonnet' },
  { value: 'gemini-pro', label: 'Gemini Pro' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'perplexity', label: 'Perplexity' },
];

const RESPONSE_STYLE_OPTIONS = [
  { value: 'concise', labelKey: 'styleConcise' },
  { value: 'detailed', labelKey: 'styleDetailed' },
  { value: 'technical', labelKey: 'styleTechnical' },
] as const;

function getInitials(name?: string | null): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---------- page component ---------- */
export default function SetariPage({ params }: { params: { locale: string } }) {
  const t = useTranslations('settings');
  const { locale } = params;

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [savedPreferences, setSavedPreferences] = useState<Preferences | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [pricing, setPricing] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // GDPR toggles — local state only (matching existing behaviour)
  const [dataRetentionEnabled, setDataRetentionEnabled] = useState(true);
  const [crossBorderEnabled, setCrossBorderEnabled] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/session').then(r => r.json()).catch(() => null),
      fetch('/api/v1/user/preferences').then(r => r.json()).catch(() => ({ defaultModel: 'auto', responseStyle: 'detailed', autoApprove: false })),
      fetch('/api/v1/organizations').then(r => r.json()).catch(() => ({ data: { items: [] } })),
      fetch('/api/billing/pricing').then(r => r.json()).catch(() => []),
    ]).then(([session, prefs, orgs, prices]) => {
      setSessionUser(session?.user || null);
      const normalizedPrefs: Preferences = {
        defaultModel: prefs?.defaultModel || 'auto',
        responseStyle: prefs?.responseStyle || 'detailed',
        autoApprove: prefs?.autoApprove ?? false,
      };
      setPreferences(normalizedPrefs);
      setSavedPreferences(normalizedPrefs);
      setOrg(orgs?.data?.items?.[0] || null);
      setPricing(Array.isArray(prices) ? prices : []);
      setLoading(false);
    });
  }, []);

  const preferencesChanged =
    preferences !== null &&
    savedPreferences !== null &&
    JSON.stringify(preferences) !== JSON.stringify(savedPreferences);

  const handleSavePreferences = async () => {
    if (!preferences) return;
    setSaving(true);
    setSaveError(false);
    try {
      await bootstrapCSRFToken();
      await csrfFetch('/api/v1/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      setSavedPreferences({ ...preferences });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      setSaveError(true);
      setTimeout(() => setSaveError(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const handleBillingPortal = async () => {
    try {
      await bootstrapCSRFToken();
      const res = await csrfFetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      // silently fail — portal is optional
    }
  };

  const otherLocale = locale === 'ro' ? 'en' : 'ro';
  const currentTier = (sessionUser as { tier?: string } | null)?.tier || 'free';

  if (loading) {
    return (
      <div className="fade-in-up max-w-[1200px] mx-auto">
        <div className="mb-24">
          <div className="h-14 bg-surface-container-low rounded-xl w-96 animate-pulse mb-6" />
          <div className="h-6 bg-surface-container-low rounded-xl w-2xl animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="glass-card rounded-[1rem] p-10 h-64 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in-up max-w-[1200px] mx-auto">
      {/* ── Hero Header ── */}
      <div className="mb-24">
        <h2 className="text-5xl lg:text-6xl font-bold tracking-tighter text-on-surface mb-6">
          {t('heroTitle')}
        </h2>
        <p className="text-xl text-on-surface-variant max-w-2xl font-light leading-relaxed">
          {t('heroDescription')}
        </p>
      </div>

      {/* ── 2x2 Bento Grid ── */}
      <motion.div
        className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12"
        variants={staggerContainer}
        initial="initial"
        animate="animate"
      >
        {/* ── Profile Card ── */}
        <motion.div
          className="glass-card rounded-lg p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]"
          variants={staggerItem}
          transition={staggerTransition}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-primary">
              <Icon name="person" />
              <span className="text-xs font-bold uppercase tracking-widest">
                {t('personalIdentity')}
              </span>
            </div>
            {/* Language switcher */}
            <div className="flex items-center space-x-1">
              <button
                onClick={() => { window.location.href = `/${locale}/setari`; }}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${locale === 'ro' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary'}`}
              >
                RO
              </button>
              <button
                onClick={() => { window.location.href = `/${otherLocale}/setari`; }}
                className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${locale === 'en' ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:text-primary'}`}
              >
                EN
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 ring-4 ring-white shadow-lg flex items-center justify-center overflow-hidden">
                {sessionUser?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sessionUser.image} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-primary">
                    {getInitials(sessionUser?.name)}
                  </span>
                )}
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-on-surface">
                {sessionUser?.name || '—'}
              </h3>
              <p className="text-on-surface-variant">{sessionUser?.email || '—'}</p>
              {org && (
                <div className="mt-2 inline-flex items-center px-3 py-1 bg-surface-container-highest rounded-full text-[12px] font-medium text-on-surface-variant">
                  <Icon name="business" size="sm" className="mr-1" />
                  {org.name}
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* ── AI Preferences Card ── */}
        <motion.div
          className="glass-card rounded-lg p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]"
          variants={staggerItem}
          transition={staggerTransition}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-secondary">
              <Icon name="auto_awesome" filled />
              <span className="text-xs font-bold uppercase tracking-widest">
                {t('curatorIntelligence')}
              </span>
            </div>
            {preferencesChanged && (
              <button
                onClick={handleSavePreferences}
                disabled={saving}
                className="text-primary text-sm font-semibold hover:underline disabled:opacity-50"
              >
                {saving ? t('saving') : saveSuccess ? t('saved') : t('save')}
              </button>
            )}
            {saveSuccess && !preferencesChanged && (
              <span className="text-secondary text-sm font-semibold">{t('saved')}</span>
            )}
            {saveError && (
              <span className="text-error text-sm font-semibold">{t('saveError')}</span>
            )}
          </div>
          <div className="space-y-6">
            {/* Model selector */}
            <div className="flex flex-col space-y-2">
              <label className="text-xs font-bold text-on-surface-variant opacity-60 uppercase">
                {t('llmModel')}
              </label>
              <div className="relative">
                <select
                  className="w-full bg-surface-container-low border-none rounded-xl py-3 px-4 appearance-none focus:ring-2 focus:ring-primary/20 text-on-surface font-medium"
                  value={preferences?.defaultModel || 'auto'}
                  onChange={e => setPreferences(p => p ? { ...p, defaultModel: e.target.value } : p)}
                >
                  {AI_MODEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <Icon
                  name="expand_more"
                  className="absolute right-4 top-3 pointer-events-none opacity-40"
                />
              </div>
            </div>
            {/* Response style */}
            <div className="flex flex-col space-y-2">
              <label className="text-xs font-bold text-on-surface-variant opacity-60 uppercase">
                {t('responseStyle')}
              </label>
              <div className="relative">
                <select
                  className="w-full bg-surface-container-low border-none rounded-xl py-3 px-4 appearance-none focus:ring-2 focus:ring-primary/20 text-on-surface font-medium"
                  value={preferences?.responseStyle || 'detailed'}
                  onChange={e => setPreferences(p => p ? { ...p, responseStyle: e.target.value } : p)}
                >
                  {RESPONSE_STYLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                  ))}
                </select>
                <Icon
                  name="expand_more"
                  className="absolute right-4 top-3 pointer-events-none opacity-40"
                />
              </div>
            </div>
            {/* Auto-approve toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-on-surface">
                  {t('autoApproveLabel')}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {t('autoApproveDescription')}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={preferences?.autoApprove ?? false}
                  onChange={() => setPreferences(p => p ? { ...p, autoApprove: !p.autoApprove } : p)}
                />
                <div className="w-11 h-6 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary" />
              </label>
            </div>
          </div>
        </motion.div>

        {/* ── Subscription Card ── */}
        <motion.div
          className="glass-card rounded-lg p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]"
          variants={staggerItem}
          transition={staggerTransition}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-tertiary">
              <Icon name="payments" />
              <span className="text-xs font-bold uppercase tracking-widest">
                {t('subscriptionStatus')}
              </span>
            </div>
            <span className="px-4 py-1 bg-tertiary-fixed text-on-tertiary-fixed text-[11px] font-bold rounded-full uppercase tracking-tighter">
              {pricing.find(p => p.tier === currentTier)?.displayName || currentTier}
            </span>
          </div>
          <div className="space-y-4">
            <p className="text-xs font-bold text-on-surface-variant opacity-60 uppercase">{t('currentPlan')}</p>
            {pricing.length > 0 ? (
              <div className="space-y-2">
                {pricing.map(tier => (
                  <div
                    key={tier.tier}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl text-sm ${tier.tier === currentTier ? 'bg-primary/10 text-primary font-semibold' : 'bg-surface-container-low text-on-surface-variant'}`}
                  >
                    <span>{tier.displayName}</span>
                    <span>{tier.monthlyPriceEur === 0 ? t('priceFree') : t('priceMonthly', { price: tier.monthlyPriceEur })}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-6">
                {/* AI Credits placeholder */}
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    <span>{t('aiCredits')}</span>
                    <span>—</span>
                  </div>
                  <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
                    <div className="h-full bg-tertiary-container rounded-full w-0" />
                  </div>
                </div>
                {/* Storage placeholder */}
                <div className="space-y-3">
                  <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                    <span>{t('storageLabel')}</span>
                    <span>—</span>
                  </div>
                  <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
                    <div className="h-full bg-primary-container rounded-full w-0" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <button
            className="w-full bg-primary text-white font-bold py-4 rounded-full hover:translate-y-[-1px] active:scale-[0.98] transition-transform"
            onClick={handleBillingPortal}
          >
            {t('manageBilling')}
          </button>
        </motion.div>

        {/* ── GDPR & Privacy Card ── */}
        <motion.div
          className="glass-card rounded-lg p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]"
          variants={staggerItem}
          transition={staggerTransition}
        >
          <div className="flex items-center space-x-3 text-on-surface-variant">
            <Icon name="security" />
            <span className="text-xs font-bold uppercase tracking-widest">
              {t('gdprPrivacy')}
            </span>
          </div>
          <div className="space-y-6">
            {/* Data Retention */}
            <div className="flex items-start justify-between">
              <div className="max-w-[80%]">
                <p className="font-semibold text-on-surface">
                  {t('dataRetention')}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {t('dataRetentionDescription')}
                </p>
                <p className="text-[10px] text-primary mt-1 font-medium">
                  {t('lastConsented')}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer mt-1">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={dataRetentionEnabled}
                  onChange={() => setDataRetentionEnabled(!dataRetentionEnabled)}
                />
                <div className="w-11 h-6 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-on-surface" />
              </label>
            </div>
            {/* Cross-Border */}
            <div className="flex items-start justify-between">
              <div className="max-w-[80%]">
                <p className="font-semibold text-on-surface">
                  {t('crossBorder')}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {t('crossBorderDescription')}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer mt-1">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={crossBorderEnabled}
                  onChange={() => setCrossBorderEnabled(!crossBorderEnabled)}
                />
                <div className="w-11 h-6 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-on-surface" />
              </label>
            </div>
          </div>
        </motion.div>
      </motion.div>

      {/* ── Footer Section ── */}
      <div className="mt-32 flex flex-col md:flex-row justify-between items-center opacity-40 text-[12px] font-medium text-on-surface-variant uppercase tracking-widest gap-6">
        <div className="flex space-x-8">
          <a className="hover:text-primary transition-colors" href="#">
            {t('privacyPolicy')}
          </a>
          <a className="hover:text-primary transition-colors" href="#">
            {t('termsOfService')}
          </a>
          <a className="hover:text-primary transition-colors" href="#">
            {t('complianceHub')}
          </a>
        </div>
        <div>{t('footerBuild')}</div>
      </div>
    </div>
  );
}
