import { Card, CardContent } from '@/components/ui/card';

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-64 rounded bg-muted animate-pulse" />

      <Card className="animate-pulse">
        <CardContent className="p-8 space-y-6">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-10 w-full rounded-lg bg-muted" />
            </div>
          ))}
          <div className="h-11 w-full rounded-lg bg-muted" />
        </CardContent>
      </Card>
    </div>
  );
}
