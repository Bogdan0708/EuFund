interface SectionStateBadgeProps {
  state: 'draft' | 'reviewed' | 'approved';
  locale?: 'ro' | 'en';
  className?: string;
}

const STATE_CONFIG: Record<string, { labelRo: string; labelEn: string; className: string }> = {
  draft: { labelRo: 'Ciornă', labelEn: 'Draft', className: 'bg-surface-container text-on-surface-variant' },
  reviewed: { labelRo: 'Verificat', labelEn: 'Reviewed', className: 'bg-amber-50 text-amber-700' },
  approved: { labelRo: 'Aprobat', labelEn: 'Approved', className: 'bg-green-50 text-green-700' },
};

export function SectionStateBadge({ state, locale = 'ro', className }: SectionStateBadgeProps) {
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.draft;
  const label = locale === 'en' ? config.labelEn : config.labelRo;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className} ${className ?? ''}`}>
      {label}
    </span>
  );
}
