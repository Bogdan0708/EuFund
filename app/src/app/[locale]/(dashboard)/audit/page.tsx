import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

const mockEvents = [
  { id: '1', when: '2026-02-20 10:14', user: 'Manager proiect', action: 'A încărcat document justificativ', source: 'Registru documente' },
  { id: '2', when: '2026-02-19 15:28', user: 'Evaluator', action: 'A solicitat modificări la raportul periodic', source: 'Flux raportare' },
  { id: '3', when: '2026-02-18 09:05', user: 'Administrator organizație', action: 'A aprobat actualizarea de buget', source: 'Modul buget proiect' },
];

export default function AuditLogPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Jurnal audit"
        description="Cronologie imuabilă a activităților pentru conformitate și trasabilitate operațională."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evenimente recente în jurnal</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {mockEvents.map((event) => (
              <li key={event.id} className="rounded-lg border p-3">
                <p className="font-medium">{event.action}</p>
                <p className="text-xs text-muted-foreground">{event.when} • {event.user}</p>
                <p className="mt-1 text-xs text-emerald-700">Sursă de adevăr: {event.source}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
