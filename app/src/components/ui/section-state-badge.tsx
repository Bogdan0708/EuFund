interface SectionStateBadgeProps {
  state: 'draft' | 'reviewed' | 'approved';
  className?: string;
}

const STATE_CONFIG: Record<string, { label: string; labelEn: string; className: string }> = {
  draft: { label: 'Ciornă', labelEn: 'Draft', className: 'bg-surface-container text-on-surface-variant' },
  reviewed: { label: 'Verificat', labelEn: 'Reviewed', className: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Aprobat', labelEn: 'Approved', className: 'bg-green-50 text-green-700' },
};

export function SectionStateBadge({ state, className }: SectionStateBadgeProps) {
  const config = STATE_CONFIG[state] ?? STATE_CONFIG.draft;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${config.className} ${className ?? ''}`}>
      {config.label}
    </span>
  );
}
