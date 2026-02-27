import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser, getUserOrganizations } from '@/lib/auth/session';

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Autentificare',
  'auth.logout': 'Deconectare',
  'auth.register': 'Înregistrare',
  'auth.password_reset': 'Resetare parolă',
  'project.create': 'Creare proiect',
  'project.update': 'Actualizare proiect',
  'project.delete': 'Ștergere proiect',
  'project.status_change': 'Schimbare status proiect',
  'project.evidence_append': 'Adăugare dovadă',
  'document.upload': 'Încărcare document',
  'document.delete': 'Ștergere document',
  'document.download': 'Descărcare document',
  'ai.generate': 'Generare AI',
  'ai.compliance_check': 'Verificare conformitate AI',
  'ai.chat': 'Conversație AI',
  'organization.member_add': 'Adăugare membru',
  'organization.member_remove': 'Eliminare membru',
  'organization.update': 'Actualizare organizație',
  'gdpr.data_export': 'Export date GDPR',
  'gdpr.data_delete': 'Ștergere date GDPR',
};

function formatDate(date: Date | null): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('ro-RO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export default async function AuditLogPage() {
  const user = await requireUser();
  const orgs = await getUserOrganizations(user.id);

  const org = orgs[0];
  let entries: Array<{
    id: string;
    action: string;
    createdAt: string | null;
    userName: string | null;
    resourceType: string | null;
  }> = [];

  if (org?.id) {
    const res = await fetch(`/api/v1/audit?orgId=${org.id}&perPage=50`, { cache: 'no-store' });
    if (res.ok) {
      const payload = await res.json();
      entries = payload?.data ?? [];
    }
  }

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
          {entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Niciun eveniment înregistrat încă.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {entries.map((event) => (
                <li key={event.id} className="rounded-lg border p-3">
                  <p className="font-medium">
                    {ACTION_LABELS[event.action] ?? event.action}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(event.createdAt ? new Date(event.createdAt) : null)} • {event.userName ?? 'Sistem'}
                  </p>
                  {event.resourceType && (
                    <p className="mt-1 text-xs text-emerald-700">
                      Resursă: {event.resourceType}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
