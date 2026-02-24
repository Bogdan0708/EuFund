import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ToastItem = {
  id: string;
  title: string;
  type: 'success' | 'warning' | 'info';
};

export function ToastStack({ items }: { items: ToastItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 space-y-2" aria-live="polite" aria-atomic="true">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            'flex min-w-64 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-lg',
            item.type === 'success' && 'border-emerald-200',
            item.type === 'warning' && 'border-amber-200',
            item.type === 'info' && 'border-sky-200',
          )}
        >
          {item.type === 'success' && <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />}
          {item.type === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />}
          {item.type === 'info' && <Info className="h-4 w-4 text-sky-600" aria-hidden="true" />}
          <span>{item.title}</span>
        </div>
      ))}
    </div>
  );
}
