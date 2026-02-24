import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

const approvalItems = [
  { id: 'A-102', title: 'Raport narativ T1', owner: 'Partener Regiunea Nord', status: 'pending' as const },
  { id: 'A-103', title: 'Pachet facturi echipamente', owner: 'Birou Central', status: 'changes' as const },
  { id: 'A-104', title: 'Notă finalizare jalon M3', owner: 'Auditor extern', status: 'approved' as const },
];

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprobări"
        description="Coada de revizuire pentru depuneri, cereri de modificare și decizii de aprobare."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Acțiuni în așteptare</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {approvalItems.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
              <div>
                <p className="font-medium">{item.title}</p>
                <p className="text-xs text-muted-foreground">{item.id} • {item.owner}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge kind="review" value={item.status} />
                <Button size="sm" variant="outline">Deschide</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
