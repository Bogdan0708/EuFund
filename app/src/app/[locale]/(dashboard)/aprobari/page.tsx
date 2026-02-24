import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBadge } from '@/components/ui/status-badge';

const approvalItems = [
  { id: 'A-102', title: 'Q1 narrative report', owner: 'North Region Partner', status: 'pending' as const },
  { id: 'A-103', title: 'Equipment invoice pack', owner: 'Central Office', status: 'changes' as const },
  { id: 'A-104', title: 'Milestone M3 completion note', owner: 'External Auditor', status: 'approved' as const },
];

export default function ApprovalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Review queue for submissions, requests for change, and approval decisions."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pending actions</CardTitle>
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
                <Button size="sm" variant="outline">Open</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
