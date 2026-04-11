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

interface SessionUser {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  tier?: string;
}

// Value strings must match the ai_model_preference enum in db/schema.ts.
// Labels reflect the actual models invoked by the gateway (see gateway.ts).
const AI_MODEL_OPTIONS = [
  { value: 'auto', label: 'Auto — Best model per step (recommended)', provider: 'Mixed' },
  // Anthropic
  { value: 'claude-sonnet', label: 'Claude Sonnet 4.6', provider: 'Anthropic' },
  { value: 'claude-haiku', label: 'Claude Haiku 4.6', provider: 'Anthropic' },
  // OpenAI
  { value: 'gpt-4o', label: 'GPT-5.4', provider: 'OpenAI' },
  { value: 'gpt-4o-mini', label: 'GPT-5.4 Mini', provider: 'OpenAI' },
  { value: 'gpt-4o-nano', label: 'GPT-5.4 Nano', provider: 'OpenAI' },
  // Google
  { value: 'gemini-pro', label: 'Gemini 3.1 Pro', provider: 'Google' },
  { value: 'gemini-flash', label: 'Gemini 3 Flash', provider: 'Google' },
  { value: 'nano-banana', label: 'Nano Banana', provider: 'Google' },
  // Perplexity
  { value: 'perplexity', label: 'Perplexity Sonar Pro', provider: 'Perplexity' },
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

// GDPR toggle preferences are persisted locally via localStorage.
// Real consent records live in the audit trail via /api/auth/consent —
// these toggles are workstation-level conveniences, not legal consent
// bookkeeping (which is handled by the cookie banner + consent API).
const GDPR_STORAGE_KEY = 'fondeu:gdpr-prefs:v1';

interface GdprPrefs {
  dataRetention: boolean;
  crossBorder: boolean;
}

function loadGdprPrefs(): GdprPrefs {
  if (typeof window === 'undefined') return { dataRetention: true, crossBorder: false };
  try {
    const raw = window.localStorage.getItem(GDPR_STORAGE_KEY);
    if (!raw) return { dataRetention: true, crossBorder: false };
    const parsed = JSON.parse(raw) as Partial<GdprPrefs>;
    return {
      dataRetention: parsed.dataRetention ?? true,
      crossBorder: parsed.crossBorder ?? false,
    };
  } catch {
    return { dataRetention: true, crossBorder: false };
  }
}

function saveGdprPrefs(prefs: GdprPrefs): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GDPR_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort — storage quota/disabled cookies shouldn't crash the page
  }
}

/* ---------- page component ---------- */
export default function SetariPage({ params }: { params: { locale: string } }) {
  void params
  const t = useTranslations('settings');

  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [savedPreferences, setSavedPreferences] = useState<Preferences | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // GDPR toggles persisted to localStorage (legal consent lives in audit DB)
  const [gdprPrefs, setGdprPrefs] = useState<GdprPrefs>({ dataRetention: true, crossBorder: false });
  useEffect(() => {
    setGdprPrefs(loadGdprPrefs());
  }, []);

  const updateGdpr = (key: keyof GdprPrefs) => {
    setGdprPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveGdprPrefs(next);
      return next;
    });
  };

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/session').then(r => r.json()).catch(() => null),
      fetch('/api/v1/user/preferences').then(r => r.json()).catch(() => ({ defaultModel: 'auto', responseStyle: 'detailed', autoApprove: false })),
      fetch('/api/v1/organizations').then(r => r.json()).catch(() => ({ data: { items: [] } })),
    ]).then(([session, prefs, orgs]) => {
      setSessionUser(session?.user || null);
      const normalizedPrefs: Preferences = {
        defaultModel: prefs?.defaultModel || 'auto',
        responseStyle: prefs?.responseStyle || 'detailed',
        autoApprove: prefs?.autoApprove ?? false,
      };
      setPreferences(normalizedPrefs);
      setSavedPreferences(normalizedPrefs);
      setOrg(orgs?.data?.items?.[0] || null);
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
      const res = await csrfFetch('/api/v1/user/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preferences),
      });
      // csrfFetch returns the Response without throwing on non-2xx — check explicitly
      if (!res.ok) {
        throw new Error(`Save failed: HTTP ${res.status}`);
      }
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
            <span className="text-[10px] font-medium text-on-surface-variant opacity-60 uppercase tracking-widest">
              {t('languageInTopBar')}
            </span>
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
                  className="w-full bg-surface-container-low border-none rounded-xl py-3 px-4 pr-10 appearance-none focus:ring-2 focus:ring-primary/20 text-on-surface font-medium"
                  value={preferences?.defaultModel || 'auto'}
                  onChange={e => setPreferences(p => p ? { ...p, defaultModel: e.target.value } : p)}
                >
                  {AI_MODEL_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <Icon
                  name="expand_more"
                  className="absolute right-4 top-3 pointer-events-none opacity-40"
                />
              </div>
              <p className="text-[11px] text-on-surface-variant leading-relaxed">
                {t('llmModelHint')}
              </p>
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
                  checked={gdprPrefs.dataRetention}
                  onChange={() => updateGdpr('dataRetention')}
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
                  checked={gdprPrefs.crossBorder}
                  onChange={() => updateGdpr('crossBorder')}
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
          <a
            className="hover:text-primary hover:opacity-100 transition-all"
            href="mailto:support@platformafinantare.eu?subject=Privacy%20Policy%20Request"
          >
            {t('privacyPolicy')}
          </a>
          <a
            className="hover:text-primary hover:opacity-100 transition-all"
            href="mailto:support@platformafinantare.eu?subject=Terms%20of%20Service%20Request"
          >
            {t('termsOfService')}
          </a>
          <button
            type="button"
            className="hover:text-primary hover:opacity-100 transition-all uppercase tracking-widest cursor-pointer"
            onClick={() => {
              // Force-show the banner even when backend consent records exist
              // or the user previously dismissed it. cookie-consent.tsx reads
              // this flag on mount and bypasses both the stored-dismissal
              // check and the "has records → hide" logic. The banner clears
              // this flag when the user makes a fresh choice.
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('eufund:cookie-consent-force-show', '1');
                window.location.reload();
              }
            }}
          >
            {t('manageCookies')}
          </button>
        </div>
        <div>{t('footerBuild')}</div>
      </div>
    </div>
  );
}
