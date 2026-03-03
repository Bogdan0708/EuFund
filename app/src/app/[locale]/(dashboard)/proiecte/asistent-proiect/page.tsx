import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { orgMembers, organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { ProjectWizard } from '@/components/ai/ProjectWizard';

export default async function ProjectWizardPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { callId?: string; idea?: string };
}) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect(`/${locale}/autentificare`);

  const memberships = await db.select({
    id: organizations.id,
    name: organizations.name,
    type: organizations.orgType,
    sector: organizations.caenPrimary,
  })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(eq(orgMembers.userId, userId));

  return (
    <ProjectWizard
      userOrgs={memberships}
      initialCallId={searchParams.callId ?? null}
      initialIdea={searchParams.idea ?? undefined}
      locale={locale}
    />
  );
}
