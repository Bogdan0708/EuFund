import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { orgMembers, organizations } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import ConversationalWizard from '@/components/ai/ConversationalWizard';

export default async function AssistantPage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string };
  searchParams: { idea?: string; callId?: string };
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
    <div className="max-w-4xl mx-auto py-6 px-4">
      <ConversationalWizard
        userOrgs={memberships}
        initialIdea={searchParams.idea}
        initialCallId={searchParams.callId}
        locale={locale}
      />
    </div>
  );
}
