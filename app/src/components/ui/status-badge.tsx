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
  ciorna: { label: 'Ciornă', tone: 'neutral', description: 'În lucru, nedepus încă.' },
  in_lucru: { label: 'În lucru', tone: 'info', description: 'Pregătire și actualizări active.' },
  verificare: { label: 'În verificare', tone: 'warning', description: 'În așteptarea feedbackului.' },
  finalizat: { label: 'Finalizat', tone: 'success', description: 'Implementare finalizată.' },
  depus: { label: 'Depus', tone: 'info', description: 'Depus către autoritatea de management.' },
  aprobat: { label: 'Aprobat', tone: 'success', description: 'Aprobat pentru finanțare/implementare.' },
  respins: { label: 'Respins', tone: 'danger', description: 'Respins. Sunt necesare modificări.' },
  arhivat: { label: 'Arhivat', tone: 'neutral', description: 'Închis și arhivat.' },
};

const callStatusMap: Record<string, { label: string; tone: StatusTone; description: string }> = {
  open: { label: 'Deschis', tone: 'success', description: 'Se acceptă aplicații în acest moment.' },
  forthcoming: { label: 'În curând', tone: 'warning', description: 'Apelul nu este încă deschis.' },
  closed: { label: 'Închis', tone: 'neutral', description: 'Perioada de depunere s-a încheiat.' },
};

const reviewStatusMap: Record<string, { label: string; tone: StatusTone; description: string }> = {
  draft: { label: 'Ciornă', tone: 'neutral', description: 'Elementul este încă în pregătire.' },
  pending: { label: 'În așteptare', tone: 'warning', description: 'Așteaptă acțiune.' },
  approved: { label: 'Aprobat', tone: 'success', description: 'Validat și acceptat.' },
  changes: { label: 'Necesită modificări', tone: 'danger', description: 'Utilizatorul trebuie să revizuiască și să redepună.' },
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
    description: 'Status furnizat de sistemul sursă.',
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
