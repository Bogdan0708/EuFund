'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <Card className="max-w-xl mx-auto mt-10">
      <CardHeader>
        <CardTitle className="text-destructive">A apărut o eroare</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {error.message || 'Nu am putut încărca proiectele. Încearcă din nou.'}
        </p>
        <Button onClick={reset}>Reîncearcă</Button>
      </CardContent>
    </Card>
  );
}
