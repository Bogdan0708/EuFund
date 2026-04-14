import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { AppShell } from '@/components/layout/AppShell'

export default async function AppLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const session = await auth()

  if (!session?.user) {
    redirect(`/${locale}/autentificare`)
  }

  const name = session.user.name || session.user.email || ''
  const initials = name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <AppShell userName={name} userInitials={initials}>
      {children}
    </AppShell>
  )
}
