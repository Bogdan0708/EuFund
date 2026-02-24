import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const toneClass: Record<StatusTone, string> = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  info: 'bg-sky-100 text-sky-700 border-sky-200',
  success: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-100 text-amber-800 border-amber-200',
  danger: 'bg-rose-100 text-rose-700 border-rose-200',
};

const projectStatusMap: Record<string, { label: string; tone: StatusTone; description: string }> = {
  ciorna: { label: 'Draft', tone: 'neutral', description: 'Work in progress, not submitted.' },
  in_lucru: { label: 'In Progress', tone: 'info', description: 'Active preparation and updates.' },
  verificare: { label: 'Under Review', tone: 'warning', description: 'Waiting for reviewer feedback.' },
  finalizat: { label: 'Completed', tone: 'success', description: 'Implementation completed.' },
  depus: { label: 'Submitted', tone: 'info', description: 'Submitted to managing authority.' },
  aprobat: { label: 'Approved', tone: 'success', description: 'Approved for implementation/funding.' },
  respins: { label: 'Rejected', tone: 'danger', description: 'Rejected. Change request expected.' },
  arhivat: { label: 'Archived', tone: 'neutral', description: 'Closed and archived.' },
};

const callStatusMap: Record<string, { label: string; tone: StatusTone; description: string }> = {
  open: { label: 'Open', tone: 'success', description: 'Applications are currently accepted.' },
  forthcoming: { label: 'Forthcoming', tone: 'warning', description: 'Call not yet open for submission.' },
  closed: { label: 'Closed', tone: 'neutral', description: 'Submission window has ended.' },
};

const reviewStatusMap: Record<string, { label: string; tone: StatusTone; description: string }> = {
  draft: { label: 'Draft', tone: 'neutral', description: 'The item is still being prepared.' },
  pending: { label: 'Pending', tone: 'warning', description: 'Waiting for action.' },
  approved: { label: 'Approved', tone: 'success', description: 'Validated and accepted.' },
  changes: { label: 'Needs Changes', tone: 'danger', description: 'User must revise and resubmit.' },
};

interface StatusBadgeProps {
  kind: 'project' | 'call' | 'review';
  value: string;
}

export function StatusBadge({ kind, value }: StatusBadgeProps) {
  const source = kind === 'project' ? projectStatusMap : kind === 'call' ? callStatusMap : reviewStatusMap;
  const resolved = source[value] || {
    label: value,
    tone: 'neutral' as const,
    description: 'Status provided by source system.',
  };

  return (
    <Badge
      variant="outline"
      title={resolved.description}
      className={cn('font-medium', toneClass[resolved.tone])}
    >
      {resolved.label}
    </Badge>
  );
}
