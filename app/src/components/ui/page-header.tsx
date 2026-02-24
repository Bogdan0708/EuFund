import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  rightSlot?: ReactNode;
  meta?: ReactNode;
}

export function PageHeader({ title, description, rightSlot, meta }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card/90 p-5 shadow-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {meta && <div className="pt-1">{meta}</div>}
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </div>
  );
}
