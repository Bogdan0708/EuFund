'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/ds-icon';
import { DsButton } from '@/components/ui/ds-button';

/* ---------- placeholder data ---------- */
const AI_MODELS = [
  'Claude 3.5 Sonnet (Default)',
  'GPT-4o Omniscient',
  'FondEU Custom Fine-tune',
];

const USAGE_STATS = {
  aiCredits: { used: 840, total: 1000 },
  storage: { used: '12.4 GB', total: '50 GB', percent: 25 },
};

/* ---------- page component ---------- */
export default function SetariPage() {
  const t = useTranslations('settings');
  const [autoApproveEnabled, setAutoApproveEnabled] = useState(true);
  const [dataRetentionEnabled, setDataRetentionEnabled] = useState(true);
  const [crossBorderEnabled, setCrossBorderEnabled] = useState(false);

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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
        {/* ── Profile Card ── */}
        <div className="glass-card rounded-[1rem] p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-primary">
              <Icon name="person" />
              <span className="text-xs font-bold uppercase tracking-widest">
                {t('personalIdentity')}
              </span>
            </div>
            <button className="text-primary text-sm font-semibold hover:underline">
              {t('editProfile')}
            </button>
          </div>
          <div className="flex items-center space-x-6">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary/20 to-secondary/20 ring-4 ring-white shadow-lg flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">MC</span>
              </div>
              <div className="absolute inset-0 bg-black/20 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <Icon name="photo_camera" className="text-white" />
              </div>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-on-surface">
                Marcus Chen
              </h3>
              <p className="text-on-surface-variant">m.chen@inov-euro.org</p>
              <div className="mt-2 inline-flex items-center px-3 py-1 bg-surface-container-highest rounded-full text-[12px] font-medium text-on-surface-variant">
                <Icon name="business" size="sm" className="mr-1" />
                InovEuro Collective
              </div>
            </div>
          </div>
        </div>

        {/* ── AI Preferences Card ── */}
        <div className="glass-card rounded-[1rem] p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]">
          <div className="flex items-center space-x-3 text-secondary">
            <Icon name="auto_awesome" filled />
            <span className="text-xs font-bold uppercase tracking-widest">
              {t('curatorIntelligence')}
            </span>
          </div>
          <div className="space-y-6">
            <div className="flex flex-col space-y-2">
              <label className="text-xs font-bold text-on-surface-variant opacity-60 uppercase">
                {t('llmModel')}
              </label>
              <div className="relative">
                <select className="w-full bg-surface-container-low border-none rounded-xl py-3 px-4 appearance-none focus:ring-2 focus:ring-primary/20 text-on-surface font-medium">
                  {AI_MODELS.map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
                <Icon
                  name="expand_more"
                  className="absolute right-4 top-3 pointer-events-none opacity-40"
                />
              </div>
            </div>
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
                  checked={autoApproveEnabled}
                  onChange={() => setAutoApproveEnabled(!autoApproveEnabled)}
                />
                <div className="w-11 h-6 bg-surface-container-highest rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-secondary" />
              </label>
            </div>
          </div>
        </div>

        {/* ── Subscription Card ── */}
        <div className="glass-card rounded-[1rem] p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3 text-tertiary">
              <Icon name="payments" />
              <span className="text-xs font-bold uppercase tracking-widest">
                {t('subscriptionStatus')}
              </span>
            </div>
            <span className="px-4 py-1 bg-tertiary-fixed text-on-tertiary-fixed text-[11px] font-bold rounded-full uppercase tracking-tighter">
              Enterprise
            </span>
          </div>
          <div className="space-y-6">
            {/* AI Credits */}
            <div className="space-y-3">
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                <span>{t('aiCredits')}</span>
                <span>
                  {USAGE_STATS.aiCredits.used} / {USAGE_STATS.aiCredits.total}
                </span>
              </div>
              <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full bg-tertiary-container rounded-full"
                  style={{
                    width: `${(USAGE_STATS.aiCredits.used / USAGE_STATS.aiCredits.total) * 100}%`,
                  }}
                />
              </div>
            </div>
            {/* Storage */}
            <div className="space-y-3">
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-on-surface-variant">
                <span>{t('storageLabel')}</span>
                <span>
                  {USAGE_STATS.storage.used} / {USAGE_STATS.storage.total}
                </span>
              </div>
              <div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-container rounded-full"
                  style={{ width: `${USAGE_STATS.storage.percent}%` }}
                />
              </div>
            </div>
          </div>
          <DsButton className="w-full py-4">{t('manageBilling')}</DsButton>
        </div>

        {/* ── GDPR & Privacy Card ── */}
        <div className="glass-card rounded-[1rem] p-10 flex flex-col space-y-8 shadow-[0_20px_40px_rgba(0,0,0,0.02)] transition-all hover:translate-y-[-4px]">
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
                  onChange={() =>
                    setDataRetentionEnabled(!dataRetentionEnabled)
                  }
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
        </div>
      </div>

      {/* ── Footer Section ── */}
      <div className="mt-32 flex flex-col md:flex-row justify-between items-center opacity-40 text-[12px] font-medium text-on-surface-variant uppercase tracking-widest gap-6">
        <div className="flex space-x-8">
          <a
            className="hover:text-primary transition-colors"
            href="#"
          >
            {t('privacyPolicy')}
          </a>
          <a
            className="hover:text-primary transition-colors"
            href="#"
          >
            {t('termsOfService')}
          </a>
          <a
            className="hover:text-primary transition-colors"
            href="#"
          >
            {t('complianceHub')}
          </a>
        </div>
        <div>{t('footerBuild')}</div>
      </div>
    </div>
  );
}
