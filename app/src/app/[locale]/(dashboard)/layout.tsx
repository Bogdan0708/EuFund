import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';

export default async function DashboardLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/autentificare`);
  }

  const userName = session.user.name || session.user.email || '';
  const userInitials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  return (
    <AppShell
      locale={locale}
      userName={userName}
      userInitials={userInitials}
      userImage={session.user.image}
    >
      {children}
    </AppShell>
  );
}
