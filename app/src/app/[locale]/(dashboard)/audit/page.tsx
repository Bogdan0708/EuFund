import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';

const mockEvents = [
  { id: '1', when: '2026-02-20 10:14', user: 'Project Manager', action: 'Uploaded evidence document', source: 'Documents registry' },
  { id: '2', when: '2026-02-19 15:28', user: 'Reviewer', action: 'Requested changes on periodic report', source: 'Reporting workflow' },
  { id: '3', when: '2026-02-18 09:05', user: 'Org Admin', action: 'Approved budget update', source: 'Project budget module' },
];

export default function AuditLogPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Immutable activity timeline for compliance and operational traceability."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent audit trail events</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-3 text-sm">
            {mockEvents.map((event) => (
              <li key={event.id} className="rounded-lg border p-3">
                <p className="font-medium">{event.action}</p>
                <p className="text-xs text-muted-foreground">{event.when} • {event.user}</p>
                <p className="mt-1 text-xs text-emerald-700">Source of truth: {event.source}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
