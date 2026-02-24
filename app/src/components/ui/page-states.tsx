import Link from 'next/link';
import { ReactNode } from 'react';
import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function LoadingState({ label = 'Se încarcă datele...' }: { label?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <span>{label}</span>
      </CardContent>
    </Card>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
        <p className="text-sm text-destructive">{message}</p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry}>
            Reîncearcă
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  icon,
}: {
  title: string;
  description: string;
  actionHref?: string;
  actionLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
        <span className="rounded-full bg-muted p-3 text-muted-foreground" aria-hidden="true">
          {icon || <Inbox className="h-5 w-5" />}
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="max-w-lg text-sm text-muted-foreground">{description}</p>
        {actionHref && actionLabel && (
          <Button asChild>
            <Link href={actionHref}>{actionLabel}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
