import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { requireUser, getUserOrganizations } from '@/lib/auth/session';
import { ApprovalsClient } from './approvals-client';

export default async function ApprovalsPage() {
  const user = await requireUser();
  const orgs = await getUserOrganizations(user.id);
  const org = orgs[0];

  let pendingProjects: Array<{
    id: string;
    title: string;
    acronym: string | null;
    updatedAt: string | null;
    createdByName: string | null;
  }> = [];

  if (org?.id) {
    const res = await fetch(`/api/v1/approvals?orgId=${org.id}&perPage=50`, { cache: 'no-store' });
    if (res.ok) {
      const payload = await res.json();
      pendingProjects = payload?.data ?? [];
    }
  }

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
        <CardContent>
          {org?.id ? (
            <ApprovalsClient orgId={org.id} initialProjects={pendingProjects} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Nicio organizație disponibilă pentru aprobare.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
